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
