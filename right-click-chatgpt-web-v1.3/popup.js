const autoSend = document.getElementById("autoSend");
const includeSource = document.getElementById("includeSource");
const enableChatGPT = document.getElementById("enableChatGPT");
const enableGemini = document.getElementById("enableGemini");
const parallelMode = document.getElementById("parallelMode");
const geminiApiKey = document.getElementById("geminiApiKey");
const geminiModelPicker = document.getElementById("geminiModelPicker");
const geminiModelTrigger = document.getElementById("geminiModelTrigger");
const geminiModelMenu = document.getElementById("geminiModelMenu");
const geminiModelSearch = document.getElementById("geminiModelSearch");
const geminiModelList = document.getElementById("geminiModelList");
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
let availableModels = [];
let selectedGeminiModel = "";

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
    geminiModel: selectedGeminiModel.trim()
  });
}

async function saveTelegramSettings() {
  await chrome.storage.local.set({
    telegramBotToken: telegramBotToken.value.trim(),
    telegramChatId: telegramChatId.value.trim()
  });
}

function updateModelTrigger(text, disabled = false) {
  geminiModelTrigger.textContent = text;
  geminiModelTrigger.disabled = disabled;
}

function closeModelPicker() {
  geminiModelPicker.classList.remove("open");
}

function openModelPicker() {
  if (geminiModelTrigger.disabled || !availableModels.length) return;
  geminiModelPicker.classList.add("open");
  geminiModelSearch.value = "";
  renderModelList(availableModels);
  requestAnimationFrame(() => geminiModelSearch.focus());
}

function clearModelOptions(message = "Nhập API Key để tải model...") {
  availableModels = [];
  selectedGeminiModel = "";
  geminiModelList.replaceChildren();
  updateModelTrigger(message, true);
  closeModelPicker();
}

function modelDisplayName(model) {
  return model.displayName && model.displayName !== model.name ? model.displayName : model.name;
}

function renderModelList(models) {
  geminiModelList.replaceChildren();
  if (!models.length) {
    const empty = document.createElement("div");
    empty.className = "model-picker-empty";
    empty.textContent = "Không tìm thấy model phù hợp.";
    geminiModelList.appendChild(empty);
    return;
  }
  for (const model of models) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "model-picker-item";
    if (model.name === selectedGeminiModel) item.classList.add("selected");
    const name = document.createElement("span");
    name.className = "model-picker-name";
    name.textContent = modelDisplayName(model);
    const id = document.createElement("span");
    id.className = "model-picker-id";
    id.textContent = model.name;
    item.append(name, id);
    if (model.description) item.title = model.description;
    item.addEventListener("click", async () => {
      selectedGeminiModel = model.name;
      updateModelTrigger(modelDisplayName(model), false);
      closeModelPicker();
      await chrome.storage.local.set({ geminiModel: selectedGeminiModel });
      showModelStatus(`Đã chọn: ${modelDisplayName(model)}`);
    });
    geminiModelList.appendChild(item);
  }
}

function renderModels(models, preferredModel = "") {
  availableModels = Array.isArray(models) ? models.filter(model => model?.name) : [];
  const preferred = availableModels.some(m => m.name === preferredModel) ? preferredModel : availableModels[0]?.name || "";
  selectedGeminiModel = preferred;
  if (!availableModels.length) {
    updateModelTrigger("Không có model hỗ trợ generateContent", true);
    geminiModelList.replaceChildren();
    return preferred;
  }
  const selected = availableModels.find(m => m.name === preferred);
  updateModelTrigger(modelDisplayName(selected), false);
  renderModelList(availableModels);
  return preferred;
}

async function loadGeminiModels(apiKey, { silent = false, preferredModel = "" } = {}) {
  const key = String(apiKey || "").trim();
  const requestId = ++modelRequestId;
  if (!key) {
    clearModelOptions();
    showModelStatus("");
    return false;
  }
  loadingModels = true;
  updateModelTrigger("◌ Đang tải model...", true);
  closeModelPicker();
  showModelStatus("Đang kiểm tra API Key và tải danh sách model…");
  try {
    const result = await chrome.runtime.sendMessage({ type: "LIST_GEMINI_MODELS", apiKey: key });
    if (requestId !== modelRequestId) return false;
    if (!result?.ok) {
      clearModelOptions("⚠ Không tải được model");
      showModelStatus(result?.error || "Không tải được danh sách model.", false);
      return false;
    }
    const selected = renderModels(result.models || [], preferredModel);
    if (!availableModels.length) {
      showModelStatus("⚠ Không tìm thấy model hỗ trợ generateContent.", false);
      return false;
    }
    await chrome.storage.local.set({ geminiApiKey: key, geminiModel: selected });
    showModelStatus(`✓ Đã tải ${availableModels.length} model hỗ trợ generateContent.`);
    if (!silent) showStatus(`✅ Đã tải ${availableModels.length} model Gemini.`);
    return true;
  } catch (err) {
    if (requestId !== modelRequestId) return false;
    clearModelOptions("⚠ Không tải được model");
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
    ++modelRequestId;
    clearModelOptions();
    showModelStatus("");
    return;
  }
  showModelStatus("Đang chờ nhập xong API Key…");
  modelLoadTimer = setTimeout(() => loadGeminiModels(key, { silent: true, preferredModel: selectedGeminiModel }), 800);
}

geminiModelTrigger.addEventListener("click", () => {
  if (geminiModelPicker.classList.contains("open")) closeModelPicker();
  else openModelPicker();
});

geminiModelSearch.addEventListener("input", () => {
  const query = geminiModelSearch.value.trim().toLowerCase();
  if (!query) return renderModelList(availableModels);
  renderModelList(availableModels.filter(model => {
    const name = modelDisplayName(model).toLowerCase();
    const id = String(model.name || "").toLowerCase();
    const description = String(model.description || "").toLowerCase();
    return name.includes(query) || id.includes(query) || description.includes(query);
  }));
});

document.addEventListener("click", event => {
  if (!geminiModelPicker.contains(event.target)) closeModelPicker();
});

geminiModelSearch.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeModelPicker();
    geminiModelTrigger.focus();
  }
});

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
    await loadGeminiModels(settings.geminiApiKey, { silent: true, preferredModel: settings.geminiModel });
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

saveGemini.addEventListener("click", async () => {
  const key = geminiApiKey.value.trim();
  if (!key) {
    showStatus("Nhập Gemini API Key trước.", false);
    return;
  }
  saveGemini.disabled = true;
  try {
    const ok = await loadGeminiModels(key, { preferredModel: selectedGeminiModel });
    if (ok) showStatus(`✅ Đã lưu Gemini và model: ${selectedGeminiModel}`);
  } finally {
    saveGemini.disabled = false;
  }
});

testGemini.addEventListener("click", async () => {
  const key = geminiApiKey.value.trim();
  if (!key) {
    showStatus("Nhập Gemini API Key trước.", false);
    return;
  }

  testGemini.disabled = true;
  showStatus("Đang kiểm tra Gemini…");
  try {
    if (loadingModels || !selectedGeminiModel || !availableModels.some(m => m.name === selectedGeminiModel)) {
      const ok = await loadGeminiModels(key, { silent: true, preferredModel: selectedGeminiModel });
      if (!ok) return;
    }
    await chrome.storage.local.set({ geminiApiKey: key, geminiModel: selectedGeminiModel });
    const result = await chrome.runtime.sendMessage({
      type: "TEST_GEMINI",
      apiKey: key,
      model: selectedGeminiModel
    });
    if (result?.ok) showStatus(`✅ Gemini hoạt động với ${selectedGeminiModel}.`);
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