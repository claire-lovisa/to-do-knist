'use strict';

// main.js — Electron main process for ToDoKnist.
// Frameless, transparent, non-resizable, always-on-top pixel-art knitting loom.

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./lib/store.js');
const M = require('./lib/markdown.js');

// Canonical app name -> ~/.config/ToDoKnist on Linux (matches productName).
app.setName('ToDoKnist');

// OS-standard config directory (~/.config/ToDoKnist on Linux).
function configDir() {
  return app.getPath('userData');
}

function defaultRecordsDir() {
  return path.join(app.getPath('documents'), 'ToDoKnist');
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 320, // focused/idle height (needles + fabric + status)
    minWidth: 440,
    maxWidth: 440,
    minHeight: 280,
    maxHeight: 640,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
      spellcheck: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  if (process.env.TODOKNIST_NO_ANIM === '1') {
    mainWindow.webContents.once('dom-ready', () => {
      mainWindow.webContents.executeJavaScript('window.__TODOKNIST_NO_ANIM = true;');
    });
  }
  mainWindow.loadFile('index.html');
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) =>
    console.error('[main] did-fail-load', code, desc, url));
  mainWindow.webContents.on('render-process-gone', (_e, details) =>
    console.error('[main] render-process-gone', details.reason, details.exitCode));
  mainWindow.webContents.on('console-message', (_e, level, msg) => {
    if (level >= 2) console.error('[renderer]', msg);
  });
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    maybeTestAction(mainWindow);
    maybeCaptureAndQuit(mainWindow);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Test-only: perform an action early, before the capture.
function maybeTestAction(win) {
  const action = process.env.TODOKNIST_TEST_ACTION;
  if (!action) return;
  const delay = parseInt(process.env.TODOKNIST_ACTION_DELAY || '1500', 10);
  setTimeout(async () => {
    try {
      if (action === 'click') {
        const r = await win.webContents.executeJavaScript(
          `(() => { const row = document.querySelector('#focusView .task'); if (row) { row.click(); return 'clicked:' + row.dataset.index; } return 'no-task'; })()`
        );
        console.log('[test-action]', r);
      } else if (action === 'listmode') {
        const r = await win.webContents.executeJavaScript(`document.getElementById('viewBtn').click(); 'toggled'`);
        console.log('[test-action]', r);
      } else if (action === 'appendnote') {
        const r = await win.webContents.executeJavaScript(`window.TodoKnist.appendNote('**session note (test):** hello from test')`);
        console.log('[append-result]', JSON.stringify(r));
      } else if (action === 'abortlog') {
        const r = await win.webContents.executeJavaScript(`window.TodoKnist.appendNote('**aborted plan (test):** Test Plan — 3/8 tasks done')`);
        console.log('[append-result]', JSON.stringify(r));
      } else if (action === 'restore-check') {
        const r = await win.webContents.executeJavaScript(
          `(() => { const prog = document.getElementById('progress').textContent; const task = document.querySelector('#focusView .task'); return JSON.stringify({ prog, taskText: task ? task.querySelector('.label').textContent : 'none', taskDone: task ? task.classList.contains('done') : null }); })()`
        );
        console.log('[restore-check]', r);
      } else if (action === 'paste') {
        const md = '# Pasted Plan\n\n## Section\n- [ ] Pasted task 1\n- [ ] Pasted task 2\n';
        const r = await win.webContents.executeJavaScript(
          `window.TodoKnist.openPasted(${JSON.stringify(md)}).then(r => JSON.stringify(r))`
        );
        console.log('[paste-result]', r);
      } else if (action === 'abort-popup') {
        // simulate Ctrl+C to open abort popup
        await win.webContents.executeJavaScript(
          `(() => { const e = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }); document.dispatchEvent(e); return 'dispatched'; })()`
        );
        console.log('[test-action]', 'abort-popup dispatched');
      } else if (action === 'invalid-paste') {
        const r = await win.webContents.executeJavaScript(
          `window.TodoKnist.openPasted('no heading no tasks here').then(r => JSON.stringify(r))`
        );
        console.log('[paste-result]', r);
      } else if (action === 'complete-skip') {
        // click the focused task, wait for the completion popup, then skip it
        await win.webContents.executeJavaScript(
          `(() => { const row = document.querySelector('#focusView .task'); if (row) row.click(); return 'clicked'; })()`
        );
        await new Promise((res) => setTimeout(res, 3000));
        const r = await win.webContents.executeJavaScript(
          `(() => { const b = document.getElementById('skipNote'); if (b) { b.click(); return 'skipped'; } return 'no-skip'; })()`
        );
        console.log('[test-action]', 'complete-skip', r);
      }
    } catch (e) {
      console.error('[test-action] error', e.message);
    }
  }, delay);
}

