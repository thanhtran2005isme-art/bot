const autoSend = document.getElementById("autoSend");
const includeSource = document.getElementById("includeSource");
const enableChatGPT = document.getElementById("enableChatGPT");
const enableGemini = document.getElementById("enableGemini");
const parallelMode = document.getElementById("parallelMode");
const geminiApiKey = document.getElementById("geminiApiKey");
const geminiModel = document.getElementById("geminiModel");
const geminiModelStatus = document.getElementById("geminiModelStatus");
const saveGemini = document.getElementById("saveGemini");
const testGemini = document.getElementById("testGemini");
const telegramBotToken = document.getElementById("telegramBotToken");
const telegramChatId = document.getElementById("telegramChatId");
const saveTelegram = document.getElementById("saveTelegram");
const testTelegram = document.getElementById("testTelegram");
const status = document.getElementById("status");

let modelLoadTimer = null;
let modelRequestId = 0;
let loadingModels = false;

function showStatus(text, ok = true) {
  status.textContent = text;
  status.style.color = ok ? "#1a7f37" : "#cf222e";
}

function showModelStatus(text, ok = true) {
  geminiModelStatus.textContent = text;
  geminiModelStatus.style.color = ok ? "#1a7f37" : "#cf222e";
}

async function saveGeminiSettings() {
  await chrome.storage.local.set({
    geminiApiKey: geminiApiKey.value.trim(),
    geminiModel: geminiModel.value.trim()
  });
}

async function saveTelegramSettings() {
  await chrome.storage.local.set({
    telegramBotToken: telegramBotToken.value.trim(),
    telegramChatId: telegramChatId.value.trim()
  });
}

function clearModelOptions(message = "Nhập API Key để tải model...") {
  geminiModel.replaceChildren();
  const option = document.createElement("option");
  option.value = "";
  option.textContent = message;
  geminiModel.appendChild(option);
  geminiModel.disabled = true;
}

function renderModels(models, preferredModel = "") {
  geminiModel.replaceChildren();

  for (const model of models) {
    const option = document.createElement("option");
    option.value = model.name;
    option.textContent = model.displayName === model.name
      ? model.name
      : `${model.displayName} (${model.name})`;
    option.title = model.description || model.name;
    geminiModel.appendChild(option);
  }

  const preferred = models.some(m => m.name === preferredModel) ? preferredModel : models[0]?.name || "";
  if (preferred) geminiModel.value = preferred;
  geminiModel.disabled = !models.length;

  return preferred;
}

async function loadGeminiModels(apiKey, { silent = false } = {}) {
  const key = String(apiKey || "").trim();
  const requestId = ++modelRequestId;

  if (!key) {
    clearModelOptions();
    showModelStatus("");
    return false;
  }

  loadingModels = true;
  geminiModel.disabled = true;
  showModelStatus("Đang kiểm tra API Key và tải danh sách model…");

  try {
    const result = await chrome.runtime.sendMessage({ type: "LIST_GEMINI_MODELS", apiKey: key });
    if (requestId !== modelRequestId) return false;

    if (!result?.ok) {
      clearModelOptions("API Key không hợp lệ hoặc không tải được model");
      showModelStatus(result?.error || "Không tải được danh sách model.", false);
      return false;
    }

    const previous = geminiModel.value;
    const preferred = previous || "";
    const selected = renderModels(result.models || [], preferred);
    await chrome.storage.local.set({
      geminiApiKey: key,
      geminiModel: selected
    });

    showModelStatus(`Đã tải ${result.models.length} model hỗ trợ generateContent.`);
    if (!silent) showStatus(`✅ Đã tải ${result.models.length} model Gemini.`);
    return true;
  } catch (err) {
    if (requestId !== modelRequestId) return false;
    clearModelOptions("Không tải được model");
    showModelStatus(String(err?.message || err), false);
    return false;
  } finally {
    if (requestId === modelRequestId) loadingModels = false;
  }
}

function scheduleModelLoad() {
  clearTimeout(modelLoadTimer);
  const key = geminiApiKey.value.trim();
  if (!key) {
    loadGeminiModels("");
    return;
  }

  showModelStatus("Đang chờ nhập xong API Key…");
  modelLoadTimer = setTimeout(() => loadGeminiModels(key, { silent: true }), 800);
}

chrome.storage.local.get({
  autoSend: true,
  includeSource: false,
  enableChatGPT: true,
  enableGemini: true,
  parallelMode: true,
  geminiApiKey: "",
  geminiModel: "",
  telegramBotToken: "",
  telegramChatId: ""
}).then(async settings => {
  autoSend.checked = settings.autoSend;
  includeSource.checked = settings.includeSource;
  enableChatGPT.checked = settings.enableChatGPT;
  enableGemini.checked = settings.enableGemini;
  parallelMode.checked = settings.parallelMode;
  geminiApiKey.value = settings.geminiApiKey;
  telegramBotToken.value = settings.telegramBotToken;
  telegramChatId.value = settings.telegramChatId;

  if (settings.geminiApiKey) {
    await loadGeminiModels(settings.geminiApiKey, { silent: true });
    if (settings.geminiModel && [...geminiModel.options].some(o => o.value === settings.geminiModel)) {
      geminiModel.value = settings.geminiModel;
    }
  } else {
    clearModelOptions();
  }
});

autoSend.addEventListener("change", () => chrome.storage.local.set({ autoSend: autoSend.checked }));
includeSource.addEventListener("change", () => chrome.storage.local.set({ includeSource: includeSource.checked }));
enableChatGPT.addEventListener("change", () => chrome.storage.local.set({ enableChatGPT: enableChatGPT.checked }));
enableGemini.addEventListener("change", () => chrome.storage.local.set({ enableGemini: enableGemini.checked }));
parallelMode.addEventListener("change", () => chrome.storage.local.set({ parallelMode: parallelMode.checked }));

geminiApiKey.addEventListener("input", scheduleModelLoad);

geminiModel.addEventListener("change", async () => {
  if (geminiModel.value) {
    await chrome.storage.local.set({ geminiModel: geminiModel.value });
    showModelStatus(`Đã chọn: ${geminiModel.value}`);
  }
});

saveGemini.addEventListener("click", async () => {
  if (!geminiApiKey.value.trim()) {
    showStatus("Nhập Gemini API Key trước.", false);
    return;
  }

  saveGemini.disabled = true;
  try {
    const ok = await loadGeminiModels(geminiApiKey.value.trim());
    if (ok) showStatus(`✅ Đã lưu Gemini và model: ${geminiModel.value}`);
  } finally {
    saveGemini.disabled = false;
  }
});

testGemini.addEventListener("click", async () => {
  if (!geminiApiKey.value.trim()) {
    showStatus("Nhập Gemini API Key trước.", false);
    return;
  }
  if (!geminiModel.value) {
    const ok = await loadGeminiModels(geminiApiKey.value.trim());
    if (!ok) return;
  }

  testGemini.disabled = true;
  showStatus("Đang kiểm tra Gemini…");
  try {
    await saveGeminiSettings();
    const result = await chrome.runtime.sendMessage({ type: "TEST_GEMINI" });
    if (result?.ok) showStatus(`✅ Gemini hoạt động với ${geminiModel.value}.`);
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
