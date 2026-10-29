"use strict";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import St from "gi://St";
import { Extension, gettext as _, } from "resource:///org/gnome/shell/extensions/extension.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as DND from "resource:///org/gnome/shell/ui/dnd.js";
import { TodoClient, undoneCount, todoCount } from "./client.js";
import { markdownToMarkup, markdownToPlain, firstLink, noteBlocks } from "./markdown.js";
import { isEmpty } from "./utils.js";

const MENU_WIDTH = 440;
const SCROLL_MAX_HEIGHT = 380;
const MAX_INPUT_CHARS = 200;
const MAX_NOTES_CHARS = 5000;
const NOTES_INDENT = "    ";
// Durations in ms; the shell turns them to 0 when the user disables animations
const OPEN_ANIMATION_TIME = 250;
// Must not outlast the shell's own close fade (150 ms), which hides the menu when it ends
const CLOSE_ANIMATION_TIME = 150;
const SLIDE_ANIMATION_TIME = 200;
const REVEAL_ANIMATION_TIME = 220;
const PULSE_ANIMATION_TIME = 300;
const BURST_ANIMATION_TIME = 450;
const BURST_PARTICLES = 8;
const BURST_DISTANCE = 22;

const SCREEN = {
    FOLDERS: "folders",
    COMPLETED: "completed",
    LISTS: "lists",
    TODOS: "todos",
    NOTES: "notes",
};

// How deep each screen is: going deeper slides in from the right, going back from the left
const DEPTH = {
    [SCREEN.FOLDERS]: 0,
    [SCREEN.COMPLETED]: 1,
    [SCREEN.LISTS]: 2,
    [SCREEN.TODOS]: 3,
    [SCREEN.NOTES]: 4,
};

// A function, not a constant: gettext needs the extension instance, which does not exist at import time
const inputHint = (screen) => ({
    [SCREEN.FOLDERS]: _("Novo projeto..."),
    [SCREEN.LISTS]: _("Nova lista..."),
    [SCREEN.TODOS]: _("Nova tarefa..."),
    [SCREEN.COMPLETED]: "",
    [SCREEN.NOTES]: "",
}[screen]);

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Clutter.Text counts positions in characters (-1 is the end); JS strings count UTF-16
// units, which differ for emoji. Spreading a string gives one item per character.

/** Characters of `text` and the cursor position among them. */
function charsAndCursor(text) {
    const chars = [...text.get_text()];
    const cursor = text.get_cursor_position();
    return [chars, cursor < 0 ? chars.length : cursor];
}

/** Where the line holding position `at` starts. */
function lineStart(chars, at) {
    let start = at;
    while (start > 0 && chars[start - 1] !== "\n") {
        start--;
    }
    return start;
}

function insertAtCursor(text, insertion) {
    text.delete_selection();
    text.insert_text(insertion, text.get_cursor_position());
}

/** Enter: the new line starts with the same spaces as the current one. */
function newLineKeepingIndent(text) {
    text.delete_selection();
    const [chars, cursor] = charsAndCursor(text);
    const start = lineStart(chars, cursor);
    let end = start;
    while (end < cursor && (chars[end] === " " || chars[end] === "\t")) {
        end++;
    }
    const indent = chars.slice(start, end).join("");
    text.insert_text(`\n${indent}`, text.get_cursor_position());
}

/** Shift+Tab: remove up to one indentation level from the start of the cursor's line. */
function unindentLine(text) {
    const [chars, cursor] = charsAndCursor(text);
    const start = lineStart(chars, cursor);
    let count = 0;
    while (count < NOTES_INDENT.length && chars[start + count] === " ") {
        count++;
    }
    if (count > 0) {
        text.delete_text(start, start + count);
    }
}

export default class TodoListExtension extends Extension {
    _client;
    _button;
    _mainBox;
    _header;
    _content;
    _footer;
    _scroll;
    _input;
    _view;
    /** { key } of the row being renamed inline, or null */
    _renaming = null;
    /** key of the row waiting for a second click to be deleted, or null */
    _pendingDelete = null;
    /** entry that should receive keyboard focus once the render finished */
    _toFocus = null;
    _dragOverItem = null;
    /** Rebuild after DND finishes (avoid destroying actors mid-drop) */
    _pendingRerender = false;
    _dragging = false;
    /** Screen and row keys of the last render, to tell which rows are new */
    _shownRows = null;
    /** { listId, index } of the todo whose check was just clicked, pulsed on the next render */
    _pulse = null;
    /** Where the panel icon is, as the menu's scaling origin [x, y] */
    _iconPivot = [0.5, 0];
    /** { draft } while the notes screen is in edit mode, or null. Kept when the menu closes. */
    _editingNotes = null;

