// Runs the real extension.js against fakes of the GNOME toolkit (see helpers/).
// Checks logic and navigation, not appearance.
import assert from "node:assert/strict";
import { register } from "node:module";
register(new URL("./helpers/hooks.mjs", import.meta.url));

const { findAll, hasClass } = await import(new URL("./helpers/stubs.mjs", import.meta.url).href);
const { default: Ext } = await import(new URL("../extension.js", import.meta.url).href);

// ---- fake settings, seeded with one project: General / Tasks = [alpha (pending), beta (done)]
const store = {
    workspace: JSON.stringify({
        folders: [{
            id: "f0", name: "General", completed: false,
            lists: [{ id: "l0", name: "Tasks", todos: [{ name: "alpha", isDone: false }, { name: "beta", isDone: true }] }],
        }],
    }),
};
globalThis.__settings = { get_string: (k) => store[k], set_string: (k, v) => { store[k] = v; } };
globalThis.__notes = [];
globalThis.global = { create_app_launch_context: () => null };

const ext = new Ext();
ext.enable();
await new Promise((resolve) => setImmediate(resolve)); // connect() is async, like the real client

// ---- helpers
// Mutations are async and the redraw comes after them (the daemon's Changed): let it all settle
const flush = () => new Promise((resolve) => setImmediate(resolve));
const click = async (b) => { b.emit("clicked"); await flush(); };
const type = async (text) => { ext._input.text = text; ext._input.clutterText.emit("activate"); await flush(); };
const commit = async (entry) => { entry.clutterText.emit("activate"); await flush(); };
const rows = () => findAll(ext._content, (n) => hasClass(n, "organizedtodo-row"));
const rowTitles = () => findAll(ext._content, (n) => hasClass(n, "organizedtodo-row-title")).map((n) => n.text);
const todoLabels = () => findAll(ext._content, (n) => hasClass(n, "organizedtodo-todo-label")).map((n) => n.text);
const headerTitle = () => findAll(ext._header, (n) => hasClass(n, "organizedtodo-title"))[0]?.text;
const headerSub = () => findAll(ext._header, (n) => hasClass(n, "organizedtodo-subtitle"))[0]?.text;
const btnByIcon = (root, icon) => findAll(root, (n) => n.child?.icon_name === icon);
const mainBtn = (row) => findAll(row, (n) => hasClass(n, "organizedtodo-row-main"))[0];
const pill = (root, label) => findAll(root, (n) => n.label === label)[0];
const entries = () => findAll(ext._content, (x) => x.constructor.name === "Entry");
const checks = () => findAll(ext._content, (x) => hasClass(x, "organizedtodo-check"));
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log("ok -", name); };

await t("enable renders Projects with the stored project", async () => {
    assert.equal(headerTitle(), "Projects");
    assert.deepEqual(rowTitles(), ["General"]);
    assert.equal(ext._input.hint_text, "New project...");
    assert.equal(ext._footer.visible, true);
    assert.deepEqual(Object.keys(globalThis.__bound), ["open-organizedtodo", "quick-add"]);
});

await t("panel button shows only the custom icon (no label, no counter)", async () => {
    const kids = ext._button.children;
    assert.equal(kids.length, 1);
    assert.equal(kids[0].constructor.name, "Icon");
    assert.deepEqual(kids[0].gicon, { path: "/ext/icons/organizedtodo.svg" });
    assert.equal(kids[0].style_class, "organizedtodo-panel-icon");
    assert.equal(findAll(ext._button, (n) => n.constructor.name === "Label").length, 0);
});

await t("create project from the bottom input", async () => {
    await type("Project A");
    assert.deepEqual(rowTitles(), ["General", "Project A"]);
    assert.equal(ext._input.text, "");
    assert.equal(globalThis.__focus, ext._input);
    assert.equal(pill(rows()[1], "Complete"), undefined); // no todos: nothing to complete
    await type("   "); // blank ignored
    assert.equal(rowTitles().length, 2);
});

await t("open project -> lists screen; create two lists", async () => {
    await click(mainBtn(rows()[1]));
    assert.equal(headerTitle(), "Project A");
    assert.equal(ext._input.hint_text, "New list...");
    assert.equal(findAll(ext._content, (x) => hasClass(x, "organizedtodo-empty-title"))[0].text, "No lists yet");
    await type("Features");
    await type("Fixes");
    assert.deepEqual(rowTitles(), ["Features", "Fixes"]);
});

