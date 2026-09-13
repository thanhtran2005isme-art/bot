const CHATGPT_URL = 'https://chatgpt.com/';
const MENU_ID = 'ask-chatgpt-web';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function createMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Hỏi ChatGPT',
      contexts: ['selection']
    });
  });
}

chrome.runtime.onInstalled.addListener(createMenu);
chrome.runtime.onStartup.addListener(createMenu);

function isChatGPT(url) {
  return /^https:\/\/(chatgpt\.com|chat\.openai\.com)(\/|$)/i.test(String(url || ''));
}

async function waitForTabComplete(tabId) {
  try {
    if ((await chrome.tabs.get(tabId)).status === 'complete') return;
  } catch (_) {}

  await new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timeout);
      resolve();
    };
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish();
    };
    const timeout = setTimeout(finish, 20000);
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function sendToChatGPT(prompt) {
  const text = String(prompt || '').trim();
  if (!text) return { ok: false, error: 'Prompt rỗng.' };

  const tabs = await chrome.tabs.query({});
  let tab = tabs.find(t => t.active && isChatGPT(t.url)) || tabs.find(t => isChatGPT(t.url));

  if (!tab) {
    tab = await chrome.tabs.create({ url: CHATGPT_URL, active: true });
  } else {
    tab = await chrome.tabs.update(tab.id, { active: true });
  }

  try {
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch (_) {}

  await waitForTabComplete(tab.id);

  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const result = await chrome.tabs.sendMessage(tab.id, {
        type: 'FILL_AND_SEND_CHATGPT',
        text,
        autoSend: true
      });
      if (result?.ok) return result;
      if (result?.error) console.warn('[Right Click ChatGPT]', result.error);
    } catch (_) {}

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['chatgpt-direct.js']
      });
    } catch (_) {}

    await sleep(500);
  }

  return { ok: false, error: 'Không thể gửi prompt trực tiếp tới ChatGPT.' };
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== 'ASK_CHATGPT_WEB') return;

  sendToChatGPT(message.text)
    .then(reply)
    .catch(error => reply({ ok: false, error: String(error?.message || error) }));
  return true;
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText) return;

  sendToChatGPT(info.selectionText).catch(error => {
    console.error('[Right Click ChatGPT]', error);
  });
});
