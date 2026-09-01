# Guide for LLMs

This file is for anyone (human or model) who needs to change ToDoKnist
without ramping up from scratch. It records the decisions, the traps, and
where things live.

## Architecture in one paragraph

Electron app. Three layers, kept separate on purpose:

1. **Main process** (`main.js`) — owns the window, all file I/O, plan parsing.
   The renderer never touches the filesystem.
2. **Preload** (`preload.js`) — a narrow `contextBridge` API. Twelve methods,
   nothing else leaks into the renderer.
3. **Renderer** (`renderer/app.js` + `renderer/styles.css` + `index.html`) —
   pure DOM. Talks to main only through `window.TodoKnist.*`.

Two pure library modules have no Electron dependency and are unit-tested:

- `lib/markdown.js` — parse/serialize Markdown checklists.
- `lib/store.js` — config, plan files, sidecars, Obsidian daily-note append.

## File map

```
main.js              window config, IPC handlers, buildPlanView, path guard
preload.js           contextBridge — the entire renderer API surface
index.html           DOM structure + strict CSP
renderer/app.js      renderer logic: modes, animation, sounds, popups, DnD
renderer/styles.css  all visuals
lib/markdown.js      parseMarkdown, toggleTaskInLines, buildSidecar, formatLocal
lib/store.js         readConfig/writeConfig, plan + sidecar read/write, appendDailyNote
test/markdown.test.js  8 parser tests
test/store.test.js     7 store tests
assets/              Press Start 2P font (woff2 + ttf)
example-plan.md      7-task sample plan for testing
```

## The IPC API (preload.js)

The renderer can only call these. If you need a new capability, add it here
and handle it in main.js.

| Method | Purpose |
|---|---|
| `getConfig()` | read config (vault, records, activePlan, muted) |
| `setMuted(bool)` | persist mute state |
| `openDropped(filePath)` | copy a dropped .md into records, parse, return plan |
| `openPasted(content)` | save pasted markdown, parse, return plan |
| `toggle(fileName, index, done)` | toggle a task, rewrite .md + sidecar, return updated plan |
| `setActive(fileName)` | set/clear the active plan pointer in config |
| `loadActive()` | reload the active plan on startup |
| `deletePlan(fileName)` | delete plan + sidecar |
| `appendNote(body)` | append to today's Obsidian daily note |
| `resize(w, h)` | resize the window |
| `quit()` | quit the app |
| `pathForFile(file)` | resolve a dropped File object to a real path |

## Data flow

1. User drops/pastes markdown → main copies it to records dir → main parses
   → main builds sidecar (if missing) → main sends `plan` view to renderer.
2. User clicks a task → renderer calls `toggle` → main rewrites the .md file
   (adds `(done YYYY-MM-DD HH:MM)` timestamp) → main updates sidecar → main
   returns the fresh plan view → renderer re-renders.
3. On reopen, the **sidecar is authoritative** for done/at states, not the
   markdown text. The markdown text is kept in sync for human readability.

## Config

Stored at `~/.config/ToDoKnist/config.json` (Linux standard, via
`app.getPath('userData')`). Never hardcoded.

```json
{
  "vault": "/path/to/obsidian/vault",
  "records": "/path/to/plans/dir",
  "activePlan": "slug-or-null.md",
  "muted": false
}
```

## Window

- Frameless, transparent, always-on-top, non-resizable.
- Width 440px fixed. Height changes between focus mode (320px) and list mode
  (560px) via `API.resize()`.
- `transparent: true` — the window background is see-through; only the needles
  and the cream fabric are opaque.
- `--no-sandbox` in `npm start` to avoid the SUID chrome-sandbox requirement.

## Visual layout (top to bottom)

```
.loom       — crossed needles only, transparent bg, drag region
.body       — transparent container
  .idle     — "knit your plan..." (only when no plan loaded)
  .fabric   — cream yarn sheet, opaque, holds task rows
.status     — "0/7 done" + [+] [*] buttons, transparent
```

