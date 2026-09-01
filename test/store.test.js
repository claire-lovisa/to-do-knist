'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const S = require('../lib/store.js');

function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'todoknist-'));
  return dir;
}

test('config read/write round-trip, missing -> null, malformed -> null', () => {
  const dir = path.join(tmpRoot(), 'cfg');
  assert.equal(S.readConfig(dir), null);
  S.writeConfig(dir, { vault: '/v', records: '/r' });
  assert.deepEqual(S.readConfig(dir), { vault: '/v', records: '/r' });
  // corrupt it
  fs.writeFileSync(S.configFilePath(dir), '{ not json', 'utf8');
  assert.equal(S.readConfig(dir), null);
});

test('saveDroppedPlan copies without touching original and handles collisions', () => {
  const records = path.join(tmpRoot(), 'records');
  const srcDir = path.join(tmpRoot(), 'src');
  S.ensureDir(srcDir);
  const src = path.join(srcDir, 'plan.md');
  fs.writeFileSync(src, '# Plan\n- [ ] a\n', 'utf8');

  const name1 = S.saveDroppedPlan(records, src, new Date(2026, 7, 31, 9, 30, 5));
  assert.equal(name1, 'plan.md');
  assert.equal(fs.readFileSync(src, 'utf8'), '# Plan\n- [ ] a\n'); // untouched
  assert.equal(fs.readFileSync(path.join(records, name1), 'utf8'), '# Plan\n- [ ] a\n');

  // second drop collides -> timestamp suffix
  const name2 = S.saveDroppedPlan(records, src, new Date(2026, 7, 31, 9, 30, 5));
  assert.match(name2, /^plan-20260831-093005(-\d+)?\.md$/);
  assert.notEqual(name1, name2);
});

test('savePastedPlan slugifies title, falls back to plan-<ts>, avoids collisions', () => {
  const records = path.join(tmpRoot(), 'records');
  const now = new Date(2026, 7, 31, 9, 30, 12);
  const n1 = S.savePastedPlan(records, 'My Cool Plan!', '# My Cool Plan!\n- [ ] a\n', now);
  assert.equal(n1, 'my-cool-plan.md');

  // same title collision -> timestamp suffix
  const n2 = S.savePastedPlan(records, 'My Cool Plan!', '...', now);
  assert.match(n2, /^my-cool-plan-20260831-093012(-\d+)?\.md$/);

  // empty title fallback
  const n3 = S.savePastedPlan(records, '   !!!   ', '# !!!\n- [ ] a\n', now);
  assert.match(n3, /^plan-20260831-093012\.md$/);
});

test('sidecar round-trip + deletePlanAndSidecar', () => {
  const records = path.join(tmpRoot(), 'records');
  const plan = 'demo.md';
  S.writePlanFile(records, plan, '# Demo\n- [ ] a\n');
  S.writeSidecar(records, plan, { planPath: '/x', indices: [0], tasks: [{ done: true, at: 'iso' }] });
  const sc = S.readSidecar(records, plan);
  assert.equal(sc.tasks[0].done, true);
  assert.equal(S.sidecarNameFor(plan), 'demo.progress.json');
  S.deletePlanAndSidecar(records, plan);
  assert.equal(fs.existsSync(path.join(records, plan)), false);
  assert.equal(fs.existsSync(path.join(records, S.sidecarNameFor(plan))), false);
});

test('deletePlanAndSidecar refuses path traversal', () => {
  const records = path.join(tmpRoot(), 'records');
  S.writePlanFile(records, 'keep.md', '# keep\n');
  assert.throws(() => S.deletePlanAndSidecar(records, '../escape.md'), /path-escape/);
  assert.ok(fs.existsSync(path.join(records, 'keep.md')));
});

test('appendDailyNote creates Journal + note, appends only, preserves content', () => {
  const vault = path.join(tmpRoot(), 'vault');
  S.ensureDir(vault);
  const now = new Date(2026, 7, 31, 9, 30);
  const r1 = S.appendDailyNote(vault, '**session note (2026-08-31 09:30):** learned stuff', now);
  assert.equal(r1.ok, true);
  const note = S.dailyNotePath(vault, now);
  const c1 = fs.readFileSync(note, 'utf8');
  assert.match(c1, /---\n\*\*session note/);

  // pre-existing content is preserved on a second append
  fs.writeFileSync(note, 'EXISTING HEADER\n\n', 'utf8');
  const r2 = S.appendDailyNote(vault, '**aborted plan (2026-08-31 09:30):** demo — 1/2 tasks done', now);
  assert.equal(r2.ok, true);
  const c2 = fs.readFileSync(note, 'utf8');
  assert.ok(c2.startsWith('EXISTING HEADER'));
  assert.match(c2, /---\n\*\*aborted plan/);
  assert.match(c2, /1\/2 tasks done/);
});

test('appendDailyNote handles missing vault gracefully', () => {
  const r = S.appendDailyNote('/no/such/place/here', 'body', new Date(2026, 7, 31));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'vault-missing');
});