await t("open list -> todos screen; add todos", async () => {
    await click(mainBtn(rows()[0]));
    assert.equal(headerTitle(), "Features");
    assert.equal(headerSub(), "Project A");
    assert.equal(ext._input.hint_text, "New task...");
    await type("login");
    await type("export");
    assert.deepEqual(todoLabels(), ["login", "export"]);
});

await t("back navigation goes list -> lists -> projects", async () => {
    await click(btnByIcon(ext._header, "go-previous-symbolic")[0]);
    assert.equal(headerTitle(), "Project A");
    await click(btnByIcon(ext._header, "go-previous-symbolic")[0]);
    assert.equal(headerTitle(), "Projects");
    assert.equal(btnByIcon(ext._header, "go-previous-symbolic").length, 0);
});

await t("all done: checking the last pending todo returns to Projects and offers Complete", async () => {
    await click(mainBtn(rows()[1])); // Project A
    await click(mainBtn(rows()[1])); // Fixes
    await type("fix1");
    await click(checks()[0]); // fix1 done, features still pending
    assert.equal(headerTitle(), "Fixes");
    await click(btnByIcon(ext._header, "go-previous-symbolic")[0]);
    await click(mainBtn(rows()[0]));
    await click(checks()[0]);
    assert.equal(headerTitle(), "Features"); // not yet
    await click(checks()[1]);                                // last one
    assert.equal(headerTitle(), "Projects");           // jumped back
    assert.deepEqual(rowTitles(), ["General", "Project A"]); // still active: completing is the user's choice
    assert.ok(pill(rows()[1], "Complete"));
    assert.equal(pill(rows()[0], "Complete"), undefined); // General still has a pending todo
    assert.equal(pill(ext._header, "Completed · 1"), undefined);
    assert.equal(globalThis.__notes.length, 0);
});

await t("a new todo hides Complete; clicking Complete moves the project to Completed", async () => {
    await click(mainBtn(rows()[1])); // Project A
    await click(mainBtn(rows()[0])); // Features
    await type("polish");
    await click(btnByIcon(ext._header, "go-previous-symbolic")[0]);
    await click(btnByIcon(ext._header, "go-previous-symbolic")[0]);
    assert.equal(pill(rows()[1], "Complete"), undefined);
    await click(mainBtn(rows()[1]));
    await click(mainBtn(rows()[0]));
    await click(checks()[2]); // polish: all done again
    assert.equal(headerTitle(), "Projects");
    await click(pill(rows()[1], "Complete"));
    assert.deepEqual(rowTitles(), ["General"]);
    assert.ok(pill(ext._header, "Completed · 1"));
});

await t("Completed screen lists it, project is accessible, reactivation works", async () => {
    await click(pill(ext._header, "Completed · 1"));
    assert.equal(headerTitle(), "Completed");
    assert.deepEqual(rowTitles(), ["Project A"]);
    assert.equal(ext._footer.visible, false);
    // open it: header offers Reactivate, back goes to Completed
    await click(mainBtn(rows()[0]));
    assert.equal(headerTitle(), "Project A");
    assert.ok(pill(ext._header, "Reactivate"));
    assert.match(headerSub(), /completed/);
    await click(btnByIcon(ext._header, "go-previous-symbolic")[0]);
    assert.equal(headerTitle(), "Completed");
    // reactivate from the row; no completed left -> falls back to Projects
    await click(pill(rows()[0], "Reactivate"));
    assert.equal(headerTitle(), "Projects");
    assert.deepEqual(rowTitles(), ["General", "Project A"]);
    assert.equal(ext._footer.visible, true);
});

await t("unchecking in a completed project reactivates it", async () => {
    const f = ext._client.getFolders(false).find((x) => x.name === "Project A");
    await ext._client.setFolderCompleted(f.id, true);
    ext._navigate({ screen: "lists", folderId: f.id });
    assert.ok(pill(ext._header, "Reactivate"));
    await click(mainBtn(rows()[0]));
    await click(checks()[0]); // uncheck
    assert.equal(ext._client.getFolder(f.id).completed, false);
    ext._navigate({ screen: "folders" });
    assert.deepEqual(rowTitles(), ["General", "Project A"]);
});