The decorative skein-band, yarn-slot, and bottom deco strip were removed.
The `.overlay` (popup veil) and `.vault-err` are fixed-position, hidden by
default.

## CSS conventions

- Colors are CSS variables in `:root` (`--red`, `--cream`, `--ink`, etc.).
- There are also `--bg-*` variables: solid-color SVG data URIs used as
  `background-image` to force opaque compositing (see "Traps" below).
- Drag regions: `.app` is `-webkit-app-region: drag`; `.idle`, `.fabric`,
  `.status` override with `no-drag`.
- Font: Press Start 2P, a pixel font. Sizes are intentionally small (7-14px)
  because the font renders large.

## Key constants (renderer/app.js)

```
FOCUSED_H = 320   // window height in focus mode
LIST_H    = 560   // window height in list mode
WIDTH     = 440   // fixed window width
```

`cap()` returns the max fabric height per mode (220 focus / 440 list).
`measureTarget()` clamps the fabric's natural height to `[90, cap()]`.

If you change the fabric's `min-height` or `max-height` in CSS, update
`cap()` and `FOCUSED_H`/`LIST_H` to match, or the knit animation will
undershoot or overshoot.

## Traps (things that bit us)

### 1. Transparent windows and `background-color`

On Linux compositors (both X11 and Wayland), `background-color` on a
frameless transparent Electron window can render at ~25% intensity — the
desktop bleeds through. Elements with `background-image` render opaquely.

**Fix in place:** every structural element sets both `background-color`
(the real color) and `background-image` (a `--bg-*` SVG data URI of the
same color). The fabric already had an SVG stitch pattern so it worked;
the loom and body now have solid SVG fills.

If you add a new colored element, follow the same pattern or it will
appear dim. Note: swiftshader (headless/Xvfb) cannot render SVG
`background-image` at all, so you cannot verify colors in a headless
screenshot — test on a real GPU desktop.

### 2. The `.overlay` must respect `[hidden]`

`.overlay` has `display: flex`. The browser's UA rule
`[hidden] { display: none }` loses to it, so the overlay was always
visible — a 75%-black veil covering the whole window. This was the real
cause of the "dark window with a white rectangle" bug.

**Fix in place:** `.overlay[hidden] { display: none }` is declared
before `.overlay { display: flex }`. If you add `display:` to any element
that uses the `hidden` attribute, add the `[hidden]` override too.

### 3. `state.busy` must always clear

The renderer sets `state.busy = true` during the knit animation and
during task toggles to block re-entrancy. If an error path returns
early without clearing it, the app freezes (no clicks accepted).

**Fix in place:** `onTaskClick` uses `try/finally`. `presentPlan` sets
and clears `busy` around the animation. If you add a new async
interaction, guard `busy` the same way.

### 4. DnD listeners belong on `document`, not `body`

`.body` was a drag region, which swallowed drag events. DnD listeners
are on `document` so drops work anywhere on the window.

### 5. Sidecar is authoritative on reopen

When a plan is reopened, the `.progress.json` sidecar wins over the
markdown text for done/at states. The markdown is rewritten on every
toggle to stay human-readable, but if the two disagree, the sidecar is
trusted. Don't "fix" this by trusting the markdown — the sidecar is the
source of truth.

### 6. Path traversal guard

`store.safeWithin(parent, child)` checks that a resolved path is inside
the records dir. `plan:loadActive` and all file ops call it. Never
remove this — a tampered config could point `activePlan` at
`../../etc/passwd`.

## Testing

    npm test

15 tests, all pure (no Electron). The renderer is verified by eye on a
real desktop. Headless Xvfb + swiftshader can verify layout measurements
and computed styles but **not** actual pixel colors (see trap #1).

Headless render for debugging:

    TODOKNIST_NO_ANIM=1 \
    TODOKNIST_CAPTURE=/tmp/shot.png \
    TODOKNIST_QUIT=1 \
    TODOKNIST_CAPTURE_DELAY=2500 \
    xvfb-run -a npx electron . --no-sandbox

This prints `[measure]` (element bounding boxes) and `[styles]` (computed
colors) to stderr, then writes a PNG.
