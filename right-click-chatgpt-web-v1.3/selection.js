(() => {
  if (globalThis.__RIGHT_CLICK_CHATGPT_WEB_V12__) return;
  globalThis.__RIGHT_CLICK_CHATGPT_WEB_V12__ = true;

  let lastSentAt = 0;

  function selectedText() {
    const s = window.getSelection?.()?.toString?.()?.trim();
    if (s) return s;

    const el = document.activeElement;
    if (el && (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement)) {
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? 0;
      return el.value.slice(start, end).trim();
    }
    return "";
  }

  document.addEventListener("contextmenu", () => {
    const text = selectedText();
    if (!text) return;

    const now = Date.now();
    if (now - lastSentAt < 700) return;
    lastSentAt = now;

    chrome.runtime.sendMessage({
      type: "ASK_CHATGPT_WEB",
      text,
      pageTitle: document.title,
      pageUrl: location.href
    }).catch(() => {});
  }, true);
})();