await t("inline rename: edit -> entry focused -> Enter commits", async () => {
    await click(btnByIcon(rows()[1], "document-edit-symbolic")[0]);
    const entry = entries()[0];
    assert.ok(entry);
    assert.equal(entry.text, "Project A");
    assert.equal(globalThis.__focus, entry);
    entry.text = "  Project Alpha ";
    await commit(entry);
    assert.deepEqual(rowTitles(), ["General", "Project Alpha"]);
    assert.equal(ext._renaming, null);
});

await t("inline rename: Escape cancels and is swallowed; blank commit keeps old name", async () => {
    await click(btnByIcon(rows()[1], "document-edit-symbolic")[0]);
    let entry = entries()[0];
    entry.text = "nope";
    const res = entry.clutterText.emit("key-press-event", { get_key_symbol: () => 65307 });
    assert.deepEqual(res, [true]); // EVENT_STOP
    assert.deepEqual(rowTitles(), ["General", "Project Alpha"]);
    await click(btnByIcon(rows()[1], "document-edit-symbolic")[0]);
    entry = entries()[0];
    entry.text = "   ";
    await commit(entry);
    assert.deepEqual(rowTitles(), ["General", "Project Alpha"]);
    assert.deepEqual(entry.clutterText.emit("key-press-event", { get_key_symbol: () => 97 }), [false]);
});

await t("delete needs confirmation when it has content, immediate when empty", async () => {
    await click(btnByIcon(rows()[1], "edit-delete-symbolic")[0]);
    assert.deepEqual(rowTitles(), ["General", "Project Alpha"]);
    assert.ok(pill(rows()[1], "Delete?"));
    ext._navigate({ screen: "folders" }); // navigating elsewhere disarms
    assert.equal(pill(rows()[1], "Delete?"), undefined);
    await click(btnByIcon(rows()[1], "edit-delete-symbolic")[0]);
    await click(pill(rows()[1], "Delete?"));
    assert.deepEqual(rowTitles(), ["General"]);
    await type("Empty"); // empty project deletes at once
    await click(btnByIcon(rows()[1], "edit-delete-symbolic")[0]);
    assert.deepEqual(rowTitles(), ["General"]);
});

await t("menu closing disarms a pending delete", async () => {
    await click(btnByIcon(rows()[0], "edit-delete-symbolic")[0]);
    assert.ok(pill(rows()[0], "Delete?"));
    ext._button.menu.emit("open-state-changed", false);
    assert.equal(pill(rows()[0], "Delete?"), undefined);
});

await t("todo row: focus moves to top, no copy button, markup escaping, remove", async () => {
    await click(mainBtn(rows()[0]));         // General
    await click(mainBtn(rows()[0]));         // Tasks (alpha, beta)
    assert.deepEqual(todoLabels(), ["alpha", "beta"]);
    await type("a<b&c");
    assert.equal(todoLabels().length, 3);
    await click(findAll(rows()[2], (x) => hasClass(x, "organizedtodo-focus-btn"))[0]);
    assert.deepEqual(todoLabels(), ["a<b&c", "alpha", "beta"]);
    assert.ok(hasClass(rows()[0], "organizedtodo-focused"));
    assert.equal(btnByIcon(rows()[0], "edit-copy-symbolic").length, 0);
    assert.equal(btnByIcon(rows()[0], "document-edit-symbolic").length, 1);
    await click(findAll(rows()[0], (x) => hasClass(x, "organizedtodo-check"))[0]);
    const label = findAll(rows()[0], (x) => hasClass(x, "organizedtodo-todo-label"))[0];
    assert.equal(label.clutterText.markup, "<s>a&lt;b&amp;c</s>"); // escaped
    assert.ok(hasClass(rows()[0], "organizedtodo-done"));
    await click(btnByIcon(rows()[0], "edit-delete-symbolic")[0]);
    assert.deepEqual(todoLabels(), ["alpha", "beta"]);
});

