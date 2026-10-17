(() => {
  const $ = id => document.getElementById(id);
  const buttons = [$('chatgpt'), $('gemini'), $('android')];
  let busy = false;

  function setStatus(message, kind = '') {
    const element = $('status');
    element.textContent = message;
    element.className = 'status' + (kind ? ' ' + kind : '');
  }

  function setBusy(value) {
    busy = value;
    for (const button of buttons) button.disabled = value;
  }

  function activeTab() {
    return chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(tabs => tabs[0] || null);
  }

  async function selectedTextFromPage(tab) {
    if (!tab?.id) return '';

    // Reading all accessible frames handles selections inside embedded web apps
    // better than messaging only the top frame. The cached content-script
    // selection remains as a fallback if the page clears selection on popup open.
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () => {
          try {
            const selected = String(window.getSelection?.()?.toString?.() || '').trim();
            if (selected) return selected;
          } catch (_) {}

          const element = document.activeElement;
          if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
            const start = element.selectionStart ?? 0;
            const end = element.selectionEnd ?? 0;
            if (end > start) return String(element.value || '').slice(start, end).trim();
          }
          return '';
        }
      });
      const selected = (results || [])
        .map(item => String(item.result || '').trim())
        .find(Boolean);
      if (selected) return selected;
    } catch (_) {}

    try {
      const reply = await chrome.tabs.sendMessage(tab.id, { type: 'GET_SELECTED_TEXT' });
      return String(reply?.text || '').trim();
    } catch (_) {
      return '';
    }
  }

  async function runSelectionAction(type, label) {
    if (busy) return;
    setBusy(true);
    setStatus('Đang lấy văn bản đã bôi đen…');

    try {
      const tab = await activeTab();
      const text = await selectedTextFromPage(tab);
      if (!text) {
        throw new Error('Chưa lấy được văn bản. Hãy bôi đen câu hỏi trên trang web rồi mở extension và chọn lại.');
      }

      setStatus(label + ' đang xử lý…');
      const result = await chrome.runtime.sendMessage({ type, text });
      if (!result?.ok && !result?.duplicateIgnored) {
        throw new Error(result?.error || 'Thao tác thất bại.');
      }
      if (type === 'ASK_CHATGPT_WEB') {
        setStatus('Đã gửi nội dung sang ChatGPT Web.', 'ok');
      } else {
        setStatus('Gemini đã trả lời và gửi kết quả sang Telegram.', 'ok');
      }
    } catch (error) {
      setStatus(String(error?.message || error), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function runAndroidAction() {
    if (busy) return;
    setBusy(true);
    setStatus('Đang đọc màn hình Android qua bridge…');

    try {
      const result = await chrome.runtime.sendMessage({ type: 'READ_ANDROID_SCREEN' });
      if (!result?.ok) throw new Error(result?.error || 'Không đọc/gửi được màn hình Android.');
      setStatus('Đã đọc màn hình và gửi nội dung sang ChatGPT.', 'ok');
    } catch (error) {
      setStatus(String(error?.message || error) + ' Hãy kiểm tra start-bridge.bat.', 'error');
    } finally {
      setBusy(false);
    }
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

  $('chatgpt').addEventListener('click', () => runSelectionAction('ASK_CHATGPT_WEB', 'ChatGPT Web'));
  $('gemini').addEventListener('click', () => runSelectionAction('ASK_GEMINI_AND_DELIVER', 'Gemini'));
  $('android').addEventListener('click', runAndroidAction);
  $('settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage().catch(error => setStatus('Không mở được trang cài đặt: ' + String(error?.message || error), 'error'));
  });

  updateConfigSummary();
})();
