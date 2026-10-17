# Right Click AI: ChatGPT Web + Gemini → Telegram + Android OCR

Chrome Extension Manifest V3 với 3 lựa chọn ở menu chuột phải.

## 1. Ba chức năng trong menu chuột phải

1. **Gửi văn bản sang ChatGPT Web** — bôi đen câu hỏi, chuột phải → **Trợ lý AI → 1. Gửi văn bản sang ChatGPT Web**. Extension mở/chuyển sang ChatGPT, điền câu hỏi và tự gửi.
2. **Gemini trả lời → Telegram** — bôi đen câu hỏi, chuột phải → **Trợ lý AI → 2. Gemini trả lời → Telegram**. Extension gọi Gemini API rồi gửi cả câu hỏi và câu trả lời tới Telegram.
3. **Đọc màn hình Android → ChatGPT** — kết nối điện thoại bằng ADB, giữ bridge chạy, chuột phải trên trang → **Trợ lý AI → 3. Đọc màn hình Android → ChatGPT**. Chức năng này đọc màn hình điện thoại hiện tại và gửi nội dung sang ChatGPT Web. Nút nổi 📱 và icon extension vẫn hoạt động như trước.

Chỉ mục bạn bấm mới được chạy. Không cần giữ Alt và không tự gửi câu hỏi chỉ vì mở menu chuột phải.

## 2. Cấu hình Gemini model và Telegram

### Gemini API

1. Mở `chrome://extensions/`.
2. Chọn extension → **Details** → **Extension options**.
3. Lấy Gemini API key từ [Google AI Studio](https://aistudio.google.com/apikey), rồi dán vào trang cấu hình.
4. Trong **Model Gemini sử dụng**, chọn một model có sẵn hoặc bấm **Tải danh sách model từ API** để lấy những model hỗ trợ `generateContent` mà API key của bạn truy cập được.
5. Chọn model muốn dùng và bấm **Lưu cấu hình**.

Danh sách model được lấy từ endpoint chính thức `GET https://generativelanguage.googleapis.com/v1beta/models`, lọc theo `supportedGenerationMethods` có `generateContent`. <https://ai.google.dev/api/models>

### Telegram

1. Mở Telegram, chat với [@BotFather](https://t.me/BotFather).
2. Dùng `/newbot` để tạo bot và lấy Bot Token.
3. Mở cuộc trò chuyện với bot vừa tạo và gửi `/start`.
4. Lấy Chat ID của cuộc trò chuyện hoặc nhóm mà bot được phép gửi.
5. Nhập Bot Token và Chat ID trong Extension options rồi bấm **Lưu cấu hình**.

## 3. Đọc text màn hình Android / scrcpy

Bridge dùng ADB để chụp màn hình Android và mặc định dùng Tesseract OCR để nhận dạng chữ. Nếu OCR nhanh lỗi, bridge thử phương án UIAutomator kết hợp OCR.

Chuẩn bị:
- Bật USB debugging trên điện thoại.
- Điện thoại xuất hiện khi chạy `adb devices`.
- Có Python 3 trên Windows và `adb.exe` trong PATH/Android SDK, hoặc đặt `ADB_PATH`.
- Cài Tesseract OCR kèm dữ liệu tiếng Việt bằng `install-vietnamese-ocr.bat`.
- Có thể mở scrcpy song song.

Chạy `start-bridge.bat` và giữ cửa sổ mở. Bạn có thể dùng nút nổi 📱, icon extension, hoặc mục thứ 3 trong menu chuột phải để đọc màn hình điện thoại rồi gửi sang ChatGPT Web.

Nếu cắm nhiều điện thoại, đặt `ANDROID_SERIAL` trước khi chạy bridge.

## Thành phần chính

- `manifest.json`: cấu hình extension và quyền context menu/API.
- `background-direct-v2.js`: tạo menu 3 chức năng và điều phối luồng.
- `selection.js`: lưu văn bản bôi đen để menu có thể đọc khi được bấm.
- `chatgpt-direct.js`: điền prompt và bấm gửi trên ChatGPT Web.
- `gemini-delivery.js`: gọi Gemini API và gửi kết quả qua Telegram Bot API.
- `options.html` / `options.js`: cấu hình Gemini API key/model và Telegram token/chat ID.
- `floating-button.js`: nút nổi đọc màn hình Android.
- `android-bridge.py`: ADB, chụp màn hình và OCR.
- `start-bridge.bat` / `install-vietnamese-ocr.bat`: khởi động bridge và cài OCR.

## Bảo mật

- Gemini API key và Telegram Bot Token được nhập trong Options và lưu qua `chrome.storage.local`; không commit token thật lên GitHub.
- Không chia sẻ Gemini API key, Bot Token hoặc thư mục cấu hình có chứa chúng.
- Extension cần quyền `<all_urls>` để cung cấp menu trên các website; chỉ cài bản bạn tin tưởng.
- Android bridge chỉ bind tại `127.0.0.1`.
