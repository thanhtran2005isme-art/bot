#!/usr/bin/env python3
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HOST = "127.0.0.1"
PORT = 8765
MAX_TEXT = 30000
MIN_UI_ITEMS = 5
MIN_UI_CHARS = 100
SCRIPT_DIR = Path(__file__).resolve().parent
FAST_OCR = os.environ.get("RCGPT_FAST_OCR", "1").strip().lower() not in {"0", "false", "no", "off"}

_cached_adb = None
_cached_serial = None
_cached_tesseract = None
_cached_ocr_language = None
_prefer_pull_screenshot = False


def _creationflags():
    if os.name == "nt" and hasattr(subprocess, "CREATE_NO_WINDOW"):
        return subprocess.CREATE_NO_WINDOW
    return 0


def run_process(args, timeout=8, label="process"):
    try:
        result = subprocess.run(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            creationflags=_creationflags(),
            check=False,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"{label} phản hồi quá lâu.")
    except OSError as exc:
        raise RuntimeError(f"Không chạy được {label}: {exc}")

    stdout = result.stdout.decode("utf-8", errors="replace").strip()
    stderr = result.stderr.decode("utf-8", errors="replace").strip()
    if result.returncode != 0:
        raise RuntimeError(stderr or stdout or f"exit code {result.returncode}")
    return stdout


def run_process_bytes(args, timeout=8, label="process"):
    try:
        result = subprocess.run(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            creationflags=_creationflags(),
            check=False,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"{label} phản hồi quá lâu.")
    except OSError as exc:
        raise RuntimeError(f"Không chạy được {label}: {exc}")

    if result.returncode != 0:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(detail or f"exit code {result.returncode}")
    return result.stdout


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


def list_devices(adb):
    output = run_process([adb, "devices"], timeout=4, label="ADB")
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
        raise RuntimeError(f"Có nhiều thiết bị ADB: {', '.join(devices)}. Hãy đặt ANDROID_SERIAL để chọn máy.")
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


def limit_text(text):
    text = str(text or "").strip()
    if len(text) > MAX_TEXT:
        return text[:MAX_TEXT].rstrip() + "\n[Đã cắt bớt vì màn hình có quá nhiều text]"
    return text


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
    return raw_text[start:end + len(end_tag)].strip()


def extract_text_from_xml(xml_text):
    try:
        root = ET.fromstring(isolate_ui_xml(xml_text))
    except ET.ParseError as exc:
        raise RuntimeError(f"Không đọc được UI XML từ Android: {exc}")

    lines = []
    seen = set()
    for node in root.iter("node"):
        for key in ("text", "content-desc", "hint"):
            value = clean_value(node.attrib.get(key, ""))
            normalized = value.casefold()
            if not value or normalized in seen:
                continue
            seen.add(normalized)
            lines.append(value)
    return limit_text("\n".join(lines)), len(lines)


def dump_ui_xml(base):
    try:
        direct = run_process(base + ["exec-out", "uiautomator", "dump", "/dev/tty"], timeout=6, label="UIAutomator")
        if "<hierarchy" in direct and "</hierarchy>" in direct:
            return isolate_ui_xml(direct)
    except Exception:
        pass

    run_process(base + ["shell", "uiautomator", "dump", "/sdcard/window.xml"], timeout=8, label="UIAutomator")
    fallback = run_process(base + ["exec-out", "cat", "/sdcard/window.xml"], timeout=4, label="ADB cat UI XML")
    return isolate_ui_xml(fallback)


def needs_ocr(text, items):
    return items < MIN_UI_ITEMS or len(str(text or "").strip()) < MIN_UI_CHARS


def capture_screen_png(base):
    global _prefer_pull_screenshot
    png_signature = b"\x89PNG\r\n\x1a\n"
    direct_error = None

    # Try the fast binary stream only until this device proves it is broken.
    # After one invalid result we remember it and go straight to adb pull.
    if not _prefer_pull_screenshot:
        try:
            data = run_process_bytes(
                base + ["exec-out", "screencap", "-p"],
                timeout=5,
                label="ADB screencap",
            )
            png_start = data.find(png_signature)
            if png_start >= 0:
                return data[png_start:]
            direct_error = f"exec-out trả về {len(data)} bytes nhưng không có PNG signature"
            _prefer_pull_screenshot = True
            print(f"[screencap] {direct_error}; từ lần sau bỏ qua exec-out và dùng adb pull.", flush=True)
        except Exception as exc:
            direct_error = str(exc)
            _prefer_pull_screenshot = True
            print(f"[screencap] exec-out lỗi: {direct_error}; từ lần sau dùng adb pull.", flush=True)

    remote_path = "/sdcard/__rcgpt_screen.png"
    local_path = None
    try:
        run_process(base + ["shell", "screencap", "-p", remote_path], timeout=6, label="ADB screencap")
        with tempfile.NamedTemporaryFile(prefix="rcgpt-adb-screen-", suffix=".png", delete=False) as tmp:
            local_path = tmp.name
        run_process(base + ["pull", remote_path, local_path], timeout=7, label="ADB pull screenshot")
        with open(local_path, "rb") as file:
            data = file.read()
        png_start = data.find(png_signature)
        if png_start < 0:
            raise RuntimeError(
                f"Ảnh ADB pull không phải PNG hợp lệ ({len(data)} bytes). "
                f"Lỗi đường nhanh: {direct_error or 'đã bỏ qua'}"
            )
        return data[png_start:]
    finally:
        try:
            run_process(base + ["shell", "rm", "-f", remote_path], timeout=2, label="ADB cleanup")
        except Exception:
            pass
        if local_path:
            try:
                os.unlink(local_path)
            except OSError:
                pass


