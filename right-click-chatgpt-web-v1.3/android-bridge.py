#!/usr/bin/env python3
import json
import os
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HOST = "127.0.0.1"
PORT = 8765
MAX_TEXT = 30000
SCRIPT_DIR = Path(__file__).resolve().parent

_cached_adb = None
_cached_serial = None


def find_adb():
    global _cached_adb
    if _cached_adb and Path(_cached_adb).is_file():
        return _cached_adb

    candidates = []
    env_adb = os.environ.get("ADB_PATH", "").strip().strip('"')
    if env_adb:
        candidates.append(Path(env_adb))

    which_adb = shutil.which("adb") or shutil.which("adb.exe")
    if which_adb:
        candidates.append(Path(which_adb))

    candidates.extend([
        SCRIPT_DIR / "adb.exe",
        SCRIPT_DIR / "platform-tools" / "adb.exe",
        Path.cwd() / "adb.exe",
        Path.cwd() / "platform-tools" / "adb.exe",
        Path(r"C:\platform-tools\adb.exe"),
    ])

    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        candidates.append(Path(local_app_data) / "Android" / "Sdk" / "platform-tools" / "adb.exe")

    seen = set()
    for candidate in candidates:
        try:
            resolved = candidate.expanduser().resolve()
        except Exception:
            resolved = candidate
        key = str(resolved).lower()
        if key in seen:
            continue
        seen.add(key)
        if resolved.is_file():
            _cached_adb = str(resolved)
            return _cached_adb

    return None


