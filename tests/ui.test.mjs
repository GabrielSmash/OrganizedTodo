// Runs the real extension.js against fakes of the GNOME toolkit (see helpers/).
// Checks logic and navigation, not appearance.
import assert from "node:assert/strict";
import { register } from "node:module";
register(new URL("./helpers/hooks.mjs", import.meta.url));

const { findAll, hasClass } = await import(new URL("./helpers/stubs.mjs", import.meta.url).href);
const { default: Ext } = await import(new URL("../extension.js", import.meta.url).href);

// ---- fake settings, seeded with one project: Geral / Tarefas = [alpha (pending), beta (done)]
const store = {
    workspace: JSON.stringify({
        folders: [{
            id: "f0", name: "Geral", completed: false,
            lists: [{ id: "l0", name: "Tarefas", todos: [{ name: "alpha", isDone: false }, { name: "beta", isDone: true }] }],
        }],
    }),
};
globalThis.__settings = { get_string: (k) => store[k], set_string: (k, v) => { store[k] = v; } };
globalThis.__notes = [];

const ext = new Ext();
ext.enable();

// ---- helpers
const click = (b) => b.emit("clicked");
const type = (text) => { ext._input.text = text; ext._input.clutterText.emit("activate"); };
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
const t = (name, fn) => { fn(); n++; console.log("ok -", name); };

t("enable renders Projetos with the stored project", () => {
    assert.equal(headerTitle(), "Projetos");
    assert.deepEqual(rowTitles(), ["Geral"]);
    assert.equal(ext._input.hint_text, "Novo projeto...");
    assert.equal(ext._footer.visible, true);
    assert.equal(globalThis.__bound, "open-organizedtodo");
});

t("panel button shows only the custom icon (no label, no counter)", () => {
    const kids = ext._button.children;
    assert.equal(kids.length, 1);
    assert.equal(kids[0].constructor.name, "Icon");
    assert.deepEqual(kids[0].gicon, { path: "/ext/icons/organizedtodo.svg" });
    assert.equal(kids[0].style_class, "organizedtodo-panel-icon");
    assert.equal(findAll(ext._button, (n) => n.constructor.name === "Label").length, 0);
});

t("create project from the bottom input", () => {
    type("Projeto A");
    assert.deepEqual(rowTitles(), ["Geral", "Projeto A"]);
    assert.equal(ext._input.text, "");
    assert.equal(globalThis.__focus, ext._input);
    type("   "); // blank ignored
    assert.equal(rowTitles().length, 2);
});

t("open project -> lists screen; create two lists", () => {
    click(mainBtn(rows()[1]));
    assert.equal(headerTitle(), "Projeto A");
    assert.equal(ext._input.hint_text, "Nova lista...");
    assert.equal(findAll(ext._content, (x) => hasClass(x, "organizedtodo-empty-title"))[0].text, "Nenhuma lista ainda");
    type("Lista de features");
    type("Lista de Fixes");
    assert.deepEqual(rowTitles(), ["Lista de features", "Lista de Fixes"]);
});

t("open list -> todos screen; add todos", () => {
    click(mainBtn(rows()[0]));
    assert.equal(headerTitle(), "Lista de features");
    assert.equal(headerSub(), "Projeto A");
    assert.equal(ext._input.hint_text, "Nova tarefa...");
    type("login");
    type("export");
    assert.deepEqual(todoLabels(), ["login", "export"]);
});

t("back navigation goes list -> lists -> projects", () => {
    click(btnByIcon(ext._header, "go-previous-symbolic")[0]);
    assert.equal(headerTitle(), "Projeto A");
    click(btnByIcon(ext._header, "go-previous-symbolic")[0]);
    assert.equal(headerTitle(), "Projetos");
    assert.equal(btnByIcon(ext._header, "go-previous-symbolic").length, 0);
});

t("auto-complete: checking the last pending todo returns to Projetos and moves project to Concluídos", () => {
    click(mainBtn(rows()[1])); // Projeto A
    click(mainBtn(rows()[1])); // Lista de Fixes
    type("fix1");
    click(checks()[0]); // fix1 done, features still pending
    assert.equal(headerTitle(), "Lista de Fixes");
    click(btnByIcon(ext._header, "go-previous-symbolic")[0]);
    click(mainBtn(rows()[0]));
    click(checks()[0]);
    assert.equal(headerTitle(), "Lista de features"); // not yet
    click(checks()[1]);                                // last one
    assert.equal(headerTitle(), "Projetos");           // jumped back
    assert.deepEqual(rowTitles(), ["Geral"]);          // Projeto A left the active list
    assert.deepEqual(globalThis.__notes.at(-1), ["Projeto concluído", "Projeto A"]);
    assert.ok(pill(ext._header, "Concluídos · 1"));
});