def find_tesseract():
    global _cached_tesseract
    if _cached_tesseract and Path(_cached_tesseract).is_file():
        return _cached_tesseract

    candidates = []
    env_path = os.environ.get("TESSERACT_PATH", "").strip().strip('"')
    if env_path:
        candidates.append(Path(env_path))

    found = shutil.which("tesseract.exe") or shutil.which("tesseract")
    if found:
        candidates.append(Path(found))

    candidates.append(SCRIPT_DIR / "tesseract.exe")
    for key in ("ProgramFiles", "ProgramFiles(x86)"):
        root = os.environ.get(key)
        if root:
            candidates.append(Path(root) / "Tesseract-OCR" / "tesseract.exe")

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
            _cached_tesseract = str(resolved)
            return _cached_tesseract
    return None


def get_ocr_language(tesseract):
    global _cached_ocr_language
    if _cached_ocr_language:
        return _cached_ocr_language

    output = run_process([tesseract, "--list-langs"], timeout=4, label="Tesseract --list-langs")
    languages = {
        line.strip()
        for line in output.splitlines()
        if line.strip() and not line.lower().startswith("list of available languages")
    }
    if "vie" not in languages:
        raise RuntimeError(
            "Tesseract thiếu vie.traineddata. Hãy chạy install-vietnamese-ocr.bat một lần."
        )
    _cached_ocr_language = "vie+eng" if "eng" in languages else "vie"
    print(f"[OCR] Tesseract: {tesseract}", flush=True)
    print(f"[OCR] Language: {_cached_ocr_language} (đã cache, không kiểm tra lại mỗi lần)", flush=True)
    return _cached_ocr_language


def ocr_png_with_tesseract(png_data):
    tesseract = find_tesseract()
    if not tesseract:
        raise RuntimeError(
            "Không tìm thấy Tesseract OCR. Hãy chạy install-vietnamese-ocr.bat một lần."
        )

    language = get_ocr_language(tesseract)
    psm = os.environ.get("RCGPT_TESSERACT_PSM", "6").strip()
    if not psm.isdigit():
        psm = "6"

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(prefix="rcgpt-screen-", suffix=".png", delete=False) as tmp:
            tmp.write(png_data)
            tmp_path = tmp.name

        output = run_process(
            [
                tesseract,
                tmp_path,
                "stdout",
                "-l",
                language,
                "--oem",
                "1",
                "--psm",
                psm,
                "-c",
                "preserve_interword_spaces=1",
            ],
            timeout=10,
            label="Tesseract OCR",
        )
        if not output:
            raise RuntimeError("Tesseract không nhận ra chữ trên ảnh màn hình.")
        return limit_text(output.replace("\f", ""))
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def merge_texts(primary, secondary):
    lines = []
    seen = set()
    for source in (primary, secondary):
        for raw_line in str(source or "").splitlines():
            value = clean_value(raw_line)
            key = value.casefold()
            if not value or key in seen:
                continue
            seen.add(key)
            lines.append(value)
    return limit_text("\n".join(lines)), len(lines)


def read_fast_ocr(base, serial):
    started = time.perf_counter()
    capture_started = time.perf_counter()
    png_data = capture_screen_png(base)
    capture_ms = int((time.perf_counter() - capture_started) * 1000)

    ocr_started = time.perf_counter()
    text = ocr_png_with_tesseract(png_data)
    ocr_ms = int((time.perf_counter() - ocr_started) * 1000)
    total_ms = int((time.perf_counter() - started) * 1000)
    items = len([line for line in text.splitlines() if line.strip()])

    print(f"[FAST] capture={capture_ms}ms | OCR={ocr_ms}ms | total={total_ms}ms | lines={items}", flush=True)
    return {
        "ok": True,
        "text": text,
        "items": items,
        "uiItems": 0,
        "ocrUsed": True,
        "method": "tesseract-fast",
        "device": serial,
        "timingMs": {"capture": capture_ms, "ocr": ocr_ms, "total": total_ms},
    }


