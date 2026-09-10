# Right Click → ChatGPT Web + Telegram v1.3

Không cần OpenAI API key.

## Luồng sử dụng
1. Bôi đen nội dung trên Facebook / web.
2. Chuột phải một lần → extension tự mở ChatGPT Web và đưa câu hỏi vào.
3. ChatGPT trả lời.
4. Trên trang ChatGPT sẽ có nút **📤 Gửi câu trả lời → Telegram**.
5. Bấm nút đó **một lần**. Extension lấy câu trả lời cuối cùng đang hiển thị và gửi sang Telegram.

Nút này là thao tác chủ động của người dùng; extension không tự động gửi câu trả lời.

## Cài đặt
1. Giải nén ZIP.
2. Mở `chrome://extensions`.
3. Bật **Developer mode**.
4. Xóa bản cũ hoặc Reload.
5. `Load unpacked` → chọn thư mục `right-click-chatgpt-web-v1.3`.
6. Trong **Site access**, chọn **On all sites**.
7. Đăng nhập ChatGPT tại `https://chatgpt.com`.

## Telegram
Trong popup extension nhập Bot Token + Chat ID, bấm Lưu rồi Gửi thử. Nếu Gửi thử thành công thì phần Telegram đã cấu hình đúng.

## Lưu ý
- Không cần OpenAI API key.
- Token Telegram được lưu trong `chrome.storage.local` của extension.
- Nút gửi lấy câu trả lời cuối cùng đang hiển thị trên trang ChatGPT. Nếu giao diện ChatGPT thay đổi lớn, selector có thể cần cập nhật.