    enable() {
        this._client = new TodoClient(() => this._onWorkspaceChanged());
        this._view = { screen: SCREEN.FOLDERS };
        this._button = new PanelMenu.Button(0.0, this.metadata.name, false);
        this._button.add_child(new St.Icon({
            gicon: Gio.icon_new_for_string(`${this.path}/icons/organizedtodo.svg`),
            style_class: "organizedtodo-panel-icon",
        }));
        Main.panel.addToStatusArea(this.uuid, this._button);
        this._buildMenu();
        this._render();
        this._bindShortcut();
        this._client.connect().catch((e) => console.error(`organizedtodo: cannot reach the daemon: ${e}`));
    }

    disable() {
        this._clearDragOver();
        this._pendingRerender = false;
        this._dragging = false;
        this._shownRows = null;
        this._pulse = null;
        Main.wm.removeKeybinding("open-organizedtodo");
        this._button?.destroy();
        this._button = null;
        this._mainBox = null;
        this._header = null;
        this._content = null;
        this._footer = null;
        this._scroll = null;
        this._input = null;
        this._toFocus = null;
        this._renaming = null;
        this._pendingDelete = null;
        this._editingNotes = null;
        this._client?.destroy();
        this._client = null;
    }

    // ---------------------------------------------------------------- menu

    _buildMenu() {
        this._mainBox = new St.BoxLayout({
            vertical: true,
            style_class: "organizedtodo-main",
            style: `width: ${MENU_WIDTH}px;`,
        });
        this._header = new St.BoxLayout({
            style_class: "organizedtodo-header",
            x_expand: true,
        });
        this._content = new St.BoxLayout({
            vertical: true,
            style_class: "organizedtodo-content",
            x_expand: true,
        });
        this._scroll = new St.ScrollView({
            style_class: "vfade organizedtodo-scroll",
            style: `max-height: ${SCROLL_MAX_HEIGHT}px;`,
            hscrollbar_policy: St.PolicyType.NEVER,
            overlay_scrollbars: true,
        });
        this._scroll.add_child(this._content);
        this._input = new St.Entry({
            style_class: "organizedtodo-input",
            can_focus: true,
            track_hover: true,
            x_expand: true,
        });
        this._input.clutterText.set_max_length(MAX_INPUT_CHARS);
        this._input.clutterText.connect("activate", () => this._submitInput());
        this._footer = new St.BoxLayout({
            style_class: "organizedtodo-footer",
            x_expand: true,
        });
        this._footer.add_child(this._input);
        this._mainBox.add_child(this._header);
        this._mainBox.add_child(this._scroll);
        this._mainBox.add_child(this._footer);
        this._button.menu.box.add_child(this._mainBox);
        this._followIconPivot();
        // Half-finished interactions should not survive closing the menu
        this._button.menu.connect("open-state-changed", (_menu, isOpen) => {
            if (isOpen) {
                this._growFromIcon();
            }
            else {
                this._shrinkIntoIcon();
            }
            // A failed load gets another chance every time the menu opens
            if (isOpen && this._client?.error) {
                this._send(this._client.refresh());
            }
            if (!isOpen && (this._renaming || this._pendingDelete)) {
                this._renaming = null;
                this._pendingDelete = null;
                this._render();
            }
        });
    }

    /**
     * Keep the menu's scaling origin on the panel icon. The menu is placed during layout,
     * after it opens, so the origin is updated whenever its allocation changes.
     */
    _followIconPivot() {
        const menuActor = this._button.menu.actor;
        menuActor.connect("notify::allocation", () => {
            const box = menuActor.get_allocation_box();
            const width = box.get_width();
            if (width <= 0) {
                return;
            }
            const [iconX] = this._button.get_transformed_position();
            const pivotX = (iconX + this._button.width / 2 - box.x1) / width;
            this._iconPivot = [Math.min(Math.max(pivotX, 0), 1), 0];
            menuActor.set_pivot_point(...this._iconPivot);
        });
    }

