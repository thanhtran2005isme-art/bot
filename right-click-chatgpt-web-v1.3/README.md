# Right Click AI: ChatGPT Web + Gemini → Telegram + Android OCR

Chrome Extension Manifest V3 với popup để chọn một chế độ mặc định; bôi đen văn bản rồi chuột phải sẽ tự chạy chế độ đang lưu.

## 1. Chọn chế độ mặc định

Bấm icon extension để mở popup và **tích chọn một trong ba chế độ**:
1. **ChatGPT Web** — gửi văn bản đang bôi đen sang ChatGPT và tự gửi.
2. **Gemini → Telegram** — dùng Gemini API trả lời, chỉ gửi đáp án đúng kèm nội dung phương án (không gửi lại câu hỏi hoặc giải thích) tới Telegram.
3. **Đọc màn hình Android** — đọc nội dung điện thoại qua ADB/OCR rồi gửi sang ChatGPT.

Lựa chọn được lưu trong `chrome.storage.local` và giữ nguyên cho những lần sau. Khi sử dụng hằng ngày, không cần mở popup để chọn lại: **bôi đen văn bản trên trang web rồi nhấn chuột phải**, extension tự chạy chế độ đang lưu. Khi đang ở chế độ Android, thao tác bôi đen + chuột phải là thao tác kích hoạt; nội dung được đọc là màn hình điện thoại Android, không phải đoạn văn bản trên máy tính. Chuột phải ở nơi không có văn bản bôi đen vẫn hiện menu ngữ cảnh bình thường.

Nút **Cài đặt API key / Telegram / Model** mở trang Options để cấu hình Gemini API key, model, Telegram Bot Token và Chat ID.

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

Bridge dùng ADB để chụp màn hình Android và Tesseract OCR để nhận dạng chữ. Bridge chỉ được gọi khi chế độ **Đọc màn hình Android** đang được chọn và người dùng bôi đen văn bản rồi nhấn chuột phải; bấm icon extension chỉ dùng để đổi chế độ/cài đặt, không tự đọc màn hình.

Chuẩn bị:
- Bật USB debugging trên điện thoại.
- Điện thoại xuất hiện khi chạy `adb devices`.
- Có Python 3 trên Windows và `adb.exe` trong PATH/Android SDK, hoặc đặt `ADB_PATH`.
- Cài Tesseract OCR kèm dữ liệu tiếng Việt bằng `install-vietnamese-ocr.bat`.
- Chạy `start-bridge.bat` và giữ cửa sổ bridge mở. Chạy ADB daemon riêng không thay cho Python bridge tại `127.0.0.1:8765`.

Để dùng Android OCR, chọn chế độ này trong popup một lần. Từ đó, bôi đen bất kỳ đoạn văn bản nào trên máy tính rồi chuột phải sẽ kích hoạt việc đọc màn hình điện thoại qua bridge. Bấm icon extension không tự đọc màn hình.

## Thành phần chính
- `manifest.json`: quyền extension và popup khi bấm icon.
- `popup.html` / `popup.js`: bộ chọn một chế độ mặc định được lưu, kèm trạng thái cấu hình và nút mở Options.
- `background-direct-v2.js`: điều phối chế độ đang lưu tới ChatGPT, Gemini/Telegram hoặc Android OCR.
- `selection.js`: lưu văn bản được bôi đen và kích hoạt chế độ đã chọn khi nhấn chuột phải.
- `chatgpt-direct.js`: điền prompt và gửi trên ChatGPT Web.
- `gemini-delivery.js`: gọi Gemini API và gửi câu trả lời qua Telegram.
- `options.html` / `options.js`: API key, model và Telegram settings.
- `android-bridge.py`: bridge local giao tiếp ADB và OCR.

## Bảo mật
- API key và Bot Token được lưu trong `chrome.storage.local`; đừng commit token thật hoặc chia sẻ chúng.
- Extension cần quyền `<all_urls>` để cung cấp các thao tác trên website; chỉ cài bản bạn tin tưởng.
- Bridge Android chỉ bind tại `127.0.0.1`.
