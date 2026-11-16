// Preferences window. It runs in its own process, not inside GNOME Shell:
// it talks to the extension and the daemon only through GSettings keys.
import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import Gtk from "gi://Gtk";
import { ExtensionPreferences, gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

const THEMES = ["organizedtodo", "system"];

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

export default class OrganizedTodoPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        this._loadStyle(window);
        window.add(this._appearancePage(window, settings));
        window.add(this._behaviorPage(window, settings));
        window.add(this._shortcutsPage(window, settings));
    }

    _appearancePage(window, settings) {
        const page = new Adw.PreferencesPage({ title: _("Appearance"), icon_name: "applications-graphics-symbolic" });
        const group = new Adw.PreferencesGroup({ title: _("Theme") });
        const theme = new Adw.ComboRow({
            title: _("Theme"),
            subtitle: _("Colors of the menu, the quick add and this window"),
            model: Gtk.StringList.new([_("OrganizedTodo"), _("System")]),
        });
        group.add(theme);
        page.add(group);
        bindCombo(window, settings, "theme", theme, THEMES);
        watch(window, settings, "theme", () => {
            if (settings.get_string("theme") === "organizedtodo") {
                window.add_css_class("organizedtodo-prefs");
            }
            else {
                window.remove_css_class("organizedtodo-prefs");
            }
        });

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

    /** prefs.css for this window; removed on close so reopening does not stack copies */
    _loadStyle(window) {
        const provider = new Gtk.CssProvider();
        provider.load_from_path(`${this.path}/prefs.css`);
        const display = window.get_display();
        Gtk.StyleContext.add_provider_for_display(display, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        window.connect("close-request", () => Gtk.StyleContext.remove_provider_for_display(display, provider));
    }
}
