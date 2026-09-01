'use strict';

// lib/markdown.js
// Pure functions for parsing & serializing Markdown checklists.
// No Electron / no DOM dependencies so it can be unit-tested directly.

const TASK_RE = /^(\s*[-*+]\s+\[)[ xX](\].*)$/;
const HEADING1_RE = /^#\s+(.+?)\s*$/;
const HEADING2_RE = /^##\s+(.+?)\s*$/;
const TIMESTAMP_RE = /\s*\(done (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})\)\s*$/;

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Local YYYY-MM-DD HH:MM for a Date.
function formatLocal(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// Convert a local "YYYY-MM-DD HH:MM" timestamp into an ISO string.
function localStampToIso(year, month, day, hour, min) {
  const dt = new Date(year, month - 1, day, hour, min, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

// Strip a trailing "(done YYYY-MM-DD HH:MM)" marker from task text.
// Returns { text, at } where `at` is an ISO string or null.
function splitDisplayText(rawText) {
  const m = rawText.match(TIMESTAMP_RE);
  if (!m) return { text: rawText.trim(), at: null };
  const text = rawText.slice(0, m.index).trim();
  const at = localStampToIso(+m[1], +m[2], +m[3], +m[4], +m[5]);
  return { text, at };
}

// Parse a Markdown document into a plan structure.
// Returns { ok: true, title, tasks, sections, lines } or { ok: false, error }.
function parseMarkdown(md) {
  if (typeof md !== 'string') return { ok: false, error: 'not-a-string' };
  const lines = md.split(/\r?\n/);

  let title = null;
  let titleLine = -1;
  let currentSection = null; // null = no section yet
  const tasks = [];
  // sections: ordered list of { name, indices: [globalTaskIndex] }
  const sectionMap = new Map(); // name -> section object (null name uses key "\u0000")
  const NULL_KEY = '\u0000';

  function getSection(name) {
    const key = name === null ? NULL_KEY : name;
    if (!sectionMap.has(key)) {
      const sec = { name, indices: [] };
      sectionMap.set(key, sec);
      // keep insertion order via a parallel list
      sectionsOrdered.push(sec);
    }
    return sectionMap.get(key);
  }
  const sectionsOrdered = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const h1 = line.match(HEADING1_RE);
    if (h1 && title === null) {
      title = h1[1].trim();
      titleLine = i;
      continue;
    }
    // Subsequent top-level headings are treated as unrelated content (ignored).

    const h2 = line.match(HEADING2_RE);
    if (h2) {
      currentSection = h2[1].trim();
      continue;
    }

    const tm = line.match(TASK_RE);
    if (tm) {
      const marker = line[tm[1].length]; // char between [ and ]
      const done = marker === 'x' || marker === 'X';
      const afterBracket = tm[2]; // starts with ']'
      // text after the closing bracket
      const rawText = afterBracket.slice(1);
      const { text, at } = splitDisplayText(rawText);
      const sec = getSection(currentSection);
      const globalIndex = tasks.length;
      tasks.push({
        index: globalIndex,
        done,
        at,
        text,
        section: currentSection,
        line: i,
        raw: line,
      });
      sec.indices.push(globalIndex);
      continue;
    }

    // anything else: preserved content, ignored by the parser
  }

  if (title === null) return { ok: false, error: 'no-title' };
  if (tasks.length === 0) return { ok: false, error: 'no-tasks' };

  return { ok: true, title, titleLine, tasks, sections: sectionsOrdered, lines };
}

// Produce a new line string for a task, setting it done/undone.
// `task` is a parsed task object (uses task.raw / task.line is not needed here).
function setTaskLineState(rawLine, done, now) {
  const m = rawLine.match(TASK_RE);
  if (!m) return rawLine; // not a task line; leave untouched (safe)
  const prefix = m[1]; // up to and including '['
  let rest = m[2]; // from ']' onward
  // remove any existing trailing timestamp
  rest = rest.replace(TIMESTAMP_RE, '');
  if (done) {
    const ts = formatLocal(now);
    return `${prefix}x${rest} (done ${ts})`;
  }
  return `${prefix} ${rest}`;
}

// Apply a toggle to the lines array (immutably) for a given global task index.
// Returns a new lines array. `plan` must be a successful parseMarkdown result.
function toggleTaskInLines(lines, plan, taskIndex, makeDone, now) {
  const task = plan.tasks[taskIndex];
  if (!task) return lines.slice();
  const next = lines.slice();
  next[task.line] = setTaskLineState(task.raw, makeDone, now);
  return next;
}

// Build the sidecar progress object from a parsed plan.
// `doneStates` is an optional map of globalIndex -> { done, at } used when
// overlaying an existing sidecar (sidecar is authoritative on reopen).
function buildSidecar(planPath, plan, doneStates) {
  const tasks = plan.tasks.map((t, i) => {
    const override = doneStates && doneStates[i];
    if (override) {
      return { done: !!override.done, at: override.at || null };
    }
    return { done: !!t.done, at: t.at || null };
  });
  return {
    planPath,
    indices: plan.tasks.map((t) => t.index),
    tasks,
  };
}

// Count done tasks in a sidecar or plan.
function countDone(sidecarOrPlan) {
  if (!sidecarOrPlan || !Array.isArray(sidecarOrPlan.tasks)) return 0;
  return sidecarOrPlan.tasks.filter((t) => t.done).length;
}

module.exports = {
  TASK_RE,
  parseMarkdown,
  setTaskLineState,
  toggleTaskInLines,
  buildSidecar,
  countDone,
  formatLocal,
  localStampToIso,
  splitDisplayText,
  pad2,
};
