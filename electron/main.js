// Electron shell: packages the web editor as a desktop app for macOS, Windows and Linux.
// Chromium's Web MIDI sits on CoreMIDI, WinMM and ALSA respectively, so any
// class-compliant USB-MIDI interface the system sees shows up in the editor.
const { app, BrowserWindow, session, Menu, shell } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 980,
    minHeight: 700,
    title: 'ToneLab SE Editor',
    backgroundColor: '#0d1b3d',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, '..', 'app', 'index.html'));
  if (process.argv.includes('--smoke-test')) {
    // CI-style check: can the page get Web MIDI with SysEx, and does the editor boot?
    win.webContents.on('did-finish-load', async () => {
      const r = await win.webContents.executeJavaScript(`
        navigator.requestMIDIAccess({ sysex: true })
          .then(a => 'midi+sysex OK; outputs: ' + JSON.stringify([...a.outputs.values()].map(o => o.name)) + '; editor: ' + (window.TL && window.TL.app ? 'loaded' : 'missing'))
          .catch(e => 'midi FAILED: ' + e.name + ' ' + e.message)`);
      console.log('SMOKE ' + r);
      app.quit();
    });
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  // Grant Web MIDI incl. SysEx without a prompt: this app exists to talk to the pedal.
  const allowed = new Set(['midi', 'midiSysex']);
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((wc, permission) => allowed.has(permission));

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
