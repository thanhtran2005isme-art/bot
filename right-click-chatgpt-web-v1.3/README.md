# Right Click → ChatGPT Web

Chrome Extension Manifest V3 để gửi nhanh văn bản trên web hoặc text đang hiển thị trên màn hình Android sang ChatGPT Web.

Không dùng Gemini API, Telegram hoặc OpenAI API key.

## 1. Gửi văn bản trên web

1. Cài extension bằng **Load unpacked**.
2. Đăng nhập ChatGPT tại `https://chatgpt.com/`.
3. Bôi đen văn bản trên trang web.
4. Chuột phải → **Hỏi ChatGPT**.
5. Extension mở/focus ChatGPT, điền nội dung và tự gửi.

## 2. Đọc text màn hình Android / scrcpy

Tính năng này không OCR cửa sổ scrcpy. Nó dùng **ADB + UIAutomator** để lấy text trực tiếp từ cây giao diện Android nên thường nhanh hơn gửi screenshot cho GPT.

### Chuẩn bị

- Bật **USB debugging** trên điện thoại.
- Điện thoại phải xuất hiện khi chạy `adb devices`.
- Có Python 3 trên Windows.
- Có `adb.exe` trong PATH, trong thư mục extension, Android SDK, hoặc đặt biến `ADB_PATH` trỏ tới `adb.exe`.
- Có thể mở scrcpy song song bình thường.

Nếu `scrcpy.exe` nằm trong PATH và `adb.exe` ở cùng thư mục với scrcpy, `start-bridge.bat` sẽ cố tự tìm ADB.

### Cách dùng

1. Chạy `start-bridge.bat` và giữ cửa sổ đó mở.
2. Mở popup của extension.
3. Bấm **📱 Đọc màn hình điện thoại → ChatGPT**.
4. Bridge chạy `uiautomator dump`, lấy các trường `text`, `content-desc`, `hint` trên màn hình hiện tại.
5. Extension gửi phần text đó thẳng sang ChatGPT Web.

Bridge chỉ lắng nghe tại `127.0.0.1:8765` và chỉ cung cấp endpoint đọc text Android; extension không gửi lệnh shell tùy ý tới bridge.

### Khi không lấy được text

Một số app/game/WebView/canvas không expose chữ qua Accessibility/UIAutomator. Khi đó nút sẽ báo không tìm thấy text. Trường hợp này cần bổ sung fallback screenshot + OCR local.

### Nhiều thiết bị ADB

Nếu đang cắm nhiều điện thoại, đặt biến môi trường trước khi chạy bridge:

```bat
set ANDROID_SERIAL=SERIAL_CUA_MAY
start-bridge.bat
```

Nếu ADB không tự được tìm thấy:

```bat
set ADB_PATH=C:\duong-dan\toi\adb.exe
start-bridge.bat
```

## Thành phần chính

- `manifest.json`: cấu hình extension và quyền gọi bridge local.
- `background-direct-v2.js`: chuyển text sang ChatGPT Web.
- `chatgpt-direct.js`: điền prompt và bấm gửi trên ChatGPT Web.
- `popup.html` + `popup.js`: nút đọc màn hình Android.
- `android-bridge.py`: bridge local gọi ADB/UIAutomator và trả text JSON.
- `start-bridge.bat`: khởi động bridge trên Windows.

## Quyền host

- `https://chatgpt.com/*`
- `https://chat.openai.com/*`
- `http://127.0.0.1:8765/*`

Không còn code Gemini hoặc Telegram.
