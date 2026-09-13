const CHATGPT_URL = 'https://chatgpt.com/';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let lastPrompt = '';
let lastPromptAt = 0;

function isChatGPT(url) {
  return /^https:\/\/(chatgpt\.com|chat\.openai\.com)(\/|$)/i.test(String(url || ''));
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

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== 'ASK_CHATGPT_WEB') return;

  sendToChatGPT(message.text)
    .then(reply)
    .catch(error => reply({ ok: false, error: String(error?.message || error) }));
  return true;
});
