importScripts('policy.js');

let pending = false;
let lastOpen = -Infinity;
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Sender metadata is supplied by Chromium, not the page or message payload.
  if (sender.id !== chrome.runtime.id || !Number.isInteger(sender.frameId) || sender.frameId < 0 ||
      !Number.isInteger(sender.tab?.id) ||
      !cloePolicy.isAllowedPage(sender.url) ||
      (sender.frameId !== 0 && !cloePolicy.isCalendarFrame(sender.url)) ||
      sender.origin !== new URL(sender.url).origin) return;
  if (message?.type !== 'OPEN_EXTERNAL') return;
  const url = cloePolicy.externalUrl(message.url);
  if (!url || pending || Date.now() - lastOpen < 500) {
    sendResponse({ok: false});
    return;
  }
  pending = true;
  lastOpen = Date.now();
  // Ask OUR isolated top-frame script, rather than trusting a frame's claim
  // about its embedding site. No tabs/host permission or page bridge needed.
  chrome.tabs.sendMessage(sender.tab.id, {type: 'CHECK_PWA'}, {frameId: 0}, (context) => {
    if (chrome.runtime.lastError || context?.allowed !== true) {
      pending = false;
      sendResponse({ok: false});
      return;
    }
    chrome.runtime.sendNativeMessage('com.iltumio.cloe', {url}, (response) => {
      pending = false;
      sendResponse({ok: !chrome.runtime.lastError && response?.ok === true});
    });
  });
  return true;
});