    /** The menu grows out of the panel icon (replaces the shell's small default zoom). */
    _growFromIcon() {
        const menuActor = this._button.menu.actor;
        // The shell resets the origin on every open and close; the allocation does not always change
        menuActor.set_pivot_point(...this._iconPivot);
        menuActor.set_scale(0.1, 0.1);
        menuActor.ease({
            scale_x: 1,
            scale_y: 1,
            duration: OPEN_ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    /** The reverse of _growFromIcon: the menu goes back into the icon while the shell fades it out. */
    _shrinkIntoIcon() {
        const menuActor = this._button.menu.actor;
        menuActor.set_pivot_point(...this._iconPivot);
        menuActor.ease({
            scale_x: 0.1,
            scale_y: 0.1,
            duration: CLOSE_ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
        });
    }

    _bindShortcut() {
        Main.wm.addKeybinding("open-organizedtodo", this.getSettings(), Meta.KeyBindingFlags.NONE, Shell.ActionMode.ALL, () => {
            this._button?.menu.toggle();
            this._input?.clutterText.grab_key_focus();
        });
    }

    /** The bottom entry creates a folder, list or todo depending on the screen. */
    _submitInput() {
        const text = this._input.get_text().trim();
        if (!text) {
            return;
        }
        const { screen, folderId, listId } = this._view;
        if (screen === SCREEN.FOLDERS) {
            this._send(this._client.addFolder(text));
        }
        else if (screen === SCREEN.LISTS) {
            this._send(this._client.addList(folderId, text));
        }
        else if (screen === SCREEN.TODOS) {
            this._send(this._client.addTodo(folderId, listId, text));
        }
        else {
            return;
        }
        this._input.set_text("");
        this._render();
        this._input.grab_key_focus();
    }

    _navigate(view) {
        const direction = Math.sign(DEPTH[view.screen] - DEPTH[this._view.screen]);
        this._view = view;
        this._renaming = null;
        this._pendingDelete = null;
        this._pulse = null;
        this._editingNotes = null;
        this._render();
        if (direction) {
            this._slideIn(direction);
        }
    }

    /** The new screen slides in from the side it comes from. */
    _slideIn(direction) {
        for (const actor of [this._header, this._content]) {
            actor.opacity = 0;
            actor.translation_x = 24 * direction;
            actor.ease({
                opacity: 255,
                translation_x: 0,
                duration: SLIDE_ANIMATION_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    /** Daemon data changed (from here or elsewhere): redraw, unless a drag is running. */
    _onWorkspaceChanged() {
        if (this._dragging) {
            this._pendingRerender = true;
            return;
        }
        this._render();
    }

    /** Fire a daemon call; the redraw comes from the Changed signal. */
    _send(promise) {
        promise.catch((e) => console.error(`organizedtodo: daemon call failed: ${e}`));
    }

    // -------------------------------------------------------------- render

    _render() {
        const folder = this._view.folderId
            ? this._client.getFolder(this._view.folderId)
            : null;
        const list = folder?.lists.find((l) => l.id === this._view.listId) ?? null;
        const todo = list?.todos[this._view.index] ?? null;
        // Whatever the view points to may have been deleted (here or via dconf)
        let screen = this._view.screen;
        // By index and name: if todos moved or were removed, do not show another todo's notes
        if (screen === SCREEN.NOTES && todo?.name !== this._view.name) {
            screen = SCREEN.TODOS;
        }
        if (screen === SCREEN.TODOS && !list) {
            screen = folder ? SCREEN.LISTS : SCREEN.FOLDERS;
        }
        if (screen === SCREEN.LISTS && !folder) {
            screen = SCREEN.FOLDERS;
        }
        if (screen === SCREEN.COMPLETED && isEmpty(this._client.getFolders(true))) {
            screen = SCREEN.FOLDERS;
        }
        if (screen !== this._view.screen) {
            this._view = { screen, folderId: folder?.id, listId: screen === SCREEN.TODOS ? list.id : undefined };
            this._editingNotes = null;
        }

        this._header.destroy_all_children();
        this._content.destroy_all_children();
        if (this._client.error) {
            this._renderError();
            return;
        }
        switch (screen) {
            case SCREEN.FOLDERS:
                this._renderFolders();
                break;
            case SCREEN.COMPLETED:
                this._renderCompleted();
                break;
            case SCREEN.LISTS:
                this._renderLists(folder);
                break;
            case SCREEN.TODOS:
                this._renderTodos(folder, list);
                break;
            case SCREEN.NOTES:
                this._renderNotes(folder, list, todo);
                break;
        }
        this._revealNewRows(`${screen}:${this._view.folderId}:${this._view.listId}`);
        this._pulseToggled();
        this._input.hint_text = inputHint(screen);
        this._footer.visible = screen !== SCREEN.COMPLETED && screen !== SCREEN.NOTES;
        if (this._toFocus) {
            this._toFocus.grab_key_focus();
            this._toFocus.clutterText.set_selection(0, -1);
            this._toFocus = null;
        }
    }

    /**
     * Fade in the rows that were not there in the previous render of the same screen.
     * Only while the menu is open: the first load and screen changes are not "new rows".
     */
    _revealNewRows(context) {
        const rows = this._content.get_children().filter((row) => row._revealKey);
        const previous = this._shownRows?.context === context ? this._shownRows.keys : null;
        this._shownRows = { context, keys: new Set(rows.map((row) => row._revealKey)) };
        if (!previous || !this._button.menu.isOpen) {
            return;
        }
        for (const row of rows) {
            if (previous.has(row._revealKey)) {
                continue;
            }
            row.opacity = 0;
            row.translation_y = -6;
            row.ease({
                opacity: 255,
                translation_y: 0,
                duration: REVEAL_ANIMATION_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    /** Pop the check that was just clicked, once the redraw with the new state is on screen. */
    _pulseToggled() {
        if (!this._pulse) {
            return;
        }
        const { listId, index } = this._pulse;
        const row = this._content.get_children().find((r) => r._listId === listId && r._index === index);
        if (!row) {
            return;
        }
        this._pulse = null;
        row._check.set_pivot_point(0.5, 0.5);
        row._check.set_scale(1.35, 1.35);
        row._check.ease({
            scale_x: 1,
            scale_y: 1,
            duration: PULSE_ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
        });
        if (row._done) {
            // The new check is not laid out yet: burst once its position is known
            const id = row._check.connect("notify::allocation", () => {
                row._check.disconnect(id);
                this._burstFrom(row._check);
            });
        }
    }

    /** Dots flying out of a check that was just marked done. They live above the menu, then vanish. */
    _burstFrom(actor) {
        const [x, y] = actor.get_transformed_position();
        const [width, height] = actor.get_transformed_size();
        for (let i = 0; i < BURST_PARTICLES; i++) {
            const angle = (2 * Math.PI * i) / BURST_PARTICLES;
            // The dots take turns in the colors of the panel icon
            const dot = new St.Widget({ style_class: `organizedtodo-burst organizedtodo-burst-${i % 3}` });
            Main.uiGroup.add_child(dot);
            dot.set_position(x + width / 2 - 3, y + height / 2 - 3);
            dot.ease({
                translation_x: Math.cos(angle) * BURST_DISTANCE,
                translation_y: Math.sin(angle) * BURST_DISTANCE,
                opacity: 0,
                duration: BURST_ANIMATION_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onStopped: () => dot.destroy(),
            });
        }
    }

    _renderFolders() {
        const active = this._client.getFolders(false);
        const completed = this._client.getFolders(true);
        const actions = [];
        if (completed.length) {
            actions.push(this._pillButton(`${_("Concluídos")} · ${completed.length}`, () => this._navigate({ screen: SCREEN.COMPLETED })));
        }
        const pending = active.reduce((total, folder) => total + undoneCount(folder), 0);
        this._buildHeader({
            title: _("Projetos"),
            subtitle: plural(pending, _("pendente"), _("pendentes")),
            actions,
        });
        if (isEmpty(active)) {
            this._emptyState(_("Nenhum projeto ainda"), _("Crie o primeiro no campo abaixo"));
            return;
        }
        for (const folder of active) {
            this._content.add_child(this._folderRow(folder));
        }
    }

    _renderCompleted() {
        const folders = this._client.getFolders(true);
        this._buildHeader({
            title: _("Concluídos"),
            subtitle: plural(folders.length, _("projeto"), _("projetos")),
            onBack: () => this._navigate({ screen: SCREEN.FOLDERS }),
        });
        for (const folder of folders) {
            const reactivate = this._pillButton(_("Reativar"), () => {
                this._send(this._client.setFolderCompleted(folder.id, false));
                this._render();
            });
            this._content.add_child(this._folderRow(folder, [reactivate]));
        }
    }

    _renderLists(folder) {
        const actions = [];
        if (folder.completed) {
            actions.push(this._pillButton(_("Reativar"), () => {
                this._send(this._client.setFolderCompleted(folder.id, false));
                this._render();
            }, "organizedtodo-accent-btn"));
        }
        const status = folder.completed ? ` · ${_("concluído")}` : "";
        this._buildHeader({
            title: folder.name,
            subtitle: `${plural(folder.lists.length, _("lista"), _("listas"))} · ${plural(undoneCount(folder), _("pendente"), _("pendentes"))}${status}`,
            onBack: () => this._navigate({ screen: folder.completed ? SCREEN.COMPLETED : SCREEN.FOLDERS }),
            actions,
        });
        if (isEmpty(folder.lists)) {
            this._emptyState(_("Nenhuma lista ainda"), _("Crie a primeira no campo abaixo"));
            return;
        }
        for (const list of folder.lists) {
            this._content.add_child(this._entityRow({
                kind: "list",
                id: list.id,
                title: list.name,
                meta: plural(todoCount(list), _("tarefa"), _("tarefas")),
                badge: undoneCount(list),
                hasContent: todoCount(list) > 0,
                onOpen: () => this._navigate({ screen: SCREEN.TODOS, folderId: folder.id, listId: list.id }),
                onRename: (name) => this._send(this._client.renameList(folder.id, list.id, name)),
                onDelete: () => this._send(this._client.removeList(folder.id, list.id)),
            }));
        }
    }

    /** The daemon is missing or the stored data is unreadable: nothing can be shown or changed. */
    _renderError() {
        this._buildHeader({ title: _("Projetos") });
        this._emptyState(_("Não foi possível carregar as tarefas"), _("Veja os detalhes com: journalctl --user -g organizedtodo"));
        this._footer.visible = false;
    }

    _renderTodos(folder, list) {
        this._buildHeader({
            title: list.name,
            subtitle: folder.name,
            onBack: () => this._navigate({ screen: SCREEN.LISTS, folderId: folder.id }),
        });
        if (isEmpty(list.todos)) {
            this._emptyState(_("✅ Nada a fazer"), _("Adicione uma tarefa no campo abaixo"));
            return;
        }
        list.todos.forEach((task, index) => {
            this._content.add_child(this._todoRow(folder.id, list.id, task, index));
        });
    }

    /** Notes of one todo: drawn as markdown, or the raw text while editing. */
    _renderNotes(folder, list, todo) {
        const { index } = this._view;
        const save = () => {
            const notes = this._editingNotes.draft;
            this._editingNotes = null;
            this._send(this._client.setTodoNotes(folder.id, list.id, index, notes));
            this._render();
        };
        const action = this._editingNotes
            ? this._pillButton(_("Salvar"), save, "organizedtodo-accent-btn")
            : this._iconButton("document-edit-symbolic", "", () => {
                this._editingNotes = { draft: todo.notes ?? "" };
                this._render();
            });
        this._buildHeader({
            title: todo.name,
            subtitle: list.name,
            onBack: () => this._navigate({ screen: SCREEN.TODOS, folderId: folder.id, listId: list.id }),
            actions: [action],
        });
        if (this._editingNotes) {
            const entry = this._notesEntry(save);
            this._content.add_child(entry);
            entry.grab_key_focus();
            return;
        }
        if (!todo.notes) {
            this._emptyState(_("📝 Sem anotações"), _("Use o lápis para escrever; aceita markdown"));
            return;
        }
        for (const { markup, link, code } of noteBlocks(todo.notes)) {
            const style_class = code ? "organizedtodo-note-code" : "organizedtodo-note-line";
            const line = this._markupLabel(markup, link, { style_class, x_expand: true });
            line.clutterText.line_wrap = true;
            line.clutterText.set_ellipsize(0);
            this._content.add_child(line);
        }
    }

    /** Multi-line entry: Enter breaks the line, Ctrl+Enter saves, Escape cancels. */
    _notesEntry(onSave) {
        const entry = new St.Entry({
            text: this._editingNotes.draft,
            hint_text: _("Escreva em markdown..."),
            style_class: "organizedtodo-input",
            can_focus: true,
            x_expand: true,
        });
        const text = entry.clutterText;
        text.single_line_mode = false;
        text.activatable = false;
        text.line_wrap = true;
        text.set_max_length(MAX_NOTES_CHARS);
        // The draft survives redraws (a Changed signal) and closing the menu
        text.connect("text-changed", () => {
            this._editingNotes.draft = entry.get_text();
        });
        text.connect("key-press-event", (_actor, event) => {
            const key = event.get_key_symbol();
            if (key === Clutter.KEY_Escape) {
                // Cancel the edit only; do not let Escape close the whole menu
                this._editingNotes = null;
                this._render();
                return Clutter.EVENT_STOP;
            }
            const state = event.get_state();
            const isEnter = key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter;
            if (isEnter && state & Clutter.ModifierType.CONTROL_MASK) {
                onSave();
                return Clutter.EVENT_STOP;
            }
            if (isEnter) {
                newLineKeepingIndent(text);
                return Clutter.EVENT_STOP;
            }
            // Shift+Tab arrives as ISO_Left_Tab; either way, Tab must not move the focus away
            if (key === Clutter.KEY_ISO_Left_Tab || (key === Clutter.KEY_Tab && state & Clutter.ModifierType.SHIFT_MASK)) {
                unindentLine(text);
                return Clutter.EVENT_STOP;
            }
            if (key === Clutter.KEY_Tab) {
                insertAtCursor(text, NOTES_INDENT);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        // The content scrolls at SCROLL_MAX_HEIGHT; keep the line being typed in view
        const adjustment = this._scroll.vadjustment ?? this._scroll.vscroll.adjustment;
        const showCursor = () => {
            const rect = text.get_cursor_rect();
            const top = entry.y + text.y + rect.get_y();
            const bottom = top + rect.get_height();
            if (top < adjustment.value) {
                adjustment.value = top;
            }
            else if (bottom > adjustment.value + adjustment.page_size) {
                adjustment.value = bottom - adjustment.page_size;
            }
        };
        text.connect("cursor-changed", showCursor);
        // A new line makes the content taller only after the next layout: try again then
        const changedId = adjustment.connect("changed", showCursor);
        entry.connect("destroy", () => adjustment.disconnect(changedId));
        return entry;
    }

    // ------------------------------------------------------- shared pieces

    _buildHeader({ title, subtitle, onBack, actions = [] }) {
        if (onBack) {
            this._header.add_child(this._iconButton("go-previous-symbolic", "", onBack));
        }
        const titles = new St.BoxLayout({
            vertical: true,
            style_class: "organizedtodo-titles",
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        titles.add_child(this._markdownLabel(title, { style_class: "organizedtodo-title" }));
        if (subtitle) {
            titles.add_child(this._markdownLabel(subtitle, { style_class: "organizedtodo-subtitle" }));
        }
        this._header.add_child(titles);
        for (const action of actions) {
            this._header.add_child(action);
        }
    }

    _emptyState(title, hint) {
        const box = new St.BoxLayout({
            vertical: true,
            style_class: "organizedtodo-empty",
            x_expand: true,
        });
        box.add_child(new St.Label({ text: title, style_class: "organizedtodo-empty-title" }));
        box.add_child(new St.Label({ text: hint, style_class: "organizedtodo-empty-hint" }));
        this._content.add_child(box);
    }

    /**
     * Label that draws `text` as markdown; its `text` property keeps the string as typed.
     * When the text has a link, clicking the label opens it (and nothing behind it reacts).
     */
    _markdownLabel(text, props, { struck = false } = {}) {
        const markup = markdownToMarkup(text);
        return this._markupLabel(struck ? `<s>${markup}</s>` : markup, firstLink(text), { text, ...props });
    }

    /** Label drawing `markup`; when `url` is set, clicking the label opens it. */
    _markupLabel(markup, url, props) {
        const label = new St.Label(props);
        label.clutterText.set_markup(markup);
        if (url) {
            label.reactive = true;
            // Swallow the press too, or a parent button (the row) would still react
            label.connect("button-press-event", () => Clutter.EVENT_STOP);
            label.connect("button-release-event", () => {
                this._openLink(url);
                return Clutter.EVENT_STOP;
            });
        }
        return label;
    }

    _openLink(url) {
        try {
            Gio.AppInfo.launch_default_for_uri(url, global.create_app_launch_context(0, -1));
        }
        catch (e) {
            console.error(`organizedtodo: cannot open ${url}: ${e}`);
            return;
        }
        this._button.menu.close();
    }

    _iconButton(iconName, extraClass, onClick) {
        const button = new St.Button({
            style_class: `organizedtodo-icon-btn ${extraClass}`,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({ icon_name: iconName, style_class: "organizedtodo-icon" }),
        });
        button.connect("clicked", () => onClick());
        return button;
    }

    _pillButton(label, onClick, extraClass = "") {
        const button = new St.Button({
            label,
            style_class: `organizedtodo-pill ${extraClass}`,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        button.connect("clicked", () => onClick());
        return button;
    }

    /** First click arms the button ("Excluir?"), second click deletes. */
    _deleteButton(key, needsConfirm, onDelete) {
        const armed = this._pendingDelete === key;
        const button = armed
            ? this._pillButton(_("Excluir?"), () => { }, "organizedtodo-danger-btn")
            : this._iconButton("edit-delete-symbolic", "organizedtodo-delete-btn", () => { });
        button.connect("clicked", () => {
            if (needsConfirm && !armed) {
                this._pendingDelete = key;
            }
            else {
                this._pendingDelete = null;
                onDelete();
            }
            this._render();
        });
        return button;
    }

    _renameEntry(initial, onCommit) {
        const entry = new St.Entry({
            text: initial,
            style_class: "organizedtodo-input",
            can_focus: true,
            x_expand: true,
        });
        entry.clutterText.set_max_length(MAX_INPUT_CHARS);
        entry.clutterText.connect("activate", () => {
            const name = entry.get_text().trim();
            this._renaming = null;
            if (name) {
                onCommit(name);
            }
            this._render();
        });
        entry.clutterText.connect("key-press-event", (_actor, event) => {
            if (event.get_key_symbol() !== Clutter.KEY_Escape) {
                return Clutter.EVENT_PROPAGATE;
            }
            // Cancel the rename only; do not let Escape close the whole menu
            this._renaming = null;
            this._render();
            return Clutter.EVENT_STOP;
        });
        this._toFocus = entry;
        return entry;
    }

    _folderRow(folder, extra = []) {
        return this._entityRow({
            kind: "folder",
            id: folder.id,
            title: folder.name,
            meta: `${plural(folder.lists.length, _("lista"), _("listas"))} · ${plural(todoCount(folder), _("tarefa"), _("tarefas"))}`,
            badge: folder.completed ? 0 : undoneCount(folder),
            hasContent: folder.lists.length > 0,
            extra,
            onOpen: () => this._navigate({ screen: SCREEN.LISTS, folderId: folder.id }),
            onRename: (name) => this._send(this._client.renameFolder(folder.id, name)),
            onDelete: () => this._send(this._client.removeFolder(folder.id)),
        });
    }

    /** One row for a folder or a list: open, rename inline, delete. */
    _entityRow({ kind, id, title, meta, badge, hasContent, extra = [], onOpen, onRename, onDelete }) {
        const key = `${kind}:${id}`;
        const row = new St.BoxLayout({
            style_class: "organizedtodo-row",
            reactive: true,
            track_hover: true,
            x_expand: true,
        });
        row._revealKey = key;
        const info = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        if (this._renaming?.key === key) {
            info.add_child(this._renameEntry(title, onRename));
            row.add_child(info);
            return row;
        }
        info.add_child(this._markdownLabel(title, { style_class: "organizedtodo-row-title" }));
        info.add_child(new St.Label({ text: meta, style_class: "organizedtodo-row-meta" }));
        const inner = new St.BoxLayout({ x_expand: true });
        inner.add_child(info);
        if (badge) {
            inner.add_child(new St.Label({
                text: String(badge),
                style_class: "organizedtodo-badge",
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
        inner.add_child(new St.Icon({
            icon_name: "go-next-symbolic",
            style_class: "organizedtodo-chevron",
            y_align: Clutter.ActorAlign.CENTER,
        }));
        const main = new St.Button({
            style_class: "organizedtodo-row-main",
            can_focus: true,
            x_expand: true,
            child: inner,
        });
        main.connect("clicked", () => onOpen());
        row.add_child(main);
        for (const widget of extra) {
            row.add_child(widget);
        }
        row.add_child(this._iconButton("document-edit-symbolic", "", () => {
            this._renaming = { key };
            this._pendingDelete = null;
            this._render();
        }));
        row.add_child(this._deleteButton(key, hasContent, onDelete));
        return row;
    }

    // --------------------------------------------------------------- todos

    _todoRow(folderId, listId, task, index) {
        const isFocused = index === 0 && !!task.isFocused;
        const classes = ["organizedtodo-row", "organizedtodo-todo"];
        if (isFocused) {
            classes.push("organizedtodo-focused");
        }
        if (task.isDone) {
            classes.push("organizedtodo-done");
        }
        const row = new St.BoxLayout({
            style_class: classes.join(" "),
            reactive: true,
            track_hover: true,
            x_expand: true,
        });
        // The name is part of the key: if another todo is removed meanwhile, indices
        // shift, the key stops matching and the edit is dropped instead of hitting the wrong todo
        const key = `todo:${listId}:${index}:${task.name}`;
        if (this._renaming?.key === key) {
            row.add_child(this._renameEntry(task.name, (name) => this._send(this._client.renameTodo(folderId, listId, index, name))));
            return row;
        }

        const check = new St.Button({
            style_class: `organizedtodo-check${task.isDone ? " organizedtodo-check-on" : ""}`,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Label({
                text: task.isDone ? "✔" : "",
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            }),
        });
        check.connect("clicked", async () => {
            this._pulse = { listId, index };
            const folderName = this._client.getFolder(folderId)?.name ?? "";
            let completedProject;
            try {
                completedProject = await this._client.toggleTodo(folderId, listId, index);
            }
            catch (e) {
                console.error(`organizedtodo: daemon call failed: ${e}`);
                this._pulse = null;
                return;
            }
            // The extension may have been disabled while waiting for the daemon
            if (completedProject && this._client) {
                // Notifications take no markup: show the name without the markdown markers
                Main.notify(_("Projeto concluído"), markdownToPlain(folderName));
                this._navigate({ screen: SCREEN.FOLDERS });
            }
        });

        const label = this._markdownLabel(task.name, {
            style_class: "organizedtodo-todo-label",
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        }, { struck: task.isDone });
        label.clutterText.line_wrap = true;
        label.clutterText.set_ellipsize(0);

        const notes = this._iconButton("text-x-generic-symbolic", task.notes ? "organizedtodo-notes-on" : "", () => {
            this._navigate({ screen: SCREEN.NOTES, folderId, listId, index, name: task.name });
        });
        const edit = this._iconButton("document-edit-symbolic", "", () => {
            this._renaming = { key };
            this._pendingDelete = null;
            this._render();
        });
        const focus = this._iconButton("find-location-symbolic", "organizedtodo-focus-btn", () => {
            this._send(this._client.setTodoFocus(folderId, listId, index, !isFocused));
            this._render();
        });
        const remove = this._iconButton("edit-delete-symbolic", "organizedtodo-delete-btn", () => {
            this._send(this._client.removeTodo(folderId, listId, index));
            this._render();
        });
        const dragHandle = new St.Button({
            style_class: "organizedtodo-drag-btn",
            can_focus: true,
            reactive: true,
            track_hover: true,
            x_expand: false,
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Label({ text: "=", y_align: Clutter.ActorAlign.CENTER }),
        });

        row.add_child(check);
        row.add_child(label);
        row.add_child(notes);
        row.add_child(edit);
        row.add_child(focus);
        row.add_child(remove);
        row.add_child(dragHandle);
        this._makeSortable(row, dragHandle, folderId, listId, index);
        // By name, not index: reordering or toggling a todo does not make it "new"
        row._revealKey = `todo:${listId}:${task.name}`;
        row._listId = listId;
        row._index = index;
        row._check = check;
        row._done = task.isDone;
        return row;
    }

    /**
     * Shell DND: same delegate on the row and on the handle, so the row is a
     * drop target and the handle is the drag source. Reordering is limited to
     * the list being shown.
     */
    _makeSortable(row, dragHandle, folderId, listId, index) {
        const delegate = {
            isTodoItem: true,
            listId,
            index,
            actor: row,
            getDragActor: () => new Clutter.Clone({ source: row, opacity: 200 }),
            getDragActorSource: () => row,
            handleDragOver: (source) => {
                if (!source?.isTodoItem || source.listId !== listId || source.index === index) {
                    this._clearDragOver();
                    return DND.DragMotionResult.NO_DROP;
                }
                this._setDragOver(row);
                return DND.DragMotionResult.MOVE_DROP;
            },
            acceptDrop: (source, _actor, _x, y) => {
                this._clearDragOver();
                if (!source?.isTodoItem || source.listId !== listId || source.index === index) {
                    return false;
                }
                const height = row.height ?? 0;
                const placeAfter = height > 0 ? y > height / 2 : false;
                // Persist only; the daemon's Changed redraws once the drag has ended
                return this._reorderTodo(folderId, listId, source.index, index, placeAfter);
            },
        };
        row._delegate = delegate;
        dragHandle._delegate = delegate;
        const draggable = DND.makeDraggable(dragHandle, { dragActorOpacity: 200 });
        draggable.connect("drag-begin", () => {
            this._dragging = true;
            row.add_style_class_name("organizedtodo-dragging");
            return true;
        });
        draggable.connect("drag-end", () => {
            this._dragging = false;
            row.remove_style_class_name("organizedtodo-dragging");
            this._clearDragOver();
            if (this._pendingRerender) {
                this._pendingRerender = false;
                this._render();
            }
            return true;
        });
    }

    _setDragOver(row) {
        if (this._dragOverItem === row) {
            return;
        }
        this._clearDragOver();
        row.add_style_class_name("organizedtodo-drag-over");
        this._dragOverItem = row;
    }

    _clearDragOver() {
        if (this._dragOverItem) {
            this._dragOverItem.remove_style_class_name("organizedtodo-drag-over");
            this._dragOverItem = null;
        }
    }

    /** `placeAfter` decides insert before vs after the drop target row. */
    _reorderTodo(folderId, listId, fromIndex, targetIndex, placeAfter) {
        let toIndex = placeAfter ? targetIndex + 1 : targetIndex;
        // After removing fromIndex, later indices shift left
        if (fromIndex < toIndex) {
            toIndex -= 1;
        }
        if (fromIndex === toIndex) {
            return false;
        }
        this._send(this._client.reorderTodo(folderId, listId, fromIndex, toIndex));
        return true;
    }
}
