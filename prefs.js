// Preferences window. It runs in its own process, not inside GNOME Shell:
// options reach the extension and the daemon through GSettings keys; the Data
// page (backup, cleanup) calls the daemon over D-Bus.
import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";
import { ExtensionPreferences, gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";
import { daemonProxy } from "./client.js";
import { isLight, LIGHT_THEME_CLASS } from "./utils.js";

// GTK's dialogs report back through callbacks; once promisified they can be awaited
Gio._promisify(Gtk.FileDialog.prototype, "save", "save_finish");
Gio._promisify(Gtk.FileDialog.prototype, "open", "open_finish");
Gio._promisify(Adw.AlertDialog.prototype, "choose", "choose_finish");

const THEMES = ["default", "light", "system"];
const AGENT_ACCESS = ["off", "read", "write"];

/** Runs update now and whenever the key changes, until the window closes */
function watch(window, settings, key, update) {
    const id = settings.connect(`changed::${key}`, update);
    window.connect("close-request", () => settings.disconnect(id));
    update();
}

/** Same key and modifiers, whatever order the modifiers are written in ("<Alt><Shift>" = "<Shift><Alt>") */
function sameShortcut(a, b) {
    const [okA, keyA, modsA] = Gtk.accelerator_parse(a);
    const [okB, keyB, modsB] = Gtk.accelerator_parse(b);
    return okA && okB && keyA === keyB && modsA === modsB;
}

/** A ComboRow whose position i stands for values[i] of a string key */
function bindCombo(window, settings, key, row, values) {
    row.connect("notify::selected", () => settings.set_string(key, values[row.selected]));
    watch(window, settings, key, () => {
        row.selected = values.indexOf(settings.get_string(key));
    });
}

/** A SpinRow tied to an integer key; its limits come from the key's <range> in the schema */
function spinRow(settings, key, props) {
    const [, [lower, upper]] = settings.settings_schema.get_key(key).get_range().recursiveUnpack();
    const row = new Adw.SpinRow({ ...props, adjustment: new Gtk.Adjustment({ lower, upper, step_increment: 20 }) });
    settings.bind(key, row, "value", Gio.SettingsBindFlags.DEFAULT);
    return row;
}

/** A short message at the bottom of the window */
function toast(window, title) {
    window.add_toast(new Adw.Toast({ title, timeout: 4 }));
}

/** The daemon's own message, without the "GDBus.Error:org.freedesktop.DBus.Error.Failed: " prefix */
function errorText(error) {
    if (error instanceof GLib.Error) {
        Gio.DBusError.strip_remote_error(error);
    }
    return error.message;
}

/** Closing a file dialog without choosing is not an error */
function dismissed(error) {
    return error instanceof GLib.Error
        && (error.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED)
            || error.matches(Gtk.DialogError, Gtk.DialogError.CANCELLED));
}

/** The daemon reads and writes files by path: a remote location has none */
function localPath(file) {
    const path = file.get_path();
    if (!path) {
        throw new Error(_("Choose a file on this computer"));
    }
    return path;
}

/** Asks before something that cannot be undone; true only when the user confirmed */
async function confirm(window, heading, body, action) {
    const dialog = new Adw.AlertDialog({ heading, body });
    dialog.add_response("cancel", _("Cancel"));
    dialog.add_response("confirm", action);
    dialog.set_response_appearance("confirm", Adw.ResponseAppearance.DESTRUCTIVE);
    // Enter and Esc both cancel: confirming takes a deliberate click
    dialog.set_default_response("cancel");
    dialog.set_close_response("cancel");
    return (await dialog.choose(window, null)) === "confirm";
}

/** Where make install puts the daemon. Agents start it themselves, maybe without our PATH */
function daemonPath() {
    return GLib.build_filenamev([GLib.get_home_dir(), ".local", "bin", "organizedtodo-daemon"]);
}

function copyText(window, text) {
    window.get_clipboard().set_content(Gdk.ContentProvider.new_for_value(text));
    toast(window, _("Copied"));
}

