(() => {
  const DEFAULT_MODEL = 'gemini-3.8-flash';
  const SETTINGS_DEFAULTS = {
    geminiApiKey: '',
    geminiModel: DEFAULT_MODEL,
    telegramBotToken: '',
    telegramChatId: ''
  };

  const $ = id => document.getElementById(id);
  const modelSelect = $('geminiModel');
  const modelStatus = $('modelStatus');
  const saveStatus = $('status');

  const fallbackModels = [
    { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
    { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash' },
    { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash' },
    { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash' },
    { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview' },
    { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview' }
  ];

  function setStatus(element, message, isError = false) {
    element.textContent = message;
    element.style.color = isError ? '#dc2626' : '#16a34a';
  }

  function apiErrorHint(status) {
    switch (Number(status)) {
      case 400: return 'Kiểm tra yêu cầu/tham số của model.';
      case 401: return 'API key không hợp lệ hoặc đã hết hiệu lực.';
      case 402: return 'Tài khoản API có thể đã hết tín dụng thanh toán.';
      case 403: return 'API key/project không có quyền dùng model này.';
      case 404: return 'Không tìm thấy model hoặc model không khả dụng qua endpoint này.';
      case 429: return 'Có thể đã chạm quota/giới hạn tốc độ; thử lại sau hoặc kiểm tra hạn mức.';
      case 500:
      case 502:
      case 503: return 'Dịch vụ có thể đang lỗi tạm thời; thử lại sau.';
      default: return '';
    }
  }

  function persistLastStatus(status) {
    return new Promise(resolve => {
      chrome.storage.local.set({ geminiLastStatus: { ...status, time: Date.now() } }, resolve);
    });
  }

  function renderLastStatus(status) {
    const el = $('lastRunStatus');
    if (!status) {
      el.textContent = 'Chưa có lần chạy hoặc kiểm tra model nào.';
      el.style.color = 'GrayText';
      return;
    }
    const when = status.time ? new Date(status.time).toLocaleString() : '';
    const state = status.ok === true ? 'THÀNH CÔNG' : status.ok === false ? 'LỖI' : 'ĐANG CHẠY';
    el.textContent = '[' + state + '] Model: ' + (status.model || 'chưa rõ') +
      (status.stage ? ' · Bước: ' + status.stage : '') +
      ' · ' + (status.message || '') + (when ? ' · ' + when : '');
    el.style.color = status.ok === false ? '#dc2626' : status.ok === true ? '#16a34a' : 'GrayText';
  }

  function refreshLastStatus() {
    chrome.storage.local.get({ geminiLastStatus: null }, values => renderLastStatus(values.geminiLastStatus));
  }

  async function testSelectedModel() {
    const apiKey = $('geminiApiKey').value.trim();
    const model = String(modelSelect.value || '').trim();
    if (!apiKey) {
      setStatus(modelStatus, 'Nhập Gemini API key trước khi kiểm tra model.', true);
      $('geminiApiKey').focus();
      return;
    }
    if (!model) {
      setStatus(modelStatus, 'Hãy chọn một model trước.', true);
      return;
    }

    const button = $('testModel');
    button.disabled = true;
    const originalLabel = button.textContent;
    button.textContent = 'Đang kiểm tra…';
    setStatus(modelStatus, 'Đang gọi thử model ' + model + ' bằng một yêu cầu ngắn…');

    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 25000);
    try {
      const response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Reply with only OK.' }] }],
            generationConfig: { temperature: 0, maxOutputTokens: 8 }
          }),
          signal: abort.signal,
          cache: 'no-store'
        }
      );

      let data = {};
      try { data = await response.json(); } catch (_) {}
      if (!response.ok) {
        const detail = data?.error?.message || data?.message || ('HTTP ' + response.status);
        const apiState = data?.error?.status ? ' (' + data.error.status + ')' : '';
        throw new Error('Model "' + model + '" — Gemini API HTTP ' + response.status + apiState +
          ': ' + detail + (apiErrorHint(response.status) ? ' ' + apiErrorHint(response.status) : ''));
      }

      const reply = (data?.candidates?.[0]?.content?.parts || [])
        .map(part => String(part?.text || '')).join('').trim();
      if (!reply) {
        const reason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason || 'không có nội dung trả lời';
        throw new Error('Model "' + model + '" đã nhận request nhưng không trả lời: ' + reason);
      }

      const message = 'Model "' + model + '" chạy được với API key này. Phản hồi thử: ' + reply;
      setStatus(modelStatus, '✓ ' + message, false);
      await persistLastStatus({ ok: true, model, stage: 'Kiểm tra model', source: 'model-test', message });
    } catch (error) {
      const detail = error?.name === 'AbortError'
        ? 'Kiểm tra model "' + model + '" hết thời gian chờ (25 giây).'
        : String(error?.message || error);
      setStatus(modelStatus, '✕ ' + detail, true);
      await persistLastStatus({ ok: false, model, stage: 'Kiểm tra model', source: 'model-test', message: detail });
    } finally {
      clearTimeout(timeout);
      button.disabled = false;
      button.textContent = originalLabel;
      refreshLastStatus();
    }
  }

  function addModelOption(model, selectedModel) {
    const id = String(model.id || '').replace(/^models\//, '');
    if (!id) return;

    let option = Array.from(modelSelect.options).find(item => item.value === id);
    if (!option) {
      option = document.createElement('option');
      option.value = id;
      modelSelect.appendChild(option);
    }
    option.textContent = model.name && model.name !== id ? model.name + ' (' + id + ')' : id;
    option.selected = id === selectedModel;
  }

  function ensureModelOption(modelId) {
    const id = String(modelId || DEFAULT_MODEL).replace(/^models\//, '');
    if (!Array.from(modelSelect.options).some(option => option.value === id)) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = id + ' (đang lưu)';
      modelSelect.appendChild(option);
    }
    modelSelect.value = id;
  }

  function populateFallbackModels(selectedModel) {
    for (const model of fallbackModels) addModelOption(model, selectedModel);
    ensureModelOption(selectedModel || DEFAULT_MODEL);
  }

  async function fetchAvailableModels() {
    const apiKey = $('geminiApiKey').value.trim();
    if (!apiKey) {
      setStatus(modelStatus, 'Nhập Gemini API key trước khi tải danh sách model.', true);
      $('geminiApiKey').focus();
      return;
    }

    const button = $('loadModels');
    button.disabled = true;
    const originalLabel = button.textContent;
    button.textContent = 'Đang tải model…';
    setStatus(modelStatus, 'Đang lấy danh sách model được API key này truy cập…');

    try {
      const models = [];
      let pageToken = '';

      // Follow the API's page token so large model lists are not silently truncated.
      for (let page = 0; page < 10; page++) {
        const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
        url.searchParams.set('pageSize', '1000');
        if (pageToken) url.searchParams.set('pageToken', pageToken);

        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: { 'x-goog-api-key': apiKey },
          cache: 'no-store'
        });

        let data = {};
        try {
          data = await response.json();
        } catch (_) {}

        if (!response.ok) {
          const details = data?.error?.message || 'HTTP ' + response.status;
          throw new Error(details);
        }

        for (const model of data.models || []) {
          const id = String(model.name || '').replace(/^models\//, '');
          const methods = Array.isArray(model.supportedGenerationMethods) ? model.supportedGenerationMethods : [];
          if (!id.toLowerCase().includes('gemini') || !methods.includes('generateContent')) continue;
          models.push({
            id,
            name: String(model.displayName || id),
            description: String(model.description || '')
          });
        }

        pageToken = String(data.nextPageToken || '');
        if (!pageToken) break;
      }

      const unique = Array.from(new Map(models.map(model => [model.id, model])).values())
        .sort((a, b) => {
          const aPreview = /preview|experimental/i.test(a.id) ? 1 : 0;
          const bPreview = /preview|experimental/i.test(b.id) ? 1 : 0;
          if (aPreview !== bPreview) return aPreview - bPreview;
          return a.id.localeCompare(b.id);
        });

      if (!unique.length) {
        throw new Error('API key không trả về model Gemini nào hỗ trợ generateContent.');
      }

      const selectedModel = modelSelect.value || DEFAULT_MODEL;
      modelSelect.replaceChildren();
      for (const model of unique) addModelOption(model, selectedModel);
      ensureModelOption(selectedModel);
      setStatus(modelStatus, 'Đã tải ' + unique.length + ' model Gemini hỗ trợ generateContent. Chọn model rồi bấm Lưu cấu hình.');
    } catch (error) {
      setStatus(modelStatus, 'Không tải được danh sách model: ' + String(error?.message || error), true);
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }

  chrome.storage.local.get(SETTINGS_DEFAULTS, values => {
    $('geminiApiKey').value = values.geminiApiKey || '';
    $('telegramBotToken').value = values.telegramBotToken || '';
    $('telegramChatId').value = values.telegramChatId || '';

    populateFallbackModels(values.geminiModel || DEFAULT_MODEL);
    // If the API key has already been configured, populate the current live list.
    if (values.geminiApiKey) fetchAvailableModels();
  });

  $('loadModels').addEventListener('click', fetchAvailableModels);
  $('testModel').addEventListener('click', testSelectedModel);
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.geminiLastStatus) {
      renderLastStatus(changes.geminiLastStatus.newValue);
    }
  });
  refreshLastStatus();

  $('save').addEventListener('click', () => {
    const values = {
      geminiApiKey: $('geminiApiKey').value.trim(),
      geminiModel: modelSelect.value || DEFAULT_MODEL,
      telegramBotToken: $('telegramBotToken').value.trim(),
      telegramChatId: $('telegramChatId').value.trim()
    };

    chrome.storage.local.set(values, () => {
      if (chrome.runtime.lastError) {
        setStatus(saveStatus, 'Không lưu được: ' + chrome.runtime.lastError.message, true);
        return;
      }
      setStatus(saveStatus, 'Đã lưu cấu hình. Model đang chọn: ' + values.geminiModel, false);
    });
  });
})();
