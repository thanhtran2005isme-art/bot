(() => {
  const DEFAULT_MODEL = 'gemini-3.8-flash';
  let lastRequestText = '';
  let lastRequestAt = 0;

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
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 300
            }
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
      const response = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: chunk })
      });
      const data = await readJsonResponse(response, 'Telegram API');
      if (!data?.ok) throw new Error('Telegram API: ' + (data?.description || 'gửi tin nhắn thất bại'));
    }
    return 'Telegram';
  }

  async function handleGeminiDelivery(question) {
    const text = String(question || '').trim();
    if (!text) throw new Error('Không có văn bản được bôi đen.');

    const now = Date.now();
    if (text === lastRequestText && now - lastRequestAt < 1800) {
      return { ok: true, duplicateIgnored: true };
    }
    lastRequestText = text;
    lastRequestAt = now;

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

      const answer = await askGemini(text, settings);
      stage = 'Telegram';
      await saveLastStatus({
        ok: null, model, stage, source: 'right-click',
        message: 'Gemini trả lời được; đang gửi đáp án tới Telegram…'
      });
      await setGeminiState('→', 'Model ' + model + ' đã trả lời. Đang gửi Telegram…', '#0f766e', 0);

      await sendTelegram(settings, makeMessage(answer));
      await saveLastStatus({
        ok: true, model, stage: 'Hoàn tất', source: 'right-click',
        message: 'Đã gửi đáp án qua Telegram.'
      });
      await setGeminiState('✓', 'Đã gửi đáp án qua Telegram · Model: ' + model, '#15803d', 3000);
      return { ok: true, targets: ['Telegram'], model };
    } catch (error) {
      const detail = String(error?.message || error);
      await saveLastStatus({
        ok: false, model, stage, source: 'right-click',
        message: detail
      });
      await setGeminiState('!', 'Model ' + model + ' · ' + detail, '#b91c1c', 0);
      throw error;
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