// Test-only: if TODOKNIST_CAPTURE is set, wait for the renderer to settle,
// capture the window to that path, then quit when TODOKNIST_QUIT is set.
function maybeCaptureAndQuit(win) {
  const cap = process.env.TODOKNIST_CAPTURE;
  if (!cap) return;
  const delay = parseInt(process.env.TODOKNIST_CAPTURE_DELAY || '2500', 10);
  console.log('[capture] scheduled in', delay, 'ms');
  setTimeout(() => {
    console.log('[capture] firing');
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      console.log('[capture] quitting');
      if (process.env.TODOKNIST_QUIT) app.quit();
    };
    win.webContents
      .executeJavaScript(
        '(() => { const m = (id) => { const e = document.getElementById(id); if (!e) return null; const r = e.getBoundingClientRect(); return { id, x: r.x, y: r.y, w: r.width, h: r.height, visible: e.offsetParent !== null, hidden: e.hidden }; }; const ids = ["loom","body","idle","fabric","fTitle","fScroll","focusView","listView","completeView","status","progress","viewBtn","soundBtn","deco"]; return JSON.stringify(ids.map(m)); })()'
      )
      .then((measurements) => {
        console.log('[measure]', measurements);
        return win.webContents.executeJavaScript(
          '(() => { const s = (id) => { const e = document.getElementById(id); if (!e) return null; const cs = getComputedStyle(e); return { id, bg: cs.backgroundColor, color: cs.color, border: cs.borderTopColor, opacity: cs.opacity }; }; const ids = ["loom","body","fabric","status","deco","focusView"]; return JSON.stringify(ids.map(s)); })()'
        );
      })
      .then((styles) => {
        console.log('[styles]', styles);
        return win.webContents.executeJavaScript(
          `(() => {
            const cv = document.getElementById('completeView');
            const ov = document.getElementById('overlay');
            const pop = document.getElementById('popup');
            const prog = document.getElementById('progress');
            const ve = document.getElementById('viewBtn');
            return JSON.stringify({
              prog: prog ? prog.textContent : null,
              viewBtn: ve ? ve.textContent : null,
              completeVisible: cv ? !cv.hidden : false,
              allKnit: cv ? cv.querySelector('.all-knit') !== null : false,
              overlayHidden: ov ? ov.hidden : true,
              popupTitle: pop && !ov.hidden ? (pop.querySelector('h2')||{}).textContent : null,
              popupActions: pop && !ov.hidden ? Array.from(pop.querySelectorAll('button')).map(b => b.textContent) : [],
            });
          })()`
        );
      })
      .then((state) => {
        console.log('[state]', state);
        return win.webContents.capturePage();
      })
      .then((img) => {
        try {
          fs.writeFileSync(cap, img.toPNG());
          console.log('[capture] wrote', cap);
        } catch (e) {
          console.error('[capture] write failed', e.message);
        }
        finish();
      })
      .catch((e) => {
        console.error('[capture] failed', e.message);
        finish();
      });
    setTimeout(finish, 5000);
  }, delay);
}

// ---------- First-run configuration resolution ----------
// Ask the user (once) for the Obsidian vault and confirm the records dir.
// Stored in the OS-standard config dir; never hardcoded.
function ensureConfig() {
  let cfg = store.readConfig(configDir());
  if (cfg && cfg.vault !== undefined && cfg.records) {
    return cfg;
  }
  cfg = cfg || {};
  dialog.showMessageBoxSync({
    type: 'info',
    title: 'ToDoKnist setup',
    message: 'ToDoKnist needs your Obsidian vault folder.',
    detail:
      'Session notes and abort logs are appended to Journal/' +
      new Date().toISOString().slice(0, 10) +
      '.md inside your vault.\n\nPlease choose your vault folder.',
    buttons: ['OK'],
  });

  const vault = dialog.showOpenDialogSync({
    title: 'Choose your Obsidian vault folder',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: app.getPath('home'),
  });
  cfg.vault = vault && vault[0] ? vault[0] : '';

  const recDefault = defaultRecordsDir();
  const rec = dialog.showOpenDialogSync({
    title: 'Choose where to store plans (cancel for default)',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: recDefault,
    buttonLabel: 'Use this folder',
  });
  cfg.records = rec && rec[0] ? rec[0] : recDefault;

  store.writeConfig(configDir(), cfg);
  return cfg;
}

function getConfig() {
  const cfg = store.readConfig(configDir());
  if (!cfg) return { vault: '', records: defaultRecordsDir() };
  return {
    vault: cfg.vault || '',
    records: cfg.records || defaultRecordsDir(),
    activePlan: cfg.activePlan || null,
    muted: !!cfg.muted,
  };
}

function patchConfig(patch) {
  const cfg = store.readConfig(configDir()) || {};
  Object.assign(cfg, patch);
  store.writeConfig(configDir(), cfg);
  return cfg;
}

// ---------- Plan loading / toggling (parsing happens here) ----------

// Build the serialisable plan view sent to the renderer from a parsed plan and
// a per-task state list (the authoritative done/at states).
function buildPlanView(parsed, states) {
  return {
    title: parsed.title,
    tasks: parsed.tasks.map((t, i) => ({
      index: t.index,
      done: !!(states[i] && states[i].done),
      at: (states[i] && states[i].at) || null,
      text: t.text,
      section: t.section,
    })),
    sections: parsed.sections,
  };
}