t("Concluídos screen lists it, project is accessible, reactivation works", () => {
    click(pill(ext._header, "Concluídos · 1"));
    assert.equal(headerTitle(), "Concluídos");
    assert.deepEqual(rowTitles(), ["Projeto A"]);
    assert.equal(ext._footer.visible, false);
    // open it: header offers Reativar, back goes to Concluídos
    click(mainBtn(rows()[0]));
    assert.equal(headerTitle(), "Projeto A");
    assert.ok(pill(ext._header, "Reativar"));
    assert.match(headerSub(), /concluído/);
    click(btnByIcon(ext._header, "go-previous-symbolic")[0]);
    assert.equal(headerTitle(), "Concluídos");
    // reactivate from the row; no completed left -> falls back to Projetos
    click(pill(rows()[0], "Reativar"));
    assert.equal(headerTitle(), "Projetos");
    assert.deepEqual(rowTitles(), ["Geral", "Projeto A"]);
    assert.equal(ext._footer.visible, true);
});

t("unchecking in a completed project reactivates it", () => {
    const f = ext._manager.getFolders(false).find((x) => x.name === "Projeto A");
    ext._manager.setFolderCompleted(f.id, true);
    ext._navigate({ screen: "lists", folderId: f.id });
    assert.ok(pill(ext._header, "Reativar"));
    click(mainBtn(rows()[0]));
    click(checks()[0]); // uncheck
    assert.equal(ext._manager.getFolder(f.id).completed, false);
    ext._navigate({ screen: "folders" });
    assert.deepEqual(rowTitles(), ["Geral", "Projeto A"]);
});

t("inline rename: edit -> entry focused -> Enter commits", () => {
    click(btnByIcon(rows()[1], "document-edit-symbolic")[0]);
    const entry = entries()[0];
    assert.ok(entry);
    assert.equal(entry.text, "Projeto A");
    assert.equal(globalThis.__focus, entry);
    entry.text = "  Projeto Alfa ";
    entry.clutterText.emit("activate");
    assert.deepEqual(rowTitles(), ["Geral", "Projeto Alfa"]);
    assert.equal(ext._renaming, null);
});

t("inline rename: Escape cancels and is swallowed; blank commit keeps old name", () => {
    click(btnByIcon(rows()[1], "document-edit-symbolic")[0]);
    let entry = entries()[0];
    entry.text = "nope";
    const res = entry.clutterText.emit("key-press-event", { get_key_symbol: () => 65307 });
    assert.deepEqual(res, [true]); // EVENT_STOP
    assert.deepEqual(rowTitles(), ["Geral", "Projeto Alfa"]);
    click(btnByIcon(rows()[1], "document-edit-symbolic")[0]);
    entry = entries()[0];
    entry.text = "   ";
    entry.clutterText.emit("activate");
    assert.deepEqual(rowTitles(), ["Geral", "Projeto Alfa"]);
    assert.deepEqual(entry.clutterText.emit("key-press-event", { get_key_symbol: () => 97 }), [false]);
});

t("delete needs confirmation when it has content, immediate when empty", () => {
    click(btnByIcon(rows()[1], "edit-delete-symbolic")[0]);
    assert.deepEqual(rowTitles(), ["Geral", "Projeto Alfa"]);
    assert.ok(pill(rows()[1], "Excluir?"));
    ext._navigate({ screen: "folders" }); // navigating elsewhere disarms
    assert.equal(pill(rows()[1], "Excluir?"), undefined);
    click(btnByIcon(rows()[1], "edit-delete-symbolic")[0]);
    click(pill(rows()[1], "Excluir?"));
    assert.deepEqual(rowTitles(), ["Geral"]);
    type("Vazio"); // empty project deletes at once
    click(btnByIcon(rows()[1], "edit-delete-symbolic")[0]);
    assert.deepEqual(rowTitles(), ["Geral"]);
});

t("menu closing disarms a pending delete", () => {
    click(btnByIcon(rows()[0], "edit-delete-symbolic")[0]);
    assert.ok(pill(rows()[0], "Excluir?"));
    ext._button.menu.emit("open-state-changed", false);
    assert.equal(pill(rows()[0], "Excluir?"), undefined);
});

