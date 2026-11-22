// Execute the actual entry point; only the native Electron boundary is substituted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const editorURL = pathToFileURL(path.join(root, 'app', 'index.html')).href;

async function boot(smoke = null) {
  const windows = [], externalURLs = [], handlers = {}, exits = [];
  class WebContents extends EventEmitter {
    constructor() { super(); this.url = ''; this.mainFrame = { url: '' }; this.destroyed = false; }
    async executeJavaScript() { if (smoke.error) throw new Error(smoke.error); return smoke.result; }
    getURL() { return this.url; }
    isDestroyed() { return this.destroyed; }
    setWindowOpenHandler(handler) { this.open = handler; }
  }
  class BrowserWindow {
    constructor(options) { this.options = options; this.webContents = new WebContents(); windows.push(this); }
    loadFile(file) { this.webContents.url = this.webContents.mainFrame.url = pathToFileURL(file).href; }
    static getAllWindows() { return windows; }
  }
  const app = new EventEmitter();
  app.whenReady = () => Promise.resolve();
  app.quit = () => {};
  app.exit = code => exits.push(code);
  const electron = { app, BrowserWindow,
    session: { defaultSession: {
      setPermissionRequestHandler(handler) { handlers.request = handler; },
      setPermissionCheckHandler(handler) { handlers.check = handler; },
    } },
    shell: { openExternal(url) { externalURLs.push(url); } },
    Menu: { buildFromTemplate: x => x, setApplicationMenu() {} },
  };
  electron.session.fromPartition = () => electron.session.defaultSession;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8'), {
    require: name => name === 'electron' ? electron : require(name),
    __dirname: path.join(root, 'electron'), process: { argv: smoke ? ['--smoke-test'] : [], platform: 'linux' }, console: { log() {}, error() {} }, setTimeout, clearTimeout,
  });
  await Promise.resolve();
  return { windows, handlers, externalURLs, WebContents, exits };
}

(async () => {
  const { windows, handlers, externalURLs, WebContents } = await boot();
  const wc = windows[0].webContents;
  const valid = { isMainFrame: true, requestingUrl: editorURL };
  function request(contents, permission, details) {
    const answers = [];
    handlers.request(contents, permission, allowed => answers.push(allowed), details);
    assert.equal(answers.length, 1, 'permission requests must always settle once');
    return answers[0];
  }
  function denied(label, contents, details, origin = 'file://') {
    for (const permission of ['midi', 'midiSysex']) {
      assert.equal(request(contents, permission, details), false, `${label}: request ${permission}`);
      assert.equal(handlers.check(contents, permission, origin, details), false, `${label}: check ${permission}`);
    }
  }
  for (const permission of ['midi', 'midiSysex']) {
    assert.equal(request(wc, permission, valid), true, 'trusted editor retains MIDI');
    assert.equal(handlers.check(wc, permission, 'file://', valid), true);
  }
  denied('unknown WebContents', Object.assign(new WebContents(), { url: editorURL, mainFrame: { url: editorURL } }), valid);
  denied('absent WebContents', null, valid);
  denied('missing details', wc, undefined);
  denied('missing frame identity', wc, { requestingUrl: editorURL });
  denied('missing requesting URL', wc, { isMainFrame: true });
  denied('same-document child frame', wc, { ...valid, isMainFrame: false });
  for (const url of ['https://evil.test/', 'file:///tmp/other.html', editorURL + '?evil', editorURL + '#evil', 'data:text/html,evil', 'about:blank']) {
    denied(`untrusted requesting document ${url}`, wc, { ...valid, requestingUrl: url });
  }
  for (const origin of ['https://evil.test', 'file:///tmp/other.html', 'null', '', undefined]) {
    assert.equal(handlers.check(wc, 'midiSysex', origin, valid), false, `untrusted origin ${origin}`);
  }
  for (const permission of ['camera', 'media', 'geolocation', 'notifications', 'openExternal', 'unknown']) {
    assert.equal(request(wc, permission, valid), false);
    assert.equal(handlers.check(wc, permission, 'file://', valid), false);
  }
  wc.url = 'https://evil.test/';
  denied('navigated window', wc, valid);
  wc.url = editorURL;
  wc.mainFrame.url = 'file:///tmp/other.html';
  denied('mismatched main frame', wc, valid);
  wc.mainFrame.url = editorURL;
  wc.destroyed = true;
  denied('destroyed window', wc, valid);
  wc.destroyed = false;

  for (const type of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
    for (const [url, isMainFrame, wantBlocked] of [
      [editorURL, true, false], ['https://evil.test/', true, true],
      ['file:///tmp/other.html', true, true], [editorURL + '?evil', true, true],
      [editorURL, false, true], [editorURL, undefined, true], ['about:blank', false, true],
    ]) {
      let blocked = false;
      wc.emit(type, { url, isMainFrame, preventDefault() { blocked = true; } });
      assert.equal(blocked, wantBlocked, `${type}: ${url}, main frame ${isMainFrame}`);
    }
  }
  for (const url of ['https://evil.test/', 'file:///tmp/other.html', 'javascript:alert(1)', editorURL]) {
    assert.equal(wc.open({ url }).action, 'deny');
  }
  assert.deepEqual(externalURLs, [], 'untrusted pages cannot cause OS browser launches');
  assert.equal(windows[0].options.webPreferences.sandbox, true);
  assert.equal(windows[0].options.webPreferences.contextIsolation, true);
  assert.equal(windows[0].options.webPreferences.nodeIntegration, false);
  for (const [smoke, code] of [[{ result: { ok: true, checks: 'renderer checks' } }, 0], [{ result: { ok: false } }, 1], [{ error: 'renderer failed' }, 1]]) {
    const run = await boot(smoke);
    run.windows[0].webContents.emit('did-finish-load');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(run.exits, [code], 'smoke exit must reflect verified renderer result');
  }
  console.log('Electron security: permission, frame, navigation and window boundaries passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