await t("edit todo: Enter saves and keeps state; Esc and blank cancel; shifted index drops the edit", async () => {
    const fid = ext._view.folderId, lid = ext._view.listId;
    // rows: alpha (pending), beta (done)
    await click(btnByIcon(rows()[1], "document-edit-symbolic")[0]);
    let entry = entries()[0];
    assert.equal(entries().length, 1);
    assert.equal(entry.text, "beta");
    assert.equal(globalThis.__focus, entry);
    entry.text = "  beta <edited> & more ";
    await commit(entry);
    assert.deepEqual(todoLabels(), ["alpha", "beta <edited> & more"]);
    assert.ok(hasClass(rows()[1], "organizedtodo-done")); // still done
    assert.equal(findAll(rows()[1], (x) => hasClass(x, "organizedtodo-todo-label"))[0].clutterText.markup, "<s>beta &lt;edited&gt; &amp; more</s>");
    // Esc cancels and is swallowed
    await click(btnByIcon(rows()[0], "document-edit-symbolic")[0]);
    entry = entries()[0];
    entry.text = "zzz";
    assert.deepEqual(entry.clutterText.emit("key-press-event", { get_key_symbol: () => 65307 }), [true]);
    assert.equal(entries().length, 0);
    assert.equal(todoLabels()[0], "alpha");
    // blank keeps the old name
    await click(btnByIcon(rows()[0], "document-edit-symbolic")[0]);
    entry = entries()[0];
    entry.text = "   ";
    await commit(entry);
    assert.equal(todoLabels()[0], "alpha");
    // removing another todo while editing shifts indices: edit is dropped, nothing is renamed
    await await type("t1"); await type("t2");
    await click(btnByIcon(rows()[3], "document-edit-symbolic")[0]);
    assert.equal(entries().length, 1);
    await click(btnByIcon(rows()[2], "edit-delete-symbolic")[0]); // delete t1
    assert.equal(entries().length, 0);
    assert.deepEqual(todoLabels(), ["alpha", "beta <edited> & more", "t2"]);
    await click(btnByIcon(rows()[2], "edit-delete-symbolic")[0]); // delete t2
    assert.equal(await ext._client.renameTodo(fid, lid, 1, "beta"), true); // restore for next test
    assert.deepEqual(todoLabels(), ["alpha", "beta"]);
});

await t("drag & drop reorder within a list; redraw deferred until drag-end", async () => {
    await type("third");
    const before = rows();
    const drag = globalThis.__draggables.at(-1);
    drag.handlers["drag-begin"]();
    const src = before[0]._delegate, target = before[2]._delegate;
    assert.equal(target.handleDragOver(src), 1);
    assert.ok(before[2].classes.has("organizedtodo-drag-over"));
    assert.equal(target.acceptDrop(src, null, 0, 0), true); // height unknown -> placed before target
    assert.equal(before[2].classes.has("organizedtodo-drag-over"), false);
    await flush(); // Changed arrives while the drag is still running
    assert.deepEqual(todoLabels(), ["alpha", "beta", "third"]); // UI not rebuilt yet
    assert.deepEqual(ext._client.getList(ext._view.folderId, ext._view.listId).todos.map((x) => x.name), ["beta", "alpha", "third"]);
    drag.handlers["drag-end"]();
    assert.deepEqual(todoLabels(), ["beta", "alpha", "third"]);
    const r = rows(); // same position / self drop rejected
    assert.equal(r[1]._delegate.acceptDrop(r[1]._delegate, null, 0, 0), false);
    assert.equal(r[1]._delegate.handleDragOver(r[1]._delegate), 0);
});

await t("view pointing to a deleted project falls back to Projects", async () => {
    await ext._client.removeFolder(ext._view.folderId);
    await flush();
    assert.equal(headerTitle(), "Projects");
    assert.equal(ext._view.screen, "folders");
});

await t("load failure shows a notice without the input; reopening the menu retries", async () => {
    ext._client._error = "daemon unreachable";
    ext._render();
    assert.equal(findAll(ext._content, (x) => hasClass(x, "organizedtodo-empty-title"))[0].text, "Could not load the tasks");
    assert.equal(ext._footer.visible, false);
    assert.equal(rows().length, 0);
    ext._button.menu.emit("open-state-changed", true);
    await flush();
    assert.equal(ext._client.error, null);
    assert.equal(headerTitle(), "Projects");
    // the previous test deleted the last project: back to the normal empty state
    assert.equal(findAll(ext._content, (x) => hasClass(x, "organizedtodo-empty-title"))[0].text, "No projects yet");
    assert.equal(ext._footer.visible, true);
});

