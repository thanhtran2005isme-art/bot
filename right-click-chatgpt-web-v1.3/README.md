# Right Click → ChatGPT Web

Chrome Extension Manifest V3 để gửi nhanh phần văn bản đang bôi đen sang ChatGPT Web.

## Cách dùng

1. Cài extension ở chế độ **Load unpacked**.
2. Đăng nhập ChatGPT tại `https://chatgpt.com/`.
3. Bôi đen văn bản trên bất kỳ trang web nào.
4. Chuột phải và chọn **Hỏi ChatGPT**.
5. Extension sẽ mở hoặc chuyển sang tab ChatGPT, điền nội dung đã chọn và tự gửi.

## Thành phần chính

- `manifest.json`: cấu hình extension.
- `background-direct-v2.js`: tạo context menu và chuyển nội dung sang ChatGPT.
- `chatgpt-direct.js`: điền prompt và bấm gửi trên ChatGPT Web.
- `popup.html`: hướng dẫn sử dụng ngắn gọn.

## Quyền sử dụng

Extension chỉ giữ các quyền cần thiết để mở tab, chèn content script và tạo menu chuột phải. Host permissions chỉ còn:

- `https://chatgpt.com/*`
- `https://chat.openai.com/*`

Không còn Gemini API, Gemini API Key, Telegram Bot Token, Telegram Chat ID hoặc bất kỳ logic gửi dữ liệu sang Telegram nào.
