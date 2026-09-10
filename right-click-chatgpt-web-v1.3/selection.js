(() => {
  if (globalThis.__RIGHT_CLICK_CHATGPT_AUTO__) return;
  globalThis.__RIGHT_CLICK_CHATGPT_AUTO__ = true;

  let lastText = "";
  let lastRunAt = 0;

  function getSelectedText() {
    const text = String(window.getSelection?.()?.toString?.() || "").trim();
    if (text) return text;

    const active = document.activeElement;
    if (active && (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement)) {
      const start = active.selectionStart ?? 0;
      const end = active.selectionEnd ?? 0;
      return String(active.value || "").slice(start, end).trim();
    }

    return "";
  }

  async function autoAsk(text) {
    const clean = String(text || "").trim();
    if (!clean) return;

    // Prevent duplicate launches from repeated contextmenu events.
    const now = Date.now();
    if (clean === lastText && now - lastRunAt < 1500) return;
    lastText = clean;
    lastRunAt = now;

    try {
      const result = await chrome.runtime.sendMessage({
        type: "ASK_CHATGPT_WEB",
        text: clean,
        pageTitle: document.title,
        pageUrl: location.href,
        autoTriggered: true
      });
      if (!result?.ok) {
        console.error("[Right Click ChatGPT + Gemini] Tự động chạy lỗi:", result?.error || result);
      } else {
        console.log("[Right Click ChatGPT + Gemini] Đã tự động gửi yêu cầu từ chuột phải.", result);
      }
    } catch (error) {
      console.error("[Right Click ChatGPT + Gemini] Không thể gửi yêu cầu:", error);
    }
  }

  document.addEventListener("contextmenu", () => {
    const text = getSelectedText();
    if (text) void autoAsk(text);
  }, true);
})();
