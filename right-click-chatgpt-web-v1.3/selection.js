(() => {
  if (globalThis.__RCGPT_AUTO_RIGHT_CLICK__) return;
  globalThis.__RCGPT_AUTO_RIGHT_CLICK__ = true;

  let lastText = '';
  let lastAt = 0;

  function selectedText() {
    try {
      const direct = String(window.getSelection?.()?.toString?.() || '').trim();
      if (direct) return direct;
    } catch (_) {}

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
    if (text === lastText && now - lastAt < 1200) return;

    lastText = text;
    lastAt = now;

    chrome.runtime.sendMessage({
      type: 'ASK_CHATGPT_WEB',
      text,
      source: 'right-click-auto'
    }).catch(() => {});
  }

  function onRightPointerDown(event) {
    if (event.button !== 2) return;

    // Capture the right-click before page scripts can swallow contextmenu.
    // Defer one task so the browser has finished updating the current selection.
    setTimeout(sendSelection, 0);
  }

  // Listen on window in the capture phase. This is intentionally earlier than
  // the old document/contextmenu-only path and works better on interactive sites.
  window.addEventListener('pointerdown', onRightPointerDown, true);
  window.addEventListener('mousedown', onRightPointerDown, true);
  window.addEventListener('contextmenu', sendSelection, true);

  // Keep the document listener as a fallback for unusual event routing.
  document.addEventListener('contextmenu', sendSelection, true);
})();
