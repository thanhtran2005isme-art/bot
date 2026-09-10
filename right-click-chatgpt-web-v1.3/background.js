const CHATGPT_URL = "https://chatgpt.com/";
const ASK_MENU_ID = "ask-chatgpt-web-fallback";
const TELEGRAM_MENU_ID = "send-selection-to-telegram";

async function ensureDefaults() {
  const current = await chrome.storage.local.get([
    "autoSend", "includeSource", "telegramBotToken", "telegramChatId",
    "geminiApiKey", "geminiModel", "enableGemini", "enableChatGPT", "parallelMode"
  ]);
  const defaults = {};
  if (typeof current.autoSend !== "boolean") defaults.autoSend = true;
  if (typeof current.includeSource !== "boolean") defaults.includeSource = false;
  if (typeof current.telegramBotToken !== "string") defaults.telegramBotToken = "";
  if (typeof current.telegramChatId !== "string") defaults.telegramChatId = "";
  if (typeof current.geminiApiKey !== "string") defaults.geminiApiKey = "";
  if (typeof current.geminiModel !== "string") defaults.geminiModel = "";
  if (typeof current.enableGemini !== "boolean") defaults.enableGemini = true;
  if (typeof current.enableChatGPT !== "boolean") defaults.enableChatGPT = true;
  if (typeof current.parallelMode !== "boolean") defaults.parallelMode = true;
  if (Object.keys(defaults).length) await chrome.storage.local.set(defaults);
}

function ensureContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: ASK_MENU_ID, title: "Hỏi ChatGPT + Gemini", contexts: ["selection"] });
    chrome.contextMenus.create({ id: TELEGRAM_MENU_ID, title: "Gửi đoạn đã chọn → Telegram", contexts: ["selection"] });
  });
}

async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url || !/^https?:\/\//i.test(tab.url)) continue;
    const file = /^https:\/\/chatgpt\.com\//i.test(tab.url) ? "chatgpt.js" : "selection.js";
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: file === "selection.js" }, files: [file] });
    } catch (_) {}
  }
}

chrome.runtime.onInstalled.addListener(async () => { await ensureDefaults(); ensureContextMenu(); await injectIntoOpenTabs(); });
chrome.runtime.onStartup.addListener(async () => { await ensureDefaults(); ensureContextMenu(); });

function isChatGPTUrl(url) {
  return /^https:\/\/chatgpt\.com(?:\/|$)/i.test(String(url || "")) || /^https:\/\/chat\.openai\.com(?:\/|$)/i.test(String(url || ""));
}

async function waitForTabComplete(tabId, timeoutMs = 15000) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === "complete") return;

  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function sendPendingToChatGPTTab(tabId) {
  await waitForTabComplete(tabId);

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: "CHECK_PENDING_PROMPT" });
      return { ok: true };
    } catch (_) {
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ["chatgpt.js"] });
        await chrome.tabs.sendMessage(tabId, { type: "CHECK_PENDING_PROMPT" });
        return { ok: true };
      } catch (error) {
        if (attempt === 3) return { ok: false, error: `Không kết nối được ChatGPT Web: ${error?.message || error}` };
        await new Promise(resolve => setTimeout(resolve, 700));
      }
    }
  }
  return { ok: false, error: "Không thể gửi prompt tới ChatGPT Web." };
}

async function sendToChatGPT(text, pageTitle, pageUrl) {
  const settings = await chrome.storage.local.get({ autoSend: true, includeSource: false });
  let prompt = String(text || "").trim();
  if (!prompt) return { ok: false, error: "Không có văn bản được chọn" };
  if (settings.includeSource && pageUrl) prompt += `\n\nNguồn: ${pageTitle || "Trang web"}\n${pageUrl}`;

  await chrome.storage.local.set({ pendingChatGPTPrompt: { text: prompt, createdAt: Date.now(), autoSend: settings.autoSend } });

  const tabs = await chrome.tabs.query({});
  const chatTabs = tabs.filter(tab => tab.id && isChatGPTUrl(tab.url));
  let tab = chatTabs.find(t => t.active) || chatTabs[0];

  if (!tab) {
    tab = await chrome.tabs.create({ url: CHATGPT_URL, active: true });
  } else {
    await chrome.tabs.update(tab.id, { active: true });
  }

  if (tab.windowId != null) {
    try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (_) {}
  }

  const delivered = await sendPendingToChatGPTTab(tab.id);
  if (!delivered.ok) return delivered;
  return { ok: true, tabId: tab.id };
}

