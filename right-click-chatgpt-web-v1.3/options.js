(() => {
  const DEFAULT_MODEL = 'gemini-3.8-flash';
  const SETTINGS_DEFAULTS = {
    geminiApiKey: '',
    geminiModel: DEFAULT_MODEL,
    geminiThinkingLevel: 'low',
    telegramBotToken: '',
    telegramChatId: ''
  };

  const $ = id => document.getElementById(id);
  const modelSelect = $('geminiModel');
  const modelStatus = $('modelStatus');
  const saveStatus = $('status');
  const MODEL_TEST_CONCURRENCY = 3;
  let availableModels = [];
  let batchResults = new Map();
  let batchTesting = false;

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

  function isTextResponseModel(model) {
    const id = String(model?.id || '').toLowerCase();
    // These IDs are specialized for image generation, audio, embeddings, live/audio
    // streams, robotics, or video; they're not suitable for this text-answer workflow.
    return !/(?:^|[-.])(?:image|tts|transcribe|audio|live|embedding|embed|computer-use|robotics|nano-banana|imagen|veo|lyria)(?:[-.]|$)/i.test(id);
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

  async function requestModelTest(model, apiKey, timeoutMs = 20000, thinkingLevel = 'low') {
    async function sendTest(maxOutputTokens) {
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), timeoutMs);
      try {
        const generationConfig = { maxOutputTokens };
        if (/^gemini-(?:3(?:\.\d+)?|4)(?:-|$)/i.test(model)) {
          const level = ['low', 'medium', 'high'].includes(String(thinkingLevel).toLowerCase())
            ? String(thinkingLevel).toLowerCase()
            : 'low';
          generationConfig.thinkingConfig = { thinkingLevel: level };
        }

        const response = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: 'Reply with the single word OK. Do not explain.' }] }],
              generationConfig
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
          const message = 'Gemini API HTTP ' + response.status + apiState + ': ' + detail +
            (apiErrorHint(response.status) ? ' ' + apiErrorHint(response.status) : '');
          const kind = response.status === 429 ? 'quota'
            : response.status >= 500 ? 'temporary'
            : 'error';
          return { ok: false, kind, message };
        }

        const candidate = data?.candidates?.[0];
        const reply = (candidate?.content?.parts || [])
          .map(part => String(part?.text || '')).join('').trim();
        if (!reply) {
          const reason = data?.promptFeedback?.blockReason || candidate?.finishReason || 'không có nội dung trả lời';
          return { ok: false, kind: reason === 'MAX_TOKENS' ? 'token-limit' : 'error',
            message: 'Model nhận request nhưng không trả về text: ' + reason, finishReason: reason };
        }
        return { ok: true, reply };
      } catch (error) {
        let message = error?.name === 'AbortError'
          ? 'Hết thời gian chờ (' + Math.round(timeoutMs / 1000) + ' giây).'
          : String(error?.message || error);
        if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
          message = 'Lỗi mạng/CORS khi kết nối Gemini API. ' + message;
        }
        const kind = /hết thời gian|network|cors|failed to fetch|load failed/i.test(message) ? 'temporary' : 'error';
        return { ok: false, kind, message };
      } finally {
        clearTimeout(timeout);
      }
    }

    // Eight tokens was too small for models with internal reasoning and caused
    // false negatives (MAX_TOKENS). Start with a larger output budget, then retry
    // once with more room if the model specifically reports MAX_TOKENS.
    let result = await sendTest(256);
    if (!result.ok && result.finishReason === 'MAX_TOKENS') {
      result = await sendTest(1024);
    }
    if (!result.ok && result.kind === 'token-limit') {
      result.kind = 'temporary';
      result.message += ' Đã thử lại với 1024 token nhưng vẫn không tạo được phản hồi thử.';
    }
    return result;
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

    try {
      const result = await requestModelTest(model, apiKey, 25000, $('geminiThinkingLevel').value);
      if (!result.ok) throw new Error('Model "' + model + '" — ' + result.message);

      const message = 'Model "' + model + '" chạy được với API key này. Phản hồi thử: ' + result.reply;
      setStatus(modelStatus, '✓ ' + message, false);
      await persistLastStatus({ ok: true, model, stage: 'Kiểm tra model', source: 'model-test', message });
    } catch (error) {
      const detail = String(error?.message || error);
      setStatus(modelStatus, '✕ ' + detail, true);
      await persistLastStatus({ ok: false, model, stage: 'Kiểm tra model', source: 'model-test', message: detail });
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
      refreshLastStatus();
    }
  }

  function renderBatchResults() {
    const workingList = $('workingModelsList');
    const failedList = $('failedModelsList');
    const deferredList = $('deferredModelsList');
    const entries = Array.from(batchResults.entries());
    const working = entries.filter(([, result]) => result.ok);
    const deferred = entries.filter(([, result]) => !result.ok && ['quota', 'temporary'].includes(result.kind));
    const failed = entries.filter(([, result]) => !result.ok && !['quota', 'temporary'].includes(result.kind));

    $('workingModelCount').textContent = String(working.length);
    $('failedModelCount').textContent = String(failed.length);
    $('deferredModelCount').textContent = String(deferred.length);
    workingList.replaceChildren();
    failedList.replaceChildren();
    deferredList.replaceChildren();

    function appendEmpty(list, message) {
      const empty = document.createElement('div');
      empty.className = 'empty-list';
      empty.textContent = message;
      list.appendChild(empty);
    }

    if (!working.length) {
      appendEmpty(workingList, batchTesting ? 'Đang kiểm tra… model chạy được sẽ hiện ở đây.' : 'Chưa có model nào chạy thành công.');
    }

    for (const [modelId, result] of working) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'model-row success';
      const title = document.createElement('strong');
      title.textContent = '✓ ' + modelId;
      const detail = document.createElement('small');
      detail.textContent = 'Trả về text thành công. Bấm để chọn model.';
      button.append(title, detail);
      button.addEventListener('click', () => {
        ensureModelOption(modelId);
        modelSelect.value = modelId;
        setStatus(modelStatus, 'Đã chọn ' + modelId + '. Bấm “Lưu cấu hình” để sử dụng.', false);
      });
      workingList.appendChild(button);
    }

    if (!failed.length) appendEmpty(failedList, batchTesting ? 'Lỗi cấu hình/model sẽ hiện ở đây.' : 'Chưa có lỗi xác định.');
    for (const [modelId, result] of failed) {
      const row = document.createElement('div');
      row.className = 'model-row failure';
      const title = document.createElement('strong');
      title.textContent = '✕ ' + modelId;
      const detail = document.createElement('small');
      detail.textContent = result.message || 'Lỗi chưa rõ.';
      row.append(title, detail);
      failedList.appendChild(row);
    }

    if (!deferred.length) appendEmpty(deferredList, batchTesting ? 'Quota/lỗi tạm thời sẽ hiện ở đây.' : 'Không có model nào đang chờ thử lại.');
    for (const [modelId, result] of deferred) {
      const row = document.createElement('div');
      row.className = 'model-row';
      const title = document.createElement('strong');
      title.textContent = (result.kind === 'quota' ? '◷ QUOTA ' : '⚠ TẠM THỜI ') + modelId;
      const detail = document.createElement('small');
      detail.textContent = result.message || 'Chưa xác định được khả năng chạy.';
      row.append(title, detail);
      deferredList.appendChild(row);
    }
  }
  async function testAllModels() {
    const apiKey = $('geminiApiKey').value.trim();
    if (!apiKey) {
      setStatus(modelStatus, 'Nhập Gemini API key trước khi kiểm tra.', true);
      $('geminiApiKey').focus();
      return;
    }
    if (!availableModels.length) {
      setStatus(modelStatus, 'Hãy bấm “Tải danh sách model từ API” trước.', true);
      return;
    }
    if (batchTesting) return;

    const button = $('testAllModels');
    const singleButton = $('testModel');
    const loadButton = $('loadModels');
    batchTesting = true;
    batchResults = new Map();
    button.disabled = true;
    singleButton.disabled = true;
    loadButton.disabled = true;
    const originalLabel = button.textContent;
    button.textContent = 'Đang kiểm tra toàn bộ…';
    renderBatchResults();

    let nextIndex = 0;
    const total = availableModels.length;
    setStatus(modelStatus, 'Bắt đầu kiểm tra ' + total + ' model, chạy song song tối đa ' + MODEL_TEST_CONCURRENCY + ' model…');

    function renderProgress() {
      const completed = batchResults.size;
      const successCount = Array.from(batchResults.values()).filter(item => item.ok).length;
      const failCount = completed - successCount;
      setStatus(modelStatus, 'Đã kiểm tra ' + completed + '/' + total +
        ' · Chạy được: ' + successCount + ' · Lỗi: ' + failCount +
        (completed < total ? ' · Đang xử lý…' : ''), false);
    }

    async function worker() {
      while (true) {
        const index = nextIndex++;
        if (index >= total) return;
        const model = availableModels[index];
        const result = await requestModelTest(model.id, apiKey, 15000);
        batchResults.set(model.id, { ...result, name: model.name || model.id });
        renderBatchResults();
        renderProgress();
      }
    }

    try {
      const workerCount = Math.min(MODEL_TEST_CONCURRENCY, total);
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
      const values = Array.from(batchResults.values());
      const workingCount = values.filter(item => item.ok).length;
      const deferredCount = values.filter(item => !item.ok && ['quota', 'temporary'].includes(item.kind)).length;
      const failedCount = total - workingCount - deferredCount;
      const summary = 'Đã kiểm tra xong ' + total + ' model văn bản. Chạy được: ' + workingCount +
        ', lỗi xác định: ' + failedCount + ', quota/lỗi tạm thời: ' + deferredCount + '.';
      setStatus(modelStatus, summary, workingCount === 0);
      await persistLastStatus({
        ok: workingCount > 0,
        model: 'Kiểm tra hàng loạt (' + total + ' model)',
        stage: 'Kiểm tra model',
        source: 'bulk-model-test',
        message: summary
      });
      refreshLastStatus();
    } finally {
      batchTesting = false;
      button.disabled = false;
      singleButton.disabled = false;
      loadButton.disabled = false;
      button.textContent = originalLabel;
      renderBatchResults();
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

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        let response;
        let data = {};
        try {
          response = await fetch(url.toString(), {
            method: 'GET',
            headers: { 'x-goog-api-key': apiKey },
            cache: 'no-store',
            signal: controller.signal
          });
          try {
            data = await response.json();
          } catch (_) {}

          if (!response.ok) {
            const details = data?.error?.message || 'HTTP ' + response.status;
            throw new Error(details);
          }
        } catch (error) {
          if (error?.name === 'AbortError') {
            throw new Error('Lấy danh sách model quá 15 giây. Kiểm tra kết nối rồi thử lại.');
          }
          throw error;
        } finally {
          clearTimeout(timeout);
        }

        for (const model of data.models || []) {
          const id = String(model.name || '').replace(/^models\//, '');
          const methods = Array.isArray(model.supportedGenerationMethods) ? model.supportedGenerationMethods : [];
          if (!id.toLowerCase().includes('gemini') || !methods.includes('generateContent')) continue;
          // This extension needs text answers, not image/audio/embedding/robotics output.
          if (!isTextResponseModel({ id })) continue;
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

      availableModels = unique;
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
    $('geminiThinkingLevel').value = ['low', 'medium', 'high'].includes(values.geminiThinkingLevel)
      ? values.geminiThinkingLevel
      : 'low';
    $('telegramBotToken').value = values.telegramBotToken || '';
    $('telegramChatId').value = values.telegramChatId || '';

    populateFallbackModels(values.geminiModel || DEFAULT_MODEL);
    // If the API key has already been configured, populate the current live list.
    if (values.geminiApiKey) fetchAvailableModels();
  });

  $('loadModels').addEventListener('click', fetchAvailableModels);
  $('testModel').addEventListener('click', testSelectedModel);
  $('testAllModels').addEventListener('click', testAllModels);
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
      geminiThinkingLevel: ['low', 'medium', 'high'].includes($('geminiThinkingLevel').value)
        ? $('geminiThinkingLevel').value
        : 'low',
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
