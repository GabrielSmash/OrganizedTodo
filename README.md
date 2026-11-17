# OrganizedTodo

A todo list for the GNOME top bar, organized as **projects → lists → tasks**. When every task of a project is done, the project shows a **Complete** button, and you decide when to archive it.

Derived from [Todoit](https://github.com/wassimbj/todoit-gnome), by wassimbj (MIT). The data model, the screens and most of the code were rewritten. See [License and credits](#license-and-credits).

## Features

- **Screens with a back button:** Projects → Lists → Tasks → Notes of a task.
- **One-click completion:** when you check the last pending task of a project (across all of its lists), you go back to Projects and the project shows **Complete**.
- **Completed projects:** kept, viewable and can be reactivated.
- **Inline editing:** rename projects, lists and tasks without opening another screen.
- **Focus and order:** highlight a task (it is pinned to the top of its list) and drag to reorder.
- **A single panel icon**, opened by clicking or with the `Alt+Shift+Space` shortcut.
- **Settings window:** the gear on the Projects screen opens appearance, behavior, shortcuts and backup options.
- **AI agents (MCP):** Claude Code and other MCP clients can read your projects and, if you allow it, add, complete, rename and annotate tasks. They never delete anything.
- **Quick add from anywhere:** `Super+Alt+T` opens a box in the middle of the current screen to add a task without opening the menu. It remembers the last list you used, and can pick or create another one.
- **Notes per task:** free text for each task, with full markdown (headings, lists, checkboxes, colored code blocks).
- **Formatting in names:** simple markdown in projects, lists and tasks; links open with one click.
- **A notes editor made for code:** Tab indents, Shift+Tab unindents, Enter keeps the indentation.
- **Animations:** the menu grows from the icon and shrinks back into it, screens slide, new rows fade in and checking a task sets off a small burst. They follow GNOME's reduce-animations setting.

## Requirements

- GNOME Shell **45 to 50**. Tested only on **50**; other versions may behave differently.
- To install from source: `git`, `make` and `glib-compile-schemas`
  (Ubuntu/Debian: package `libglib2.0-bin`; Fedora: `glib2-devel`).
- To build the daemon (the Rust backend): **Rust 1.92 or newer** (`cargo`, via [rustup](https://rustup.rs)),
  `pkg-config` and the GLib headers (Ubuntu/Debian: `pkg-config libglib2.0-dev`; Fedora: `pkgconf glib2-devel`).
- To build the zip (`make pack`): `zip`.

## Installation

### From source (recommended)

```sh
git clone https://github.com/GabrielSmash/OrganizedTodo.git
cd OrganizedTodo
make install
```

`make install` does two things:

1. Compiles the schema and copies the extension to
   `~/.local/share/gnome-shell/extensions/organizedtodo@gabrielsmash.github.io/`.
2. Builds and installs the **daemon** (`make install-daemon`):
   - the binary at `~/.local/bin/organizedtodo-daemon`;
   - the activation file at `~/.local/share/dbus-1/services/io.github.gabrielsmash.OrganizedTodo.service`.

You do not need to start the daemon: D-Bus starts it the first time the extension calls it.

If the repository is already inside the extensions folder (cloned straight into
`~/.local/share/gnome-shell/extensions/organizedtodo@gabrielsmash.github.io`), run only `make install-daemon`.

### From a zip

If someone sent you the file `organizedtodo@gabrielsmash.github.io.shell-extension.zip`:

```sh
gnome-extensions install --force organizedtodo@gabrielsmash.github.io.shell-extension.zip
```

To build that zip from the source: `make pack`.

The zip contains **only the extension**. The daemon has to be installed from source (`make install-daemon`);
without it, the menu opens empty and the error shows up in the log (`journalctl --user -g organizedtodo`).

### Enable

On **Wayland**, GNOME only sees new extensions after a new session:

1. Log out and back in (on X11 you can reload with `Alt+F2`, `r`, Enter).
2. Enable the extension:

```sh
gnome-extensions enable organizedtodo@gabrielsmash.github.io
```

If the **original Todoit** is enabled, disable it: both respond to `Alt+Shift+Space`. Their data is separate, and OrganizedTodo does **not** read Todoit's list.

### Update

Inside the repository folder: `git pull && make install`, then log out and back in (GNOME caches extension code).

If the daemon is already running, it keeps the old version until it exits. Logging out takes care of that;
to switch right away: `pkill -x organizedtodo-d` (D-Bus starts the new version on the next call).

### Uninstall

```sh
gnome-extensions disable organizedtodo@gabrielsmash.github.io
rm -rf ~/.local/share/gnome-shell/extensions/organizedtodo@gabrielsmash.github.io
pkill -x organizedtodo-d
rm -f ~/.local/bin/organizedtodo-daemon ~/.local/share/dbus-1/services/io.github.gabrielsmash.OrganizedTodo.service
dconf reset -f /org/gnome/shell/extensions/organizedtodo/   # also deletes your data
```

## Usage

### Open

Click the icon in the top bar, or press **`Alt+Shift+Space`**. The shortcut puts the cursor in the text field at the bottom.

### The bottom field

The text field at the bottom creates **whatever makes sense on the current screen**:

| Screen | The field creates | Hint text |
|---|---|---|
| Projects | a project | `New project...` |
| Lists (inside a project) | a list | `New list...` |
| Tasks (inside a list) | a task | `New task...` |

Type and press **Enter**.

### Quick add

Press **`Super+Alt+T`** in any app to add a task without opening the menu. A box opens in the middle of the screen you are on.

- It starts on the list you quick-added to last (the first time, the first list of the first active project).
- Type the task and press **Enter**: it is added and the box closes. **Esc** cancels.
- To send it somewhere else, press **Tab** or click the destination: pick a project, then a list.
  Type to filter (accents and case do not matter), **Enter** takes the first match, **↑/↓** move between them
  and **Esc** goes one step back. What you already typed is kept.
- When the name you type does not exist, **Create "…"** makes the project or the list right there.
- Completed projects are not offered: adding to one would reactivate it.

### Step by step

1. On the **Projects** screen, type a project name (for example, `Project A`) and press Enter.
2. Click the project to open it. Create lists, for example `Features` and `Fixes`.
3. Click a list to open it and add tasks.
4. Use the **back** arrow at the top to go up one level.

### On each row

**Projects and lists** (click the row to open it):

| Button | What it does |
|---|---|
| Pencil | Renames in place. **Enter** saves and **Esc** cancels. An empty name is ignored. |
| Trash | Deletes. If the project or list has content, the button turns into **"Delete?"** and asks for a second click. |
| Complete | Shows on a project when all of its tasks are done. Moves it to **Completed**. |

The pill next to the name shows how many pending tasks there are.

**Tasks:**

| Control | What it does |
|---|---|
| Circle on the left | Checks or unchecks the task (the text is struck through). |
| Document | Opens the task's **notes**. It is highlighted when the task has notes. |
| Pencil | Edits the task's text. **Enter** saves and **Esc** cancels. |
| Target | **Focus**: pins the task to the top of its list (one per list). Click again to release. |
| Trash | Deletes the task, without asking. |
| `=` on the right | Drag to reorder within the list. |

### Completing a project

- When you check the **last pending task** of a project, counting **all of its lists**, you go back to Projects and the project shows a **Complete** button.
- Click **Complete** to move it to **Completed**. If you do nothing, the project stays where it is.
- Adding a new task, or unchecking one, hides the button again.
- A project **with no tasks** never shows the button.
- To see completed projects, use the **`Completed · N`** button at the top of Projects (it only shows when there is at least one).
- Inside Completed you can open a project to look at it, or click **Reactivate** to bring it back.
- **Unchecking** a task, or **adding** one, in a completed project reactivates it automatically.
- Prefer no button? **Settings → Behavior → When a project is all done → Archive it** archives the project as soon as its last task is checked.

### Notes

Each task can have notes. Click the task's document icon to open them; the screen title is the task's name.

- The **pencil** at the top opens the editor with the raw text. **Ctrl+Enter** or **Save** stores it; **Esc** cancels.
- **Enter** breaks the line keeping the current line's indentation; **Tab** inserts 4 spaces; **Shift+Tab** removes one level.
- What you are typing is not lost if the menu closes: when you reopen it, the editing continues.
- To delete the notes, clear all the text and save.

### Formatting (markdown)

**In names** of projects, lists and tasks (one line):

| You type | You see |
|---|---|
| `**bold**`, `*italic*`, `~~strike~~` | bold, italic, strikethrough |
| `` `code` `` | code in a monospace font |
| `> remark` | quote |
| `- item` | list item |
| `[text](site.com)`, `www.site.com`, `https://...` | link: click the text to open it |

**In notes**, all of the above and more:

| You type | You see |
|---|---|
| `# Title`, `## Subtitle`, `### Section` | headings (the space after `#` is required) |
| `1. item` | numbered list |
| `- [ ] pending`, `- [x] done` | ☐ / ☑ |
| `---` | horizontal rule |
| ` ```py ` … ` ``` ` | code block, colored for the language |

Languages with colors: Python (`py`), JavaScript/TypeScript (`js`, `ts`), Rust (`rs`), Shell (`sh`, `bash`) and JSON
(`json`). Others, or a block with no language, are shown without colors.

Only `http(s)` links and e-mail addresses are opened; other schemes (`file:`, `ssh:`...) are shown as text.

### Settings

Click the **gear** on the Projects screen, or run `gnome-extensions prefs organizedtodo@gabrielsmash.github.io`.
Changes apply right away.

| Tab | Options |
|---|---|
| Appearance | Theme (Default is dark, Light is white, System follows GNOME's light or dark style; applies to the menu, the quick add and this window), icon position in the top bar, pending count next to the icon, menu width, maximum list height, the burst on done tasks |
| Behavior | Which screen the menu opens on, confirm before deleting, where new and done tasks go, Complete button or automatic archive, quick add destination and staying open |
| Shortcuts | Click a shortcut and press the new one; Backspace disables it, the arrow button restores the default |
| AI agents | What agents can do (nothing, read, or read and change), and the command to connect one |
| Data | Export and import a backup; delete every archived project |

The shortcuts can also be changed from a terminal:

```sh
dconf write /org/gnome/shell/extensions/organizedtodo/open-organizedtodo "['<Super>t']"
dconf write /org/gnome/shell/extensions/organizedtodo/quick-add "['<Super><Alt>n']"
```

### AI agents (MCP)

[MCP](https://modelcontextprotocol.io) lets AI agents such as Claude Code use apps through tools.
OrganizedTodo's daemon has an MCP mode, `organizedtodo-daemon mcp`, that the agent starts by itself.
Nothing runs until an agent connects.

1. In **Settings → AI agents**, choose what agents can do. It starts as **Nothing**.
2. Connect your agent. For Claude Code:

   ```sh
   claude mcp add organizedtodo -- ~/.local/bin/organizedtodo-daemon mcp
   ```

   Other agents take a JSON entry, which the same tab copies for you:

   ```json
   {"mcpServers": {"organizedtodo": {"command": "/home/you/.local/bin/organizedtodo-daemon", "args": ["mcp"]}}}
   ```

3. Ask in plain words: *"what is left in the Home project?"*, *"add 'buy coffee' to Home › Shopping"*, *"mark the coffee task done"*.

| Access | Tools |
|---|---|
| Read | `list_projects`, `get_list`, `search_tasks` |
| Read and change | also `add_project`, `add_list`, `add_task`, `complete_task`, `reopen_task`, `rename_task`, `set_task_notes`, `focus_task` |

- Agents refer to things **by name** (case does not matter, a unique part is enough) or by id. When a name fits more than one, nothing changes and the agent is told the candidates.
- They follow your settings, as the menu does: where new and done tasks go, and archiving a project when it is all done.
- They cannot delete projects, lists or tasks, import a backup or clear the archive.
- Changes show up in the menu right away.
- The access setting is a rule for agents, not a security boundary: any program in your session can already talk to the daemon over D-Bus.

## Where the data lives

Everything is stored in **dconf**, as a single JSON text. The daemon reads and writes it; the extension only talks to the daemon.
There is no sync between machines.

```sh
# view
dconf read /org/gnome/shell/extensions/organizedtodo/workspace

# backup
dconf dump /org/gnome/shell/extensions/organizedtodo/ > backup.conf

# restore
dconf load /org/gnome/shell/extensions/organizedtodo/ < backup.conf
```

**Backup:** Settings → Data → **Export** saves every project, list, task and note to a JSON file, and **Import**
replaces everything with one (after a confirmation). The `dconf dump` above also keeps your settings.

If you reset dconf (for example, `dconf reset -f /`), you lose your tasks. Back up now and then.

## Development

```sh
npm test         # markdown and UI tests (with fakes of GNOME and of the daemon)
cargo test --manifest-path daemon/Cargo.toml   # daemon rules and persistence
make schemas     # recompiles the GSettings schema after editing it
make install-daemon   # rebuilds and reinstalls the daemon
make pack        # builds the zip (extension only)
```

How the pieces connect:

```text
extension.js (UI, runs inside gnome-shell)
   └─ client.js ── session D-Bus ──► organizedtodo-daemon (Rust)
                   io.github.gabrielsmash.OrganizedTodo     └─ dconf (GSettings)
                                       ▲
AI agent ── stdio (MCP) ──► organizedtodo-daemon mcp ── AgentCall
```

The MCP mode owns no data: each tool call becomes one `AgentCall`, which the daemon checks against the
access setting and runs as one step on its store thread, so a task found by name is the one changed.

The extension never blocks the shell: every call to the daemon is asynchronous, and the UI redraws when the
daemon emits the `Changed` signal.

To test the daemon without touching your real data, run it with the in-memory backend (stop the installed one first,
because only one instance can own the name on the bus):

```sh
pkill -x organizedtodo-d
GSETTINGS_BACKEND=memory daemon/target/debug/organizedtodo-daemon
gdbus introspect --session --dest io.github.gabrielsmash.OrganizedTodo --object-path /io/github/gabrielsmash/OrganizedTodo
```

Logs of the extension and the daemon: `journalctl --user -g organizedtodo`.

The UI tests run the real `extension.js` on Node, with small fakes of `St`, `Clutter` and the shell modules (`tests/helpers`). They check **logic and navigation, not appearance**; check the visuals in a real session.

Layout:

| File | Role |
|---|---|
| `daemon/` | Rust backend: rules (projects, lists, tasks, completion, quick add destination), persistence, backup files, the D-Bus service and the MCP mode for AI agents (`agent.rs`, `lookup.rs`, `mcp.rs`). |
| `client.js` | D-Bus client of the daemon; keeps the copy of the data for the UI. |
| `extension.js` | The screens and the navigation. |
| `quickAdd.js` | The quick add box (`Super+Alt+T`). |
| `prefs.js` | The settings window (runs in its own process, not inside the shell). |
| `prefs.css` | Colors of the settings window for the OrganizedTodo theme. |
| `markdown.js` | Markdown → Pango markup: names, notes and code block colors. |
| `stylesheet.css` | Look. |
| `icons/` | Panel icon. |
| `schemas/` | Settings (GSettings). |
| `tests/` | Tests. |

## Known limitations

- The interface is in English only; there are no translation files.
- Tested only on GNOME Shell 50.
- The zip (`make pack`) does not include the daemon; it has to be built from source.
- No sync, no reminders and no dates on tasks.
- Code block colors are simple keyword highlighting, not a full parser of the language.
- MCP runs over stdio only (the agent starts it); there is no HTTP mode. The MCP bridge (`daemon/src/mcp.rs`) has no automated test: it was checked by hand, also with Claude Code, against a nested session.

## License and credits

MIT. See [`LICENCE`](LICENCE).

Based on [Todoit](https://github.com/wassimbj/todoit-gnome), copyright (c) 2024 Wassim Ben Jdida, also MIT. The original copyright notice was kept.