await t("names are drawn as markdown; the stored text stays as typed", async () => {
    await type("**Big** `x`");
    const title = findAll(ext._content, (x) => hasClass(x, "organizedtodo-row-title"))[0];
    assert.equal(title.text, "**Big** `x`");
    assert.match(title.clutterText.markup, /^<b>Big<\/b> <span font_family="monospace"/);
    await click(mainBtn(rows()[0]));
    assert.match(findAll(ext._header, (x) => hasClass(x, "organizedtodo-title"))[0].clutterText.markup, /<b>Big<\/b>/);
    await type("L");
    await click(mainBtn(rows()[0]));
    await type("> note");
    const label = findAll(ext._content, (x) => hasClass(x, "organizedtodo-todo-label"))[0];
    assert.equal(label.clutterText.markup, `<span style="italic" fgalpha="70%">▎ note</span>`);
    await click(checks()[0]); // last pending todo: back to Projects, the project offers Complete
    assert.equal(headerTitle(), "Projects");
    assert.ok(pill(rows()[0], "Complete"));
});

await t("clicking a name with a link opens it and closes the menu; the row does not react", async () => {
    let closed = 0;
    ext._button.menu.close = () => closed++;
    await type("read [docs](https://gnome.org) and [x](file:///etc)");
    const row = rows().at(-1);
    const label = findAll(row, (x) => hasClass(x, "organizedtodo-row-title"))[0];
    assert.equal(label.reactive, true);
    assert.deepEqual(label.emit("button-press-event"), [true]); // EVENT_STOP: the row button never sees it
    assert.deepEqual(label.emit("button-release-event"), [true]);
    assert.deepEqual(globalThis.__opened, ["https://gnome.org"]);
    assert.equal(closed, 1);
    assert.equal(headerTitle(), "Projects"); // did not open the project
    await type("no link");
    assert.notEqual(findAll(rows().at(-1), (x) => hasClass(x, "organizedtodo-row-title"))[0].reactive, true);
});

await t("animations: menu grows from the icon, screens slide, new rows fade in, checks pulse", async () => {
    const menu = ext._button.menu;
    // the pivot follows the icon: icon centered at x=410, menu spanning 0..440
    ext._button.x = 400; ext._button.width = 20;
    menu.allocation = { x1: 0, get_width: () => 440 };
    menu.emit("notify::allocation");
    assert.deepEqual(menu.pivot, [410 / 440, 0]);
    menu.isOpen = true;
    menu.pivot = [0.5, 0]; // the shell resets it on open; the allocation may not change
    menu.emit("open-state-changed", true);
    assert.deepEqual(menu.pivot, [410 / 440, 0]);
    assert.deepEqual(menu.eased.at(-1), { from: { scale_x: 0.1, scale_y: 0.1 }, to: { scale_x: 1, scale_y: 1, duration: 250, mode: 5 } });

    // deeper: from the right; back: from the left; same screen re-render: no slide
    ext._content.eased = [];
    await type("Anim");
    assert.equal(ext._content.eased.length, 0);
    await click(mainBtn(rows().at(-1)));
    assert.equal(ext._content.eased.at(-1).from.translation_x, 24);
    await click(btnByIcon(ext._header, "go-previous-symbolic")[0]);
    assert.equal(ext._content.eased.at(-1).from.translation_x, -24);

    // only the row that was not there before fades in
    const before = rows().length;
    await type("New");
    const all = rows();
    assert.equal(all.length, before + 1);
    assert.deepEqual(all.at(-1).eased?.[0].from, { opacity: 0, translation_y: -6 });
    assert.ok(all.slice(0, -1).every((row) => !row.eased));

    // the clicked check pops once the redraw shows the new state
    await click(mainBtn(all.at(-1)));
    await type("L");
    await click(mainBtn(rows()[0]));
    await type("one");
    await type("two");
    await click(checks()[0]);
    const check = checks()[0];
    assert.deepEqual(check.eased?.[0].from, { scale_x: 1.35, scale_y: 1.35 });
    assert.equal(checks()[1].eased, undefined);
    assert.equal(ext._pulse, null);

    // marked done: once laid out, 8 dots fly out of the check's center and are destroyed
    const { uiGroup } = await import("resource:///org/gnome/shell/ui/main.js");
    Object.assign(check, { x: 100, y: 50, width: 18, height: 18 });
    check.emit("notify::allocation");
    const dots = uiGroup.children.slice(-8);
    assert.equal(dots.length, 8);
    assert.ok(dots.every((dot) => dot.x === 106 && dot.y === 56 && dot.destroyed));
    assert.ok(Math.abs(dots[0].translation_x - 22) < 1e-9 && Math.abs(dots[2].translation_y - 22) < 1e-9);
    // unchecking pops the check but does not burst
    const count = uiGroup.children.length;
    await click(checks()[0]);
    checks()[0].emit("notify::allocation");
    assert.equal(uiGroup.children.length, count);

    // closing: back into the icon, within the shell's fade
    menu.pivot = [0.5, 0];
    menu.isOpen = false;
    menu.emit("open-state-changed", false);
    assert.deepEqual(menu.pivot, [410 / 440, 0]);
    assert.deepEqual(menu.eased.at(-1).to, { scale_x: 0.1, scale_y: 0.1, duration: 150, mode: 4 });
});

