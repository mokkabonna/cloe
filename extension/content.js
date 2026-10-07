// No page-world script or postMessage bridge: only real user link clicks.
(() => {
  const topFrame = window === window.top;
  if (!cloePolicy.isAllowedPage(window.location.href) ||
      (!topFrame && !cloePolicy.isCalendarFrame(window.location.href))) return;
  const isPwa = () => window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches;
  if (topFrame) {
    // Extension-only messaging, never a page-world postMessage bridge.
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
      if (sender.id === chrome.runtime.id && message?.type === 'CHECK_PWA') {
        respond({allowed: cloePolicy.isAllowedPage(window.location.href) && isPwa()});
      }
    });
  }
  let pending = false;
  document.addEventListener('click', (event) => {
    if (!event.isTrusted || event.defaultPrevented || event.button !== 0 ||
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!cloePolicy.isAllowedPage(window.location.href)) return;
    if (!isPwa()) return;

    const anchor = event.composedPath().find(node =>
      node instanceof Element && node.matches('a[href]'));
    if (!anchor || anchor.hasAttribute('download')) return;
    const url = cloePolicy.externalUrl(anchor.href);
    if (!url) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (pending) return;
    pending = true;
    chrome.runtime.sendMessage({type: 'OPEN_EXTERNAL', url}, (response) => {
      pending = false;
      if (chrome.runtime.lastError || response?.ok !== true) {
        // Never navigate as a fallback or log potentially sensitive URLs.
        console.warn('CLOE could not open the link. Copy it into your browser to retry.');
      }
    });
  }, true);
})();
