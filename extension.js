"use strict";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import St from "gi://St";
import { Extension, gettext as _, } from "resource:///org/gnome/shell/extensions/extension.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as DND from "resource:///org/gnome/shell/ui/dnd.js";
import { TodoClient, undoneCount, todoCount } from "./client.js";
import { isEmpty } from "./utils.js";

const MENU_WIDTH = 440;
const SCROLL_MAX_HEIGHT = 380;
const MAX_INPUT_CHARS = 200;

const SCREEN = {
    FOLDERS: "folders",
    COMPLETED: "completed",
    LISTS: "lists",
    TODOS: "todos",
};

// A function, not a constant: gettext needs the extension instance, which does not exist at import time
const inputHint = (screen) => ({
    [SCREEN.FOLDERS]: _("Novo projeto..."),
    [SCREEN.LISTS]: _("Nova lista..."),
    [SCREEN.TODOS]: _("Nova tarefa..."),
    [SCREEN.COMPLETED]: "",
}[screen]);

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export default class TodoListExtension extends Extension {
    _client;
    _button;
    _mainBox;
    _header;
    _content;
    _footer;
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
        Main.wm.removeKeybinding("open-organizedtodo");
        this._button?.destroy();
        this._button = null;
        this._mainBox = null;
        this._header = null;
        this._content = null;
        this._footer = null;
        this._input = null;
        this._toFocus = null;
        this._renaming = null;
        this._pendingDelete = null;
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
        const scroll = new St.ScrollView({
            style_class: "vfade organizedtodo-scroll",
            style: `max-height: ${SCROLL_MAX_HEIGHT}px;`,
            hscrollbar_policy: St.PolicyType.NEVER,
            overlay_scrollbars: true,
        });
        scroll.add_child(this._content);
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
        this._mainBox.add_child(scroll);
        this._mainBox.add_child(this._footer);
        this._button.menu.box.add_child(this._mainBox);
        // Half-finished interactions should not survive closing the menu
        this._button.menu.connect("open-state-changed", (_menu, isOpen) => {
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
        this._view = view;
        this._renaming = null;
        this._pendingDelete = null;
        this._render();
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
        // Whatever the view points to may have been deleted (here or via dconf)
        let screen = this._view.screen;
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
            this._view = { screen, folderId: folder?.id };
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
        }
        this._input.hint_text = inputHint(screen);
        this._footer.visible = screen !== SCREEN.COMPLETED;
        if (this._toFocus) {
            this._toFocus.grab_key_focus();
            this._toFocus.clutterText.set_selection(0, -1);
            this._toFocus = null;
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
        titles.add_child(new St.Label({ text: title, style_class: "organizedtodo-title" }));
        if (subtitle) {
            titles.add_child(new St.Label({ text: subtitle, style_class: "organizedtodo-subtitle" }));
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
        info.add_child(new St.Label({ text: title, style_class: "organizedtodo-row-title" }));
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
            const folderName = this._client.getFolder(folderId)?.name ?? "";
            let completedProject;
            try {
                completedProject = await this._client.toggleTodo(folderId, listId, index);
            }
            catch (e) {
                console.error(`organizedtodo: daemon call failed: ${e}`);
                return;
            }
            // The extension may have been disabled while waiting for the daemon
            if (completedProject && this._client) {
                Main.notify(_("Projeto concluído"), folderName);
                this._navigate({ screen: SCREEN.FOLDERS });
            }
        });

        const label = new St.Label({
            text: task.name,
            style_class: "organizedtodo-todo-label",
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });
        label.clutterText.line_wrap = true;
        label.clutterText.set_ellipsize(0);
        if (task.isDone) {
            label.clutterText.set_markup(`<s>${GLib.markup_escape_text(task.name, -1)}</s>`);
        }

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
        row.add_child(edit);
        row.add_child(focus);
        row.add_child(remove);
        row.add_child(dragHandle);
        this._makeSortable(row, dragHandle, folderId, listId, index);
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