// ---- notes: keys as the editor receives them
const KEY = { Return: 65293, Tab: 65289, LeftTab: 65056, Escape: 65307 };
const press = (entry, key, state = 0) => entry.clutterText.emit("key-press-event", { get_key_symbol: () => key, get_state: () => state });
const CTRL = 4;
const noteLines = () => findAll(ext._content, (x) => hasClass(x, "organizedtodo-note-line"));
const noteCode = () => findAll(ext._content, (x) => hasClass(x, "organizedtodo-note-code"));
const notesBtn = (row) => btnByIcon(row, "text-x-generic-symbolic")[0];
const storedTodos = () => ext._client.getList(ext._view.folderId, ext._view.listId).todos;

await t("notes: the row button opens the todo's notes; written in markdown, drawn per line, code as a box", async () => {
    ext._navigate({ screen: "folders" });
    await type("Notes");
    await click(mainBtn(rows().at(-1)));
    await type("L");
    await click(mainBtn(rows()[0]));
    await type("**a**");
    await type("b");
    assert.equal(hasClass(notesBtn(rows()[0]), "organizedtodo-notes-on"), false);
    await click(notesBtn(rows()[0]));
    assert.equal(headerTitle(), "**a**");
    assert.match(findAll(ext._header, (x) => hasClass(x, "organizedtodo-title"))[0].clutterText.markup, /<b>a<\/b>/);
    assert.equal(headerSub(), "L");
    assert.equal(ext._footer.visible, false);
    assert.equal(findAll(ext._content, (x) => hasClass(x, "organizedtodo-empty-title"))[0].text, "📝 No notes");

    await click(btnByIcon(ext._header, "document-edit-symbolic")[0]);
    const entry = entries()[0];
    assert.equal(entry.text, "");
    assert.equal(globalThis.__focus, entry);
    entry.text = "# Plan\nsee www.a.com\n```py\ndef f():\n```\n\n";
    entry.clutterText.emit("text-changed");
    assert.deepEqual(press(entry, KEY.Return, CTRL), [true]); // Ctrl+Enter saves
    await flush();
    assert.equal(entries().length, 0);
    assert.equal(storedTodos()[0].notes, "# Plan\nsee www.a.com\n```py\ndef f():\n```");
    const [title, link] = noteLines();
    assert.equal(title.clutterText.markup, `<span weight="bold" size="x-large">Plan</span>`);
    assert.equal(link.reactive, true);
    link.emit("button-release-event");
    assert.equal(globalThis.__opened.at(-1), "https://www.a.com");
    assert.equal(noteCode().length, 1);
    assert.match(noteCode()[0].clutterText.markup, /<span foreground="#dc8add">def<\/span>/);

    await click(btnByIcon(ext._header, "go-previous-symbolic")[0]);
    assert.equal(ext._view.screen, "todos");
    assert.equal(hasClass(notesBtn(rows()[0]), "organizedtodo-notes-on"), true);
    assert.equal(hasClass(notesBtn(rows()[1]), "organizedtodo-notes-on"), false);
});

await t("notes editor: Enter keeps the indentation, Tab indents, Shift+Tab unindents, Escape cancels", async () => {
    await click(notesBtn(rows()[1]));
    await click(btnByIcon(ext._header, "document-edit-symbolic")[0]);
    const entry = entries()[0];
    entry.text = "😀 def f():";
    assert.deepEqual(press(entry, KEY.Return), [true]);
    assert.deepEqual(press(entry, KEY.Tab), [true]); // the focus stays in the entry
    entry.clutterText.insert_text("x", -1);
    press(entry, KEY.Return);
    assert.equal(entry.text, "😀 def f():\n    x\n    ");
    assert.deepEqual(press(entry, KEY.LeftTab), [true]);
    assert.equal(entry.text, "😀 def f():\n    x\n");
    assert.equal(ext._editingNotes.draft, entry.text);
    assert.deepEqual(press(entry, 97), [false]); // other keys are typed as usual
    // the line being typed stays in view: 100px visible, the entry at 0, its text 8px down
    const adjustment = ext._scroll.vadjustment;
    entry.y = 0;
    entry.clutterText.y = 8;
    entry.clutterText.cursorRect = { y: 150, height: 20 };
    entry.clutterText.emit("cursor-changed");
    assert.equal(adjustment.value, 78); // scrolled just enough: the cursor at the bottom
    entry.clutterText.cursorRect = { y: 10, height: 20 };
    adjustment.emit("changed");
    assert.equal(adjustment.value, 18); // back up to the cursor
    assert.deepEqual(press(entry, KEY.Escape), [true]); // cancels, does not close the menu
    assert.equal(entries().length, 0);
    assert.equal(storedTodos()[1].notes, undefined);
});

