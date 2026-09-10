(() => {
  if (globalThis.__RIGHT_CLICK_CHATGPT_WEB_V13__) return;
  globalThis.__RIGHT_CLICK_CHATGPT_WEB_V13__ = true;

  let busy = false;
  let lastAssistant = null;
  let sendButton = null;

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
    // innerText gives a human-readable version and generally excludes collapsed DOM content.
    let text = (el.innerText || el.textContent || "").trim();
    text = text.replace(/\n{3,}/g, "\n\n").trim();
    return text;
  }

  function makeButton() {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "📤 Gửi câu trả lời → Telegram";
    Object.assign(b.style, {
      position: "fixed",
      right: "24px",
      bottom: "88px",
      zIndex: "2147483647",
      padding: "9px 13px",
      border: "1px solid rgba(255,255,255,.18)",
      borderRadius: "10px",
      background: "#111827",
      color: "white",
      fontSize: "13px",
      fontWeight: "600",
      cursor: "pointer",
      boxShadow: "0 4px 18px rgba(0,0,0,.35)",
      opacity: ".94"
    });
    b.title = "Gửi câu trả lời ChatGPT cuối cùng sang Telegram";
    b.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const nodes = assistantNodes();
      const target = nodes[nodes.length - 1] || lastAssistant;
      if (!target) { b.textContent = "❌ Chưa thấy câu trả lời"; setTimeout(() => b.textContent = "📤 Gửi câu trả lời → Telegram", 1800); return; }
      const text = cleanAnswerText(target);
      if (!text) { b.textContent = "❌ Câu trả lời trống"; setTimeout(() => b.textContent = "📤 Gửi câu trả lời → Telegram", 1800); return; }
      b.disabled = true;
      b.textContent = "⏳ Đang gửi…";
      try {
        const result = await chrome.runtime.sendMessage({ type: "SEND_CHATGPT_ANSWER", text });
        if (result?.ok) {
          b.textContent = "✅ Đã gửi Telegram";
        } else {
          b.textContent = "❌ " + (result?.error || "Gửi lỗi");
        }
      } catch (err) {
        b.textContent = "❌ " + String(err?.message || err);
      } finally {
        setTimeout(() => { b.textContent = "📤 Gửi câu trả lời → Telegram"; b.disabled = false; }, 2200);
      }
    }, true);
    return b;
  }

  function updateAssistantButton() {
    const nodes = assistantNodes();
    if (nodes.length) {
      lastAssistant = nodes[nodes.length - 1];
      if (!sendButton) {
        sendButton = makeButton();
        document.documentElement.appendChild(sendButton);
      }
    }
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === "CHECK_PENDING_PROMPT") processPending();
  });

  processPending();
  updateAssistantButton();

  const observer = new MutationObserver(() => {
    chrome.storage.local.get("pendingChatGPTPrompt").then(({ pendingChatGPTPrompt }) => {
      if (pendingChatGPTPrompt?.text) processPending();
    });
    updateAssistantButton();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