// Read a stored plan, parse it, and reconcile with its sidecar (authoritative).
// Builds a sidecar from the markdown when one is missing or malformed.
// Returns { plan, parsed } where `plan` is the serialisable view for the renderer
// and `parsed` retains raw line info for the main process.
function loadPlanInto(records, fileName) {
  const markdown = store.readPlanFile(records, fileName);
  const parsed = M.parseMarkdown(markdown);
  if (!parsed.ok) throw new Error('parse-failed');

  let sidecar = store.readSidecar(records, fileName);
  const fresh =
    !sidecar ||
    !Array.isArray(sidecar.tasks) ||
    sidecar.tasks.length !== parsed.tasks.length;
  if (fresh) {
    sidecar = M.buildSidecar(store.planFilePath(records, fileName), parsed);
    store.writeSidecar(records, fileName, sidecar);
  }

  const states = parsed.tasks.map((t, i) => {
    const s = sidecar.tasks[i];
    return { done: !!(s && s.done), at: (s && s.at) || null };
  });

  return { plan: buildPlanView(parsed, states), parsed };
}

// ---------- IPC ----------

ipcMain.handle('cfg:get', () => getConfig());

ipcMain.handle('plan:openDropped', async (_e, filePath) => {
  const { records } = getConfig();
  if (!records) return { ok: false, error: 'no-records' };
  try {
    const fileName = store.saveDroppedPlan(records, filePath, new Date());
    const { plan } = loadPlanInto(records, fileName);
    return { ok: true, fileName, plan };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('plan:openPasted', async (_e, { content }) => {
  const { records } = getConfig();
  if (!records) return { ok: false, error: 'no-records' };
  try {
    const parsed = M.parseMarkdown(content);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const fileName = store.savePastedPlan(records, parsed.title, content, new Date());
    const { plan } = loadPlanInto(records, fileName);
    return { ok: true, fileName, plan };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('plan:toggle', async (_e, { fileName, index, done }) => {
  const { records } = getConfig();
  try {
    const markdown = store.readPlanFile(records, fileName);
    const parsed = M.parseMarkdown(markdown);
    if (!parsed.ok || index < 0 || index >= parsed.tasks.length) {
      return { ok: false, error: 'bad-index' };
    }
    const now = new Date();
    const lines = M.toggleTaskInLines(parsed.lines, parsed, index, done, now);
    store.writePlanFile(records, fileName, lines.join('\n'));

    let sidecar = store.readSidecar(records, fileName);
    const states =
      sidecar && Array.isArray(sidecar.tasks) && sidecar.tasks.length === parsed.tasks.length
        ? sidecar.tasks.map((t) => ({ done: !!t.done, at: t.at || null }))
        : parsed.tasks.map((t) => ({ done: !!t.done, at: t.at || null }));
    states[index] = { done: !!done, at: done ? now.toISOString() : null };

    store.writeSidecar(records, fileName, {
      planPath: store.planFilePath(records, fileName),
      indices: parsed.tasks.map((t) => t.index),
      tasks: states,
    });

    return { ok: true, plan: buildPlanView(parsed, states) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('plan:setActive', async (_e, fileName) => {
  patchConfig({ activePlan: fileName || null });
  return { ok: true };
});

ipcMain.handle('plan:loadActive', async () => {
  const { records, activePlan } = getConfig();
  if (!activePlan) return { active: false };
  // Reject a tampered config that points outside the records directory.
  if (!store.safeWithin(records, store.planFilePath(records, activePlan))) {
    patchConfig({ activePlan: null });
    return { active: false };
  }
  if (!fs.existsSync(store.planFilePath(records, activePlan))) {
    patchConfig({ activePlan: null });
    return { active: false };
  }
  try {
    const { plan } = loadPlanInto(records, activePlan);
    return { active: true, fileName: activePlan, plan };
  } catch (err) {
    return { active: false, error: err.message };
  }
});

ipcMain.handle('plan:delete', async (_e, fileName) => {
  const { records } = getConfig();
  try {
    store.deletePlanAndSidecar(records, fileName);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('vault:appendNote', async (_e, body) => {
  const { vault } = getConfig();
  return store.appendDailyNote(vault, body, new Date());
});

ipcMain.handle('cfg:setMuted', async (_e, muted) => {
  patchConfig({ muted: !!muted });
  return { ok: true };
});

ipcMain.handle('win:resize', async (_e, { width, height }) => {
  if (mainWindow) {
    mainWindow.setSize(width || 440, height);
  }
  return { ok: true };
});

ipcMain.handle('app:quit', async () => {
  app.quit();
});

// ---------- App lifecycle ----------

Menu.setApplicationMenu(null);

app.whenReady().then(() => {
  ensureConfig();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

// Open external links in the system browser (safety), never in-app.
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (url && url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });
});