/** A row showing a command or snippet, with a button that copies it */
function copyRow(window, title, shown, copied = shown) {
    const row = new Adw.ActionRow({ title, subtitle: shown, subtitle_selectable: true });
    row.add_css_class("monospace");
    const button = new Gtk.Button({
        icon_name: "edit-copy-symbolic",
        tooltip_text: _("Copy"),
        valign: Gtk.Align.CENTER,
        css_classes: ["flat"],
    });
    button.connect("clicked", () => copyText(window, copied));
    row.add_suffix(button);
    return row;
}

function projects(count) {
    return `${count} ${count === 1 ? _("project") : _("projects")}`;
}

export default class OrganizedTodoPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        this._loadStyle(window);
        window.add(this._appearancePage(window, settings));
        window.add(this._behaviorPage(window, settings));
        window.add(this._shortcutsPage(window, settings));
        window.add(this._agentsPage(window, settings));
        window.add(this._dataPage(window));
    }

    _appearancePage(window, settings) {
        const page = new Adw.PreferencesPage({ title: _("Appearance"), icon_name: "applications-graphics-symbolic" });
        const group = new Adw.PreferencesGroup({ title: _("Theme") });
        const theme = new Adw.ComboRow({
            title: _("Theme"),
            subtitle: _("Menu, quick add and this window. System follows GNOME's light or dark style"),
            model: Gtk.StringList.new([_("Default"), _("Light"), _("System")]),
        });
        group.add(theme);
        page.add(group);
        bindCombo(window, settings, "theme", theme, THEMES);
        // The same rule and the same GNOME key as the menu, so the window and the menu always agree
        const desktop = new Gio.Settings({ schema_id: "org.gnome.desktop.interface" });
        const applyTheme = () => {
            if (isLight(settings.get_string("theme"), desktop.get_string("color-scheme"))) {
                window.add_css_class(LIGHT_THEME_CLASS);
            }
            else {
                window.remove_css_class(LIGHT_THEME_CLASS);
            }
        };
        watch(window, settings, "theme", applyTheme);
        watch(window, desktop, "color-scheme", applyTheme);

        const bar = new Adw.PreferencesGroup({ title: _("Top bar") });
        const position = new Adw.ComboRow({
            title: _("Icon position"),
            model: Gtk.StringList.new([_("Left"), _("Center"), _("Right")]),
        });
        bindCombo(window, settings, "panel-position", position, ["left", "center", "right"]);
        const count = new Adw.SwitchRow({ title: _("Pending count"), subtitle: _("Number of pending tasks next to the icon") });
        settings.bind("show-pending-count", count, "active", Gio.SettingsBindFlags.DEFAULT);
        bar.add(position);
        bar.add(count);
        page.add(bar);

        const menu = new Adw.PreferencesGroup({ title: _("Menu") });
        menu.add(spinRow(settings, "menu-width", { title: _("Width"), subtitle: _("In pixels") }));
        menu.add(spinRow(settings, "menu-height", { title: _("Maximum list height"), subtitle: _("In pixels; longer lists scroll") }));
        const effect = new Adw.SwitchRow({ title: _("Celebrate done tasks"), subtitle: _("The check pulses and dots burst out of it") });
        settings.bind("completion-effect", effect, "active", Gio.SettingsBindFlags.DEFAULT);
        menu.add(effect);
        page.add(menu);
        return page;
    }

    _behaviorPage(window, settings) {
        const page = new Adw.PreferencesPage({ title: _("Behavior"), icon_name: "preferences-other-symbolic" });

        const menu = new Adw.PreferencesGroup({ title: _("Menu") });
        const openOn = new Adw.ComboRow({
            title: _("When the menu opens"),
            model: Gtk.StringList.new([_("Show the last screen"), _("Go back to Projects")]),
        });
        bindCombo(window, settings, "open-on", openOn, ["last", "projects"]);
        const confirm = new Adw.SwitchRow({
            title: _("Confirm before deleting"),
            subtitle: _("Projects and lists that are not empty ask for a second click"),
        });
        settings.bind("confirm-delete", confirm, "active", Gio.SettingsBindFlags.DEFAULT);
        menu.add(openOn);
        menu.add(confirm);
        page.add(menu);

        const tasks = new Adw.PreferencesGroup({ title: _("Tasks") });
        const newAt = new Adw.ComboRow({
            title: _("New tasks go"),
            model: Gtk.StringList.new([_("At the bottom"), _("At the top")]),
        });
        bindCombo(window, settings, "new-todo-position", newAt, ["bottom", "top"]);
        const doneAt = new Adw.ComboRow({
            title: _("Done tasks"),
            model: Gtk.StringList.new([_("Stay in place"), _("Move to the bottom")]),
        });
        bindCombo(window, settings, "done-todo-position", doneAt, ["stay", "bottom"]);
        const completion = new Adw.ComboRow({
            title: _("When a project is all done"),
            model: Gtk.StringList.new([_("Show a Complete button"), _("Archive it")]),
        });
        bindCombo(window, settings, "project-completion", completion, ["button", "automatic"]);
        tasks.add(newAt);
        tasks.add(doneAt);
        tasks.add(completion);
        page.add(tasks);

        const quick = new Adw.PreferencesGroup({ title: _("Quick add") });
        const target = new Adw.ComboRow({
            title: _("Where tasks go"),
            model: Gtk.StringList.new([_("The last list used"), _("Ask every time")]),
        });
        bindCombo(window, settings, "quick-add-target", target, ["remember", "ask"]);
        quick.add(target);
        const keepOpen = new Adw.SwitchRow({
            title: _("Stay open after adding"),
            subtitle: _("To add several tasks in a row; Esc closes"),
        });
        settings.bind("quick-add-keep-open", keepOpen, "active", Gio.SettingsBindFlags.DEFAULT);
        quick.add(keepOpen);
        page.add(quick);
        return page;
    }

    _shortcutsPage(window, settings) {
        const page = new Adw.PreferencesPage({ title: _("Shortcuts"), icon_name: "preferences-desktop-keyboard-shortcuts-symbolic" });
        const group = new Adw.PreferencesGroup({ title: _("Shortcuts"), description: _("Click a shortcut to change it") });
        const shortcuts = [
            { key: "open-organizedtodo", title: _("Open the menu") },
            { key: "quick-add", title: _("Quick add a task") },
        ];
        for (const shortcut of shortcuts) {
            const { key, title } = shortcut;
            const row = new Adw.ActionRow({ title, activatable: true });
            const label = new Adw.ShortcutLabel({ disabled_text: _("Disabled"), valign: Gtk.Align.CENTER });
            const reset = new Gtk.Button({
                icon_name: "edit-undo-symbolic",
                tooltip_text: _("Back to the default"),
                valign: Gtk.Align.CENTER,
                css_classes: ["flat"],
            });
            reset.connect("clicked", () => settings.reset(key));
            row.add_suffix(label);
            row.add_suffix(reset);
            group.add(row);
            row.connect("activated", () =>
                this._captureShortcut(window, settings, shortcut, shortcuts.filter((other) => other !== shortcut)));
            // Only the first accelerator of the list is shown and edited, as GNOME Settings does
            watch(window, settings, key, () => {
                label.accelerator = settings.get_strv(key)[0] ?? "";
                reset.visible = settings.get_user_value(key) !== null;
            });
        }
        page.add(group);
        return page;
    }

    /** Waits for one key combination and saves it as the shortcut. Esc cancels, Backspace disables. */
    _captureShortcut(window, settings, { key, title }, others) {
        const status = new Adw.StatusPage({
            icon_name: "input-keyboard-symbolic",
            title: _("Press the new shortcut"),
            description: _("Esc cancels · Backspace disables"),
        });
        const view = new Adw.ToolbarView({ content: status });
        view.add_top_bar(new Adw.HeaderBar());
        const dialog = new Adw.Dialog({ title, child: view, content_width: 420 });
        const keys = new Gtk.EventControllerKey();
        // Capture phase: the dialog sees the keys before its focused button could act on them
        keys.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
        keys.connect("key-pressed", (_controller, keyval, _keycode, state) => {
            const mods = state & Gtk.accelerator_get_default_mod_mask();
            if (!mods && keyval === Gdk.KEY_Escape) {
                dialog.close();
                return Gdk.EVENT_STOP;
            }
            if (!mods && keyval === Gdk.KEY_BackSpace) {
                settings.set_strv(key, []);
                dialog.close();
                return Gdk.EVENT_STOP;
            }
            // A modifier alone is not a shortcut yet: wait for the rest
            if (!Gtk.accelerator_valid(keyval, mods)) {
                return Gdk.EVENT_STOP;
            }
            // Shift alone does not count: a global "Shift+T" would stop T from being typed anywhere
            if (!(mods & ~Gdk.ModifierType.SHIFT_MASK)) {
                status.description = _("Hold Ctrl, Alt or Super with the key");
                return Gdk.EVENT_STOP;
            }
            // Lower case, as mutter writes them: Shift+T is "<Shift>t"
            const accel = Gtk.accelerator_name(Gdk.keyval_to_lower(keyval), mods);
            const taken = others.find((other) => settings.get_strv(other.key).some((existing) => sameShortcut(existing, accel)));
            if (taken) {
                status.description = `${_("Already used by")} “${taken.title}”`;
                return Gdk.EVENT_STOP;
            }
            settings.set_strv(key, [accel]);
            dialog.close();
            return Gdk.EVENT_STOP;
        });
        dialog.add_controller(keys);
        dialog.present(window);
    }

    _agentsPage(window, settings) {
        const page = new Adw.PreferencesPage({ title: _("AI agents"), icon_name: "system-run-symbolic" });
        const access = new Adw.PreferencesGroup({
            title: _("Access"),
            description: _("AI agents such as Claude Code can use OrganizedTodo through MCP. "
                + "They never delete anything, and they only do what you allow here."),
        });
        const level = new Adw.ComboRow({
            title: _("AI agents can"),
            model: Gtk.StringList.new([_("Nothing"), _("Read your projects"), _("Read and change them")]),
        });
        bindCombo(window, settings, "agent-access", level, AGENT_ACCESS);
        // What the chosen level means, right under it: the combo labels alone leave doubts
        watch(window, settings, "agent-access", () => {
            level.subtitle = {
                off: _("Agents are told the access is off"),
                read: _("List projects and lists, read tasks and notes, search"),
                write: _("Also add projects, lists and tasks, complete, reopen, rename, write notes and focus"),
            }[settings.get_string("agent-access")];
        });
        access.add(level);
        page.add(access);

        const path = daemonPath();
        const connect = new Adw.PreferencesGroup({
            title: _("Connect an agent"),
            description: _("The agent starts OrganizedTodo's MCP server itself with this command; "
                + "nothing runs until it does."),
        });
        // --scope user: available in every folder, not only where the command was run (the default)
        const claudeCode = `claude mcp add --scope user organizedtodo -- ${GLib.shell_quote(path)} mcp`;
        connect.add(copyRow(window, _("Claude Code"), claudeCode));
        const config = JSON.stringify({ mcpServers: { organizedtodo: { command: path, args: ["mcp"] } } }, null, 2);
        connect.add(copyRow(window, _("Other agents (JSON configuration)"), `${path} mcp`, config));
        page.add(connect);
        return page;
    }

    _dataPage(window) {
        const page = new Adw.PreferencesPage({ title: _("Data"), icon_name: "drive-harddisk-symbolic" });
        const backup = new Adw.PreferencesGroup({
            title: _("Backup"),
            description: _("Every project, list, task and note, in one JSON file"),
        });
        const exportRow = new Adw.ActionRow({
            title: _("Export"),
            subtitle: _("Save everything to a file"),
            activatable: true,
        });
        exportRow.add_suffix(new Gtk.Image({ icon_name: "document-save-symbolic" }));
        exportRow.connect("activated", () => this._export(window));
        backup.add(exportRow);
        const importRow = new Adw.ActionRow({
            title: _("Import"),
            subtitle: _("Replace everything with a backup"),
            activatable: true,
        });
        importRow.add_suffix(new Gtk.Image({ icon_name: "document-open-symbolic" }));
        importRow.connect("activated", () => this._import(window));
        backup.add(importRow);
        page.add(backup);

        const archive = new Adw.PreferencesGroup({ title: _("Archive") });
        const purgeRow = new Adw.ActionRow({
            title: _("Delete archived projects"),
            subtitle: _("Every project in Completed, with its lists and tasks"),
            activatable: true,
        });
        purgeRow.add_suffix(new Gtk.Image({ icon_name: "user-trash-symbolic" }));
        purgeRow.connect("activated", () => this._removeArchived(window));
        archive.add(purgeRow);
        page.add(archive);
        return page;
    }

    async _export(window) {
        const today = GLib.DateTime.new_now_local().format("%Y-%m-%d");
        const dialog = new Gtk.FileDialog({
            title: _("Export projects"),
            initial_name: `organizedtodo-${today}.json`,
        });
        let file;
        try {
            file = await dialog.save(window, null);
        }
        catch (e) {
            if (!dismissed(e)) {
                toast(window, errorText(e));
            }
            return;
        }
        try {
            const proxy = await daemonProxy();
            await proxy.ExportWorkspaceAsync(localPath(file));
            toast(window, `${_("Exported to")} ${file.get_basename()}`);
        }
        catch (e) {
            toast(window, errorText(e));
        }
    }

    async _import(window) {
        const filter = new Gtk.FileFilter({ name: _("Backups (JSON)") });
        filter.add_pattern("*.json");
        const filters = new Gio.ListStore({ item_type: Gtk.FileFilter });
        filters.append(filter);
        const dialog = new Gtk.FileDialog({ title: _("Import projects"), filters });
        let file;
        try {
            file = await dialog.open(window, null);
        }
        catch (e) {
            if (!dismissed(e)) {
                toast(window, errorText(e));
            }
            return;
        }
        const replace = await confirm(
            window,
            _("Replace all your projects?"),
            `${_("Every project, list and task will be replaced by the ones in")} “${file.get_basename()}”. `
                + _("Export first if you may want them back."),
            _("Replace"),
        );
        if (!replace) {
            return;
        }
        try {
            const proxy = await daemonProxy();
            const [count] = await proxy.ImportWorkspaceAsync(localPath(file));
            toast(window, `${_("Imported")} ${projects(count)}`);
        }
        catch (e) {
            toast(window, errorText(e));
        }
    }

    async _removeArchived(window) {
        const remove = await confirm(
            window,
            _("Delete every archived project?"),
            _("The projects in Completed are deleted with their lists, tasks and notes. This cannot be undone."),
            _("Delete"),
        );
        if (!remove) {
            return;
        }
        try {
            const proxy = await daemonProxy();
            const [count] = await proxy.RemoveCompletedFoldersAsync();
            toast(window, count ? `${_("Deleted")} ${projects(count)}` : _("There were no archived projects"));
        }
        catch (e) {
            toast(window, errorText(e));
        }
    }

    /** prefs.css for this window; removed on close so reopening does not stack copies */
    _loadStyle(window) {
        const provider = new Gtk.CssProvider();
        provider.load_from_path(`${this.path}/prefs.css`);
        const display = window.get_display();
        window.add_css_class("organizedtodo-prefs");
        Gtk.StyleContext.add_provider_for_display(display, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        window.connect("close-request", () => Gtk.StyleContext.remove_provider_for_display(display, provider));
    }
}
