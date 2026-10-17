# Right Click AI: ChatGPT Web + Gemini → Telegram + Android OCR

Chrome Extension Manifest V3 với popup khi bấm icon extension, đồng thời cung cấp 3 lựa chọn trong menu chuột phải.

## 1. Bấm icon extension

Bấm icon extension trên thanh công cụ Chrome sẽ mở popup **Trợ lý AI**, không tự chạy ADB.

Popup có ba thao tác:
1. **ChatGPT Web** — gửi văn bản đang bôi đen sang ChatGPT.
2. **Gemini → Telegram** — dùng Gemini API trả lời câu hỏi và gửi kết quả tới Telegram.
3. **Đọc màn hình Android** — đọc nội dung điện thoại qua ADB/OCR rồi gửi sang ChatGPT.

Nút **Cài đặt API key / Telegram / Model** mở trang Extension options để cấu hình Gemini API key, model, Telegram Bot Token và Chat ID.

Bạn cũng có thể bôi đen câu hỏi, nhấn chuột phải → **Trợ lý AI**, rồi chọn một trong ba mục. Việc mở menu chuột phải không tự gửi câu hỏi.

## 2. Cấu hình Gemini model và Telegram

### Gemini API
1. Mở popup extension → **Cài đặt API key / Telegram / Model**, hoặc vào `chrome://extensions/` → extension → **Details → Extension options**.
2. Lấy Gemini API key từ [Google AI Studio](https://aistudio.google.com/apikey), rồi dán vào trang cấu hình.
3. Chọn model có sẵn hoặc bấm **Tải danh sách model từ API** để lấy các model hỗ trợ `generateContent` cho API key này.
4. Bấm **Lưu cấu hình**.

### Telegram
1. Chat với [@BotFather](https://t.me/BotFather), dùng `/newbot` để tạo bot và lấy Bot Token.
2. Mở cuộc trò chuyện với bot và gửi `/start`.
3. Lấy Chat ID, nhập cùng Bot Token trong Extension options rồi lưu.

## 3. Đọc text màn hình Android / scrcpy

Bridge dùng ADB để chụp màn hình Android và Tesseract OCR để nhận dạng chữ. Chỉ thao tác **Đọc màn hình Android** mới kích hoạt bridge; bấm icon extension không tự đọc màn hình nữa.

Chuẩn bị:
- Bật USB debugging trên điện thoại.
- Điện thoại xuất hiện khi chạy `adb devices`.
- Có Python 3 trên Windows và `adb.exe` trong PATH/Android SDK, hoặc đặt `ADB_PATH`.
- Cài Tesseract OCR kèm dữ liệu tiếng Việt bằng `install-vietnamese-ocr.bat`.
- Chạy `start-bridge.bat` và giữ cửa sổ bridge mở. Chạy ADB daemon riêng không thay cho Python bridge tại `127.0.0.1:8765`.

Bạn có thể mở popup hoặc menu chuột phải để chọn mục Android OCR. Nút nổi 📱 và thao tác từ icon extension trước đây vẫn được thay bằng nút trong popup.

## Thành phần chính
- `manifest.json`: quyền extension và popup khi bấm icon.
- `popup.html` / `popup.js`: ba lựa chọn nhanh cùng trạng thái cấu hình và nút mở Options.
- `background-direct-v2.js`: menu chuột phải, điều phối ChatGPT/ADB.
- `selection.js`: lưu văn bản được bôi đen để sử dụng từ menu.
- `chatgpt-direct.js`: điền prompt và gửi trên ChatGPT Web.
- `gemini-delivery.js`: gọi Gemini API và gửi câu trả lời qua Telegram.
- `options.html` / `options.js`: API key, model và Telegram settings.
- `android-bridge.py`: bridge local giao tiếp ADB và OCR.

## Bảo mật
- API key và Bot Token được lưu trong `chrome.storage.local`; đừng commit token thật hoặc chia sẻ chúng.
- Extension cần quyền `<all_urls>` để cung cấp các thao tác trên website; chỉ cài bản bạn tin tưởng.
- Bridge Android chỉ bind tại `127.0.0.1`.
