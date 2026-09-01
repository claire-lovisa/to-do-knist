'use strict';

/* ToDoKnist renderer — pixel-art knitting loom behaviour. */

const API = window.TodoKnist;

// Test-only: disable knit animation for headless verification.
const NO_ANIM = (() => {
  try { return window.__TODOKNIST_NO_ANIM === true; } catch (e) { return false; }
})();

const el = {
  app: document.getElementById('app'),
  column: document.getElementById('column'),
  loom: document.getElementById('loom'),
  body: document.getElementById('body'),
  idle: document.getElementById('idle'),
  idleLine: document.querySelector('#idle .idle-line span'),
  idleHint: document.querySelector('#idle .idle-hint'),
  fabric: document.getElementById('fabric'),
  fTitle: document.getElementById('fTitle'),
  fDivider: document.querySelector('#fabric .fabric-divider'),
  fScroll: document.getElementById('fScroll'),
  focusView: document.getElementById('focusView'),
  listView: document.getElementById('listView'),
  completeView: document.getElementById('completeView'),
  progress: document.getElementById('progress'),
  viewBtn: document.getElementById('viewBtn'),
  soundBtn: document.getElementById('soundBtn'),
  fxLayer: document.getElementById('fxLayer'),
  overlay: document.getElementById('overlay'),
  popup: document.getElementById('popup'),
  vaultErr: document.getElementById('vaultErr'),
};

const state = {
  fileName: null,
  plan: null,        // { title, tasks:[{index,done,at,text,section}], sections:[{name,indices}] }
  mode: 'focus',     // 'focus' | 'list'
  muted: false,
  completed: false,  // all tasks done (celebration triggered once)
  busy: false,       // ignore interaction during animations
  celebrating: false,
};

const FOCUSED_H = 320;
const LIST_H = 560;
const WIDTH = 440;

const CONFETTI_COLORS = ['#C1443C', '#F5EDE0', '#2A9D8F', '#E9B824', '#FF8080', '#FFD700'];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function localStamp(d) {
  d = d || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function allDone(plan) {
  return plan && plan.tasks.length > 0 && plan.tasks.every((t) => t.done);
}
function countDone(plan) {
  return plan ? plan.tasks.filter((t) => t.done).length : 0;
}
function focusedIndex() {
  if (!state.plan) return -1;
  return state.plan.tasks.findIndex((t) => !t.done);
}

/* ---------------- Sound (lazy Web Audio square waves) ---------------- */
const Sound = {
  ctx: null,
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  beep(freq, dur, delay, gain) {
    if (state.muted || !this.ctx) return;
    const t = this.ctx.currentTime + (delay || 0);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(gain || 0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur);
  },
  clack() { this.beep(300 + Math.random() * 150, 0.045, 0, 0.04); },
  check() { this.beep(700, 0.05, 0, 0.05); this.beep(950, 0.06, 0.07, 0.05); },
  uncheck() { this.beep(350, 0.06, 0, 0.05); },
  complete() { [880, 1100, 1320, 1760].forEach((f, i) => this.beep(f, 0.12, i * 0.13, 0.06)); },
};

/* ---------------- FX: sparkles & confetti ---------------- */
function emitSparkles(anchor) {
  const rect = anchor.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  for (let i = 0; i < 6; i++) {
    const s = document.createElement('div');
    s.className = 'sparkle';
    s.style.left = cx + 'px';
    s.style.top = cy + 'px';
    s.style.background = i % 2 ? '#E9B824' : '#F5EDE0';
    el.fxLayer.appendChild(s);
    const ang = (Math.PI * 2 * i) / 6 + Math.random() * 0.5;
    const dist = 14 + Math.random() * 10;
    s.animate(
      [
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: `translate(${Math.cos(ang) * dist}px, ${Math.sin(ang) * dist}px) scale(0)`, opacity: 0 },
      ],
      { duration: 320, easing: 'steps(4)' }
    ).onfinish = () => s.remove();
  }
}

