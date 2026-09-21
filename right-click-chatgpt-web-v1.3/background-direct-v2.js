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

async function tryDeliver(tabId, text) {
  try {
    return await chrome.tabs.sendMessage(tabId, {
      type: 'FILL_AND_SEND_CHATGPT',
      text,
      autoSend: true
    });
  } catch (_) {
    return null;
  }
}

async function injectDirect(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['chatgpt-direct.js']
    });
    return true;
  } catch (_) {
    return false;
  }
}

async function deliver(tabId, text) {
  let result = await tryDeliver(tabId, text);
  if (result?.ok) return result;

  await injectDirect(tabId);
  result = await tryDeliver(tabId, text);
  if (result?.ok) return result;

  for (let attempt = 0; attempt < 32; attempt++) {
    await sleep(attempt < 12 ? 20 : 60);

    result = await tryDeliver(tabId, text);
    if (result?.ok) return result;

    if (attempt === 10) {
      await injectDirect(tabId);
    }
  }

  return { ok: false, error: 'Không thể dán/gửi prompt sang ChatGPT.' };
}

async function activateForPaste(tab) {
  try {
    const activeTab = await chrome.tabs.update(tab.id, { active: true });

    // Do not await window focus. The tab is already active, so the content
    // script can paste immediately while Chrome finishes focusing the window.
    chrome.windows.update(activeTab.windowId, { focused: true }).catch(() => {});

    return activeTab;
  } catch (_) {
    return tab;
  }
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
    return deliver(tab.id, text);
  }

  // Contenteditable editing is much faster and more reliable once ChatGPT is
  // the active tab. Activate first, then paste immediately; do not wait for
  // a separate window-focus round trip.
  tab = await activateForPaste(tab);
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
  if (phoneBusy) return { ok: false, error: 'Đang xử lý lần đọc trước.' };
  phoneBusy = true;
  await setActionState('…', 'Đang đọc màn hình Android…');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

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
      throw new Error('Không tìm thấy text trên màn hình Android.');
    }

    const mode = data.ocrUsed ? 'OCR' : 'UI';
    await setActionState('→', `Đã đọc ${data.items || '?'} dòng (${mode}). Đang gửi ChatGPT…`);
    const result = await sendToChatGPT(makePhonePrompt(text));
    if (!result?.ok) throw new Error(result?.error || 'Không gửi được sang ChatGPT.');

    await setActionState('✓', `Đã gửi màn hình Android sang ChatGPT (${mode})`, 1400);
    return { ok: true, items: data.items || 0, ocrUsed: !!data.ocrUsed };
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? 'Bridge/ADB/OCR phản hồi quá lâu.'
      : String(error?.message || error);
    console.error('[Android → ChatGPT]', message);
    await setActionState('!', `Lỗi: ${message}`, 3500);
    return { ok: false, error: message };
  } finally {
    clearTimeout(timeout);
    phoneBusy = false;
  }
}

chrome.action.onClicked.addListener(() => {
  readPhoneAndSend().catch(error => console.error('[Android → ChatGPT]', error));
});

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type === 'ASK_CHATGPT_WEB') {
    sendToChatGPT(message.text)
      .then(reply)
      .catch(error => reply({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === 'READ_ANDROID_SCREEN') {
    readPhoneAndSend()
      .then(reply)
      .catch(error => reply({ ok: false, error: String(error?.message || error) }));
    return true;
  }
});
