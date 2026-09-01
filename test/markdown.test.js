'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const M = require('../lib/markdown.js');

test('parse: title + tasks in sections and without section', () => {
  const md = `# Plan title

- [ ] No section task

## Section A
- [ ] Task one
- [x] Done task (done 2026-08-31 09:05)
`;
  const p = M.parseMarkdown(md);
  assert.equal(p.ok, true);
  assert.equal(p.title, 'Plan title');
  assert.equal(p.tasks.length, 3);
  assert.equal(p.tasks[0].text, 'No section task');
  assert.equal(p.tasks[0].section, null);
  assert.equal(p.tasks[1].text, 'Task one');
  assert.equal(p.tasks[1].done, false);
  assert.equal(p.tasks[1].section, 'Section A');
  assert.equal(p.tasks[2].done, true);
  assert.equal(p.tasks[2].text, 'Done task'); // timestamp stripped
  assert.ok(p.tasks[2].at); // ISO present
  assert.equal(p.tasks[2].section, 'Section A');
});

test('parse: accepts - [X] uppercase', () => {
  const p = M.parseMarkdown('# T\n- [X] did it\n');
  assert.equal(p.ok, true);
  assert.equal(p.tasks[0].done, true);
  assert.equal(p.tasks[0].text, 'did it');
});

test('parse: requires title', () => {
  assert.equal(M.parseMarkdown('- [ ] only task').ok, false);
});

test('parse: requires at least one task', () => {
  assert.equal(M.parseMarkdown('# Title only').ok, false);
});

test('parse: ignores unrelated markdown', () => {
  const md = `# Title
Some prose paragraph.
> a quote

- [ ] real task
`;
  const p = M.parseMarkdown(md);
  assert.equal(p.ok, true);
  assert.equal(p.tasks.length, 1);
  assert.equal(p.tasks[0].text, 'real task');
});

test('toggle: check appends timestamp, uncheck removes it, preserves other content', () => {
  const md = `# Title

## Section
- [ ] Task one
some preserved prose line
- [x] Task two (done 2026-01-02 03:04)
`;
  const p = M.parseMarkdown(md);
  const now = new Date(2026, 7, 31, 9, 30); // local 2026-08-31 09:30
  let lines = p.lines.slice();

  // check task 0
  lines = M.toggleTaskInLines(lines, p, 0, true, now);
  assert.match(lines[3], /^- \[x\] Task one \(done 2026-08-31 09:30\)$/);
  // preserved line untouched
  assert.equal(lines[4], 'some preserved prose line');
  // uncheck task 1
  lines = M.toggleTaskInLines(lines, p, 1, false, now);
  assert.equal(lines[5], '- [ ] Task two');
});

test('buildSidecar + countDone', () => {
  const md = `# Title
- [ ] a
- [x] b (done 2026-05-05 10:00)
`;
  const p = M.parseMarkdown(md);
  const sc = M.buildSidecar('/records/title.md', p);
  assert.equal(sc.indices.length, 2);
  assert.equal(sc.tasks[0].done, false);
  assert.equal(sc.tasks[0].at, null);
  assert.equal(sc.tasks[1].done, true);
  assert.ok(sc.tasks[1].at);
  assert.equal(M.countDone(sc), 1);

  // overlay authoritative states
  const sc2 = M.buildSidecar('/records/title.md', p, {
    0: { done: true, at: '2026-08-31T00:00:00.000Z' },
    1: { done: false, at: null },
  });
  assert.equal(sc2.tasks[0].done, true);
  assert.equal(sc2.tasks[1].done, false);
  assert.equal(M.countDone(sc2), 1);
});

test('splitDisplayText strips trailing timestamp and parses ISO', () => {
  const r = M.splitDisplayText('Do thing (done 2026-08-31 09:05)');
  assert.equal(r.text, 'Do thing');
  assert.equal(typeof r.at, 'string');
  const none = M.splitDisplayText('No timestamp here');
  assert.equal(none.text, 'No timestamp here');
  assert.equal(none.at, null);
});