async function geminiListModels(apiKey) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("Chưa nhập Gemini API Key.");

  const models = [];
  let pageToken = "";
  const seenTokens = new Set();

  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({ key, pageSize: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?${params.toString()}`);
    let data;
    try { data = await response.json(); } catch (_) { throw new Error(`Gemini trả về HTTP ${response.status}`); }
    if (!response.ok || data?.error) throw new Error(data?.error?.message || `Gemini trả về HTTP ${response.status}`);

    for (const model of data?.models || []) {
      const actions = Array.isArray(model?.supportedGenerationMethods)
        ? model.supportedGenerationMethods
        : Array.isArray(model?.supportedActions) ? model.supportedActions : [];
      const name = String(model?.name || "");
      if (!name || !actions.includes("generateContent")) continue;
      models.push({
        name: name.replace(/^models\//, ""),
        displayName: String(model?.displayName || name.replace(/^models\//, "")),
        description: String(model?.description || ""),
        inputTokenLimit: model?.inputTokenLimit ?? null,
        outputTokenLimit: model?.outputTokenLimit ?? null
      });
    }

    const next = String(data?.nextPageToken || "");
    if (!next || seenTokens.has(next)) break;
    seenTokens.add(next);
    pageToken = next;
  }

  const unique = [...new Map(models.map(m => [m.name, m])).values()];
  unique.sort((a, b) => a.displayName.localeCompare(b.displayName));
  if (!unique.length) throw new Error("API Key hợp lệ nhưng không có model hỗ trợ generateContent.");
  return unique;
}

async function geminiRequest(apiKey, model, prompt) {
  const key = String(apiKey || "").trim();
  const modelName = String(model || "").trim().replace(/^models\//, "");
  const textPrompt = String(prompt || "").trim();
  if (!key) throw new Error("Chưa nhập Gemini API Key.");
  if (!modelName) throw new Error("Chưa chọn Gemini model.");
  if (!textPrompt) throw new Error("Không có nội dung để hỏi Gemini.");

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(key)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: textPrompt }] }] })
  });
  let data;
  try { data = await response.json(); } catch (_) { throw new Error(`Gemini trả về HTTP ${response.status}`); }
  if (!response.ok || data?.error) throw new Error(data?.error?.message || `Gemini trả về HTTP ${response.status}`);
  const text = (data?.candidates || []).flatMap(c => c?.content?.parts || []).map(p => p?.text || "").join("").trim();
  if (!text) throw new Error("Gemini không trả về nội dung");
  return text;
}

async function askGemini(text, apiKeyOverride = "", modelOverride = "") {
  const stored = await chrome.storage.local.get({ geminiApiKey: "", geminiModel: "" });
  const apiKey = String(apiKeyOverride || stored.geminiApiKey || "").trim();
  const model = String(modelOverride || stored.geminiModel || "").trim();
  return geminiRequest(apiKey, model, String(text || "").trim());
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
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  let data;
  try { data = await response.json(); } catch (_) { throw new Error(`Telegram trả về HTTP ${response.status}`); }
  if (!response.ok || !data?.ok) throw new Error(data?.description || `Telegram trả về HTTP ${response.status}`);
  return data.result;
}

async function sendToTelegram(text) {
  const clean = String(text || "").trim();
  if (!clean) throw new Error("Không có văn bản được chọn");
  const { telegramBotToken = "", telegramChatId = "" } = await chrome.storage.local.get({ telegramBotToken: "", telegramChatId: "" });
  const token = telegramBotToken.trim(), chatId = telegramChatId.trim();
  if (!token || !chatId) throw new Error("Chưa nhập Telegram Bot Token hoặc Chat ID.");
  const chunks = splitTelegramText(clean);
  for (let i = 0; i < chunks.length; i++) {
    await telegramRequest(token, "sendMessage", { chat_id: chatId, text: chunks.length > 1 ? `${chunks[i]}\n\n(${i + 1}/${chunks.length})` : chunks[i], disable_web_page_preview: true });
  }
  return { ok: true, messages: chunks.length };
}

function notifyError(label, error) {
  console.error(`[Right Click ChatGPT + Gemini] ${label}:`, error);
}

async function askBoth(text, pageTitle, pageUrl) {
  // The context-menu action is explicitly a dual-provider action.
  // It must not be disabled by stale enableGemini/enableChatGPT values in storage.
  const geminiJob = askGemini(text)
    .then(async answer => {
      const { geminiModel = "" } = await chrome.storage.local.get({ geminiModel: "" });
      try {
        await sendToTelegram(`✨ Gemini (${geminiModel || "model"})\n\n${answer}`);
        return { provider: "gemini", ok: true, answer, telegramSent: true };
      } catch (error) {
        return { provider: "gemini", ok: true, answer, telegramSent: false, telegramError: String(error?.message || error) };
      }
    })
    .catch(error => ({ provider: "gemini", ok: false, error: String(error?.message || error) }));

  const chatgptJob = sendToChatGPT(text, pageTitle, pageUrl)
    .then(result => ({ provider: "chatgpt", ...result }))
    .catch(error => ({ provider: "chatgpt", ok: false, error: String(error?.message || error) }));

  // Start both immediately; neither awaits the other.
  return Promise.all([chatgptJob, geminiJob]);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ASK_CHATGPT_WEB") {
    askBoth(message.text, message.pageTitle, message.pageUrl)
      .then(results => sendResponse({ ok: results.some(r => r.ok !== false), results }))
      .catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (message?.type === "LIST_GEMINI_MODELS") {
    geminiListModels(message.apiKey).then(async models => {
      await chrome.storage.local.set({ geminiApiKey: String(message.apiKey || "").trim() });
      sendResponse({ ok: true, models });
    }).catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (message?.type === "TEST_TELEGRAM") {
    sendToTelegram("✅ Kết nối Telegram thành công từ extension Right Click → ChatGPT + Gemini.").then(sendResponse).catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (message?.type === "TEST_GEMINI") {
    const apiKey = String(message.apiKey || "").trim();
    const model = String(message.model || "").trim();
    askGemini("Trả lời ngắn gọn: Gemini API đang hoạt động tốt.", apiKey, model)
      .then(async answer => {
        let telegramSent = false;
        let telegramError = "";
        try {
          await sendToTelegram(`✨ Gemini Test (${model || "model"})\n\n${answer}`);
          telegramSent = true;
        } catch (error) {
          telegramError = String(error?.message || error);
        }
        sendResponse({ ok: true, answer, telegramSent, telegramError });
      })
      .catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (message?.type === "SEND_CHATGPT_ANSWER") {
    sendToTelegram("🤖 ChatGPT trả lời\n\n" + String(message.text || "").trim()).then(sendResponse).catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!info.selectionText) return;
  if (info.menuItemId === ASK_MENU_ID) {
    askBoth(info.selectionText, tab?.title, tab?.url)
      .then(results => {
        const gemini = results.find(r => r.provider === "gemini");
        const chatgpt = results.find(r => r.provider === "chatgpt");
        if (!gemini?.ok) notifyError("Gemini", gemini?.error);
        if (gemini?.telegramSent === false) notifyError("Gemini → Telegram", gemini.telegramError);
        if (!chatgpt?.ok) notifyError("ChatGPT Web", chatgpt?.error);
      })
      .catch(console.error);
    return;
  }
  if (info.menuItemId === TELEGRAM_MENU_ID) {
    sendToTelegram(info.selectionText).then(() => {
      try { flashTelegramMenu("✅ Đã gửi sang Telegram"); } catch (_) {}
    }).catch(async err => {
      console.error(err);
      await flashTelegramMenu("❌ Gửi lỗi – mở extension để kiểm tra", 3500);
    });
  }
});

async function flashTelegramMenu(message, ms = 2200) {
  try {
    await chrome.contextMenus.update(TELEGRAM_MENU_ID, { title: message });
    setTimeout(() => chrome.contextMenus.update(TELEGRAM_MENU_ID, { title: "Gửi đoạn đã chọn → Telegram" }).catch(() => {}), ms);
  } catch (_) {}
}
