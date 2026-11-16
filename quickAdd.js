// Quick add: a dialog, opened by a shortcut from anywhere, that adds one task
// without going through the menu's screens. Where the task goes is the daemon's call.
import Clutter from "gi://Clutter";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import * as ModalDialog from "resource:///org/gnome/shell/ui/modalDialog.js";
import { markdownToPlain } from "./markdown.js";

/** A name as typed by people searching: no markdown markers, no accents, any case ("pao" finds "Pão"). */
const searchable = (name) => markdownToPlain(name)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export class QuickAdd {
    /**
     * destination: { folderId, listId } from the daemon, or null when there is no list yet.
     * onClosed runs once the dialog is gone, however it was closed.
     * themeClass: "" or the class for GNOME's accent color (see extension.js).
     * keepOpen: after adding, clear the entry for the next task instead of closing.
     */
    constructor(client, destination, onClosed, { themeClass = "", keepOpen = false } = {}) {
        this._client = client;
        this._destination = destination;
        this._keepOpen = keepOpen;
        /** The task typed so far, kept while the destination is being picked */
        this._draft = "";
        /** "Project › List" once picked here; until then it comes from the client's copy */
        this._targetLabel = null;
        // destroyOnClose is the default: a new dialog for every use, nothing left over
        this._dialog = new ModalDialog.ModalDialog({ styleClass: `organizedtodo-quick-add ${themeClass}` });
        this._dialog.connect("destroy", () => {
            this._dialog = null;
            onClosed();
        });
        // With no list at all, start where one can be created
        if (destination) {
            this._showTask();
        }
        else {
            this._showPicker(null);
        }
    }

    open() {
        this._dialog?.open();
    }

    close() {
        this._dialog?.close();
    }

    /** Where the task goes (click or Tab to change it), the task entry, Cancel and Add. */
    _showTask() {
        const content = this._dialog.contentLayout;
        content.destroy_all_children();
        const target = new St.Button({
            style_class: "organizedtodo-quick-add-target",
            label: `${this._targetText()} ▾`,
            x_align: Clutter.ActorAlign.START,
            can_focus: true,
        });
        target.connect("clicked", () => this._pickDestination());
        this._entry = new St.Entry({
            style_class: "organizedtodo-input",
            hint_text: _("New task..."),
            text: this._draft,
            can_focus: true,
            x_expand: true,
        });
        // The entry eats Enter's key press, so a default button would never see it:
        // Enter is the entry's activate, as in GNOME's own dialogs with entries
        this._entry.clutterText.connect("activate", () => this._add());
        // Tab picks the destination instead of moving the focus to the buttons
        this._entry.clutterText.connect("key-press-event", (_actor, event) => {
            if (event.get_key_symbol() !== Clutter.KEY_Tab) {
                return Clutter.EVENT_PROPAGATE;
            }
            this._pickDestination();
            return Clutter.EVENT_STOP;
        });
        content.add_child(target);
        content.add_child(this._entry);
        this._dialog.setButtons([
            { label: _("Cancel"), action: () => this.close(), key: Clutter.KEY_Escape },
            // Not default: a stale Enter release could fire it as well, adding the task twice
            { label: _("Add"), action: () => this._add() },
        ]);
        this._dialog.setInitialKeyFocus(this._entry);
        this._entry.grab_key_focus();
    }

    _targetText() {
        if (this._targetLabel) {
            return this._targetLabel;
        }
        const { folderId, listId } = this._destination ?? {};
        const folder = this._client.getFolder(folderId);
        const list = this._client.getList(folderId, listId);
        // Names may hold markdown; a label line reads better without the markers
        return folder && list
            ? `${markdownToPlain(folder.name)} › ${markdownToPlain(list.name)}`
            : _("Choose a list");
    }

    _pickDestination() {
        this._draft = this._entry.get_text();
        this._showPicker(null);
    }

    /** folder null: pick a project; otherwise pick one of its lists. Esc goes one step back. */
    _showPicker(folder) {
        const content = this._dialog.contentLayout;
        content.destroy_all_children();
        const candidates = folder ? folder.lists : this._client.getFolders(false);
        const pick = (option) => (folder ? this._choose(folder, option) : this._showPicker(option));
        const create = async (name) => {
            try {
                if (folder) {
                    const listId = await this._client.addList(folder.id, name);
                    if (listId && this._dialog) {
                        this._choose(folder, { id: listId, name });
                    }
                }
                else {
                    const folderId = await this._client.addFolder(name);
                    // The new project is not in the client's copy yet: show it as created, with no lists
                    if (folderId && this._dialog) {
                        this._showPicker({ id: folderId, name, lists: [] });
                    }
                }
            }
            catch (e) {
                console.error(`organizedtodo: daemon call failed: ${e}`);
            }
        };
        const filter = new St.Entry({
            style_class: "organizedtodo-input",
            hint_text: folder ? _("Filter lists...") : _("Filter projects..."),
            can_focus: true,
            x_expand: true,
        });
        const options = new St.BoxLayout({ vertical: true, style_class: "organizedtodo-quick-add-options" });
        let matches = [];
        let creating = null;
        const showOptions = () => {
            const query = searchable(filter.get_text());
            matches = candidates.filter((candidate) => searchable(candidate.name).includes(query));
            options.destroy_all_children();
            for (const option of matches) {
                const button = new St.Button({
                    style_class: "organizedtodo-quick-add-option",
                    label: markdownToPlain(option.name),
                    x_align: Clutter.ActorAlign.FILL,
                    can_focus: true,
                });
                button.connect("clicked", () => pick(option));
                options.add_child(button);
            }
            // Offered unless the typed name already exists here (it would make a duplicate)
            const name = filter.get_text().trim();
            creating = name && !candidates.some((candidate) => searchable(candidate.name) === searchable(name))
                ? name
                : null;
            if (creating) {
                const button = new St.Button({
                    style_class: "organizedtodo-quick-add-option organizedtodo-quick-add-create",
                    label: `${_("Create")} “${name}”`,
                    x_align: Clutter.ActorAlign.FILL,
                    can_focus: true,
                });
                button.connect("clicked", () => create(name));
                options.add_child(button);
            }
        };
        filter.clutterText.connect("text-changed", showOptions);
        // Enter in the filter takes the first match; arrows reach the others. No default
        // button here: it would fire too when Enter activates the option that has the focus
        filter.clutterText.connect("activate", () => {
            if (matches.length > 0) {
                pick(matches[0]);
            }
            else if (creating) {
                create(creating);
            }
        });
        content.add_child(new St.Label({
            style_class: "organizedtodo-quick-add-target",
            text: folder ? markdownToPlain(folder.name) : _("Projects"),
        }));
        content.add_child(filter);
        content.add_child(options);
        showOptions();
        this._dialog.setButtons([
            { label: _("Back"), action: () => (folder ? this._showPicker(null) : this._showTask()), key: Clutter.KEY_Escape },
        ]);
        this._dialog.setInitialKeyFocus(filter);
        filter.grab_key_focus();
    }

    _choose(folder, list) {
        this._destination = { folderId: folder.id, listId: list.id };
        // From the names in hand: a list created a moment ago may not be in the client's copy yet
        this._targetLabel = `${markdownToPlain(folder.name)} › ${markdownToPlain(list.name)}`;
        this._showTask();
    }

    _add() {
        const name = this._entry.get_text().trim();
        if (!name) {
            return;
        }
        if (!this._destination) {
            this._pickDestination();
            return;
        }
        const { folderId, listId } = this._destination;
        this._client.quickAddTodo(folderId, listId, name)
            .catch((e) => console.error(`organizedtodo: daemon call failed: ${e}`));
        if (!this._keepOpen) {
            this.close();
            return;
        }
        // Optimistic, like closing: a refused task (its list deleted meanwhile) only reaches the log
        this._entry.set_text("");
        this._entry.hint_text = `${_("Added")} “${name}” · ${_("next task...")}`;
    }
}
