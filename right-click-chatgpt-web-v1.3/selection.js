(() => {
  if (globalThis.__RCGPT_AUTO_RIGHT_CLICK__) return;
  globalThis.__RCGPT_AUTO_RIGHT_CLICK__ = true;

  const CACHE_TTL_MS = 15000;
  const DUPLICATE_WINDOW_MS = 1500;
  const GEMINI_DUPLICATE_WINDOW_MS = 1800;

  let cachedText = '';
  let cachedAt = 0;
  let lastSentText = '';
  let lastSentAt = 0;
  let lastGeminiText = '';
  let lastGeminiAt = 0;

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

  function sendToGeminiAndDestination(event) {
    const text = textForSend();
    if (!text) return;

    const now = Date.now();
    if (text === lastGeminiText && now - lastGeminiAt < GEMINI_DUPLICATE_WINDOW_MS) return;

    lastGeminiText = text;
    lastGeminiAt = now;

    // Alt + right-click is the new workflow. Suppress the browser context menu
    // and keep the existing plain right-click -> ChatGPT behavior unchanged.
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    chrome.runtime.sendMessage({
      type: 'ASK_GEMINI_AND_DELIVER',
      text
    }).then(result => {
      if (!result?.ok) console.error('[Gemini → delivery]', result?.error || 'Unknown error');
    }).catch(error => console.error('[Gemini → delivery]', error));
  }

  function rememberSoon() {
    setTimeout(rememberSelection, 0);
  }

  function onRightButton(event) {
    if (event.button !== 2) return;

    rememberSelection();

    // Do not let mouse/pointer events trigger the old ChatGPT route for
    // Alt + right-click; the contextmenu handler below handles that gesture.
    if (event.altKey) return;

    setTimeout(() => sendSelection('right-click-' + event.type), 0);
  }

  function onContextMenu(event) {
    rememberSelection();

    if (event?.altKey) {
      sendToGeminiAndDestination(event);
      return;
    }

    sendSelection('right-click-contextmenu');
  }

  document.addEventListener('selectionchange', rememberSoon, true);
  document.addEventListener('copy', rememberSelection, true);
  document.addEventListener('keyup', rememberSoon, true);

  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'auxclick']) {
    window.addEventListener(type, onRightButton, true);
    document.addEventListener(type, onRightButton, true);
  }

  window.addEventListener('contextmenu', onContextMenu, true);
  document.addEventListener('contextmenu', onContextMenu, true);
})();
