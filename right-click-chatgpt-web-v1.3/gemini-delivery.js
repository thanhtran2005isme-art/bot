(() => {
  const DEFAULT_MODEL = 'gemini-3.8-flash';
  const inFlightRequests = new Map();
  let lastSuccessfulText = '';
  let lastSuccessfulAt = 0;
  let lastSuccessfulResult = null;

  async function setGeminiState(badge, title, color, clearAfter) {
    try {
      await chrome.action.setBadgeText({ text: badge });
      await chrome.action.setTitle({ title });
      if (color) await chrome.action.setBadgeBackgroundColor({ color });
    } catch (_) {}

    if (clearAfter > 0) {
      setTimeout(() => {
        chrome.action.setBadgeText({ text: '' }).catch(() => {});
        chrome.action.setTitle({ title: 'Trợ lý AI: ChatGPT, Gemini → Telegram, Android OCR' }).catch(() => {});
      }, clearAfter);
    }
  }

  function getSettings() {
    return new Promise(resolve => {
      chrome.storage.local.get({
        geminiApiKey: '',
        geminiModel: DEFAULT_MODEL,
        telegramBotToken: '',
        telegramChatId: ''
      }, resolve);
    });
  }

  function errorHint(status) {
    switch (Number(status)) {
      case 400: return ' Kiểm tra yêu cầu/tham số gửi tới model.';
      case 401: return ' API key không hợp lệ hoặc đã hết hiệu lực.';
      case 402: return ' Tài khoản API có thể đã hết tín dụng thanh toán.';
      case 403: return ' API key hoặc project không có quyền dùng model này.';
      case 404: return ' Không tìm thấy model hoặc model không khả dụng qua endpoint này.';
      case 429: return ' Đã chạm giới hạn quota/tốc độ; hãy kiểm tra quota hoặc thử lại sau.';
      case 500:
      case 502:
      case 503: return ' Dịch vụ có thể đang lỗi tạm thời; hãy thử lại sau.';
      default: return '';
    }
  }

  function saveLastStatus(status) {
    return new Promise(resolve => {
      try {
        chrome.storage.local.set({
          geminiLastStatus: { ...status, time: Date.now() }
        }, () => resolve());
      } catch (_) {
        resolve();
      }
    });
  }

  async function readJsonResponse(response, serviceName, model = '') {
    let data = {};
    try {
      data = await response.json();
    } catch (_) {}

    if (!response.ok) {
      const detail = data?.error?.message || data?.message || data?.description || ('HTTP ' + response.status);
      const code = data?.error?.status ? ' (' + data.error.status + ')' : '';
      const context = model ? 'Model "' + model + '" — ' : '';
      const hint = serviceName === 'Gemini API' ? errorHint(response.status) : '';
      throw new Error(context + serviceName + ' HTTP ' + response.status + code + ': ' + detail + hint);
    }
    return data;
  }

  async function askGemini(question, settings) {
    const apiKey = String(settings.geminiApiKey || '').trim();
    if (!apiKey) throw new Error('Chưa cấu hình Gemini API key trong Options của extension.');

    const model = String(settings.geminiModel || DEFAULT_MODEL).trim();
    if (!/^[A-Za-z0-9._-]+$/.test(model)) throw new Error('Tên Gemini model không hợp lệ.');

    const isGemini3OrLater = /^gemini-(?:3(?:\.\d+)?|4)(?:-|$)/i.test(model);
    const generationConfig = { maxOutputTokens: 512 };
    if (isGemini3OrLater) {
      // Lower thinking effort reduces latency for short, answer-only requests.
      // Gemini 3/4 recommends thinkingLevel and does not support legacy sampling parameters.
      generationConfig.thinkingConfig = { thinkingLevel: 'low' };
    } else {
      // Retain deterministic sampling for older model families that support it.
      generationConfig.temperature = 0.2;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{
                text: 'Bạn là trợ lý chọn và trả lời đáp án bằng tiếng Việt. Chỉ xuất đáp án cuối cùng; tuyệt đối không nhắc lại câu hỏi, không mở đầu bằng lời dẫn, không giải thích, không trình bày các bước suy luận. Với câu hỏi trắc nghiệm, chỉ ghi chữ cái và đầy đủ nội dung của phương án đúng theo mẫu chữ cái, dấu chấm, nội dung phương án. Với câu hỏi không phải trắc nghiệm, chỉ ghi câu trả lời trực tiếp ngắn gọn. Nếu không đủ dữ kiện để xác định đáp án, chỉ ghi Không đủ dữ kiện.'
              }]
            },
            contents: [{
              role: 'user',
              parts: [{ text: String(question || '').trim() }]
            }],
            generationConfig
          }),
          signal: controller.signal
        }
      );

      const data = await readJsonResponse(response, 'Gemini API', model);
      const candidate = data?.candidates?.[0];
      const answer = (candidate?.content?.parts || [])
        .map(part => String(part?.text || ''))
        .filter(Boolean)
        .join('\n')
        .trim();

      if (!answer) {
        const reason = data?.promptFeedback?.blockReason || candidate?.finishReason || 'không có nội dung trả lời';
        throw new Error('Gemini không trả về câu trả lời: ' + reason);
      }
      return answer;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('Gemini API phản hồi quá lâu (45 giây).');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function makeMessage(answer) {
    let text = String(answer || '').trim();

    // Defensively remove common explanation sections in case a model ignores the
    // strict answer-only instruction.
    text = text.replace(/\n\s*(?:\*{0,2}\s*)?(?:giải thích|lý do|giải thích thêm|explanation|reasoning)\s*:?\s*(?:\*{0,2})[\s\S]*$/i, '');
    // Remove common lead-ins so a multiple-choice reply is just "A. option text".
    text = text.replace(/^\s*(?:(?:đáp án đúng|đáp án|trả lời)\s*(?:là)?\s*:?\s*)/i, '');
    // Remove a single outer pair of Markdown bold markers and surrounding whitespace.
    text = text.trim().replace(/^\*\*(.*?)\*\*$/s, '$1').trim();
    return text;
  }

  function splitMessage(text, maxLength) {
    const chunks = [];
    let rest = String(text || '');
    while (rest.length > maxLength) {
      let splitAt = rest.lastIndexOf('\n', maxLength);
      if (splitAt < Math.floor(maxLength * 0.55)) splitAt = maxLength;
      chunks.push(rest.slice(0, splitAt));
      rest = rest.slice(splitAt).replace(/^\n+/, '');
    }
    if (rest) chunks.push(rest);
    return chunks;
  }

  async function sendTelegram(settings, text) {
    const token = String(settings.telegramBotToken || '').trim();
    const chatId = String(settings.telegramChatId || '').trim();
    if (!token || !chatId) {
      throw new Error('Telegram cần cả Bot Token và Chat ID trong Options.');
    }

    const chunks = splitMessage(text, 3800);
    for (const chunk of chunks) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: chunk }),
          signal: controller.signal
        });
        const data = await readJsonResponse(response, 'Telegram API');
        if (!data?.ok) throw new Error('Telegram API: ' + (data?.description || 'gửi tin nhắn thất bại'));
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw new Error('Telegram API phản hồi quá lâu (15 giây). Kiểm tra Telegram trước khi gửi lại vì yêu cầu có thể đã được nhận.');
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
    return 'Telegram';
  }

  function formatDuration(ms) {
    return (Math.max(0, Number(ms) || 0) / 1000).toFixed(1) + ' giây';
  }

  async function performGeminiDelivery(text) {
    const startedAt = Date.now();
    let settings = null;
    let model = DEFAULT_MODEL;
    let stage = 'Gemini API';
    try {
      settings = await getSettings();
      model = String(settings.geminiModel || DEFAULT_MODEL).trim();
      await saveLastStatus({
        ok: null, model, stage, source: 'right-click',
        message: 'Đang gửi câu hỏi tới model ' + model + '…'
      });
      await setGeminiState('AI', 'Đang gọi Gemini model ' + model + '…', '#4f46e5', 0);

      const geminiStartedAt = Date.now();
      const answer = await askGemini(text, settings);
      const geminiMs = Date.now() - geminiStartedAt;
      stage = 'Telegram';
      await saveLastStatus({
        ok: null, model, stage, source: 'right-click',
        message: 'Gemini trả lời sau ' + formatDuration(geminiMs) + '; đang gửi đáp án tới Telegram…',
        timings: { geminiMs }
      });
      await setGeminiState('→', 'Model ' + model + ' trả lời sau ' + formatDuration(geminiMs) + '. Đang gửi Telegram…', '#0f766e', 0);

      const telegramStartedAt = Date.now();
      await sendTelegram(settings, makeMessage(answer));
      const telegramMs = Date.now() - telegramStartedAt;
      const totalMs = Date.now() - startedAt;
      const timings = { geminiMs, telegramMs, totalMs };
      const timingMessage = 'Đã gửi đáp án qua Telegram · Gemini ' + formatDuration(geminiMs) +
        ', Telegram ' + formatDuration(telegramMs) + ', tổng ' + formatDuration(totalMs) + '.';
      await saveLastStatus({
        ok: true, model, stage: 'Hoàn tất', source: 'right-click',
        message: timingMessage, durationMs: totalMs, timings
      });
      await setGeminiState('✓', 'Đã gửi đáp án qua Telegram · ' + formatDuration(totalMs) + ' · Model: ' + model, '#15803d', 3000);
      return { ok: true, targets: ['Telegram'], model, durationMs: totalMs, timings };
    } catch (error) {
      const detail = String(error?.message || error);
      await saveLastStatus({
        ok: false, model, stage, source: 'right-click',
        message: detail, durationMs: Date.now() - startedAt
      });
      await setGeminiState('!', 'Model ' + model + ' · ' + detail, '#b91c1c', 0);
      throw error;
    }
  }

  async function handleGeminiDelivery(question) {
    const text = String(question || '').trim();
    if (!text) throw new Error('Không có văn bản được bôi đen.');

    // Share the same promise for rapid duplicate clicks, so an in-flight failure
    // is reported as a failure rather than being falsely shown as delivered.
    const existing = inFlightRequests.get(text);
    if (existing) return existing;

    const now = Date.now();
    if (text === lastSuccessfulText && now - lastSuccessfulAt < 1800 && lastSuccessfulResult) {
      return { ...lastSuccessfulResult, duplicateIgnored: true };
    }

    const pending = performGeminiDelivery(text);
    inFlightRequests.set(text, pending);
    try {
      const result = await pending;
      lastSuccessfulText = text;
      lastSuccessfulAt = Date.now();
      lastSuccessfulResult = result;
      return result;
    } finally {
      if (inFlightRequests.get(text) === pending) inFlightRequests.delete(text);
    }
  }

  globalThis.RCGPTGemini = Object.freeze({ handleGeminiDelivery });

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type !== 'ASK_GEMINI_AND_DELIVER') return;

    handleGeminiDelivery(message.text)
      .then(reply)
      .catch(async error => {
        const detail = String(error?.message || error);
        console.error('[Gemini → Telegram]', detail);
        await setGeminiState('!', detail, '#b91c1c', 6000);
        reply({ ok: false, error: detail });
      });
    return true;
  });
})();
