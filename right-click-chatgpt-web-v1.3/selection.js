(() => {
  if (globalThis.__RCGPT_AUTO_RIGHT_CLICK__) return;
  globalThis.__RCGPT_AUTO_RIGHT_CLICK__ = true;

  const CACHE_TTL_MS = 15000;
  const DUPLICATE_WINDOW_MS = 1500;

  let cachedText = '';
  let cachedAt = 0;
  let lastSentText = '';
  let lastSentAt = 0;

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

    // Do not erase the cache when another extension temporarily clears the
    // selection while it is enabling copy/right-click.
    if (!text) return;

    cachedText = text;
    cachedAt = Date.now();
  }

  function textForSend() {
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

  function sendSelection(source = 'right-click-auto') {
    const text = textForSend();
    if (!text) return;

    const now = Date.now();
    if (text === lastSentText && now - lastSentAt < DUPLICATE_WINDOW_MS) return;

    lastSentText = text;
    lastSentAt = now;

    chrome.runtime.sendMessage({
      type: 'ASK_CHATGPT_WEB',
      text,
      source
    }).catch(() => {});
  }

  function rememberSoon() {
    setTimeout(rememberSelection, 0);
  }

  function onRightButton(event) {
    if (event.button !== 2) return;

    // Preserve the selection before Allow Right Click (or the page itself)
    // has a chance to replace/clear it, then send from the live-or-cached value.
    rememberSelection();
    setTimeout(() => sendSelection(`right-click-${event.type}`), 0);
  }

  function onContextMenu() {
    rememberSelection();
    sendSelection('right-click-contextmenu');
  }

  // Cache text as soon as the user creates a selection. This decouples
  // sending from whatever another extension does during the right-click.
  document.addEventListener('selectionchange', rememberSoon, true);
  document.addEventListener('copy', rememberSelection, true);
  document.addEventListener('keyup', rememberSoon, true);

  // Multiple independent right-button signals make the extension resilient
  // when another extension suppresses one particular mouse event.
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'auxclick']) {
    window.addEventListener(type, onRightButton, true);
    document.addEventListener(type, onRightButton, true);
  }

  window.addEventListener('contextmenu', onContextMenu, true);
  document.addEventListener('contextmenu', onContextMenu, true);
})();
