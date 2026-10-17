importScripts('gemini-delivery.js');

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
      chrome.action.setTitle({ title: 'Mở popup để đổi chế độ AI / cài đặt' }).catch(() => {});
    }, clearAfter);
  }
}

function clearLegacyContextMenus() {
  // Remove the old per-action submenu; mode selection is now persistent in the popup.
  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime.lastError) {
      console.warn('[Context menu cleanup]', chrome.runtime.lastError.message);
    }
  });
}

chrome.runtime.onInstalled.addListener(clearLegacyContextMenus);
chrome.runtime.onStartup.addListener(clearLegacyContextMenus);

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
      throw new Error('Bridge trả về dữ liệu không hợp lệ (HTTP ' + response.status + ').');
    }

    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || 'Bridge lỗi HTTP ' + response.status + '.');
    }

    const text = String(data.text || '').trim();
    if (!text) throw new Error('Không tìm thấy text trên màn hình Android.');

    const mode = data.ocrUsed ? 'OCR' : 'UI';
    await setActionState('→', 'Đã đọc ' + (data.items || '?') + ' dòng (' + mode + '). Đang gửi ChatGPT…');
    const result = await sendToChatGPT(makePhonePrompt(text));
    if (!result?.ok) throw new Error(result?.error || 'Không gửi được sang ChatGPT.');

    await setActionState('✓', 'Đã gửi màn hình Android sang ChatGPT (' + mode + ')', 1400);
    return { ok: true, items: data.items || 0, ocrUsed: !!data.ocrUsed };
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? 'Bridge/ADB/OCR phản hồi quá lâu. Kiểm tra start-bridge.bat tại 127.0.0.1:8765.'
      : String(error?.message || error);
    console.error('[Android → ChatGPT]', message);
    await setActionState('!', 'Lỗi: ' + message, 3500);
    return { ok: false, error: message };
  } finally {
    clearTimeout(timeout);
    phoneBusy = false;
  }
}

async function runSelectedMode(mode, text) {
  const selectedText = String(text || '').trim();
  const validModes = ['chatgpt', 'gemini', 'android'];
  const selectedMode = validModes.includes(mode) ? mode : 'chatgpt';

  if (!selectedText) {
    throw new Error('Không lấy được văn bản đang bôi đen. Hãy bôi đen câu hỏi rồi chuột phải.');
  }

  if (selectedMode === 'chatgpt') {
    await setActionState('…', 'Đang gửi văn bản sang ChatGPT Web…');
    const result = await sendToChatGPT(selectedText);
    if (!result?.ok) throw new Error(result?.error || 'Không gửi được sang ChatGPT Web.');
    await setActionState('✓', 'Đã gửi văn bản sang ChatGPT Web', 2200);
    return { ok: true, mode: selectedMode };
  }

  if (selectedMode === 'gemini') {
    if (!globalThis.RCGPTGemini?.handleGeminiDelivery) {
      throw new Error('Không tải được chức năng Gemini. Hãy tải lại extension.');
    }
    const result = await globalThis.RCGPTGemini.handleGeminiDelivery(selectedText);
    if (!result?.ok) throw new Error(result?.error || 'Gemini/Telegram xử lý thất bại.');
    return { ...result, mode: selectedMode };
  }

  // In Android mode, the selected text is the deliberate right-click trigger.
  // The actual question is read from the connected Android screen through ADB/OCR.
  const result = await readPhoneAndSend();
  if (!result?.ok) throw new Error(result?.error || 'Không đọc/gửi được màn hình Android.');
  return { ...result, mode: selectedMode };
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type === 'RUN_SELECTED_MODE') {
    runSelectedMode(message.mode, message.text)
      .then(reply)
      .catch(async error => {
        const detail = String(error?.message || error);
        console.error('[Right Click AI]', detail);
        await setActionState('!', detail, 6000);
        reply({ ok: false, error: detail });
      });
    return true;
  }

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
