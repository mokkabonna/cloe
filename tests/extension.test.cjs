const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = name => fs.readFileSync(`${__dirname}/../extension/${name}`, 'utf8');
function content({standalone = true, page = 'https://teams.cloud.microsoft/'} = {}) {
  let listener;
  const sent = [];
  class Element {
    constructor(href, download = false) { this.href = href; this.download = download; }
    matches() { return true; }
    hasAttribute() { return this.download; }
  }
  const context = vm.createContext({URL, Element, console: {warn() {}},
    window: {location: {href: page}, matchMedia: () => ({matches: standalone})},
    document: {addEventListener(type, fn) { assert.equal(type, 'click'); listener = fn; }},
    chrome: {runtime: {sendMessage(message, callback) { sent.push(message); callback({ok:false}); }}}
  });
  vm.runInContext(source('policy.js'), context);
  vm.runInContext(source('content.js'), context);
  return {sent, click(url, overrides = {}, download = false) {
    let blocked = false;
    listener({isTrusted:true, button:0, composedPath: () => [new Element(url, download)],
      preventDefault() { blocked = true; }, stopImmediatePropagation() {}, ...overrides});
    return blocked;
  }};
}
test('only trusted external link clicks in Teams PWA are forwarded; failure cannot navigate', () => {
  const c = content();
  assert.equal(c.click('https://example.com/'), true);
  assert.equal(c.sent.length, 1);
  // No location.assign mock: attempting fallback would fail this test.
  for (const url of ['javascript:alert(1)', 'file:///tmp/a', 'custom:foo',
    'https://user:secret@example.com', 'https://teams.microsoft.com/chat',
    'https://teams.cloud.microsoft/chat', 'https://login.microsoftonline.com/']) {
    assert.equal(c.click(url), false, url);
  }
  for (const overrides of [{isTrusted:false}, {ctrlKey:true}, {button:1}, {defaultPrevented:true}]) {
    assert.equal(c.click('https://example.com/', overrides), false);
  }
  assert.equal(c.click('https://example.com/', {}, true), false);
  assert.equal(c.sent.length, 1);
  for (const options of [{standalone:false}, {page:'https://evil.example/'},
    {page:'https://teams.microsoft.com.evil.example/'}]) {
    const other = content(options);
    other.click('https://example.com/');
    assert.equal(other.sent.length, 0);
  }
});
test('manifest limits injection to Teams and has no page bridge, storage, or MAIN world', () => {
  const manifest = JSON.parse(source('manifest.json'));
  assert.deepEqual(manifest.permissions, ['nativeMessaging']);
  assert.deepEqual(manifest.content_scripts, [{
    matches:['https://teams.microsoft.com/*', 'https://teams.cloud.microsoft/*'],
    js:['policy.js','content.js'], run_at:'document_start'
  }]);
  // content() has no window messaging APIs; any registration or broadcast fails.
  content();
});
test('background independently rejects forged senders, unsafe URLs, and rapid requests', () => {
  let listener, complete;
  const opened = [];
  let now = 1000;
  const context = vm.createContext({URL, Date:{now: () => now},
    chrome:{runtime:{id:'extension-id', onMessage:{addListener(fn) {listener = fn;}},
      sendNativeMessage(host, message, callback) {opened.push(message); complete = callback;}}}
  });
  context.importScripts = name => vm.runInContext(source(name), context);
  vm.runInContext(source('background.js'), context);
  const sender = {id:'extension-id', frameId:0, tab:{id:1},
    url:'https://teams.cloud.microsoft/', origin:'https://teams.cloud.microsoft'};
  const send = (url, overrides = {}) => listener({type:'OPEN_EXTERNAL',url}, {...sender,...overrides}, () => {});
  for (const overrides of [{id:'other'}, {frameId:1}, {tab:undefined},
    {url:'https://evil.example/'}, {origin:'https://evil.example/'}, {url:undefined}]) {
    send('https://example.com/', overrides);
  }
  for (const url of ['javascript:alert(1)', 'file:///tmp/a', 'https://teams.cloud.microsoft/',
    'https://login.microsoftonline.com/', 'https://user:pass@example.com/', 'x'.repeat(8193)]) send(url);
  assert.equal(opened.length, 0);
  send('https://example.com/');
  assert.equal(opened.length, 1);
  now += 1000;
  send('https://example.com/'); // In-flight request.
  assert.equal(opened.length, 1);
  complete({ok:true});
  send('https://example.com/');
  assert.equal(opened.length, 2);
  complete({ok:false});
  send('https://example.com/'); // Cooldown.
  assert.equal(opened.length, 2);
});
