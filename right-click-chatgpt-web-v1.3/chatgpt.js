(() => {
  if (globalThis.__RIGHT_CLICK_CHATGPT_WEB_V14__) return;
  globalThis.__RIGHT_CLICK_CHATGPT_WEB_V14__ = true;

  let busy = false;
  let lastAssistant = null;
  let lastSentAnswer = "";
  let stableTimer = null;
  let lastObservedText = "";
  let lastChangeAt = 0;
  let answerWatchStartedAt = 0;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function getComposer() {
    return (
      document.querySelector("#prompt-textarea") ||
      document.querySelector('[data-testid="composer-input"]') ||
      document.querySelector('textarea[placeholder]') ||
      document.querySelector('div.ProseMirror[contenteditable="true"]') ||
      document.querySelector('[contenteditable="true"][role="textbox"]')
    );
  }

  function fillComposer(el, text) {
    el.focus();
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, text); else el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    el.replaceChildren();
    const p = document.createElement("p");
    p.textContent = text;
    el.appendChild(p);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  }

  function findSendButton() {
    return (
      document.querySelector('[data-testid="send-button"]') ||
      document.querySelector('button[aria-label*="Send"]') ||
      document.querySelector('button[aria-label*="Gửi"]')
    );
  }

  async function submit(el) {
    await sleep(250);
    const btn = findSendButton();
    if (btn && !btn.disabled) { btn.click(); return true; }
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    return true;
  }

  async function processPending() {
    if (busy) return;
    busy = true;
    try {
      const { pendingChatGPTPrompt } = await chrome.storage.local.get("pendingChatGPTPrompt");
      if (!pendingChatGPTPrompt?.text) return;
      if (Date.now() - (pendingChatGPTPrompt.createdAt || 0) > 10 * 60 * 1000) {
        await chrome.storage.local.remove("pendingChatGPTPrompt");
        return;
      }
      let composer = null;
      for (let i = 0; i < 40; i++) {
        composer = getComposer();
        if (composer) break;
        await sleep(250);
      }
      if (!composer) return;
      fillComposer(composer, pendingChatGPTPrompt.text);
      await chrome.storage.local.remove("pendingChatGPTPrompt");
      lastObservedText = "";
      lastChangeAt = Date.now();
      answerWatchStartedAt = Date.now();
      if (pendingChatGPTPrompt.autoSend) await submit(composer);
    } finally { busy = false; }
  }

  function assistantNodes() {
    const selectors = [
      '[data-message-author-role="assistant"]',
      'article[data-testid^="conversation-turn"] [data-message-author-role="assistant"]',
      '[data-testid="conversation-turn-assistant"]'
    ];
    const set = new Set();
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach(el => set.add(el));
    }
    return [...set].filter(el => {
      const text = (el.innerText || el.textContent || "").trim();
      return text.length > 0;
    });
  }

  function cleanAnswerText(el) {
    let text = (el.innerText || el.textContent || "").trim();
    text = text.replace(/\n{3,}/g, "\n\n").trim();
    return text;
  }

  function isGenerating() {
    const stopSelectors = [
      'button[aria-label*="Stop"]',
      'button[aria-label*="Dừng"]',
      '[data-testid="stop-button"]'
    ];
    return stopSelectors.some(selector => {
      const el = document.querySelector(selector);
      return !!el && !el.disabled && el.offsetParent !== null;
    });
  }

  async function sendLatestAnswer(text) {
    const clean = String(text || "").trim();
    if (!clean || clean === lastSentAnswer) return;
    try {
      const result = await chrome.runtime.sendMessage({ type: "SEND_CHATGPT_ANSWER", text: clean });
      if (result?.ok) {
        lastSentAnswer = clean;
        console.log("[Right Click ChatGPT] Đã tự gửi câu trả lời sang Telegram.");
      } else {
        console.error("[Right Click ChatGPT] Gửi Telegram lỗi:", result?.error);
      }
    } catch (err) {
      console.error("[Right Click ChatGPT] Không thể gửi Telegram:", err);
    }
  }

  function watchLatestAssistant() {
    const nodes = assistantNodes();
    if (!nodes.length) return;

    const target = nodes[nodes.length - 1];
    lastAssistant = target;
    const text = cleanAnswerText(target);
    if (!text) return;

    if (text !== lastObservedText) {
      lastObservedText = text;
      lastChangeAt = Date.now();
      answerWatchStartedAt = answerWatchStartedAt || Date.now();
      return;
    }

    if (isGenerating()) return;

    // Chờ nội dung ổn định để tránh gửi giữa lúc ChatGPT đang stream.
    const stableFor = Date.now() - lastChangeAt;
    const watchedFor = Date.now() - answerWatchStartedAt;
    if (stableFor < 1200 || watchedFor < 1200) return;

    if (stableTimer) return;
    stableTimer = setTimeout(async () => {
      stableTimer = null;
      const currentNodes = assistantNodes();
      const current = currentNodes[currentNodes.length - 1];
      const currentText = current ? cleanAnswerText(current) : "";
      if (!currentText || currentText !== lastObservedText) return;
      if (isGenerating()) return;
      await sendLatestAnswer(currentText);
    }, 300);
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === "CHECK_PENDING_PROMPT") processPending();
  });

  processPending();

  const observer = new MutationObserver(() => {
    watchLatestAssistant();
    chrome.storage.local.get("pendingChatGPTPrompt").then(({ pendingChatGPTPrompt }) => {
      if (pendingChatGPTPrompt?.text) processPending();
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  // Fallback: kiểm tra định kỳ vì một số thay đổi giao diện không luôn phát mutation như mong đợi.
  setInterval(watchLatestAssistant, 500);
})();
