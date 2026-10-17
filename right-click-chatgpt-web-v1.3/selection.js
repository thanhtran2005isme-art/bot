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

  let activeMode = 'chatgpt';
  const validModes = ['chatgpt', 'gemini', 'android'];
  const normalizeMode = mode => validModes.includes(mode) ? mode : 'chatgpt';

  chrome.storage.local.get({ activeMode: 'chatgpt' }, values => {
    activeMode = normalizeMode(values.activeMode);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.activeMode) {
      activeMode = normalizeMode(changes.activeMode.newValue);
    }
  });

  function runSavedModeOnRightClick(event) {
    // Use a live selection here, not the cache, so a stale earlier selection
    // cannot accidentally trigger an action on a later right-click.
    const text = readSelectionNow();
    if (!text) return;

    // A selected-text right-click is the trigger; suppress the browser/site menu
    // only for this case. Right-clicks without selected text behave normally.
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    cachedText = text;
    cachedAt = Date.now();

    chrome.runtime.sendMessage({
      type: 'RUN_SELECTED_MODE',
      mode: activeMode,
      text
    }, response => {
      if (chrome.runtime.lastError) {
        console.warn('[Right Click AI]', chrome.runtime.lastError.message);
      } else if (response && !response.ok) {
        console.warn('[Right Click AI]', response.error || 'Thao tác thất bại.');
      }
    });
  }

  document.addEventListener('contextmenu', runSavedModeOnRightClick, true);

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type !== 'GET_SELECTED_TEXT') return;
    reply({ text: selectedText() });
  });
})();
