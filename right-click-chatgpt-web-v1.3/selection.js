(() => {
  if (globalThis.__RCGPT_SELECTION_CACHE__) return;
  globalThis.__RCGPT_SELECTION_CACHE__ = true;

  const CACHE_TTL_MS = 15000;
  let cachedText = '';
  let cachedAt = 0;
  let toastHost = null;
  let toastRoot = null;
  let toastTimer = 0;

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

  function selectedText() {
    const liveText = readSelectionNow();
    if (liveText) {
      cachedText = liveText;
      cachedAt = Date.now();
      return liveText;
    }
    if (cachedText && Date.now() - cachedAt <= CACHE_TTL_MS) return cachedText;
    return '';
  }

  function rememberSoon() {
    setTimeout(rememberSelection, 0);
  }

  function ensureToast() {
    if (toastHost?.isConnected && toastRoot) return;

    toastHost = document.createElement('div');
    toastHost.id = '__rcgpt_status_toast_host__';
    toastHost.style.cssText = [
      'all: initial',
      'position: fixed',
      'right: 16px',
      'bottom: 16px',
      'z-index: 2147483647',
      'width: min(440px, calc(100vw - 32px))',
      'pointer-events: none'
    ].join(';');

    toastRoot = toastHost.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      .toast {
        box-sizing: border-box;
        width: fit-content;
        max-width: 100%;
        padding: 11px 15px;
        border-radius: 10px;
        color: #fff;
        background: #1d4ed8;
        box-shadow: 0 5px 24px rgba(0,0,0,.28);
        font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .toast.error { background: #b91c1c; }
      .toast.success { background: #15803d; }
      .toast.info { background: #1d4ed8; }
    `;
    toastRoot.appendChild(style);
    const container = document.createElement('div');
    container.id = 'message';
    toastRoot.appendChild(container);
    (document.documentElement || document.body).appendChild(toastHost);
  }

  function showToast(message, kind = 'info', duration = 7000) {
    try {
      ensureToast();
      clearTimeout(toastTimer);
      const container = toastRoot.getElementById('message');
      const card = document.createElement('div');
      card.className = 'toast ' + kind;
      card.textContent = String(message || '');
      container.replaceChildren(card);
      if (duration > 0) {
        toastTimer = setTimeout(() => {
          if (toastHost?.isConnected) toastHost.remove();
          toastHost = null;
          toastRoot = null;
        }, duration);
      }
    } catch (error) {
      console.warn('[Right Click AI toast]', error);
      console.info('[Right Click AI]', message);
    }
  }

  document.addEventListener('selectionchange', rememberSoon, true);
  document.addEventListener('copy', rememberSelection, true);
  document.addEventListener('keyup', rememberSoon, true);
  document.addEventListener('mouseup', rememberSoon, true);

  let activeMode = 'chatgpt';
  const validModes = ['chatgpt', 'gemini', 'android'];
  const modeLabels = {
    chatgpt: 'ChatGPT Web',
    gemini: 'Gemini → Telegram',
    android: 'Đọc màn hình Android'
  };
  const normalizeMode = mode => validModes.includes(mode) ? mode : 'chatgpt';

  try {
    chrome.storage.local.get({ activeMode: 'chatgpt' }, values => {
      activeMode = normalizeMode(values.activeMode);
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.activeMode) {
        activeMode = normalizeMode(changes.activeMode.newValue);
      }
    });
  } catch (error) {
    console.warn('[Right Click AI storage]', error);
  }

  function runSavedModeOnRightClick(event) {
    const text = readSelectionNow();
    if (!text) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    cachedText = text;
    cachedAt = Date.now();

    // Fetch the current mode again to avoid a race after changing modes.
    try {
      chrome.storage.local.get({ activeMode: 'chatgpt' }, values => {
        const mode = normalizeMode(values.activeMode || activeMode);
        activeMode = mode;
        showToast('Đang chạy ' + modeLabels[mode] + '…', 'info', 0);

        let watchdog = setTimeout(() => {
          showToast(
            'Extension chưa phản hồi sau 60 giây. Mở chrome://extensions và kiểm tra lỗi tại mục Service worker.',
            'error',
            12000
          );
        }, 60000);

        try {
          chrome.runtime.sendMessage({
            type: 'RUN_SELECTED_MODE',
            mode,
            text
          }, response => {
            clearTimeout(watchdog);

            if (chrome.runtime.lastError) {
              const detail = chrome.runtime.lastError.message || 'Không liên lạc được với extension background.';
              showToast('LỖI EXTENSION: ' + detail + ' — hãy Reload extension rồi tải lại trang web.', 'error', 12000);
              console.error('[Right Click AI]', detail);
              return;
            }

            if (!response) {
              showToast('Không nhận được phản hồi từ extension. Kiểm tra Service worker tại chrome://extensions.', 'error', 12000);
              return;
            }

            if (!response.ok) {
              const detail = response.error || 'Thao tác thất bại không rõ nguyên nhân.';
              showToast('LỖI ' + modeLabels[mode] + ': ' + detail, 'error', 12000);
              console.error('[Right Click AI]', detail);
              return;
            }

            if (mode === 'gemini') {
              showToast('ĐÃ GỬI ĐÁP ÁN QUA TELEGRAM' + (response.model ? ' · Model: ' + response.model : ''), 'success', 7000);
            } else if (mode === 'chatgpt') {
              showToast('Đã gửi văn bản sang ChatGPT Web.', 'success', 5000);
            } else {
              showToast('Đã gửi nội dung màn hình Android sang ChatGPT.', 'success', 5000);
            }
          });
        } catch (error) {
          clearTimeout(watchdog);
          showToast('LỖI EXTENSION: ' + String(error?.message || error) + ' — hãy Reload extension và tải lại trang web.', 'error', 12000);
        }
      });
    } catch (error) {
      showToast('Không đọc được chế độ đang chọn: ' + String(error?.message || error), 'error', 12000);
    }
  }

  document.addEventListener('contextmenu', runSavedModeOnRightClick, true);

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type !== 'GET_SELECTED_TEXT') return;
    reply({ text: selectedText() });
  });
})();
