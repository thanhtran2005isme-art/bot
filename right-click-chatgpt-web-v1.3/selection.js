(() => {
  if (globalThis.__RCGPT_SELECTION_CACHE__) return;
  globalThis.__RCGPT_SELECTION_CACHE__ = true;

  const CACHE_TTL_MS = 15000;
  let cachedText = '';
  let cachedAt = 0;

  function readSelectionNow() {
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

  function rememberSelection() {
    const text = readSelectionNow();
    // Some pages clear the live selection when the native context menu opens.
    // Keep the latest non-empty value briefly for the context-menu handler.
    if (!text) return;
    cachedText = text;
    cachedAt = Date.now();
  }

  function selectedText() {
    const liveText = readSelectionNow();
    if (liveText) {
      cachedText = liveText;
      cachedAt = Date.now();
      return liveText;
    }

    if (cachedText && Date.now() - cachedAt <= CACHE_TTL_MS) {
      return cachedText;
    }

    return '';
  }

  function rememberSoon() {
    setTimeout(rememberSelection, 0);
  }

  document.addEventListener('selectionchange', rememberSoon, true);
  document.addEventListener('copy', rememberSelection, true);
  document.addEventListener('keyup', rememberSoon, true);
  document.addEventListener('mouseup', rememberSoon, true);

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type !== 'GET_SELECTED_TEXT') return;
    reply({ text: selectedText() });
  });
})();
