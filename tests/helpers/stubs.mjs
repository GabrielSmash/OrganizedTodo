// Minimal fakes of the GNOME Shell UI toolkit, enough to run extension.js in Node.
export class ClutterText {
    constructor() { this.handlers = {}; this.line_wrap = false; }
    connect(sig, fn) { (this.handlers[sig] ??= []).push(fn); return 1; }
    emit(sig, ...args) { return (this.handlers[sig] ?? []).map((fn) => fn(this, ...args)); }
    set_max_length() {}
    set_ellipsize() {}
    set_selection() {}
    set_markup(m) { this.markup = m; }
    set_text(t) { this.text = t; }
    grab_key_focus() { globalThis.__focus = this; }
    // Editing, counted in characters like Clutter (-1 is the end); the text lives in the
    // owner (St.Entry). No selection in the tests.
    get_text() { return this.owner.text ?? ""; }
    get_cursor_position() { return this.cursor ?? -1; }
    get_cursor_rect() { const { y, height } = this.cursorRect; return { get_y: () => y, get_height: () => height }; }
    delete_selection() { return false; }
    insert_text(insertion, position) {
        const chars = [...this.get_text()];
        const at = position < 0 ? chars.length : position;
        chars.splice(at, 0, ...insertion);
        this.owner.text = chars.join("");
        if (this.cursor >= 0 && at <= this.cursor) {
            this.cursor += [...insertion].length;
        }
        this.emit("text-changed");
    }
    delete_text(start, end) {
        const chars = [...this.get_text()];
        chars.splice(start, end - start);
        this.owner.text = chars.join("");
        if (this.cursor >= end) {
            this.cursor -= end - start;
        }
        this.emit("text-changed");
    }
}

let lastHandlerId = 0;

export class Actor {
    constructor(props = {}) {
        this.children = [];
        this.handlers = {};
        this.classes = new Set();
        Object.assign(this, props);
        this.clutterText = new ClutterText();
        this.clutterText.owner = this;
    }
    add_child(c) { this.children.push(c); c.parent = this; }
    set_child(c) { this.child = c; }
    // Like Clutter: destroying emits "destroy", and destroying a parent destroys its children
    destroy_all_children() { for (const c of this.children.splice(0)) c.destroy?.(); }
    destroy() { this.destroyed = true; this.emit("destroy"); this.destroy_all_children(); }
    connect(sig, fn) { (this.handlers[sig] ??= []).push(fn); fn.id = ++lastHandlerId; return fn.id; }
    emit(sig, ...args) { return (this.handlers[sig] ?? []).map((fn) => fn(this, ...args)); }
    get_text() { return this.text ?? ""; }
    set_text(t) { this.text = t; }
    grab_key_focus() { globalThis.__focus = this; }
    add_style_class_name(n) { this.classes.add(n); }
    remove_style_class_name(n) { this.classes.delete(n); }
    get_children() { return this.children; }
    set_pivot_point(x, y) { this.pivot = [x, y]; }
    set_scale(x, y) { this.scale_x = x; this.scale_y = y; }
    get_transformed_position() { return [this.x ?? 0, this.y ?? 0]; }
    get_transformed_size() { return [this.width ?? 0, this.height ?? 0]; }
    set_position(x, y) { this.x = x; this.y = y; }
    disconnect(id) {
        for (const list of Object.values(this.handlers)) {
            const at = list.findIndex((fn) => fn.id === id);
            if (at >= 0) list.splice(at, 1);
        }
    }
    get_allocation_box() { return this.allocation; }
    // Records where each animation started, then jumps to the end values
    ease(props) {
        const { onStopped, ...values } = props;
        const from = Object.fromEntries(Object.keys(values).filter((k) => k !== "duration" && k !== "mode").map((k) => [k, this[k]]));
        (this.eased ??= []).push({ from, to: values });
        Object.assign(this, values);
        onStopped?.();
    }
}
export class BoxLayout extends Actor {}
export class Label extends Actor {}
export class Button extends Actor {}
export class Icon extends Actor {}
export class Entry extends Actor {}
export class ScrollView extends Actor {
    constructor(props) {
        super(props);
        this.vadjustment = new Actor({ value: 0, page_size: 100 });
    }
}
export class Widget extends Actor {}

export const St = {
    BoxLayout, Label, Button, Icon, Entry, ScrollView, Widget,
    PolicyType: { NEVER: 1 },
};

export class PanelButton extends Actor {
    constructor() {
        super();
        this.menu = new Actor();
        this.menu.actor = this.menu;
        this.menu.isOpen = false;
        this.menu.box = new Actor();
        this.menu.toggle = () => { };
    }
}

// ---- helpers for tests ----
export function walk(node, fn) {
    if (!node) return;
    fn(node);
    for (const c of node.children ?? []) walk(c, fn);
    if (node.child) walk(node.child, fn);
}
export function findAll(root, pred) {
    const out = [];
    walk(root, (n) => { if (pred(n)) out.push(n); });
    return out;
}
export const hasClass = (n, c) => (n.style_class ?? "").split(/\s+/).includes(c);
