importScripts('policy.js');

let pending = false;
let lastOpen = -Infinity;
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Sender metadata is supplied by Chromium, not the page or message payload.
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 ||
      !Number.isInteger(sender.tab?.id) ||
      !cloePolicy.isAllowedPage(sender.url) ||
      sender.origin !== new URL(sender.url).origin) return;
  if (message?.type !== 'OPEN_EXTERNAL') return;
  const url = cloePolicy.externalUrl(message.url);
  if (!url || pending || Date.now() - lastOpen < 500) {
    sendResponse({ok: false});
    return;
  }
  pending = true;
  lastOpen = Date.now();
  chrome.runtime.sendNativeMessage('com.iltumio.cloe', {url}, (response) => {
    pending = false;
    sendResponse({ok: !chrome.runtime.lastError && response?.ok === true});
  });
  return true;
});
