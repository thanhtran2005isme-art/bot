(() => {
  if (globalThis.__RCGPT_FLOATING_PHONE_BUTTON__) return;
  globalThis.__RCGPT_FLOATING_PHONE_BUTTON__ = true;

  function mount() {
    if (!document.documentElement || document.getElementById('__rcgpt_phone_host__')) return;

    const host = document.createElement('div');
    host.id = '__rcgpt_phone_host__';
    host.style.position = 'fixed';
    host.style.right = '0';
    host.style.top = '50%';
    host.style.transform = 'translateY(-50%)';
    host.style.zIndex = '2147483647';
    host.style.pointerEvents = 'auto';

    const shadow = host.attachShadow({ mode: 'closed' });
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '📱';
    button.title = 'Đọc màn hình điện thoại → ChatGPT';
    button.setAttribute('aria-label', 'Đọc màn hình điện thoại và gửi sang ChatGPT');

    Object.assign(button.style, {
      width: '42px',
      height: '46px',
      padding: '0',
      margin: '0',
      border: '1px solid rgba(255,255,255,.18)',
      borderRight: '0',
      borderRadius: '12px 0 0 12px',
      background: 'rgba(32,33,36,.92)',
      color: '#fff',
      boxShadow: '0 2px 10px rgba(0,0,0,.35)',
      font: '20px/1 system-ui, sans-serif',
      cursor: 'pointer',
      backdropFilter: 'blur(6px)'
    });

    let busy = false;
    let resetTimer = null;

    function state(text, title, delay = 0) {
      clearTimeout(resetTimer);
      button.textContent = text;
      button.title = title;
      if (delay) {
        resetTimer = setTimeout(() => {
          button.textContent = '📱';
          button.title = 'Đọc màn hình điện thoại → ChatGPT';
        }, delay);
      }
    }

    button.addEventListener('mouseenter', () => {
      if (!busy) button.style.width = '46px';
    });
    button.addEventListener('mouseleave', () => {
      button.style.width = '42px';
    });

    button.addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();
      if (busy) return;

      busy = true;
      button.disabled = true;
      button.style.cursor = 'wait';
      state('…', 'Đang đọc màn hình Android…');

      try {
        const result = await chrome.runtime.sendMessage({ type: 'READ_ANDROID_SCREEN' });
        if (!result?.ok) throw new Error(result?.error || 'Không đọc/gửi được màn hình Android.');
        state('✓', 'Đã gửi sang ChatGPT', 1200);
      } catch (error) {
        state('!', String(error?.message || error), 2500);
      } finally {
        busy = false;
        button.disabled = false;
        button.style.cursor = 'pointer';
      }
    }, true);

    shadow.appendChild(button);
    document.documentElement.appendChild(host);
  }

  if (document.documentElement) mount();
  else document.addEventListener('readystatechange', mount, { once: true });
})();
