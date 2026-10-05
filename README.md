# OrganizedTodo

A todo list that lives in the GNOME top bar, organized as **projects → lists → tasks**.

Derived from [Todoit](https://github.com/wassimbj/todoit-gnome) by wassimbj (MIT). The data model, the screens and most of the code were rewritten; see `LICENCE`.

## Features

- Three screens with a back button: **Projects → Lists → Tasks**. The entry at the bottom creates a project, a list or a task depending on the screen you are on.
- **Automatic completion**: checking the last pending task of a project (across all its lists) marks the project as completed and takes you back to the projects screen.
- **Completed** projects stay accessible and can be reactivated. Unchecking a task, or adding one, to a completed project reactivates it.
- Inline rename for projects, lists and tasks (Enter saves, Esc cancels). Deleting a project or list that has content asks for a second click.
- Focus a task (pins it to the top of its list) and drag to reorder inside a list.
- Panel icon only; open it with `Alt+Shift+Space`.

The interface is currently in Portuguese (pt-BR).

## Install

Needs GNOME Shell 45 to 50 (tested on 50 only).

From a zip:

```sh
gnome-extensions install --force organizedtodo@gabrielsmash.github.io.shell-extension.zip
# log out and back in (Wayland), then
gnome-extensions enable organizedtodo@gabrielsmash.github.io
```

From source:

```sh
git clone https://github.com/GabrielSmash/OrganizedTodo.git
cd OrganizedTodo
make install     # compiles the schema and copies into ~/.local/share/gnome-shell/extensions/
# log out and back in, then enable as above
```

Build a shareable zip with `make pack`.

If you also have the original Todoit enabled, disable it: both react to `Alt+Shift+Space`. Their data is separate; OrganizedTodo does not read Todoit's list.

## Data

Everything is stored in dconf, as one JSON string:

```sh
dconf read /org/gnome/shell/extensions/organizedtodo/workspace
dconf dump /org/gnome/shell/extensions/organizedtodo/ > backup.conf   # backup
```

## Development

```sh
npm test         # unit tests (data layer) + UI tests against stubbed GNOME toolkit
make schemas     # recompile the GSettings schema after editing it
```

The UI tests run the real `extension.js` in Node with small fakes of `St`, `Clutter` and the shell modules (`tests/helpers`). They check logic and navigation, **not how it looks**, so check visuals in a real session. Wayland caches extension code: log out and in to load changes.

Layout: `manager.js` (data and rules, no UI), `extension.js` (screens), `stylesheet.css`, `icons/`, `schemas/`.

## License

MIT. See `LICENCE`.
