// Node loader hooks: map the GNOME Shell imports (gi://, resource://) used by
// extension.js to the fakes in stubs.mjs, so the real extension code runs in Node.
const STUBS = new URL("./stubs.mjs", import.meta.url).href;
// extension.js talks to the daemon through client.js; the tests swap it for an in-memory fake
const FAKE_CLIENT = new URL("./fake-client.mjs", import.meta.url).href;

const SOURCES = {
    "gi://Clutter": `export default {
        ActorAlign: { FILL: 0, CENTER: 1, START: 2, END: 3 },
        AnimationMode: { EASE_IN_QUAD: 4, EASE_OUT_QUAD: 5, EASE_OUT_BACK: 26 },
        EVENT_STOP: true, EVENT_PROPAGATE: false, KEY_Escape: 65307,
        Clone: class { constructor(o) { Object.assign(this, o); } } };`,
    "gi://Gio": `export default {
        icon_new_for_string: (p) => ({ path: p }),
        AppInfo: { launch_default_for_uri: (uri) => { (globalThis.__opened ??= []).push(uri); } } };`,
    "gi://GLib": `export default { markup_escape_text: (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;') };`,
    "gi://Meta": `export default { KeyBindingFlags: { NONE: 0 } };`,
    "gi://Shell": `export default { ActionMode: { ALL: 1 } };`,
    "gi://St": `import { St } from "${STUBS}"; export default St;`,
    "resource:///org/gnome/shell/extensions/extension.js": `
        export class Extension {
            get metadata() { return { name: "OrganizedTodo" }; }
            get uuid() { return "organizedtodo@gabrielsmash.github.io"; }
            get path() { return "/ext"; }
            getSettings() { return globalThis.__settings; } }
        export const gettext = (s) => s;`,
    "resource:///org/gnome/shell/ui/panelMenu.js": `import { PanelButton } from "${STUBS}"; export const Button = PanelButton;`,
    "resource:///org/gnome/shell/ui/main.js": `
        import { Actor } from "${STUBS}";
        export const uiGroup = new Actor();
        export const panel = { addToStatusArea() {} };
        export const wm = {
            addKeybinding(name) { globalThis.__bound = name; },
            removeKeybinding(name) { globalThis.__unbound = name; } };
        export function notify(t, b) { (globalThis.__notes ??= []).push([t, b]); }`,
    "resource:///org/gnome/shell/ui/dnd.js": `
        export const DragMotionResult = { NO_DROP: 0, MOVE_DROP: 1 };
        export function makeDraggable() { const d = { handlers: {}, connect(s, f) { this.handlers[s] = f; } }; (globalThis.__draggables ??= []).push(d); return d; }`,
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