t("todo row: focus moves to top, no copy button, markup escaping, remove", () => {
    click(mainBtn(rows()[0]));         // Geral
    click(mainBtn(rows()[0]));         // Tarefas (alpha, beta)
    assert.deepEqual(todoLabels(), ["alpha", "beta"]);
    type("a<b&c");
    assert.equal(todoLabels().length, 3);
    click(findAll(rows()[2], (x) => hasClass(x, "organizedtodo-focus-btn"))[0]);
    assert.deepEqual(todoLabels(), ["a<b&c", "alpha", "beta"]);
    assert.ok(hasClass(rows()[0], "organizedtodo-focused"));
    assert.equal(btnByIcon(rows()[0], "edit-copy-symbolic").length, 0);
    assert.equal(btnByIcon(rows()[0], "document-edit-symbolic").length, 1);
    click(findAll(rows()[0], (x) => hasClass(x, "organizedtodo-check"))[0]);
    const label = findAll(rows()[0], (x) => hasClass(x, "organizedtodo-todo-label"))[0];
    assert.equal(label.clutterText.markup, "<s>a&lt;b&amp;c</s>"); // escaped
    assert.ok(hasClass(rows()[0], "organizedtodo-done"));
    click(btnByIcon(rows()[0], "edit-delete-symbolic")[0]);
    assert.deepEqual(todoLabels(), ["alpha", "beta"]);
});

t("edit todo: Enter saves and keeps state; Esc and blank cancel; shifted index drops the edit", () => {
    const fid = ext._view.folderId, lid = ext._view.listId;
    // rows: alpha (pending), beta (done)
    click(btnByIcon(rows()[1], "document-edit-symbolic")[0]);
    let entry = entries()[0];
    assert.equal(entries().length, 1);
    assert.equal(entry.text, "beta");
    assert.equal(globalThis.__focus, entry);
    entry.text = "  beta <edited> & more ";
    entry.clutterText.emit("activate");
    assert.deepEqual(todoLabels(), ["alpha", "beta <edited> & more"]);
    assert.ok(hasClass(rows()[1], "organizedtodo-done")); // still done
    assert.equal(findAll(rows()[1], (x) => hasClass(x, "organizedtodo-todo-label"))[0].clutterText.markup, "<s>beta &lt;edited> &amp; more</s>");
    // Esc cancels and is swallowed
    click(btnByIcon(rows()[0], "document-edit-symbolic")[0]);
    entry = entries()[0];
    entry.text = "zzz";
    assert.deepEqual(entry.clutterText.emit("key-press-event", { get_key_symbol: () => 65307 }), [true]);
    assert.equal(entries().length, 0);
    assert.equal(todoLabels()[0], "alpha");
    // blank keeps the old name
    click(btnByIcon(rows()[0], "document-edit-symbolic")[0]);
    entry = entries()[0];
    entry.text = "   ";
    entry.clutterText.emit("activate");
    assert.equal(todoLabels()[0], "alpha");
    // removing another todo while editing shifts indices: edit is dropped, nothing is renamed
    type("t1"); type("t2");
    click(btnByIcon(rows()[3], "document-edit-symbolic")[0]);
    assert.equal(entries().length, 1);
    click(btnByIcon(rows()[2], "edit-delete-symbolic")[0]); // delete t1
    assert.equal(entries().length, 0);
    assert.deepEqual(todoLabels(), ["alpha", "beta <edited> & more", "t2"]);
    click(btnByIcon(rows()[2], "edit-delete-symbolic")[0]); // delete t2
    assert.equal(ext._manager.renameTodo(fid, lid, 1, "beta"), true); // restore for next test
    ext._render();
    assert.deepEqual(todoLabels(), ["alpha", "beta"]);
});

t("drag & drop reorder within a list; rerender deferred until drag-end", () => {
    type("third");
    const before = rows();
    const src = before[0]._delegate, target = before[2]._delegate;
    assert.equal(target.handleDragOver(src), 1);
    assert.ok(before[2].classes.has("organizedtodo-drag-over"));
    assert.equal(target.acceptDrop(src, null, 0, 0), true); // height unknown -> placed before target
    assert.equal(before[2].classes.has("organizedtodo-drag-over"), false);
    assert.deepEqual(todoLabels(), ["alpha", "beta", "third"]); // UI not rebuilt yet
    assert.deepEqual(ext._manager.getList(ext._view.folderId, ext._view.listId).todos.map((x) => x.name), ["beta", "alpha", "third"]);
    globalThis.__draggables.at(-1).handlers["drag-end"]();
    assert.deepEqual(todoLabels(), ["beta", "alpha", "third"]);
    const r = rows(); // same position / self drop rejected
    assert.equal(r[1]._delegate.acceptDrop(r[1]._delegate, null, 0, 0), false);
    assert.equal(r[1]._delegate.handleDragOver(r[1]._delegate), 0);
});

t("view pointing to a deleted project falls back to Projetos", () => {
    ext._manager.removeFolder(ext._view.folderId);
    ext._render();
    assert.equal(headerTitle(), "Projetos");
    assert.equal(ext._view.screen, "folders");
});

t("disable cleans up", () => {
    ext.disable();
    assert.equal(globalThis.__unbound, "open-organizedtodo");
    assert.equal(ext._button, null);
});

console.log(`\n${n} UI tests passed`);
