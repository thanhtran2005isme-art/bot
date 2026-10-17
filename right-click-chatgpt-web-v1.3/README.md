# Right Click → ChatGPT Web + Gemini → Telegram

Chrome Extension Manifest V3 để gửi văn bản trên web sang ChatGPT Web, hoặc gọi Gemini API trả lời câu hỏi đã bôi đen rồi gửi câu hỏi cùng lời giải tới Telegram. Extension vẫn hỗ trợ đọc màn hình Android qua ADB/OCR.

## 1. Gửi văn bản sang ChatGPT Web

1. Cài extension bằng **Load unpacked**.
2. Đăng nhập ChatGPT tại https://chatgpt.com/.
3. Bôi đen văn bản trên website rồi nhấn chuột phải.
4. Extension chuyển sang ChatGPT, điền nội dung và tự gửi.

Chuột phải bình thường vẫn sử dụng luồng này.

## 2. Alt + chuột phải → Gemini → Telegram

### Cấu hình Gemini

1. Mở `chrome://extensions/`.
2. Chọn extension → **Details** → **Extension options**.
3. Dán Gemini API key lấy từ [Google AI Studio](https://aistudio.google.com/apikey).
4. Model mặc định là `gemini-3.8-flash`; đổi trong Options nếu API key của bạn không có quyền truy cập model đó.

### Cấu hình Telegram

1. Mở Telegram và chat với [@BotFather](https://t.me/BotFather).
2. Dùng lệnh `/newbot` để tạo bot và lấy Bot Token.
3. Mở cuộc trò chuyện với bot mới tạo và gửi `/start`.
4. Lấy Chat ID của cuộc trò chuyện hoặc nhóm mà bot được phép gửi tin.
5. Nhập Bot Token và Chat ID trong Extension options rồi bấm **Lưu cấu hình**.

### Sử dụng

1. Bôi đen câu hỏi trên website.
2. Giữ **Alt** rồi nhấn **chuột phải**.
3. Extension gửi câu hỏi đến Gemini, rồi gửi cả câu hỏi và câu trả lời đến Telegram.
4. Xem badge icon extension để theo dõi trạng thái; khi có lỗi, di chuột lên icon để đọc thông báo.

Luồng Alt + chuột phải độc lập với luồng chuột phải bình thường → ChatGPT Web.

## 3. Đọc text màn hình Android / scrcpy

Bridge dùng ADB để chụp màn hình Android và mặc định dùng Tesseract OCR để nhận dạng chữ. Nếu OCR nhanh lỗi, bridge thử phương án UIAutomator kết hợp OCR.

### Chuẩn bị

- Bật **USB debugging** trên điện thoại.
- Điện thoại phải xuất hiện khi chạy `adb devices`.
- Có Python 3 trên Windows.
- Có `adb.exe` trong PATH, trong thư mục extension, Android SDK, hoặc đặt biến `ADB_PATH` trỏ tới `adb.exe`.
- Cài Tesseract OCR kèm dữ liệu tiếng Việt bằng `install-vietnamese-ocr.bat`.
- Có thể mở scrcpy song song.

Nếu `scrcpy.exe` nằm trong PATH và `adb.exe` ở cùng thư mục với scrcpy, `start-bridge.bat` sẽ cố tự tìm ADB.

### Cách dùng

1. Chạy `start-bridge.bat` và giữ cửa sổ đó mở.
2. Trong Chrome, bấm nút nổi **📱** ở cạnh phải trang web hoặc bấm icon extension trên thanh công cụ.
3. Bridge đọc nội dung trên màn hình Android và chuyển text sang ChatGPT Web.

Bridge lắng nghe tại `127.0.0.1:8765`; extension gọi endpoint đọc text Android, không gửi lệnh shell tùy ý tới bridge.

### Nhiều thiết bị ADB

Nếu có nhiều điện thoại, đặt biến môi trường trước khi chạy bridge:

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

- `manifest.json`: cấu hình extension, quyền host và trang Options.
- `background-direct-v2.js`: điều phối ChatGPT Web và bridge Android.
- `selection.js`: chuột phải thường gửi ChatGPT; Alt + chuột phải gọi Gemini.
- `chatgpt-direct.js`: điền prompt và bấm gửi trên ChatGPT Web.
- `gemini-delivery.js`: gọi Gemini API, gửi tin bằng Telegram Bot API.
- `options.html` / `options.js`: cấu hình Gemini API key, model, Telegram Bot Token và Chat ID.
- `floating-button.js`: nút nổi 📱 để đọc màn hình Android.
- `android-bridge.py`: bridge local giao tiếp ADB và OCR.
- `install-vietnamese-ocr.bat`: cài Tesseract và dữ liệu OCR tiếng Việt.
- `start-bridge.bat`: khởi động bridge trên Windows.

## Bảo mật

- API key và Bot Token được nhập ở Options và lưu bằng `chrome.storage.local`; không commit thông tin thật vào repo.
- Không chia sẻ Gemini API key hoặc Telegram Bot Token.
- Extension dùng quyền `<all_urls>` để nhận thao tác bôi đen trên website; chỉ cài bản bạn tin tưởng.
- Bridge Android chỉ bind vào loopback `127.0.0.1`.