await t("notes: the draft survives redraws and closing the menu; saving empty clears", async () => {
    await click(btnByIcon(ext._header, "document-edit-symbolic")[0]);
    entries()[0].text = "draft";
    entries()[0].clutterText.emit("text-changed");
    ext._render(); // a Changed signal while typing
    ext._button.menu.emit("open-state-changed", false);
    assert.equal(entries()[0].text, "draft");
    await click(pill(ext._header, "Save"));
    assert.equal(storedTodos()[1].notes, "draft");
    await click(btnByIcon(ext._header, "document-edit-symbolic")[0]);
    assert.equal(entries()[0].text, "draft");
    entries()[0].text = "";
    entries()[0].clutterText.emit("text-changed");
    await click(pill(ext._header, "Save"));
    assert.equal(storedTodos()[1].notes, undefined);
    assert.equal(findAll(ext._content, (x) => hasClass(x, "organizedtodo-empty-title"))[0].text, "📝 No notes");
});

await t("notes of a todo that moved or was removed fall back to its list", async () => {
    // "b" is index 1: focusing it moves it to the top, index 1 is now another todo
    const { folderId, listId } = ext._view;
    await ext._client.setTodoFocus(folderId, listId, 1, true);
    await flush();
    assert.equal(ext._view.screen, "todos");
    assert.equal(headerTitle(), "L");
    assert.equal(ext._view.listId, listId);
    await click(notesBtn(rows()[1])); // "**a**", now index 1
    await click(btnByIcon(ext._header, "document-edit-symbolic")[0]);
    await ext._client.removeTodo(folderId, listId, 1);
    await flush();
    assert.equal(ext._view.screen, "todos");
    assert.equal(ext._editingNotes, null);
});

// ---- quick add: a dialog opened by its own shortcut
const quickAdd = async () => { globalThis.__bound["quick-add"](); await flush(); return globalThis.__dialogs.at(-1); };
const dialogTitle = (dialog) => findAll(dialog, (x) => hasClass(x, "organizedtodo-quick-add-target")).map((x) => x.label ?? x.text)[0];
const dialogEntry = (dialog) => findAll(dialog, (x) => x.constructor.name === "Entry")[0];
const options = (dialog) => findAll(dialog, (x) => hasClass(x, "organizedtodo-quick-add-option"));
const typeIn = async (entry, text) => { entry.text = text; entry.clutterText.emit("text-changed"); await flush(); };
const enter = async (entry) => { entry.clutterText.emit("activate"); await flush(); };
const escape = async (dialog) => { dialog.buttons.find((b) => b.key === 65307).action(); await flush(); };
const todosOf = (folderName, listName) => {
    const folder = ext._client.getFolders(true).concat(ext._client.getFolders(false)).find((f) => f.name === folderName);
    return folder.lists.find((l) => l.name === listName).todos.map((x) => x.name);
};

await t("quick add: opens on the first list of an active project; Enter adds there once and closes", async () => {
    store.workspace = JSON.stringify({ folders: [
        { id: "q0", name: "Old", completed: true, lists: [{ id: "q0a", name: "Archive", todos: [] }] },
        { id: "q1", name: "**Work**", completed: false, lists: [{ id: "q1a", name: "Inbox", todos: [] }, { id: "q1b", name: "Later", todos: [] }] },
        { id: "q2", name: "Home", completed: false, lists: [{ id: "q2a", name: "Chores", todos: [] }] },
    ] });
    await ext._client.refresh();
    const dialog = await quickAdd();
    assert.ok(dialog.opened);
    assert.equal(dialogTitle(dialog), "Work › Inbox ▾"); // completed project skipped, no markdown markers
    const entry = dialogEntry(dialog);
    assert.equal(dialog.initialFocus, entry);
    await typeIn(entry, "  buy milk ");
    await enter(entry);
    assert.deepEqual(todosOf("**Work**", "Inbox"), ["buy milk"]);
    assert.ok(dialog.destroyed);
    assert.equal(ext._quickAdd, null);
});

