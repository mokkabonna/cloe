const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = name => fs.readFileSync(`${__dirname}/../extension/${name}`, 'utf8');
function content({standalone = true, overlay = false, topFrame = true, page = 'https://teams.cloud.microsoft/'} = {}) {
  let listener;
  let checkPwa;
  const sent = [];
  class Element {
    constructor(href, download = false) { this.href = href; this.download = download; }
    matches() { return true; }
    hasAttribute() { return this.download; }
  }
  const context = vm.createContext({URL, Element, console: {warn() {}},
    window: {location: {href: page}, matchMedia: query => ({matches: query.includes('overlay') ? overlay : standalone})},
    document: {addEventListener(type, fn) { assert.equal(type, 'click'); listener = fn; }},
    chrome: {runtime: {id:'extension-id', onMessage:{addListener(fn) { checkPwa = fn; }},
      sendMessage(message, callback) { sent.push(message); callback({ok:false}); }}}
  });
  context.window.top = topFrame ? context.window : {};
  vm.runInContext(source('policy.js'), context);
  vm.runInContext(source('content.js'), context);
  return {sent, checkPwa, click(url, overrides = {}, download = false) {
    let blocked = false;
    if (!listener) return false;
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
    matches:['https://teams.microsoft.com/*', 'https://teams.cloud.microsoft/*',
      'https://outlook.office.com/*', 'https://outlook.office365.com/*',
      'https://outlook.cloud.microsoft/*', 'https://outlook.live.com/*'],
    js:['policy.js','content.js'], run_at:'document_start', all_frames:true
  }]);
  // content() has no window messaging APIs; any registration or broadcast fails.
  content();
});
test('background independently rejects forged senders, unsafe URLs, and rapid requests', () => {
  let listener, complete;
  const opened = [];
  let now = 1000;
  const context = vm.createContext({URL, Date:{now: () => now},
    chrome:{tabs:{sendMessage(id, message, options, callback) {callback({allowed:true});}},
      runtime:{id:'extension-id', onMessage:{addListener(fn) {listener = fn;}},
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
test('Outlook sources allow real external clicks while app links and lookalikes remain protected', () => {
  for (const origin of ['https://outlook.office.com', 'https://outlook.office365.com',
    'https://outlook.cloud.microsoft', 'https://outlook.live.com']) {
    const c = content({page:origin + '/mail/'});
    assert.equal(c.click('https://example.com/'), true);
    assert.equal(c.click(origin + '/calendar/'), false);
    assert.equal(c.click('https://teams.cloud.microsoft/'), false);
    assert.equal(c.click('https://example.com/', {isTrusted:false}), false);
    assert.equal(c.sent.length, 1);
    const tab = content({page:origin + '/mail/', standalone:false});
    assert.equal(tab.click('https://example.com/'), false);
    const fake = content({page:origin + '.evil.example/'});
    assert.equal(fake.click('https://example.com/'), false);
  }
});
test('calendar iframe supports the reported link; other frames remain inactive', () => {
  const link = 'https://aka.ms/JoinTeamsMeeting?omkt=nb-NO';
  const c = content({page:'https://outlook.office.com/hosted/calendar?hostName=teams',
    topFrame:false, standalone:false, overlay:true});
  assert.equal(c.click(link), true);
  assert.equal(c.sent[0].url, link);
  assert.equal(c.click(link, {isTrusted:false}), false);
  assert.equal(c.click('https://outlook.office.com/calendar'), false);
  for (const page of ['https://outlook.office.com/mail/',
    'https://outlook.office.com/hosted/calendar-evil', 'https://teams.cloud.microsoft/']) {
    assert.equal(content({page, topFrame:false}).click(link), false);
  }
});
test('top frame confirms approved PWA context only to extension messages', () => {
  for (const [options, expected] of [[{standalone:false, overlay:true},true],
    [{standalone:false},false], [{standalone:true},true]]) {
    const c = content(options);
    let response;
    c.checkPwa({type:'CHECK_PWA'}, {id:'extension-id'}, value => {response = value;});
    assert.equal(response.allowed, expected);
    response = undefined;
    c.checkPwa({type:'CHECK_PWA'}, {id:'other'}, value => {response = value;});
    assert.equal(response, undefined);
  }
});
test('worker requires calendar frame and trusted top-frame approval before native opening', () => {
  for (const scenario of [
    {allowed:true, expect:1}, {allowed:false, expect:0},
    {allowed:true, runtimeError:true, expect:0},
    {allowed:true, origin:'null', expect:0},
    {allowed:true, url:'https://outlook.office.com/hosted/calendar-evil', expect:0},
    {allowed:true, url:'https://evil.example/hosted/calendar', expect:0},
  ]) {
    let listener;
    const opens = [];
    const chrome = {tabs:{sendMessage(id, message, options, callback) {
      assert.equal(id, 7);
      assert.equal(message.type, 'CHECK_PWA');
      assert.equal(options.frameId, 0);
      if (scenario.runtimeError) chrome.runtime.lastError = {message:'No receiving end'};
      callback({allowed:scenario.allowed});
    }}, runtime:{id:'extension-id', onMessage:{addListener(fn) {listener = fn;}},
      sendNativeMessage(host, message, callback) {opens.push(message); callback({ok:true});}}};
    const context = vm.createContext({chrome, URL, Date});
    context.importScripts = name => vm.runInContext(source(name), context);
    vm.runInContext(source('background.js'), context);
    listener({type:'OPEN_EXTERNAL', url:'https://aka.ms/JoinTeamsMeeting?omkt=nb-NO'}, {
      id:'extension-id', frameId:3, tab:{id:7},
      url:scenario.url || 'https://outlook.office.com/hosted/calendar?hostName=teams',
      origin:scenario.origin || 'https://outlook.office.com',
    }, () => {});
    assert.equal(opens.length, scenario.expect, JSON.stringify(scenario));
  }
});
