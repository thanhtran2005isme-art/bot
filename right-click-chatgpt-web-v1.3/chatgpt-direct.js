(() => {
  if (globalThis.__RCGPT_DIRECT__) return;
  globalThis.__RCGPT_DIRECT__ = true;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function editor() {
    return document.querySelector('#prompt-textarea') ||
      document.querySelector('[data-testid="composer-input"]') ||
      document.querySelector('[contenteditable="true"][role="textbox"]') ||
      document.querySelector('textarea[placeholder]') ||
      document.querySelector('[contenteditable="true"]');
  }

  function valueOf(el) {
    if (!el) return '';
    return ('value' in el ? String(el.value || '') : String(el.innerText || el.textContent || '')).trim();
  }

  function fireInput(el, text) {
    try {
      el.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text
      }));
    } catch (_) {}

    try {
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: text
      }));
    } catch (_) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fill(el, text) {
    el.focus();

    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (!setter) throw new Error('Không có value setter.');
      setter.call(el, text);
      fireInput(el, text);
      return;
    }

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);

    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, text);
    } catch (_) {}

    if (!inserted || valueOf(el) !== text.trim()) {
      el.replaceChildren();
      const p = document.createElement('p');
      p.textContent = text;
      el.appendChild(p);
      fireInput(el, text);
    }
  }

  function isEnabled(button) {
    return !!button && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
  }

  function sendButton(el) {
    const form = el?.closest?.('form');
    const candidates = [
      document.querySelector('[data-testid="send-button"]'),
      document.querySelector('button[aria-label="Send prompt"]'),
      document.querySelector('button[aria-label="Send message"]'),
      document.querySelector('button[aria-label="Gửi lời nhắc"]'),
      document.querySelector('button[aria-label="Gửi tin nhắn"]'),
      document.querySelector('button[aria-label*="Send"]'),
      document.querySelector('button[aria-label*="Gửi"]'),
      form?.querySelector('button[type="submit"]')
    ];
    return candidates.find(isEnabled) || null;
  }

  function isGenerating() {
    return !!(
      document.querySelector('[data-testid="stop-button"]') ||
      document.querySelector('button[aria-label*="Stop"]') ||
      document.querySelector('button[aria-label*="Dừng"]')
    );
  }

  async function confirmedSent(el) {
    for (let i = 0; i < 20; i++) {
      if (isGenerating()) return true;
      const current = editor();
      if (!current || valueOf(current) === '') return true;
      await sleep(50);
    }
    return false;
  }

  function pressEnter(el) {
    const init = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false
    };
    el.dispatchEvent(new KeyboardEvent('keydown', init));
    el.dispatchEvent(new KeyboardEvent('keypress', init));
    el.dispatchEvent(new KeyboardEvent('keyup', init));
  }

  async function run(text, autoSend = true) {
    text = String(text || '').trim();
    if (!text) return { ok: false, error: 'Prompt rỗng.' };

    let el = null;
    for (let i = 0; i < 100; i++) {
      el = editor();
      if (el) break;
      await sleep(50);
    }
    if (!el) return { ok: false, error: 'Không tìm thấy ô nhập ChatGPT.' };

    fill(el, text);

    for (let i = 0; i < 20 && valueOf(el) !== text; i++) {
      await sleep(25);
    }
    if (valueOf(el) !== text) {
      return { ok: false, error: 'ChatGPT chưa nhận đủ nội dung.' };
    }

    if (!autoSend) return { ok: true, sent: false };

    for (let attempt = 0; attempt < 30; attempt++) {
      if (isGenerating()) return { ok: true, sent: true };

      const button = sendButton(el);
      if (button) {
        button.click();
        if (await confirmedSent(el)) return { ok: true, sent: true };
      }

      if (attempt === 4 || attempt === 12 || attempt === 22) {
        pressEnter(el);
        if (await confirmedSent(el)) return { ok: true, sent: true };
      }

      await sleep(attempt < 10 ? 50 : 100);
    }

    return { ok: false, error: 'Đã dán text nhưng chưa bấm gửi được trên ChatGPT.' };
  }

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type !== 'FILL_AND_SEND_CHATGPT') return;
    run(message.text, message.autoSend !== false)
      .then(reply)
      .catch(error => reply({ ok: false, error: String(error?.message || error) }));
    return true;
  });
})();
