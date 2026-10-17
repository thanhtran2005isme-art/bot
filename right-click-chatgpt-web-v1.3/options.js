(() => {
  const ids = [
    'geminiApiKey',
    'geminiModel',
    'telegramBotToken',
    'telegramChatId'
  ];

  const defaults = {
    geminiApiKey: '',
    geminiModel: 'gemini-3.8-flash',
    telegramBotToken: '',
    telegramChatId: ''
  };

  function setStatus(message, isError) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.style.color = isError ? '#dc2626' : '#16a34a';
  }

  chrome.storage.local.get(defaults, values => {
    for (const id of ids) {
      const element = document.getElementById(id);
      if (element && typeof values[id] !== 'undefined') element.value = values[id];
    }
  });

  document.getElementById('save').addEventListener('click', () => {
    const values = {};
    for (const id of ids) {
      values[id] = document.getElementById(id).value.trim();
    }

    if (!values.geminiModel) values.geminiModel = defaults.geminiModel;

    chrome.storage.local.set(values, () => {
      if (chrome.runtime.lastError) {
        setStatus('Không lưu được: ' + chrome.runtime.lastError.message, true);
        return;
      }
      setStatus('Đã lưu cấu hình trên trình duyệt này.', false);
    });
  });
})();
