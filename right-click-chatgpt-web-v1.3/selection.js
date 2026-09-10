// Selection is handled by chrome.contextMenus in background.js.
// Do not send ASK_CHATGPT_WEB from the contextmenu event itself because that
// starts the request before the user chooses "Hỏi ChatGPT + Gemini" and can
// cause duplicate requests or race with the actual context-menu click.
(() => {
  if (globalThis.__RIGHT_CLICK_CHATGPT_WEB_V12__) return;
  globalThis.__RIGHT_CLICK_CHATGPT_WEB_V12__ = true;
})();
