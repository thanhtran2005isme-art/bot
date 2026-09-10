(() => {
  if (globalThis.__RIGHT_CLICK_CHATGPT_WEB_V15__) return;
  globalThis.__RIGHT_CLICK_CHATGPT_WEB_V15__ = true;

  let busy = false;
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
      document.querySelector('[contenteditable="true"][role="textbox"]') ||
      document.querySelector('[contenteditable="true"]')
    );
  }

  function dispatchInputEvents(el, text) {
    try {
      el.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: text
      }));
    } catch (_) {}
    try {
      el.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text
      }));
    } catch (_) {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function fillComposer(el, text) {
    const value = String(text || "");
    el.focus();

    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (!setter) throw new Error("Không tìm thấy setter của composer.");
      setter.call(el, value);
      dispatchInputEvents(el, value);
      return;
    }

    // ChatGPT's rich-text composer is controlled by the page app, so writing only
    // innerHTML/textContent can leave React's internal value empty. Prefer the
    // browser editing command after selecting existing content, then fire input.
    try {
      document.execCommand("selectAll", false);
      document.execCommand("insertText", false, value);
    } catch (_) {}

    // Fallback for editors where execCommand is unavailable.
    const current = (el.innerText || el.textContent || "").trim();
    if (current !== value) {
      el.replaceChildren();
      const p = document.createElement("p");
      p.textContent = value;
      el.appendChild(p);
      dispatchInputEvents(el, value);
    }
  }

  function readComposerText(el) {
    return String(el?.innerText || el?.textContent || el?.value || "").trim();
  }

  async function waitForComposerValue(el, expected) {
    for (let i = 0; i < 20; i++) {
      if (readComposerText(el) === expected.trim()) return true;
      await sleep(100);
    }
    return false;
  }

  function findSendButton() {
    return (
      document.querySelector('[data-testid="send-button"]') ||
      document.querySelector('button[aria-label*="Send"]') ||
      document.querySelector('button[aria-label*="Gửi"]') ||
      document.querySelector('button[data-testid*="send"]')
    );
  }

  async function submit(el) {
    await sleep(350);
    const btn = findSendButton();
    if (btn && !btn.disabled && btn.offsetParent !== null) {
      btn.click();
      return true;
    }

    el.focus();
    try {
      const enter = new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      });
      el.dispatchEvent(enter);
      await sleep(150);
      if (!enter.defaultPrevented) {
        el.dispatchEvent(new KeyboardEvent("keyup", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true
        }));
      }
      return true;
    } catch (_) {
      return false;
    }
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
      for (let i = 0; i < 60; i++) {
        composer = getComposer();
        if (composer) break;
        await sleep(250);
      }
      if (!composer) {
        console.error("[Right Click ChatGPT] Không tìm thấy ô nhập ChatGPT.");
        return;
      }

      const expected = String(pendingChatGPTPrompt.text).trim();
      fillComposer(composer, expected);

      const accepted = await waitForComposerValue(composer, expected);
      if (!accepted) {
        console.error("[Right Click ChatGPT] Điền text thất bại; composer không nhận nội dung.", {
          expected,
          actual: readComposerText(composer)
        });
        return;
      }

      await chrome.storage.local.remove("pendingChatGPTPrompt");
      lastObservedText = "";
      lastChangeAt = Date.now();
      answerWatchStartedAt = Date.now();

      if (pendingChatGPTPrompt.autoSend) {
        const submitted = await submit(composer);
        if (!submitted) console.error("[Right Click ChatGPT] Không thể bấm gửi.");
      }
    } catch (error) {
      console.error("[Right Click ChatGPT] Lỗi xử lý prompt:", error);
    } finally {
      busy = false;
    }
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
    const text = cleanAnswerText(target);
    if (!text) return;

    if (text !== lastObservedText) {
      lastObservedText = text;
      lastChangeAt = Date.now();
      answerWatchStartedAt = answerWatchStartedAt || Date.now();
      return;
    }

    if (isGenerating()) return;

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
    }).catch(() => {});
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  setInterval(watchLatestAssistant, 500);
})();
