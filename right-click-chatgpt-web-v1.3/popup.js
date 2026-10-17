(() => {
  const $ = id => document.getElementById(id);
  const MODE_STORAGE_KEY = 'activeMode';
  const MODES = {
    chatgpt: { label: 'ChatGPT Web', radioId: 'mode-chatgpt' },
    gemini: { label: 'Gemini → Telegram', radioId: 'mode-gemini' },
    android: { label: 'Đọc màn hình Android', radioId: 'mode-android' }
  };

  function setStatus(message, kind = '') {
    const element = $('status');
    element.textContent = message;
    element.className = 'status' + (kind ? ' ' + kind : '');
  }

  function renderMode(mode) {
    const safeMode = MODES[mode] ? mode : 'chatgpt';
    for (const [key, entry] of Object.entries(MODES)) {
      const radio = $(entry.radioId);
      radio.checked = key === safeMode;
      radio.closest('.item').classList.toggle('selected', key === safeMode);
    }
    $('currentMode').textContent = 'Chế độ đang dùng: ' + MODES[safeMode].label;
  }

  function saveMode(mode) {
    if (!MODES[mode]) return;
    chrome.storage.local.set({ [MODE_STORAGE_KEY]: mode }, () => {
      if (chrome.runtime.lastError) {
        setStatus('Không lưu được chế độ: ' + chrome.runtime.lastError.message, 'error');
        return;
      }
      renderMode(mode);
      setStatus('Đã lưu. Bôi đen văn bản rồi chuột phải để chạy ' + MODES[mode].label + '.', 'ok');
    });
  }

  chrome.storage.local.get({ activeMode: 'chatgpt' }, values => {
    const mode = MODES[values.activeMode] ? values.activeMode : 'chatgpt';
    renderMode(mode);
    setStatus('Đã tải chế độ đã lưu. Bôi đen văn bản rồi chuột phải để chạy.', 'ok');
  });

  for (const [mode, entry] of Object.entries(MODES)) {
    $(entry.radioId).addEventListener('change', event => {
      if (event.target.checked) saveMode(mode);
    });
  }

  function updateConfigSummary() {
    chrome.storage.local.get({
      geminiApiKey: '',
      telegramBotToken: '',
      telegramChatId: '',
      geminiModel: 'gemini-3.8-flash'
    }, settings => {
      const gemini = settings.geminiApiKey ? 'Gemini API: đã nhập' : 'Gemini API: chưa nhập key';
      const telegram = settings.telegramBotToken && settings.telegramChatId
        ? 'Telegram: đã cấu hình'
        : 'Telegram: chưa đủ Bot Token / Chat ID';
      $('config').textContent = gemini + ' · ' + telegram + ' · Model: ' + (settings.geminiModel || 'gemini-3.8-flash');
    });
  }

  $('settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage().catch(error => setStatus('Không mở được trang cài đặt: ' + String(error?.message || error), 'error'));
  });

  updateConfigSummary();
})();