await t("quick add: a second press while one is open does nothing; Esc cancels; blank adds nothing", async () => {
    globalThis.__bound["quick-add"]();
    globalThis.__bound["quick-add"]();
    await flush();
    const dialog = globalThis.__dialogs.at(-1);
    assert.equal(globalThis.__dialogs.filter((d) => d.opened).length, 1);
    await enter(dialogEntry(dialog)); // empty: stays open
    assert.ok(dialog.opened);
    await typeIn(dialogEntry(dialog), "never");
    await escape(dialog);
    assert.ok(dialog.destroyed);
    assert.deepEqual(todosOf("**Work**", "Inbox"), ["buy milk"]);
});

await t("quick add: Tab picks project then list, filtering without accents; the typed task is kept and the list remembered", async () => {
    let dialog = await quickAdd();
    let entry = dialogEntry(dialog);
    await typeIn(entry, "call mom");
    assert.deepEqual(press(entry, 65289), [true]); // Tab: EVENT_STOP
    assert.equal(dialogTitle(dialog), "Projects");
    assert.deepEqual(options(dialog).map((x) => x.label), ["Work", "Home"]);
    const filter = dialogEntry(dialog);
    assert.equal(dialog.initialFocus, filter);
    await typeIn(filter, "HÓM");
    assert.deepEqual(options(dialog).map((x) => x.label), ["Home", "Create “HÓM”"]); // partial: Create is still offered
    await enter(filter); // first match
    assert.equal(dialogTitle(dialog), "Home");
    await escape(dialog); // one step back
    assert.equal(dialogTitle(dialog), "Projects");
    await click(options(dialog)[1]); // Home
    await click(options(dialog)[0]); // Chores
    assert.equal(dialogTitle(dialog), "Home › Chores ▾");
    entry = dialogEntry(dialog);
    assert.equal(entry.text, "call mom");
    await enter(entry);
    assert.deepEqual(todosOf("Home", "Chores"), ["call mom"]);
    dialog = await quickAdd();
    assert.equal(dialogTitle(dialog), "Home › Chores ▾"); // remembered
    await escape(dialog);
});

await t("quick add: Create makes a project and a list; no Create for a name that exists; no list at all starts in the picker", async () => {
    let dialog = await quickAdd();
    press(dialogEntry(dialog), 65289);
    let filter = dialogEntry(dialog);
    await typeIn(filter, "work");
    assert.deepEqual(options(dialog).map((x) => x.label), ["Work"]); // exists: no Create
    await typeIn(filter, "Groceries");
    assert.deepEqual(options(dialog).map((x) => x.label), ["Create “Groceries”"]);
    await enter(filter);
    assert.equal(dialogTitle(dialog), "Groceries");
    assert.deepEqual(options(dialog).map((x) => x.label), []);
    filter = dialogEntry(dialog);
    await typeIn(filter, "Market");
    await enter(filter);
    assert.equal(dialogTitle(dialog), "Groceries › Market ▾");
    const entry = dialogEntry(dialog);
    await typeIn(entry, "bread");
    await enter(entry);
    assert.deepEqual(todosOf("Groceries", "Market"), ["bread"]);
    // nothing to add to: the dialog opens in the picker, with the filter focused
    store.workspace = JSON.stringify({ folders: [] });
    await ext._client.refresh();
    dialog = await quickAdd();
    assert.equal(dialogTitle(dialog), "Projects");
    assert.equal(dialog.initialFocus, dialogEntry(dialog));
    await escape(dialog); // back to the task screen, nothing to pick yet
    assert.equal(dialogTitle(dialog), "Choose a list ▾");
    await escape(dialog);
    assert.ok(dialog.destroyed);
});

await t("disable cleans up", async () => {
    ext.disable();
    assert.deepEqual(globalThis.__unbound, ["open-organizedtodo", "quick-add"]);
    assert.equal(ext._button, null);
    assert.equal(ext._client, null);
});

console.log(`\n${n} UI tests passed`);
