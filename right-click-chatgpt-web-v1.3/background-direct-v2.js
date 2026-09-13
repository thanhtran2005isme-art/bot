const CHATGPT_URL = 'https://chatgpt.com/';
const BRIDGE_URL = 'http://127.0.0.1:8765/screen-text';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let lastPrompt = '';
let lastPromptAt = 0;
let phoneBusy = false;

async function setActionState(text, title, clearAfter = 0) {
  try {
    await chrome.action.setBadgeText({ text });
    await chrome.action.setTitle({ title });
  } catch (_) {}

  if (clearAfter > 0) {
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '' }).catch(() => {});
      chrome.action.setTitle({ title: 'Đọc màn hình điện thoại → ChatGPT' }).catch(() => {});
    }, clearAfter);
  }
}

async function findChatGPTTab() {
  const tabs = await chrome.tabs.query({
    url: ['https://chatgpt.com/*', 'https://chat.openai.com/*']
  });
  return tabs.find(tab => tab.active) || tabs[0] || null;
}

async function deliver(tabId, text) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const result = await chrome.tabs.sendMessage(tabId, {
        type: 'FILL_AND_SEND_CHATGPT',
        text,
        autoSend: true
      });
      if (result?.ok) return result;
    } catch (_) {}

    if (attempt === 0 || attempt === 8) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['chatgpt-direct.js']
        });
      } catch (_) {}
    }

    await sleep(attempt < 10 ? 80 : 150);
  }

  return { ok: false, error: 'Không thể dán/gửi prompt sang ChatGPT.' };
}

async function sendToChatGPT(prompt) {
  const text = String(prompt || '').trim();
  if (!text) return { ok: false, error: 'Prompt rỗng.' };

  const now = Date.now();
  if (text === lastPrompt && now - lastPromptAt < 700) {
    return { ok: true, duplicateIgnored: true };
  }
  lastPrompt = text;
  lastPromptAt = now;

  let tab = await findChatGPTTab();

  if (!tab) {
    tab = await chrome.tabs.create({ url: CHATGPT_URL, active: true });
  } else {
    tab = await chrome.tabs.update(tab.id, { active: true });
  }

  try {
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch (_) {}

  return deliver(tab.id, text);
}

function makePhonePrompt(text) {
  return [
    'Đây là văn bản được lấy trực tiếp từ màn hình điện thoại Android.',
    'Hãy đọc nội dung và trả lời yêu cầu hoặc câu hỏi chính trên màn hình.',
    'Nếu là câu hỏi trắc nghiệm, chỉ trả lời đáp án đúng thật ngắn gọn.',
    '',
    String(text || '').trim()
  ].join('\n');
}

async function readPhoneAndSend() {
  if (phoneBusy) return;
  phoneBusy = true;
  await setActionState('…', 'Đang đọc màn hình Android…');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

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
      throw new Error('UIAutomator không tìm thấy text trên màn hình hiện tại.');
    }

    await setActionState('→', `Đã đọc ${data.items || '?'} mục text. Đang gửi ChatGPT…`);
    const result = await sendToChatGPT(makePhonePrompt(text));
    if (!result?.ok) throw new Error(result?.error || 'Không gửi được sang ChatGPT.');

    await setActionState('✓', 'Đã gửi màn hình Android sang ChatGPT', 1400);
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? 'Bridge/ADB phản hồi quá lâu.'
      : String(error?.message || error);
    console.error('[Android → ChatGPT]', message);
    await setActionState('!', `Lỗi: ${message}`, 3500);
  } finally {
    clearTimeout(timeout);
    phoneBusy = false;
  }
}

chrome.action.onClicked.addListener(() => {
  readPhoneAndSend().catch(error => console.error('[Android → ChatGPT]', error));
});

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== 'ASK_CHATGPT_WEB') return;

  sendToChatGPT(message.text)
    .then(reply)
    .catch(error => reply({ ok: false, error: String(error?.message || error) }));
  return true;
});
