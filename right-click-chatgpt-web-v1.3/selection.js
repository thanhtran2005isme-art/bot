(() => {
  if (globalThis.__RCGPT_AUTO_RIGHT_CLICK__) return;
  globalThis.__RCGPT_AUTO_RIGHT_CLICK__ = true;

  let lastText = '';
  let lastAt = 0;

  function selectedText() {
    const direct = String(window.getSelection?.()?.toString?.() || '').trim();
    if (direct) return direct;

    const el = document.activeElement;
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? 0;
      return String(el.value || '').slice(start, end).trim();
    }

    return '';
  }

  function sendSelection() {
    const text = selectedText();
    if (!text) return;

    const now = Date.now();
    if (text === lastText && now - lastAt < 1000) return;
    lastText = text;
    lastAt = now;

    chrome.runtime.sendMessage({
      type: 'ASK_CHATGPT_WEB',
      text,
      source: 'right-click-auto'
    }).catch(() => {});
  }

  document.addEventListener('contextmenu', sendSelection, true);
})();