function dropConfetti() {
  const rect = el.fabric.getBoundingClientRect();
  for (let i = 0; i < 40; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    c.style.left = rect.left + 20 + Math.random() * (rect.width - 40) + 'px';
    c.style.top = rect.top + 10 + 'px';
    el.fxLayer.appendChild(c);
    const dx = (Math.random() - 0.5) * 160;
    const dy = 220 + Math.random() * 220;
    const rot = (Math.random() - 0.5) * 720;
    c.animate(
      [
        { transform: 'translate(0,0) rotate(0)', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg)`, opacity: 0 },
      ],
      { duration: 1400 + Math.random() * 600, easing: 'steps(10)' }
    ).onfinish = () => c.remove();
  }
}

/* ---------------- Rendering ---------------- */
function renderTitle() {
  const t = state.plan ? state.plan.title : '';
  el.fTitle.innerHTML =
    `<span class="fdots">···</span><span class="ftext">${escapeHtml(t)}</span><span class="fdots">···</span>`;
}

function taskRow(task) {
  const row = document.createElement('div');
  row.className = 'task' + (task.done ? ' done' : '');
  row.dataset.index = String(task.index);
  row.innerHTML = `<div class="marker"></div><div class="label">${escapeHtml(task.text)}</div>`;
  return row;
}

function sectionBlock(sec) {
  const wrap = document.createElement('div');
  if (sec.name) {
    const label = document.createElement('div');
    label.className = 'section-label';
    const allComplete = sec.indices.length > 0 && sec.indices.every((i) => state.plan.tasks[i].done);
    label.innerHTML = escapeHtml(sec.name) + (allComplete ? ' <span class="stamp">knt!</span>' : '');
    wrap.appendChild(label);
  }
  for (const i of sec.indices) {
    wrap.appendChild(taskRow(state.plan.tasks[i]));
  }
  return wrap;
}

function renderFocus() {
  el.focusView.hidden = false;
  el.listView.hidden = true;
  el.completeView.hidden = true;
  el.focusView.innerHTML = '';
  const fi = focusedIndex();
  if (fi < 0) return;
  const task = state.plan.tasks[fi];
  if (task.section) {
    const label = document.createElement('div');
    label.className = 'section-label';
    label.textContent = task.section;
    el.focusView.appendChild(label);
  }
  const row = taskRow(task);
  el.focusView.appendChild(row);
  const remaining = state.plan.tasks.filter((t) => !t.done).length;
  if (remaining > 1) {
    const hint = document.createElement('div');
    hint.className = 'focus-hint';
    hint.textContent = `\u2193 ${remaining - 1} more \u2014 tap + for full list`;
    el.focusView.appendChild(hint);
  }
}

function renderList() {
  el.focusView.hidden = true;
  el.listView.hidden = false;
  el.completeView.hidden = true;
  el.listView.innerHTML = '';
  for (const sec of state.plan.sections) {
    el.listView.appendChild(sectionBlock(sec));
  }
}

function renderComplete() {
  el.focusView.hidden = true;
  el.listView.hidden = true;
  el.completeView.hidden = false;
}

function renderContent() {
  renderTitle();
  if (state.mode === 'list') {
    renderList();
  } else if (allDone(state.plan)) {
    renderComplete();
  } else {
    renderFocus();
  }
}

function updateProgress() {
  if (!state.plan) { el.progress.textContent = '0/0 done'; return; }
  el.progress.textContent = `${countDone(state.plan)}/${state.plan.tasks.length} done`;
}

/* ---------------- Fabric knit animation ---------------- */
function cap() { return state.mode === 'focus' ? 220 : 440; }

function setFabricHeight(px) { el.fabric.style.height = px + 'px'; }

function measureTarget() {
  const prev = el.fabric.style.height;
  el.fabric.style.height = 'auto';
  el.fabric.style.overflow = 'hidden';
  const h = el.fabric.scrollHeight;
  el.fabric.style.height = prev;
  return Math.max(90, Math.min(h, cap()));
}

async function knitFabric() {
  if (state.completed) { setFabricHeightAuto(); return; }
  el.fabric.style.overflow = 'hidden';
  setFabricHeight(0);
  const target = measureTarget();
  setFabricHeight(0);
  // hide lines until revealed
  const lines = [el.fTitle, el.fDivider, el.fScroll].filter(Boolean);
  lines.forEach((l) => (l.style.opacity = '0'));

  // 4-stage decreasing reveal: hidden 100% -> 60% -> 20% -> 0%
  const stages = [1.0, 0.6, 0.2, 0.0];
  let prevHidden = 1.0;
  const subSteps = 5;
  const stepMs = 95;
  for (const endHidden of stages) {
    for (let s = 1; s <= subSteps; s++) {
      await wait(stepMs);
      const hidden = prevHidden + (endHidden - prevHidden) * (s / subSteps);
      const px = Math.round((1 - hidden) * target);
      setFabricHeight(px);
      Sound.clack();
      revealUpTo(px);
    }
    prevHidden = endHidden;
  }
  setFabricHeightAuto();
  lines.forEach((l) => (l.style.opacity = ''));
  el.fabric.style.overflow = '';
}

function revealUpTo(px) {
  const kids = [el.fTitle, el.fDivider, el.fScroll].filter(Boolean);
  let acc = 0;
  for (const k of kids) {
    acc += k.offsetHeight;
    if (acc <= px) k.style.opacity = '';
  }
}

function setFabricHeightAuto() {
  el.fabric.style.height = '';
  el.fabric.style.overflow = '';
}

async function knitDown() {
  el.fabric.style.overflow = 'hidden';
  const start = el.fabric.offsetHeight;
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await wait(70);
    const px = Math.round(start * (1 - i / steps));
    setFabricHeight(px);
    Sound.clack();
  }
  setFabricHeight(0);
  el.fabric.style.overflow = '';
}

/* ---------------- Plan presentation ---------------- */
function showIdle() {
  state.fileName = null;
  state.plan = null;
  state.completed = false;
  state.mode = 'focus';
  el.body.classList.remove('list');
  el.body.classList.remove('loaded');
  el.idle.hidden = false;
  el.fabric.hidden = true;
  el.focusView.hidden = true;
  el.listView.hidden = true;
  el.completeView.hidden = true;
  el.viewBtn.textContent = '+';
  el.viewBtn.title = 'Show full list';
  updateProgress();
  API.resize(WIDTH, FOCUSED_H);
}

async function presentPlan(fileName, plan, opts) {
  opts = opts || {};
  state.fileName = fileName;
  state.plan = plan;
  state.completed = allDone(plan);
  state.mode = 'focus';
  el.body.classList.remove('list');
  el.body.classList.add('loaded');
  el.idle.hidden = true;
  el.fabric.hidden = false;
  el.viewBtn.textContent = '+';
  el.viewBtn.title = 'Show full list';
  renderContent();
  updateProgress();
  await API.setActive(fileName);
  API.resize(WIDTH, FOCUSED_H);
  if (state.completed) {
    // restoring an already-completed plan: no animation, no celebration, no popup
    setFabricHeightAuto();
  } else if (opts.animate !== false) {
    state.busy = true;
    await knitFabric();
    state.busy = false;
  } else {
    setFabricHeightAuto();
  }
}

/* ---------------- Toggling a task ---------------- */
async function onTaskClick(index) {
  if (state.busy || !state.plan) return;
  const task = state.plan.tasks[index];
  if (!task) return;
  const newDone = !task.done;
  state.busy = true;
  Sound.ensure();

  try {
    const res = await API.toggle(state.fileName, index, newDone);
    if (!res.ok) return;
    state.plan = res.plan;

    const row = state.mode === 'focus' ? el.focusView.querySelector('.task') : el.listView.querySelector(`.task[data-index="${index}"]`);

    if (newDone) {
      if (row) { row.classList.add('done', 'checking'); }
      Sound.check();
      if (row) emitSparkles(row);
      await wait(750);
      if (state.mode === 'focus') {
        if (row) { row.classList.add('fading'); }
        await wait(240);
        renderFocus();
        const next = el.focusView.querySelector('.task');
        if (next) next.classList.add('focused');
      } else {
        renderList();
      }
    } else {
      Sound.uncheck();
      if (state.mode === 'focus') renderFocus(); else renderList();
    }

    updateProgress();

    if (newDone && allDone(state.plan) && !state.completed) {
      state.completed = true;
      await completePlan();
    } else if (!newDone) {
      state.completed = false;
    }
  } finally {
    state.busy = false;
  }
}

/* ---------------- Completion ---------------- */
async function completePlan() {
  state.celebrating = true;
  renderComplete();
  Sound.complete();
  dropConfetti();
  await wait(1600);
  state.celebrating = false;
  // The user may have unchecked a task during the celebration; only ask for a
  // note if the plan is still fully done.
  if (allDone(state.plan)) showCompletionPopup();
}

function showCompletionPopup() {
  el.popup.innerHTML = `
    <h2>&#10003; plan complete</h2>
    <p>add a session note?</p>
    <textarea id="noteArea" placeholder="what did you learn? what was hard?"></textarea>
    <div class="popup-actions">
      <button class="primary" id="saveNew">save + new plan</button>
      <button id="skipNote">skip</button>
    </div>`;
  el.overlay.hidden = false;
  const ta = document.getElementById('noteArea');
  setTimeout(() => ta && ta.focus(), 30);

  document.getElementById('saveNew').onclick = async () => {
    const note = (ta.value || '').trim();
    if (note) {
      const body = `**session note (${localStamp()}):** ${note.replace(/\s+/g, ' ')}`;
      const r = await API.appendNote(body);
      if (!r.ok) showVaultErr('could not write daily note: ' + (r.error || ''));
    }
    el.overlay.hidden = true;
    await resetToIdle();
  };
  document.getElementById('skipNote').onclick = async () => {
    el.overlay.hidden = true;
    await resetToIdle();
  };
}

/* ---------------- Abort (Ctrl+C) ---------------- */
function showAbortPopup() {
  const done = countDone(state.plan);
  const total = state.plan.tasks.length;
  el.popup.innerHTML = `
    <h2>&#10005; abort plan?</h2>
    <p>log your progress or delete this plan?</p>
    <div class="popup-actions">
      <button class="primary" id="abortLog">log it</button>
      <button id="abortDiscard">discard</button>
      <button id="abortCancel">cancel</button>
    </div>`;
  el.overlay.hidden = false;

  document.getElementById('abortLog').onclick = async () => {
    const body = `**aborted plan (${localStamp()}):** ${state.plan.title} — ${done}/${total} tasks done`;
    const r = await API.appendNote(body);
    if (!r.ok) showVaultErr('could not write daily note: ' + (r.error || ''));
    el.overlay.hidden = true;
    await API.setActive(null);
    await resetToIdle();
  };
  document.getElementById('abortDiscard').onclick = async () => {
    await API.deletePlan(state.fileName);
    await API.setActive(null);
    el.overlay.hidden = true;
    await resetToIdle();
  };
  document.getElementById('abortCancel').onclick = () => {
    el.overlay.hidden = true;
  };
}

async function resetToIdle() {
  if (state.plan) {
    await knitDown();
  }
  await API.setActive(null);
  showIdle();
}

/* ---------------- Mode toggle ---------------- */
async function toggleMode() {
  if (!state.plan || state.busy) return;
  if (state.mode === 'focus') {
    state.mode = 'list';
    el.body.classList.add('list');
    el.viewBtn.textContent = '\u002A';
    el.viewBtn.title = 'Focus mode';
    API.resize(WIDTH, LIST_H);
    renderContent();
    setFabricHeightAuto();
  } else {
    state.mode = 'focus';
    el.body.classList.remove('list');
    el.viewBtn.textContent = '+';
    el.viewBtn.title = 'Show full list';
    API.resize(WIDTH, FOCUSED_H);
    renderContent();
    setFabricHeightAuto();
  }
}

/* ---------------- Sound toggle ---------------- */
function updateSoundBtn() {
  if (state.muted) {
    el.soundBtn.textContent = '\u2715';
    el.soundBtn.title = 'Sound muted';
  } else {
    el.soundBtn.textContent = '\u266A';
    el.soundBtn.title = 'Sound on';
  }
}
async function toggleSound() {
  state.muted = !state.muted;
  updateSoundBtn();
  API.setMuted(state.muted);
  if (!state.muted) { Sound.ensure(); Sound.clack(); }
}

/* ---------------- Import: drop / paste ---------------- */
async function importDroppedFile(file) {
  if (!file) return;
  if (!/\.md$/i.test(file.name)) return;
  Sound.ensure();
  const filePath = API.pathForFile(file);
  const res = await API.openDropped(filePath);
  if (!res.ok) { showInputError(); return; }
  await presentPlan(res.fileName, res.plan, { animate: true });
}

async function importPastedText(text) {
  if (!text || !text.trim()) return;
  Sound.ensure();
  const res = await API.openPasted(text);
  if (!res.ok) { showInputError(); return; }
  await presentPlan(res.fileName, res.plan, { animate: true });
}

function showInputError() {
  el.loom.classList.remove('shake');
  void el.loom.offsetWidth;
  el.loom.classList.add('shake');
  setTimeout(() => el.loom.classList.remove('shake'), 1600);
  // Only swap to the error/idle surface when nothing is loaded yet; if a plan
  // is already on the loom, a failed import just shakes the needles and leaves
  // the current plan in place.
  if (state.plan) return;
  el.idle.hidden = false;
  el.body.classList.remove('loaded');
  el.fabric.hidden = true;
  el.idleLine.textContent = "couldn't read this plan :(";
  setTimeout(() => {
    if (!state.plan) el.idleLine.textContent = 'knit your plan...';
  }, 1600);
}

function showVaultErr(msg) {
  el.vaultErr.textContent = msg;
  el.vaultErr.hidden = false;
  clearTimeout(showVaultErr._t);
  showVaultErr._t = setTimeout(() => (el.vaultErr.hidden = true), 3500);
}

/* ---------------- Event wiring ---------------- */
function isInInput(t) {
  return t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable);
}

function bindEvents() {
  // task clicks (delegated)
  const clickTarget = el.fabric;
  clickTarget.addEventListener('click', (e) => {
    const row = e.target.closest('.task');
    if (!row) return;
    onTaskClick(Number(row.dataset.index));
  });

  el.viewBtn.addEventListener('click', toggleMode);
  el.soundBtn.addEventListener('click', toggleSound);

  // drag & drop — listeners on document so drops work anywhere on the window
  // (the body was previously a window-drag region which swallowed DnD events).
  let dragDepth = 0;
  document.addEventListener('dragenter', (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
      e.preventDefault();
      dragDepth++;
      el.body.classList.add('drag-over');
    }
  });
  document.addEventListener('dragover', (e) => {
    // prevent the browser from opening the file itself
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  document.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) el.body.classList.remove('drag-over');
  });
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    el.body.classList.remove('drag-over');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) await importDroppedFile(file);
  });

  // keyboard: abort (Ctrl+C) and Escape. Paste is handled by the native
  // 'paste' event below, so we do not touch Ctrl+V here (doing both would
  // import the same plan twice).
  document.addEventListener('keydown', (e) => {
    // abort (Ctrl+C) when not in an input
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && !isInInput(e.target) && state.fileName && el.overlay.hidden) {
      e.preventDefault();
      showAbortPopup();
    }
    if (e.key === 'Escape' && !el.overlay.hidden) {
      el.overlay.hidden = true;
    }
  });

  // paste (Ctrl+V) when not in an input
  document.addEventListener('paste', (e) => {
    if (isInInput(e.target)) return;
    const text = e.clipboardData && e.clipboardData.getData('text/plain');
    if (text) { e.preventDefault(); importPastedText(text); }
  });

  // resume audio on first gesture
  const wake = () => Sound.ensure();
  document.addEventListener('mousedown', wake, { once: true });
  document.addEventListener('keydown', wake, { once: true });
}

/* ---------------- Init ---------------- */
async function init() {
  bindEvents();
  const cfg = await API.getConfig();
  state.muted = !!cfg.muted;
  updateSoundBtn();

  const active = await API.loadActive();
  if (active.active && active.plan) {
    await presentPlan(active.fileName, active.plan, { animate: !NO_ANIM });
  } else {
    showIdle();
  }
}

window.addEventListener('DOMContentLoaded', init);
