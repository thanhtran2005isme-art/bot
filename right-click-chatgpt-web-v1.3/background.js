const CHATGPT_URL = "https://chatgpt.com/";
const ASK_MENU_ID = "ask-chatgpt-web-fallback";
const TELEGRAM_MENU_ID = "send-selection-to-telegram";

async function ensureDefaults() {
  const current = await chrome.storage.local.get([
    "autoSend",
    "includeSource",
    "telegramBotToken",
    "telegramChatId"
  ]);
  const defaults = {};
  if (typeof current.autoSend !== "boolean") defaults.autoSend = true;
  if (typeof current.includeSource !== "boolean") defaults.includeSource = false;
  if (typeof current.telegramBotToken !== "string") defaults.telegramBotToken = "";
  if (typeof current.telegramChatId !== "string") defaults.telegramChatId = "";
  if (Object.keys(defaults).length) await chrome.storage.local.set(defaults);
}

function ensureContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: ASK_MENU_ID,
      title: "Hỏi ChatGPT với đoạn đã chọn",
      contexts: ["selection"]
    });

    chrome.contextMenus.create({
      id: TELEGRAM_MENU_ID,
      title: "Gửi đoạn đã chọn → Telegram",
      contexts: ["selection"]
    });
  });
}

async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url || !/^https?:\/\//i.test(tab.url)) continue;
    const file = /^https:\/\/chatgpt\.com\//i.test(tab.url) ? "chatgpt.js" : "selection.js";
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: file === "selection.js" },
        files: [file]
      });
    } catch (_) {
      // Chrome blocks scripting on some protected pages.
    }
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
  ensureContextMenu();
  await injectIntoOpenTabs();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaults();
  ensureContextMenu();
});

async function sendToChatGPT(text, pageTitle, pageUrl) {
  const settings = await chrome.storage.local.get({ autoSend: true, includeSource: false });
  let prompt = String(text || "").trim();
  if (!prompt) return { ok: false, error: "Không có văn bản được chọn" };

  if (settings.includeSource && pageUrl) {
    prompt += `\n\nNguồn: ${pageTitle || "Trang web"}\n${pageUrl}`;
  }

  await chrome.storage.local.set({
    pendingChatGPTPrompt: {
      text: prompt,
      createdAt: Date.now(),
      autoSend: settings.autoSend
    }
  });

  const tabs = await chrome.tabs.query({ url: ["https://chatgpt.com/*"] });
  let tab;

  if (tabs.length) {
    tab = tabs.find(t => t.active) || tabs[0];
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });

    try {
      await chrome.tabs.sendMessage(tab.id, { type: "CHECK_PENDING_PROMPT" });
    } catch (_) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["chatgpt.js"] });
        await chrome.tabs.sendMessage(tab.id, { type: "CHECK_PENDING_PROMPT" });
      } catch (_) {}
    }
  } else {
    tab = await chrome.tabs.create({ url: CHATGPT_URL, active: true });
  }

  return { ok: true, tabId: tab?.id };
}

function splitTelegramText(text, maxLength = 3900) {
  const clean = String(text || "").trim();
  if (!clean) return [];
  if (clean.length <= maxLength) return [clean];

  const parts = [];
  let rest = clean;
  while (rest.length > maxLength) {
    let cut = rest.lastIndexOf("\n", maxLength);
    if (cut < Math.floor(maxLength * 0.6)) cut = rest.lastIndexOf(" ", maxLength);
    if (cut < Math.floor(maxLength * 0.6)) cut = maxLength;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

async function telegramRequest(botToken, method, payload) {
  const url = `https://api.telegram.org/bot${encodeURIComponent(botToken)}/${method}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  let data;
  try {
    data = await response.json();
  } catch (_) {
    throw new Error(`Telegram trả về HTTP ${response.status}`);
  }

  if (!response.ok || !data?.ok) {
    throw new Error(data?.description || `Telegram trả về HTTP ${response.status}`);
  }
  return data.result;
}

async function sendToTelegram(text) {
  const clean = String(text || "").trim();
  if (!clean) throw new Error("Không có văn bản được chọn");

  const { telegramBotToken = "", telegramChatId = "" } = await chrome.storage.local.get({
    telegramBotToken: "",
    telegramChatId: ""
  });

  const token = telegramBotToken.trim();
  const chatId = telegramChatId.trim();
  if (!token || !chatId) {
    throw new Error("Chưa nhập Telegram Bot Token hoặc Chat ID. Bấm icon extension để cài đặt.");
  }

  const chunks = splitTelegramText(clean);
  for (let i = 0; i < chunks.length; i++) {
    const textToSend = chunks.length > 1
      ? `${chunks[i]}\n\n(${i + 1}/${chunks.length})`
      : chunks[i];
    await telegramRequest(token, "sendMessage", {
      chat_id: chatId,
      text: textToSend,
      disable_web_page_preview: true
    });
  }

  return { ok: true, messages: chunks.length };
}

async function flashTelegramMenu(message, ms = 2200) {
  try {
    await chrome.contextMenus.update(TELEGRAM_MENU_ID, { title: message });
    setTimeout(() => {
      chrome.contextMenus.update(TELEGRAM_MENU_ID, {
        title: "Gửi đoạn đã chọn → Telegram"
      }).catch(() => {});
    }, ms);
  } catch (_) {}
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ASK_CHATGPT_WEB") {
    sendToChatGPT(message.text, message.pageTitle, message.pageUrl)
      .then(sendResponse)
      .catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (message?.type === "TEST_TELEGRAM") {
    sendToTelegram("✅ Kết nối Telegram thành công từ extension Right Click → ChatGPT.")
      .then(sendResponse)
      .catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (message?.type === "SEND_CHATGPT_ANSWER") {
    sendToTelegram("🤖 ChatGPT trả lời\n\n" + String(message.text || "").trim())
      .then(sendResponse)
      .catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!info.selectionText) return;

  if (info.menuItemId === ASK_MENU_ID) {
    sendToChatGPT(info.selectionText, tab?.title, tab?.url).catch(console.error);
    return;
  }

  if (info.menuItemId === TELEGRAM_MENU_ID) {
    sendToTelegram(info.selectionText)
      .then(() => flashTelegramMenu("✅ Đã gửi sang Telegram"))
      .catch(async err => {
        console.error(err);
        await flashTelegramMenu("❌ Gửi lỗi – mở extension để kiểm tra", 3500);
      });
  }
});
