# ToDoKnist

:warning: Vibe coding experiment :warning:

A small, frameless, always-on-top window that looks like a pixel-art knitting
loom. Two crossed needles sit at the top; a sheet of cream yarn hangs below
them. Give it a Markdown checklist — it knits each task in turn and writes a
session note to your Obsidian daily note when you are done.

## Run

Needs Node.js and a Linux desktop (X11 or Wayland).

    npm install
    npm start

On first run it asks for two folders:

- your Obsidian vault — notes go to `Journal/YYYY-MM-DD.md` inside it
- a records folder for your plans and their progress files

It stores these paths in `~/.config/ToDoKnist/config.json` and never hardcodes
them.

## Sandbox

`npm start` runs without the Linux SUID sandbox, so it runs without extra
setup. The window loads only local files, isolates the page from Node, and
escapes everything you type, so the sandbox adds little here.

To keep the sandbox, set it up once:

    sudo chown root node_modules/electron/dist/chrome-sandbox
    sudo chmod 4755 node_modules/electron/dist/chrome-sandbox

Then run `npm run start:sandbox`. Run those two lines again after you reinstall
Electron.

## Use

- Drag the window by the needle bar at the top. The fabric and status bar are
  not drag handles.
- Drag a `.md` file onto the window, or paste Markdown with Ctrl+V.
- The first `#` line is the title. `##` lines make sections. `- [ ]` and
  `- [x]` are tasks.
- Click a task to knit it. It writes the change back to the Markdown file and a
  `.progress.json` sidecar, then moves to the next task.
- Click `+` for the full list, `*` to focus on one task.
- Click `♪` to mute the needle sounds, `✕` to turn them back on.
- When every task is done, the loom shows `ALL KNIT ✓`, drops confetti, and
  asks for a session note. It appends the note to today's daily note.
- Press Ctrl+C (outside a text box) to log your progress or delete the plan.

It keeps your plan files in the records folder. It only ever appends to the
daily note; it never rewrites or deletes it.

## Test

    npm test

Runs 15 unit tests for the Markdown parser and the store (file ops). There are
no renderer tests; the renderer is verified by eye on a real desktop.
