const readPhoneButton = document.getElementById('readPhone');
const status = document.getElementById('status');
const BRIDGE_URL = 'http://127.0.0.1:8765/screen-text';

function setStatus(message, isError = false) {
  status.textContent = message;
  status.style.color = isError ? '#d1242f' : '';
  status.classList.toggle('muted', !isError);
}

function makePrompt(text) {
  return [
    'Đây là văn bản được lấy trực tiếp từ màn hình điện thoại Android.',
    'Hãy đọc nội dung và trả lời yêu cầu hoặc câu hỏi chính trên màn hình.',
    'Nếu là câu hỏi trắc nghiệm, trả lời ngắn gọn đáp án đúng.',
    '',
    text
  ].join('\n');
}

async function readPhoneAndSend() {
  readPhoneButton.disabled = true;
  setStatus('Đang lấy text từ Android qua ADB…');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(BRIDGE_URL, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal
    });

    let data;
    try {
      data = await response.json();
    } catch (_) {
      throw new Error(`Bridge trả về dữ liệu không hợp lệ (HTTP ${response.status}).`);
    }

    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || `Bridge lỗi HTTP ${response.status}.`);
    }

    const text = String(data.text || '').trim();
    if (!text) {
      throw new Error('UIAutomator không tìm thấy text trên màn hình hiện tại. App này có thể cần OCR ảnh.');
    }

    setStatus(`Đã lấy ${data.items || '?'} mục text. Đang gửi sang ChatGPT…`);

    const result = await chrome.runtime.sendMessage({
      type: 'ASK_CHATGPT_WEB',
      text: makePrompt(text)
    });

    if (!result?.ok) {
      throw new Error(result?.error || 'Không gửi được sang ChatGPT.');
    }

    setStatus('✅ Đã gửi text màn hình điện thoại sang ChatGPT.');
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? 'Bridge/ADB phản hồi quá lâu. Kiểm tra điện thoại đã kết nối và mở khóa.'
      : String(error?.message || error);

    const bridgeHint = /fetch|network|failed/i.test(message)
      ? '\nHãy chạy start-bridge.bat trước.'
      : '';

    setStatus(`❌ ${message}${bridgeHint}`, true);
  } finally {
    clearTimeout(timeout);
    readPhoneButton.disabled = false;
  }
}

readPhoneButton.addEventListener('click', readPhoneAndSend);
