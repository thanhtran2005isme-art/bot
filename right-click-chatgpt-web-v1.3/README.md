# Right Click → ChatGPT Web + Gemini Delivery

Chrome Extension Manifest V3 để gửi nhanh văn bản trên web sang ChatGPT Web, hoặc dùng Gemini API để trả lời câu hỏi rồi chuyển kết quả qua Telegram hay Zalo Official Account (OA). Extension còn hỗ trợ đọc text trên màn hình Android qua ADB/OCR.

## 1. Gửi văn bản trên web sang ChatGPT

1. Cài extension bằng **Load unpacked**.
2. Đăng nhập ChatGPT tại https://chatgpt.com/.
3. Bôi đen văn bản trên trang web.
4. Nhấn chuột phải.
5. Extension mở/focus ChatGPT, điền nội dung và tự gửi.

Chuột phải thông thường vẫn giữ cách hoạt động này.

## 2. Alt + chuột phải → Gemini → Telegram / Zalo OA

Luồng mới gửi câu hỏi đã bôi đen tới Gemini API, lấy câu trả lời rồi chuyển cả câu hỏi và lời giải sang kênh nhắn tin đã cấu hình.

### Cấu hình Gemini

1. Mở `chrome://extensions/`.
2. Chọn extension này → **Details** → **Extension options**.
3. Dán Gemini API key lấy từ Google AI Studio.
4. Model mặc định là `gemini-3.8-flash`; đổi model trong Options nếu cần.

### Gửi qua Telegram

1. Tạo bot bằng [@BotFather](https://t.me/BotFather) và lấy Bot Token.
2. Lấy Chat ID của cuộc trò chuyện hoặc nhóm mà bot có thể gửi tin nhắn.
3. Nhập Bot Token và Chat ID trong Extension options.
4. Chọn **Telegram** ở mục kênh nhận kết quả.

### Gửi qua Zalo OA

1. Cần có Zalo Official Account, Access Token hợp lệ và `user_id` của người nhận đủ điều kiện nhận tin qua OA API.
2. Nhập OA Access Token và Zalo user ID trong Extension options.
3. Chọn **Zalo Official Account (OA)** ở mục kênh nhận kết quả.

**Lưu ý:** Zalo OA API không phải API nhắn tin trực tiếp cho bất kỳ tài khoản Zalo cá nhân nào. Quyền gửi tin phụ thuộc điều kiện và chính sách của Zalo OA. Có thể chọn gửi cả Telegram và Zalo OA nếu đã cấu hình cả hai kênh.

### Cách dùng

1. Bôi đen câu hỏi trên một trang web.
2. Giữ phím **Alt** rồi nhấn **chuột phải**.
3. Extension gọi Gemini và gửi câu hỏi cùng câu trả lời đến kênh đã chọn.
4. Nhìn badge trên icon extension để biết trạng thái; khi lỗi, di chuột lên icon để đọc thông báo.

Phím tắt mới không thay đổi luồng chuột phải thông thường → ChatGPT Web.

## 3. Đọc text màn hình Android / scrcpy

Bridge dùng ADB để chụp màn hình Android và mặc định dùng Tesseract OCR để nhận dạng chữ. Nếu chế độ OCR nhanh lỗi, bridge thử phương án UIAutomator kết hợp OCR.

### Chuẩn bị

- Bật **USB debugging** trên điện thoại.
- Điện thoại phải xuất hiện khi chạy `adb devices`.
- Có Python 3 trên Windows.
- Có `adb.exe` trong PATH, trong thư mục extension, Android SDK, hoặc đặt biến `ADB_PATH` trỏ tới `adb.exe`.
- Cài Tesseract OCR kèm dữ liệu tiếng Việt bằng `install-vietnamese-ocr.bat`.
- Có thể mở scrcpy song song bình thường.

Nếu `scrcpy.exe` nằm trong PATH và `adb.exe` ở cùng thư mục với scrcpy, `start-bridge.bat` sẽ cố tự tìm ADB.

### Cách dùng

1. Chạy `start-bridge.bat` và giữ cửa sổ đó mở.
2. Trong Chrome, bấm nút nổi **📱** ở cạnh phải trang web hoặc bấm icon extension trên thanh công cụ.
3. Bridge đọc nội dung trên màn hình Android và chuyển text sang ChatGPT Web.

Bridge lắng nghe tại `127.0.0.1:8765`; extension gọi endpoint đọc text Android, không gửi lệnh shell tùy ý tới bridge.

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

- `manifest.json`: cấu hình extension, quyền host và trang Options.
- `background-direct-v2.js`: điều phối ChatGPT Web và bridge Android.
- `selection.js`: lấy text đang bôi đen; chuột phải thường gửi ChatGPT, Alt + chuột phải gọi Gemini.
- `chatgpt-direct.js`: điền prompt và bấm gửi trên ChatGPT Web.
- `gemini-delivery.js`: gọi Gemini API, gửi Telegram Bot API hoặc Zalo OA API.
- `options.html` / `options.js`: cấu hình API key, model và kênh nhận tin.
- `floating-button.js`: nút nổi 📱 để đọc màn hình Android.
- `android-bridge.py`: bridge local giao tiếp ADB, chụp màn hình và OCR.
- `install-vietnamese-ocr.bat`: cài Tesseract và dữ liệu OCR tiếng Việt.
- `start-bridge.bat`: khởi động bridge trên Windows.

## Bảo mật

- API key/token được cấu hình trong Options và lưu bằng `chrome.storage.local`; không commit thông tin thật vào repo.
- Không chia sẻ Bot Token, Gemini API key hoặc Zalo OA Access Token.
- Extension hiện có quyền chạy trên phạm vi website rộng (`<all_urls>`) để nhận thao tác bôi đen; chỉ cài bản bạn tin tưởng.
- Bridge Android chỉ bind vào loopback `127.0.0.1`, nhưng nên giữ extension và các token cập nhật, riêng tư.
