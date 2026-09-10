const autoSend = document.getElementById("autoSend");
const includeSource = document.getElementById("includeSource");
const enableChatGPT = document.getElementById("enableChatGPT");
const enableGemini = document.getElementById("enableGemini");
const parallelMode = document.getElementById("parallelMode");
const geminiApiKey = document.getElementById("geminiApiKey");
const geminiModel = document.getElementById("geminiModel");
const saveGemini = document.getElementById("saveGemini");
const testGemini = document.getElementById("testGemini");
const telegramBotToken = document.getElementById("telegramBotToken");
const telegramChatId = document.getElementById("telegramChatId");
const saveTelegram = document.getElementById("saveTelegram");
const testTelegram = document.getElementById("testTelegram");
const status = document.getElementById("status");

function showStatus(text, ok = true) {
  status.textContent = text;
  status.style.color = ok ? "#1a7f37" : "#cf222e";
}

async function saveGeminiSettings() {
  await chrome.storage.local.set({ geminiApiKey: geminiApiKey.value.trim(), geminiModel: geminiModel.value });
}

async function saveTelegramSettings() {
  await chrome.storage.local.set({ telegramBotToken: telegramBotToken.value.trim(), telegramChatId: telegramChatId.value.trim() });
}

chrome.storage.local.get({
  autoSend: true,
  includeSource: false,
  enableChatGPT: true,
  enableGemini: true,
  parallelMode: true,
  geminiApiKey: "",
  geminiModel: "gemini-2.5-flash",
  telegramBotToken: "",
  telegramChatId: ""
}).then(settings => {
  autoSend.checked = settings.autoSend;
  includeSource.checked = settings.includeSource;
  enableChatGPT.checked = settings.enableChatGPT;
  enableGemini.checked = settings.enableGemini;
  parallelMode.checked = settings.parallelMode;
  geminiApiKey.value = settings.geminiApiKey;
  geminiModel.value = settings.geminiModel;
  telegramBotToken.value = settings.telegramBotToken;
  telegramChatId.value = settings.telegramChatId;
});

autoSend.addEventListener("change", () => chrome.storage.local.set({ autoSend: autoSend.checked }));
includeSource.addEventListener("change", () => chrome.storage.local.set({ includeSource: includeSource.checked }));
enableChatGPT.addEventListener("change", () => chrome.storage.local.set({ enableChatGPT: enableChatGPT.checked }));
enableGemini.addEventListener("change", () => chrome.storage.local.set({ enableGemini: enableGemini.checked }));
parallelMode.addEventListener("change", () => chrome.storage.local.set({ parallelMode: parallelMode.checked }));

geminiModel.addEventListener("change", () => chrome.storage.local.set({ geminiModel: geminiModel.value }));

saveGemini.addEventListener("click", async () => {
  await saveGeminiSettings();
  showStatus("Đã lưu Gemini API Key và model.");
});

testGemini.addEventListener("click", async () => {
  if (!geminiApiKey.value.trim()) {
    showStatus("Nhập Gemini API Key trước.", false);
    return;
  }
  testGemini.disabled = true;
  showStatus("Đang kiểm tra Gemini…");
  try {
    await saveGeminiSettings();
    const result = await chrome.runtime.sendMessage({ type: "TEST_GEMINI" });
    if (result?.ok) showStatus("✅ Gemini API hoạt động tốt.");
    else showStatus(result?.error || "Gemini API lỗi.", false);
  } catch (err) {
    showStatus(String(err?.message || err), false);
  } finally {
    testGemini.disabled = false;
  }
});

saveTelegram.addEventListener("click", async () => {
  await saveTelegramSettings();
  showStatus("Đã lưu Telegram Bot Token và Chat ID.");
});

testTelegram.addEventListener("click", async () => {
  if (!telegramBotToken.value.trim() || !telegramChatId.value.trim()) {
    showStatus("Nhập đủ Bot Token và Chat ID trước.", false);
    return;
  }
  testTelegram.disabled = true;
  showStatus("Đang gửi thử…");
  try {
    await saveTelegramSettings();
    const result = await chrome.runtime.sendMessage({ type: "TEST_TELEGRAM" });
    if (result?.ok) showStatus("✅ Telegram đã nhận tin nhắn thử.");
    else showStatus(result?.error || "Không gửi được Telegram.", false);
  } catch (err) {
    showStatus(String(err?.message || err), false);
  } finally {
    testTelegram.disabled = false;
  }
});
