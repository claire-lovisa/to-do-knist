'use strict';

// lib/store.js
// Filesystem operations for config, the records directory (plans + sidecars),
// and append-only Obsidian daily-note logging. Electron-free & synchronous so
// it can be unit-tested with a throwaway temp directory.

const fs = require('fs');
const path = require('path');
const { pad2, formatLocal } = require('./markdown.js');

function todayStamp(now) {
  now = now || new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

// Reuse markdown.js's local-date formatter so there is a single source of truth
// for the "YYYY-MM-DD HH:MM" timestamp used in plan text and daily-note entries.
function localStamp(now) {
  return formatLocal(now || new Date());
}

function compactStamp(now) {
  now = now || new Date();
  return `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeWithin(parent, child) {
  const p = path.resolve(parent);
  const c = path.resolve(child);
  return c === p || c.startsWith(p + path.sep);
}

// ---------- Config ----------

function configFilePath(configDir) {
  return path.join(configDir, 'config.json');
}

function readConfig(configDir) {
  try {
    const raw = fs.readFileSync(configFilePath(configDir), 'utf8');
    const cfg = JSON.parse(raw);
    if (!cfg || typeof cfg !== 'object') return null;
    return cfg;
  } catch (e) {
    return null; // missing or malformed -> handled by caller
  }
}

function writeConfig(configDir, cfg) {
  ensureDir(configDir);
  const tmp = configFilePath(configDir) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, configFilePath(configDir));
}

// ---------- Records (plans + sidecars) ----------

function sidecarNameFor(planFileName) {
  const base = planFileName.replace(/\.md$/i, '');
  return `${base}.progress.json`;
}

function planFilePath(recordsDir, planFileName) {
  return path.join(recordsDir, planFileName);
}

function sidecarFilePath(recordsDir, planFileName) {
  return path.join(recordsDir, sidecarNameFor(planFileName));
}

// Pick a non-colliding file name inside recordsDir, adding a compact timestamp
// suffix (and a counter if still colliding) when the desired name exists.
function uniquePlanFileName(recordsDir, baseName, ext, now) {
  ext = ext.startsWith('.') ? ext : `.${ext}`;
  const first = `${baseName}${ext}`;
  if (!fs.existsSync(path.join(recordsDir, first))) return first;
  let candidate = `${baseName}-${compactStamp(now)}${ext}`;
  if (!fs.existsSync(path.join(recordsDir, candidate))) return candidate;
  let n = 1;
  for (;;) {
    candidate = `${baseName}-${compactStamp(now)}-${n}${ext}`;
    if (!fs.existsSync(path.join(recordsDir, candidate))) return candidate;
    n++;
  }
}

function slugify(title) {
  const s = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || null;
}

// Copy an externally-dropped .md file into the records dir, never touching the
// original. Returns the chosen plan file name.
function saveDroppedPlan(recordsDir, srcPath, now) {
  ensureDir(recordsDir);
  now = now || new Date();
  const base = path.basename(srcPath).replace(/\.md$/i, '') || `plan-${compactStamp(now)}`;
  const fileName = uniquePlanFileName(recordsDir, base, '.md', now);
  const dest = planFilePath(recordsDir, fileName);
  if (!safeWithin(recordsDir, dest)) throw new Error('path-escape');
  fs.copyFileSync(srcPath, dest);
  return fileName;
}

// Save a pasted plan. Filename is slugified from the title, falling back to
// plan-<timestamp>.md, avoiding collisions. Returns the chosen plan file name.
function savePastedPlan(recordsDir, title, content, now) {
  ensureDir(recordsDir);
  now = now || new Date();
  const base = slugify(title) || `plan-${compactStamp(now)}`;
  const fileName = uniquePlanFileName(recordsDir, base, '.md', now);
  const dest = planFilePath(recordsDir, fileName);
  if (!safeWithin(recordsDir, dest)) throw new Error('path-escape');
  fs.writeFileSync(dest, content, 'utf8');
  return fileName;
}

function readPlanFile(recordsDir, planFileName) {
  const p = planFilePath(recordsDir, planFileName);
  if (!safeWithin(recordsDir, p)) throw new Error('path-escape');
  return fs.readFileSync(p, 'utf8');
}

function writePlanFile(recordsDir, planFileName, content) {
  ensureDir(recordsDir);
  const p = planFilePath(recordsDir, planFileName);
  if (!safeWithin(recordsDir, p)) throw new Error('path-escape');
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, p);
}

function readSidecar(recordsDir, planFileName) {
  try {
    const p = sidecarFilePath(recordsDir, planFileName);
    if (!fs.existsSync(p)) return null;
    if (!safeWithin(recordsDir, p)) throw new Error('path-escape');
    const raw = fs.readFileSync(p, 'utf8');
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    return obj;
  } catch (e) {
    return null; // malformed sidecar -> caller falls back to plan text
  }
}

function writeSidecar(recordsDir, planFileName, sidecarObj) {
  const p = sidecarFilePath(recordsDir, planFileName);
  if (!safeWithin(recordsDir, p)) throw new Error('path-escape');
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(sidecarObj, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

// Delete only the stored plan and its matching sidecar. Refuses anything that
// would escape the records directory.
function deletePlanAndSidecar(recordsDir, planFileName) {
  const md = planFilePath(recordsDir, planFileName);
  const sc = sidecarFilePath(recordsDir, planFileName);
  if (!safeWithin(recordsDir, md) || !safeWithin(recordsDir, sc)) {
    throw new Error('path-escape');
  }
  try { if (fs.existsSync(md)) fs.unlinkSync(md); } catch (e) { /* ignore */ }
  try { if (fs.existsSync(sc)) fs.unlinkSync(sc); } catch (e) { /* ignore */ }
}

// List plans (with a .md sibling present) in the records dir.
function listPlans(recordsDir) {
  try {
    if (!fs.existsSync(recordsDir)) return [];
    return fs
      .readdirSync(recordsDir)
      .filter((f) => f.toLowerCase().endsWith('.md'))
      .map((f) => ({ fileName: f, sidecar: sidecarNameFor(f) }));
  } catch (e) {
    return [];
  }
}

// ---------- Obsidian daily-note logging (append only) ----------

function dailyNotePath(vaultPath, now) {
  return path.join(vaultPath, 'Journal', `${todayStamp(now)}.md`);
}

// Append an entry to today's daily note. `body` is the text that follows the
// horizontal rule. Never deletes or rewrites existing content; only appends.
// Returns { ok: true } or { ok: false, error }.
function appendDailyNote(vaultPath, body, now) {
  now = now || new Date();
  try {
    if (!vaultPath || typeof vaultPath !== 'string') {
      return { ok: false, error: 'no-vault' };
    }
    if (!fs.existsSync(vaultPath) || !fs.statSync(vaultPath).isDirectory()) {
      return { ok: false, error: 'vault-missing' };
    }
    const journalDir = path.join(vaultPath, 'Journal');
    ensureDir(journalDir);
    const note = dailyNotePath(vaultPath, now);
    let existing = '';
    try {
      existing = fs.readFileSync(note, 'utf8');
    } catch (e) {
      existing = ''; // note does not exist yet -> create
    }
    const sep = existing && !existing.endsWith('\n') ? '\n' : '';
    const block = `${sep}---\n${body}\n`;
    fs.appendFileSync(note, block, 'utf8');
    return { ok: true, path: note };
  } catch (e) {
    return { ok: false, error: e.code || 'write-failed' };
  }
}

module.exports = {
  pad2,
  todayStamp,
  localStamp,
  compactStamp,
  ensureDir,
  safeWithin,
  configFilePath,
  readConfig,
  writeConfig,
  sidecarNameFor,
  planFilePath,
  sidecarFilePath,
  uniquePlanFileName,
  slugify,
  saveDroppedPlan,
  savePastedPlan,
  readPlanFile,
  writePlanFile,
  readSidecar,
  writeSidecar,
  deletePlanAndSidecar,
  listPlans,
  dailyNotePath,
  appendDailyNote,
};
