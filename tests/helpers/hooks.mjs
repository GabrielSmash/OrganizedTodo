// Node loader hooks: map the GNOME Shell imports (gi://, resource://) used by
// extension.js to the fakes in stubs.mjs, so the real extension code runs in Node.
const STUBS = new URL("./stubs.mjs", import.meta.url).href;
// extension.js talks to the daemon through client.js; the tests swap it for an in-memory fake
const FAKE_CLIENT = new URL("./fake-client.mjs", import.meta.url).href;

const SOURCES = {
    "gi://Clutter": `export default {
        ActorAlign: { FILL: 0, CENTER: 1, START: 2, END: 3 },
        AnimationMode: { EASE_IN_QUAD: 4, EASE_OUT_QUAD: 5, EASE_OUT_BACK: 26 },
        EVENT_STOP: true, EVENT_PROPAGATE: false,
        KEY_Escape: 65307, KEY_Return: 65293, KEY_KP_Enter: 65421, KEY_Tab: 65289, KEY_ISO_Left_Tab: 65056,
        ModifierType: { SHIFT_MASK: 1, CONTROL_MASK: 4 },
        Clone: class { constructor(o) { Object.assign(this, o); } } };`,
    "gi://Gio": `export default {
        icon_new_for_string: (p) => ({ path: p }),
        // new Gio.Settings({ schema_id }) returns the fake the test registered for that schema
        Settings: class { constructor({ schema_id }) { return globalThis.__systemSettings[schema_id]; } },
        AppInfo: { launch_default_for_uri: (uri) => { (globalThis.__opened ??= []).push(uri); } } };`,
    "gi://GLib": `export default { markup_escape_text: (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;') };`,
    "gi://Meta": `export default { KeyBindingFlags: { NONE: 0 } };`,
    "gi://Shell": `export default { ActionMode: { ALL: 1, NORMAL: 2, OVERVIEW: 4 } };`,
    "gi://St": `import { St } from "${STUBS}"; export default St;`,
    "resource:///org/gnome/shell/extensions/extension.js": `
        export class Extension {
            get metadata() { return { name: "OrganizedTodo" }; }
            get uuid() { return "organizedtodo@gabrielsmash.github.io"; }
            get path() { return "/ext"; }
            getSettings() { return globalThis.__settings; }
            openPreferences() { globalThis.__prefsOpened = (globalThis.__prefsOpened ?? 0) + 1; } }
        export const gettext = (s) => s;`,
    "resource:///org/gnome/shell/ui/panelMenu.js": `import { PanelButton } from "${STUBS}"; export const Button = PanelButton;`,
    "resource:///org/gnome/shell/ui/main.js": `
        import { Actor } from "${STUBS}";
        export const uiGroup = new Actor();
        export const panel = {
            _leftBox: new Actor(), _centerBox: new Actor(), _rightBox: new Actor(),
            addToStatusArea(role, indicator, position, box) {
                const target = { left: this._leftBox, center: this._centerBox }[box] ?? this._rightBox;
                target.insert_child_at_index(indicator.container, position ?? 0);
            } };
        export const wm = {
            addKeybinding(name, settings, flags, mode, handler) { (globalThis.__bound ??= {})[name] = handler; },
            removeKeybinding(name) { (globalThis.__unbound ??= []).push(name); } };
        export function notify(t, b) { (globalThis.__notes ??= []).push([t, b]); }`,
    "resource:///org/gnome/shell/ui/dnd.js": `
        export const DragMotionResult = { NO_DROP: 0, MOVE_DROP: 1 };
        export function makeDraggable() { const d = { handlers: {}, connect(s, f) { this.handlers[s] = f; } }; (globalThis.__draggables ??= []).push(d); return d; }`,
    "resource:///org/gnome/shell/ui/modalDialog.js": `
        import { Actor, BoxLayout } from "${STUBS}";
        export class ModalDialog extends Actor {
            constructor(params) { super(params); this.contentLayout = new BoxLayout(); this.add_child(this.contentLayout); this.buttons = []; }
            setButtons(buttons) { this.buttons = buttons; }
            setInitialKeyFocus(actor) { this.initialFocus = actor; }
            open() { this.opened = true; (globalThis.__dialogs ??= []).push(this); }
            // Like destroyOnClose: closing destroys
            close() { this.opened = false; this.destroy(); } };`,
};

export async function resolve(spec, ctx, next) {
    if (spec in SOURCES) return { url: `stub:${spec}`, shortCircuit: true };
    if (spec === "./client.js" && ctx.parentURL?.endsWith("/extension.js")) return { url: FAKE_CLIENT, shortCircuit: true };
    return next(spec, ctx);
}
export async function load(url, ctx, next) {
    if (url.startsWith("stub:")) {
        return { format: "module", shortCircuit: true, source: SOURCES[url.slice(5)] };
    }
    return next(url, ctx);
}
