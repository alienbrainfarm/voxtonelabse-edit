// Electron shell: packages the web editor as a desktop app for macOS, Windows and Linux.
// Chromium's Web MIDI sits on CoreMIDI, WinMM and ALSA respectively, so any
// class-compliant USB-MIDI interface the system sees shows up in the editor.
const { app, BrowserWindow, session, Menu } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const editorPath = path.join(__dirname, '..', 'app', 'index.html');
const editorURL = pathToFileURL(editorPath).href;
const trustedContents = new WeakSet();
const smokeTest = process.argv.includes('--smoke-test');
let editorSession;

function canUseMidi(wc, permission, details) {
  // A file origin alone includes every local file. Require both the registered
  // editor window and the exact document in its top-level requesting frame.
  return (permission === 'midi' || permission === 'midiSysex') &&
    !!wc && trustedContents.has(wc) && !wc.isDestroyed() &&
    wc.getURL() === editorURL && wc.mainFrame.url === editorURL &&
    details?.isMainFrame === true && details.requestingUrl === editorURL;
}

function restrictNavigation(event) {
  if (event.isMainFrame !== true || event.url !== editorURL) event.preventDefault();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 980,
    minHeight: 700,
    title: 'ToneLab SE Editor',
    backgroundColor: '#0d1b3d',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, session: editorSession },
  });
  trustedContents.add(win.webContents);
  win.webContents.on('will-navigate', restrictNavigation);
  win.webContents.on('will-frame-navigate', restrictNavigation);
  win.webContents.on('will-redirect', restrictNavigation);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (smokeTest) {
    const timeout = setTimeout(() => { console.error('SMOKE failed: timed out'); app.exit(1); }, 20000);
    timeout.unref();
    win.webContents.once('did-fail-load', () => { clearTimeout(timeout); app.exit(1); });
    win.webContents.once('did-finish-load', async () => {
      try {
        const result = await win.webContents.executeJavaScript(`(async () => {
          const access = await navigator.requestMIDIAccess({ sysex: true });
          if (!access.sysexEnabled) throw new Error('SysEx permission unavailable');
          for (let i = 0; i < 100 && !document.querySelector('#btn-connect').onclick; i++) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          if (!window.TL?.app || !document.querySelector('#btn-connect').onclick) throw new Error('Editor did not start');
          document.querySelector('#midi-in').value = TL.Midi.SIM_ID;
          document.querySelector('#midi-out').value = TL.Midi.SIM_ID;
          await TL.app.connect();
          if (!TL.app.midi.sim || !TL.app.midi.connected || TL.app.state.edit.length !== 92 ||
              document.querySelector('#status').textContent !== 'Connected') throw new Error('Simulator connection failed');
          const inline = document.createElement('script');
          inline.textContent = 'window.__smokeInlineExecuted = true';
          document.head.append(inline);
          inline.remove();
          if (window.__smokeInlineExecuted) throw new Error('CSP allowed inline script');
          return { ok: true, checks: 'MIDI+SysEx, editor startup, simulator, inline-script CSP' };
        })()`);
        if (result?.ok !== true) throw new Error('Renderer checks failed');
        console.log('SMOKE passed: ' + result.checks);
        clearTimeout(timeout);
        app.exit(0);
      } catch (error) {
        console.error('SMOKE failed: ' + error.message);
        clearTimeout(timeout);
        app.exit(1);
      }
    });
  }
  win.loadFile(editorPath);
}

app.whenReady().then(() => {
  // Keep smoke tests separate from saved ports/preferences and real hardware.
  editorSession = smokeTest ? session.fromPartition('smoke-test') : session.defaultSession;
  editorSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    cb(canUseMidi(wc, permission, details));
  });
  editorSession.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
    // Electron reports file origins without a path, but may provide the full URL.
    const trustedOrigin = requestingOrigin === 'file://' || requestingOrigin === 'file:///' || requestingOrigin === editorURL;
    return trustedOrigin && canUseMidi(wc, permission, details);
  });

  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]));
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
