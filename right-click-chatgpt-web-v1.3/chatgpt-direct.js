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

  function writeContentEditableImmediately(el, text) {
    const fragment = document.createDocumentFragment();
    const lines = String(text).split(/\r?\n/);

    for (const line of lines) {
      const p = document.createElement('p');
      if (line) p.textContent = line;
      else p.appendChild(document.createElement('br'));
      fragment.appendChild(p);
    }

    el.replaceChildren(fragment);
    fireInput(el, text);

    try {
      el.focus({ preventScroll: true });
    } catch (_) {
      el.focus();
    }
  }

  function fallbackExecCommand(el, text) {
    try {
      el.focus({ preventScroll: true });
    } catch (_) {
      el.focus();
    }

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);

    try {
      return document.execCommand('insertText', false, text);
    } catch (_) {
      return false;
    }
  }

  function fill(el, text) {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      try {
        el.focus({ preventScroll: true });
      } catch (_) {
        el.focus();
      }

      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (!setter) throw new Error('Không có value setter.');

      setter.call(el, text);
      fireInput(el, text);
      return;
    }

    // Fast path for ChatGPT's contenteditable composer: paint the text into the
    // DOM synchronously so it is visible immediately after the tab switch.
    // Input events then synchronize ChatGPT's editor state.
    writeContentEditableImmediately(el, text);

    // Only use execCommand if the direct write did not stick. Keeping it out of
    // the normal path removes the largest paste latency on an activated tab.
    if (!sameText(valueOf(el), text)) {
      fallbackExecCommand(el, text);
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

  async function waitForEditor(timeoutMs = 2500) {
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

    // One very short synchronization window only. The visual DOM write above
    // is synchronous, so normal requests should never enter this loop.
    for (const delay of [5, 10, 20]) {
      await sleep(delay);
      if (sameText(valueOf(el), text)) return true;
    }

    if (fallbackExecCommand(el, text)) {
      fireInput(el, text);
      return sameText(valueOf(el), text);
    }

    return false;
  }

  async function fastSubmit(el) {
    const wasGenerating = isGenerating();

    await Promise.resolve();

    let button = sendButton(el);
    if (button) {
      button.click();
      if (await waitForSent(wasGenerating, 140)) return true;
    }

    pressEnter(el);
    if (await waitForSent(wasGenerating, 180)) return true;

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
