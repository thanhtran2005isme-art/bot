# Right Click → ChatGPT Web

Chrome Extension Manifest V3 để gửi nhanh văn bản trên web hoặc text đang hiển thị trên màn hình Android sang ChatGPT Web.

Không dùng Gemini API, Telegram hoặc OpenAI API key.

## 1. Gửi văn bản trên web

1. Cài extension bằng **Load unpacked**.
2. Đăng nhập ChatGPT tại `https://chatgpt.com/`.
3. Bôi đen văn bản trên trang web.
4. Chuột phải trên phần text đã chọn.
5. Extension mở/focus ChatGPT, điền nội dung và tự gửi.

## 2. Đọc text màn hình Android / scrcpy

Bridge ưu tiên **ADB + UIAutomator** để lấy text trực tiếp từ cây giao diện Android vì cách này nhanh. Nếu UIAutomator lấy quá ít chữ, bridge tự động chụp màn hình điện thoại bằng `adb exec-out screencap -p` rồi dùng **Windows OCR** để đọc phần chữ còn thiếu.

Cơ chế này xử lý tốt hơn các app/WebView/custom view mà UIAutomator chỉ nhìn thấy tiêu đề hoặc vài node đầu tiên.

### Chuẩn bị

- Bật **USB debugging** trên điện thoại.
- Điện thoại phải xuất hiện khi chạy `adb devices`.
- Có Python 3 trên Windows.
- Có Windows PowerShell.
- Có `adb.exe` trong PATH, trong thư mục extension, Android SDK, hoặc đặt biến `ADB_PATH` trỏ tới `adb.exe`.
- Có thể mở scrcpy song song bình thường.

Nếu `scrcpy.exe` nằm trong PATH và `adb.exe` ở cùng thư mục với scrcpy, `start-bridge.bat` sẽ cố tự tìm ADB.

### Cách dùng

1. Chạy `start-bridge.bat` và giữ cửa sổ đó mở.
2. Trong Chrome, bấm nút nổi **📱** ở cạnh phải trang web hoặc bấm icon extension trên thanh công cụ.
3. Bridge chạy `uiautomator dump` và lấy `text`, `content-desc`, `hint`.
4. Nếu lượng text quá ít, bridge tự chụp màn hình Android và chạy `windows-ocr.ps1`.
5. Kết quả OCR được gộp với text UIAutomator rồi gửi thẳng sang ChatGPT Web.

Extension chờ tối đa 20 giây để lần gọi OCR đầu tiên có đủ thời gian khởi tạo.

Bridge chỉ lắng nghe tại `127.0.0.1:8765` và chỉ cung cấp endpoint đọc text Android; extension không gửi lệnh shell tùy ý tới bridge.

### Khi OCR không chạy

Nếu bridge báo `Windows OCR không có ngôn ngữ OCR khả dụng`, hãy cài OCR language feature của Windows cho một ngôn ngữ đang dùng rồi chạy lại `start-bridge.bat`.

Nếu bridge báo UIAutomator chỉ lấy được rất ít text và OCR fallback lỗi, lỗi chi tiết sẽ được trả về thay vì âm thầm gửi phần text thiếu sang ChatGPT.

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
- `background-direct-v2.js`: đọc bridge, chuyển text sang ChatGPT Web và chờ OCR fallback khi cần.
- `chatgpt-direct.js`: điền prompt và bấm gửi trên ChatGPT Web.
- `selection.js`: lấy phần text đang bôi đen khi chuột phải.
- `floating-button.js`: nút nổi 📱 để đọc màn hình Android.
- `android-bridge.py`: bridge local gọi ADB/UIAutomator, screencap và OCR fallback.
- `windows-ocr.ps1`: dùng Windows.Media.Ocr để OCR ảnh màn hình mà không cần OpenAI API.
- `start-bridge.bat`: khởi động bridge trên Windows.

## Quyền host

- `https://chatgpt.com/*`
- `https://chat.openai.com/*`
- `http://127.0.0.1:8765/*`

Không còn code Gemini hoặc Telegram.
