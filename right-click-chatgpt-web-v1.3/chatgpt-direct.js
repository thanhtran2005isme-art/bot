(() => {
  if (globalThis.__RCGPT_DIRECT__) return;
  globalThis.__RCGPT_DIRECT__ = true;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const normalize = text => String(text || '').replace(/\s+/g, ' ').trim();

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

  function sameText(a, b) {
    return normalize(a) === normalize(b);
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

    if (!inserted || !sameText(valueOf(el), text)) {
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
      form?.querySelector('[data-testid="send-button"]'),
      document.querySelector('[data-testid="send-button"]'),
      form?.querySelector('button[aria-label="Send prompt"]'),
      form?.querySelector('button[aria-label="Send message"]'),
      form?.querySelector('button[aria-label="Gửi lời nhắc"]'),
      form?.querySelector('button[aria-label="Gửi tin nhắn"]'),
      document.querySelector('button[aria-label="Send prompt"]'),
      document.querySelector('button[aria-label="Send message"]'),
      document.querySelector('button[aria-label="Gửi lời nhắc"]'),
      document.querySelector('button[aria-label="Gửi tin nhắn"]'),
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

  function isSentState(wasGenerating) {
    const current = editor();
    if (!current || normalize(valueOf(current)) === '') return true;
    return !wasGenerating && isGenerating();
  }

  async function waitForSent(wasGenerating, timeoutMs) {
    const deadline = performance.now() + timeoutMs;

    do {
      if (isSentState(wasGenerating)) return true;
      await sleep(10);
    } while (performance.now() < deadline);

    return isSentState(wasGenerating);
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

  async function waitForEditor(timeoutMs = 3500) {
    const immediate = editor();
    if (immediate) return immediate;

    return new Promise(resolve => {
      let done = false;

      const finish = value => {
        if (done) return;
        done = true;
        observer.disconnect();
        clearTimeout(timer);
        resolve(value);
      };

      const observer = new MutationObserver(() => {
        const found = editor();
        if (found) finish(found);
      });

      observer.observe(document.documentElement || document, {
        childList: true,
        subtree: true
      });

      const timer = setTimeout(() => finish(editor()), timeoutMs);
    });
  }

  async function ensureFilled(el, text) {
    if (sameText(valueOf(el), text)) return true;

    // React normally reflects the input synchronously. These tiny retries cover
    // the rare render where it lands one task later without adding visible lag.
    for (const delay of [0, 10, 20, 35]) {
      if (delay) await sleep(delay);
      else await Promise.resolve();

      if (sameText(valueOf(el), text)) return true;
    }

    return false;
  }

  async function fastSubmit(el) {
    const wasGenerating = isGenerating();

    // Give ChatGPT one task to enable its send control after the input event.
    await Promise.resolve();

    let button = sendButton(el);
    if (button) {
      button.click();
      if (await waitForSent(wasGenerating, 140)) return true;
    }

    // Keyboard submission is the fastest independent fallback.
    pressEnter(el);
    if (await waitForSent(wasGenerating, 180)) return true;

    // React may enable the button just after the first attempts.
    button = sendButton(el);
    if (button) {
      button.click();
      if (await waitForSent(wasGenerating, 220)) return true;
    }

    return false;
  }

  async function fallbackSubmit(el) {
    const wasGenerating = isGenerating();

    for (let attempt = 0; attempt < 24; attempt++) {
      if (isSentState(wasGenerating)) return true;

      const button = sendButton(el);
      if (button) {
        button.click();
      } else if (attempt % 4 === 0) {
        pressEnter(el);
      }

      await sleep(attempt < 10 ? 20 : 45);
    }

    return isSentState(wasGenerating);
  }

  async function run(text, autoSend = true) {
    text = String(text || '').trim();
    if (!text) return { ok: false, error: 'Prompt rỗng.' };

    const el = await waitForEditor();
    if (!el) return { ok: false, error: 'Không tìm thấy ô nhập ChatGPT.' };

    fill(el, text);

    if (!(await ensureFilled(el, text))) {
      return { ok: false, error: 'ChatGPT chưa nhận đủ nội dung.' };
    }

    if (!autoSend) return { ok: true, sent: false };

    if (await fastSubmit(el)) {
      return { ok: true, sent: true, fast: true };
    }

    if (await fallbackSubmit(el)) {
      return { ok: true, sent: true, fast: false };
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