def read_android_screen_text():
    global _cached_serial

    adb = find_adb()
    if not adb:
        raise RuntimeError(
            "Không tìm thấy adb.exe. Hãy thêm ADB vào PATH hoặc đặt ADB_PATH trỏ tới adb.exe."
        )

    serial = get_device(adb)
    base = [adb, "-s", serial]

    # Fast mode is default because phone/video/webview screens usually make
    # UIAutomator slow and incomplete. It avoids paying that cost before OCR.
    if FAST_OCR:
        try:
            return read_fast_ocr(base, serial)
        except Exception as exc:
            print(f"[FAST OCR lỗi] {type(exc).__name__}: {exc}", flush=True)
            print("[FAST OCR] Đang fallback sang UIAutomator + OCR chuẩn...", flush=True)

    ui_text = ""
    ui_items = 0
    ui_error = None
    try:
        try:
            xml_text = dump_ui_xml(base)
        except Exception:
            _cached_serial = None
            serial = get_device(adb)
            base = [adb, "-s", serial]
            xml_text = dump_ui_xml(base)
        ui_text, ui_items = extract_text_from_xml(xml_text)
    except Exception as exc:
        ui_error = str(exc)
        print(f"[LỖI UIAutomator] {type(exc).__name__}: {exc}", flush=True)

    if not needs_ocr(ui_text, ui_items):
        return {
            "ok": True,
            "text": ui_text,
            "items": ui_items,
            "uiItems": ui_items,
            "ocrUsed": False,
            "method": "uiautomator",
            "device": serial,
        }

    ocr_error = None
    try:
        png_data = capture_screen_png(base)
        ocr_text = ocr_png_with_tesseract(png_data)
        text, items = merge_texts(ocr_text, ui_text)
        return {
            "ok": True,
            "text": text,
            "items": items,
            "uiItems": ui_items,
            "ocrUsed": True,
            "method": "tesseract+uiautomator",
            "device": serial,
        }
    except Exception as exc:
        ocr_error = str(exc)
        print(f"[LỖI OCR] {type(exc).__name__}: {exc}", flush=True)

    if ui_text:
        raise RuntimeError(
            f"UIAutomator chỉ lấy được {ui_items} mục/{len(ui_text)} ký tự; OCR lỗi: {ocr_error or 'không xác định'}"
        )

    details = [part for part in (ui_error, ocr_error) if part]
    raise RuntimeError("Không đọc được chữ trên màn hình Android. " + " | ".join(details))


class Handler(BaseHTTPRequestHandler):
    server_version = "AndroidTextBridge/1.4"

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
            self.send_json(200, {
                "ok": True,
                "bridge": "running",
                "adbFound": bool(find_adb()),
                "tesseractFound": bool(find_tesseract()),
                "fastOcr": FAST_OCR,
            })
            return

        if path != "/screen-text":
            self.send_json(404, {"ok": False, "error": "Not found"})
            return

        try:
            self.send_json(200, read_android_screen_text())
        except Exception as exc:
            print("", flush=True)
            print("=" * 58, flush=True)
            print(f"[LỖI /screen-text] {type(exc).__name__}: {exc}", flush=True)
            print("Lỗi này đã được giữ lại trong terminal để bạn đọc.", flush=True)
            print("=" * 58, flush=True)
            self.send_json(500, {"ok": False, "error": str(exc)})

    def log_message(self, fmt, *args):
        print(f"[bridge] {self.address_string()} - {fmt % args}", flush=True)


def main():
    print("=" * 58)
    print(" Android UI text → ChatGPT local bridge v1.4")
    print(f" http://{HOST}:{PORT}")
    print(f" Fast OCR: {'ON' if FAST_OCR else 'OFF'}")
    print(" Fast OCR = chụp màn hình → Tesseract trực tiếp, bỏ UIAutomator/PowerShell.")
    print(" Tesseract path + language được cache sau lần đầu.")
    print(" Mọi lỗi đọc màn hình/OCR sẽ được giữ trong terminal.")
    print(" Nhấn Ctrl+C để dừng.")
    print("=" * 58)

    adb = find_adb()
    if adb:
        print(f"ADB: {adb}")
        try:
            print(f"Device: {get_device(adb)}")
        except Exception as exc:
            print(f"CẢNH BÁO: {exc}", flush=True)
    else:
        print("CẢNH BÁO: Chưa tìm thấy adb.exe.")

    tesseract = find_tesseract()
    print(f"Tesseract: {tesseract or 'chưa tìm thấy - chạy install-vietnamese-ocr.bat'}")

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
        print(f"Không thể mở bridge tại {HOST}:{PORT}: {exc}", flush=True)
        sys.exit(1)
