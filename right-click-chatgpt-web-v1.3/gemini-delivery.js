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
        chrome.action.setTitle({ title: 'Đọc màn hình điện thoại → ChatGPT' }).catch(() => {});
      }, clearAfter);
    }
  }

  function getSettings() {
    return new Promise(resolve => {
      chrome.storage.local.get({
        geminiApiKey: '',
        geminiModel: DEFAULT_MODEL,
        deliveryTarget: 'telegram',
        telegramBotToken: '',
        telegramChatId: '',
        zaloAccessToken: '',
        zaloUserId: ''
      }, resolve);
    });
  }

  async function readJsonResponse(response, serviceName) {
    let data = {};
    try {
      data = await response.json();
    } catch (_) {}

    if (!response.ok) {
      const detail = data?.error?.message || data?.message || data?.description || ('HTTP ' + response.status);
      throw new Error(serviceName + ': ' + detail);
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
                text: 'Bạn là trợ lý trả lời câu hỏi bằng tiếng Việt. Trả lời trực tiếp, chính xác và ngắn gọn. Nếu là câu hỏi trắc nghiệm, nêu rõ đáp án (A/B/C/D nếu có) rồi giải thích ngắn. Nếu đề bài thiếu dữ kiện hoặc không chắc chắn, nói rõ thay vì đoán.'
              }]
            },
            contents: [{
              role: 'user',
              parts: [{ text: String(question || '').trim() }]
            }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 1800
            }
          }),
          signal: controller.signal
        }
      );

      const data = await readJsonResponse(response, 'Gemini API');
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

  function makeMessage(question, answer) {
    return 'CÂU HỎI\n' + String(question || '').trim() +
      '\n\nTRẢ LỜI GEMINI\n' + String(answer || '').trim();
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

  async function sendZalo(settings, text) {
    const token = String(settings.zaloAccessToken || '').trim();
    const userId = String(settings.zaloUserId || '').trim();
    if (!token || !userId) {
      throw new Error('Zalo OA cần Access Token và User ID của người nhận trong Options.');
    }

    // Keep each text message below commonly encountered OA text limits.
    const chunks = splitMessage(text, 1800);
    for (const chunk of chunks) {
      const response = await fetch('https://openapi.zalo.me/v2.0/oa/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'access_token': token
        },
        body: JSON.stringify({
          recipient: { user_id: userId },
          message: { text: chunk }
        })
      });
      const data = await readJsonResponse(response, 'Zalo OA API');
      if (typeof data?.error !== 'undefined' && Number(data.error) !== 0) {
        throw new Error('Zalo OA API: ' + (data?.message || data?.error_name || data.error));
      }
    }
    return 'Zalo OA';
  }

  async function deliverAnswer(settings, text) {
    const target = settings.deliveryTarget || 'telegram';
    if (target === 'telegram') return [await sendTelegram(settings, text)];
    if (target === 'zalo') return [await sendZalo(settings, text)];
    if (target === 'both') {
      const results = await Promise.allSettled([
        sendTelegram(settings, text),
        sendZalo(settings, text)
      ]);
      const sent = results.filter(result => result.status === 'fulfilled').map(result => result.value);
      const failed = results.filter(result => result.status === 'rejected').map(result => String(result.reason?.message || result.reason));
      if (failed.length && !sent.length) throw new Error(failed.join(' | '));
      if (failed.length) {
        throw new Error('Đã gửi tới ' + sent.join(', ') + ' nhưng kênh còn lại lỗi: ' + failed.join(' | '));
      }
      return sent;
    }
    throw new Error('Kênh gửi không hợp lệ. Hãy chọn Telegram, Zalo OA hoặc cả hai trong Options.');
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

    await setGeminiState('AI', 'Đang gửi câu hỏi sang Gemini…', '#4f46e5', 0);
    const settings = await getSettings();
    const answer = await askGemini(text, settings);
    await setGeminiState('→', 'Gemini đã trả lời. Đang gửi qua ' + (settings.deliveryTarget || 'telegram') + '…', '#0f766e', 0);
    const targets = await deliverAnswer(settings, makeMessage(text, answer));
    await setGeminiState('✓', 'Đã gửi câu trả lời Gemini qua ' + targets.join(' + '), '#15803d', 3000);
    return { ok: true, targets: targets };
  }

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type !== 'ASK_GEMINI_AND_DELIVER') return;

    handleGeminiDelivery(message.text)
      .then(reply)
      .catch(async error => {
        const detail = String(error?.message || error);
        console.error('[Gemini → Telegram/Zalo]', detail);
        await setGeminiState('!', detail, '#b91c1c', 6000);
        reply({ ok: false, error: detail });
      });
    return true;
  });
})();
