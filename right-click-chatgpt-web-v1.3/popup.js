const autoSend = document.getElementById("autoSend");
const includeSource = document.getElementById("includeSource");
const telegramBotToken = document.getElementById("telegramBotToken");
const telegramChatId = document.getElementById("telegramChatId");
const saveTelegram = document.getElementById("saveTelegram");
const testTelegram = document.getElementById("testTelegram");
const status = document.getElementById("status");

function showStatus(text, ok = true) {
  status.textContent = text;
  status.style.color = ok ? "#1a7f37" : "#cf222e";
}

async function saveTelegramSettings() {
  await chrome.storage.local.set({
    telegramBotToken: telegramBotToken.value.trim(),
    telegramChatId: telegramChatId.value.trim()
  });
}

chrome.storage.local.get({
  autoSend: true,
  includeSource: false,
  telegramBotToken: "",
  telegramChatId: ""
}).then(settings => {
  autoSend.checked = settings.autoSend;
  includeSource.checked = settings.includeSource;
  telegramBotToken.value = settings.telegramBotToken;
  telegramChatId.value = settings.telegramChatId;
});

autoSend.addEventListener("change", () => {
  chrome.storage.local.set({ autoSend: autoSend.checked });
});

includeSource.addEventListener("change", () => {
  chrome.storage.local.set({ includeSource: includeSource.checked });
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