def run_process(args, timeout=8):
    creationflags = 0
    if os.name == "nt" and hasattr(subprocess, "CREATE_NO_WINDOW"):
        creationflags = subprocess.CREATE_NO_WINDOW

    try:
        result = subprocess.run(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            creationflags=creationflags,
            check=False,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError("ADB phản hồi quá lâu.")
    except OSError as exc:
        raise RuntimeError(f"Không chạy được ADB: {exc}")

    stdout = result.stdout.decode("utf-8", errors="replace").strip()
    stderr = result.stderr.decode("utf-8", errors="replace").strip()

    if result.returncode != 0:
        detail = stderr or stdout or f"exit code {result.returncode}"
        raise RuntimeError(detail)

    return stdout


def list_devices(adb):
    output = run_process([adb, "devices"], timeout=4)
    devices = []
    unauthorized = []
    offline = []

    for line in output.splitlines()[1:]:
        line = line.strip()
        if not line or "\t" not in line:
            continue
        serial, state = line.split("\t", 1)
        state = state.strip()
        if state == "device":
            devices.append(serial)
        elif state == "unauthorized":
            unauthorized.append(serial)
        elif state == "offline":
            offline.append(serial)

    if not devices:
        if unauthorized:
            raise RuntimeError("Điện thoại chưa cấp quyền USB debugging. Hãy bấm Allow trên điện thoại.")
        if offline:
            raise RuntimeError("Thiết bị ADB đang offline. Hãy rút/cắm lại cáp hoặc khởi động lại ADB.")
        raise RuntimeError("Không thấy thiết bị Android qua ADB.")

    preferred = os.environ.get("ANDROID_SERIAL", "").strip()
    if preferred:
        if preferred not in devices:
            raise RuntimeError(f"ANDROID_SERIAL={preferred} không nằm trong danh sách thiết bị đang kết nối.")
        return preferred

    if len(devices) > 1:
        joined = ", ".join(devices)
        raise RuntimeError(f"Có nhiều thiết bị ADB: {joined}. Hãy đặt biến ANDROID_SERIAL để chọn máy.")

    return devices[0]


def get_device(adb):
    global _cached_serial
    if _cached_serial:
        return _cached_serial
    _cached_serial = list_devices(adb)
    return _cached_serial


def clean_value(value):
    value = str(value or "").replace("\r", " ").replace("\n", " ")
    return " ".join(value.split()).strip()


def isolate_ui_xml(raw_text):
    raw_text = str(raw_text or "")

    hierarchy_start = raw_text.find("<hierarchy")
    if hierarchy_start < 0:
        raise RuntimeError("ADB không trả về UI XML.")

    xml_decl = raw_text.rfind("<?xml", 0, hierarchy_start + 1)
    start = xml_decl if xml_decl >= 0 else hierarchy_start

    end_tag = "</hierarchy>"
    end = raw_text.find(end_tag, hierarchy_start)
    if end < 0:
        raise RuntimeError("UIAutomator trả về XML chưa hoàn chỉnh.")

    end += len(end_tag)
    return raw_text[start:end].strip()


def extract_text_from_xml(xml_text):
    xml_text = isolate_ui_xml(xml_text)

    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise RuntimeError(f"Không đọc được UI XML từ Android: {exc}")

    lines = []
    seen = set()

    for node in root.iter("node"):
        for key in ("text", "content-desc", "hint"):
            value = clean_value(node.attrib.get(key, ""))
            if not value or value in seen:
                continue
            seen.add(value)
            lines.append(value)

    text = "\n".join(lines).strip()
    if len(text) > MAX_TEXT:
        text = text[:MAX_TEXT].rstrip() + "\n[Đã cắt bớt vì màn hình có quá nhiều text]"

    return text, len(lines)


def dump_ui_xml(base):
    # Fast path: one ADB process, no temporary file/pull.
    try:
        direct = run_process(base + ["exec-out", "uiautomator", "dump", "/dev/tty"], timeout=6)
        if "<hierarchy" in direct and "</hierarchy>" in direct:
            # Validate/crop here so extra UIAutomator status text cannot break parsing.
            return isolate_ui_xml(direct)
    except Exception:
        pass

    # Compatibility fallback for devices where /dev/tty dump is unsupported or noisy.
    run_process(base + ["shell", "uiautomator", "dump", "/sdcard/window.xml"], timeout=8)
    fallback = run_process(base + ["exec-out", "cat", "/sdcard/window.xml"], timeout=4)
    return isolate_ui_xml(fallback)


def read_android_screen_text():
    global _cached_serial

    adb = find_adb()
    if not adb:
        raise RuntimeError(
            "Không tìm thấy adb.exe. Hãy thêm ADB vào PATH hoặc đặt biến ADB_PATH trỏ tới adb.exe của scrcpy/platform-tools."
        )

    serial = get_device(adb)
    base = [adb, "-s", serial]

    try:
        xml_text = dump_ui_xml(base)
    except Exception:
        # Device may have been unplugged/reconnected; refresh once.
        _cached_serial = None
        serial = get_device(adb)
        base = [adb, "-s", serial]
        xml_text = dump_ui_xml(base)

    text, items = extract_text_from_xml(xml_text)
    return {
        "ok": True,
        "text": text,
        "items": items,
        "device": serial,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "AndroidTextBridge/1.2"

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/health":
            self.send_json(200, {"ok": True, "bridge": "running", "adbFound": bool(find_adb())})
            return

        if path != "/screen-text":
            self.send_json(404, {"ok": False, "error": "Not found"})
            return

        try:
            self.send_json(200, read_android_screen_text())
        except Exception as exc:
            self.send_json(500, {"ok": False, "error": str(exc)})

    def log_message(self, fmt, *args):
        print(f"[bridge] {self.address_string()} - {fmt % args}")


def main():
    print("=" * 58)
    print(" Android UI text → ChatGPT local bridge")
    print(f" http://{HOST}:{PORT}")
    print(" Nhấn Ctrl+C để dừng.")
    print("=" * 58)

    adb = find_adb()
    if adb:
        print(f"ADB: {adb}")
        try:
            print(f"Device: {get_device(adb)}")
        except Exception as exc:
            print(f"CẢNH BÁO: {exc}")
    else:
        print("CẢNH BÁO: Chưa tìm thấy adb.exe.")
        print("Có thể đặt: set ADB_PATH=C:\\duong-dan\\adb.exe")

    server = ThreadingHTTPServer((HOST, PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nĐã dừng bridge.")
    finally:
        server.server_close()


if __name__ == "__main__":
    try:
        main()
    except OSError as exc:
        print(f"Không thể mở bridge tại {HOST}:{PORT}: {exc}")
        sys.exit(1)
