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

await t("enable renders Projetos with the stored project", async () => {
    assert.equal(headerTitle(), "Projetos");
    assert.deepEqual(rowTitles(), ["Geral"]);
    assert.equal(ext._input.hint_text, "Novo projeto...");
    assert.equal(ext._footer.visible, true);
    assert.equal(globalThis.__bound, "open-organizedtodo");
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
    await type("Projeto A");
    assert.deepEqual(rowTitles(), ["Geral", "Projeto A"]);
    assert.equal(ext._input.text, "");
    assert.equal(globalThis.__focus, ext._input);
    await type("   "); // blank ignored
    assert.equal(rowTitles().length, 2);
});

await t("open project -> lists screen; create two lists", async () => {
    await click(mainBtn(rows()[1]));
    assert.equal(headerTitle(), "Projeto A");
    assert.equal(ext._input.hint_text, "Nova lista...");
    assert.equal(findAll(ext._content, (x) => hasClass(x, "organizedtodo-empty-title"))[0].text, "Nenhuma lista ainda");
    await type("Lista de features");
    await type("Lista de Fixes");
    assert.deepEqual(rowTitles(), ["Lista de features", "Lista de Fixes"]);
});

await t("open list -> todos screen; add todos", async () => {
    await click(mainBtn(rows()[0]));
    assert.equal(headerTitle(), "Lista de features");
    assert.equal(headerSub(), "Projeto A");
    assert.equal(ext._input.hint_text, "Nova tarefa...");
    await type("login");
    await type("export");
    assert.deepEqual(todoLabels(), ["login", "export"]);
});

await t("back navigation goes list -> lists -> projects", async () => {
    await click(btnByIcon(ext._header, "go-previous-symbolic")[0]);
    assert.equal(headerTitle(), "Projeto A");
    await click(btnByIcon(ext._header, "go-previous-symbolic")[0]);
    assert.equal(headerTitle(), "Projetos");
    assert.equal(btnByIcon(ext._header, "go-previous-symbolic").length, 0);
});

await t("auto-complete: checking the last pending todo returns to Projetos and moves project to Concluídos", async () => {
    await click(mainBtn(rows()[1])); // Projeto A
    await click(mainBtn(rows()[1])); // Lista de Fixes
    await type("fix1");
    await click(checks()[0]); // fix1 done, features still pending
    assert.equal(headerTitle(), "Lista de Fixes");
    await click(btnByIcon(ext._header, "go-previous-symbolic")[0]);
    await click(mainBtn(rows()[0]));
    await click(checks()[0]);
    assert.equal(headerTitle(), "Lista de features"); // not yet
    await click(checks()[1]);                                // last one
    assert.equal(headerTitle(), "Projetos");           // jumped back
    assert.deepEqual(rowTitles(), ["Geral"]);          // Projeto A left the active list
    assert.deepEqual(globalThis.__notes.at(-1), ["Projeto concluído", "Projeto A"]);
    assert.ok(pill(ext._header, "Concluídos · 1"));
});

await t("Concluídos screen lists it, project is accessible, reactivation works", async () => {
    await click(pill(ext._header, "Concluídos · 1"));
    assert.equal(headerTitle(), "Concluídos");
    assert.deepEqual(rowTitles(), ["Projeto A"]);
    assert.equal(ext._footer.visible, false);
    // open it: header offers Reativar, back goes to Concluídos
    await click(mainBtn(rows()[0]));
    assert.equal(headerTitle(), "Projeto A");
    assert.ok(pill(ext._header, "Reativar"));
    assert.match(headerSub(), /concluído/);
    await click(btnByIcon(ext._header, "go-previous-symbolic")[0]);
    assert.equal(headerTitle(), "Concluídos");
    // reactivate from the row; no completed left -> falls back to Projetos
    await click(pill(rows()[0], "Reativar"));
    assert.equal(headerTitle(), "Projetos");
    assert.deepEqual(rowTitles(), ["Geral", "Projeto A"]);
    assert.equal(ext._footer.visible, true);
});

await t("unchecking in a completed project reactivates it", async () => {
    const f = ext._client.getFolders(false).find((x) => x.name === "Projeto A");
    await ext._client.setFolderCompleted(f.id, true);
    ext._navigate({ screen: "lists", folderId: f.id });
    assert.ok(pill(ext._header, "Reativar"));
    await click(mainBtn(rows()[0]));
    await click(checks()[0]); // uncheck
    assert.equal(ext._client.getFolder(f.id).completed, false);
    ext._navigate({ screen: "folders" });
    assert.deepEqual(rowTitles(), ["Geral", "Projeto A"]);
});

await t("inline rename: edit -> entry focused -> Enter commits", async () => {
    await click(btnByIcon(rows()[1], "document-edit-symbolic")[0]);
    const entry = entries()[0];
    assert.ok(entry);
    assert.equal(entry.text, "Projeto A");
    assert.equal(globalThis.__focus, entry);
    entry.text = "  Projeto Alfa ";
    await commit(entry);
    assert.deepEqual(rowTitles(), ["Geral", "Projeto Alfa"]);
    assert.equal(ext._renaming, null);
});

await t("inline rename: Escape cancels and is swallowed; blank commit keeps old name", async () => {
    await click(btnByIcon(rows()[1], "document-edit-symbolic")[0]);
    let entry = entries()[0];
    entry.text = "nope";
    const res = entry.clutterText.emit("key-press-event", { get_key_symbol: () => 65307 });
    assert.deepEqual(res, [true]); // EVENT_STOP
    assert.deepEqual(rowTitles(), ["Geral", "Projeto Alfa"]);
    await click(btnByIcon(rows()[1], "document-edit-symbolic")[0]);
    entry = entries()[0];
    entry.text = "   ";
    await commit(entry);
    assert.deepEqual(rowTitles(), ["Geral", "Projeto Alfa"]);
    assert.deepEqual(entry.clutterText.emit("key-press-event", { get_key_symbol: () => 97 }), [false]);
});

await t("delete needs confirmation when it has content, immediate when empty", async () => {
    await click(btnByIcon(rows()[1], "edit-delete-symbolic")[0]);
    assert.deepEqual(rowTitles(), ["Geral", "Projeto Alfa"]);
    assert.ok(pill(rows()[1], "Excluir?"));
    ext._navigate({ screen: "folders" }); // navigating elsewhere disarms
    assert.equal(pill(rows()[1], "Excluir?"), undefined);
    await click(btnByIcon(rows()[1], "edit-delete-symbolic")[0]);
    await click(pill(rows()[1], "Excluir?"));
    assert.deepEqual(rowTitles(), ["Geral"]);
    await type("Vazio"); // empty project deletes at once
    await click(btnByIcon(rows()[1], "edit-delete-symbolic")[0]);
    assert.deepEqual(rowTitles(), ["Geral"]);
});

await t("menu closing disarms a pending delete", async () => {
    await click(btnByIcon(rows()[0], "edit-delete-symbolic")[0]);
    assert.ok(pill(rows()[0], "Excluir?"));
    ext._button.menu.emit("open-state-changed", false);
    assert.equal(pill(rows()[0], "Excluir?"), undefined);
});

await t("todo row: focus moves to top, no copy button, markup escaping, remove", async () => {
    await click(mainBtn(rows()[0]));         // Geral
    await click(mainBtn(rows()[0]));         // Tarefas (alpha, beta)
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

await t("view pointing to a deleted project falls back to Projetos", async () => {
    await ext._client.removeFolder(ext._view.folderId);
    await flush();
    assert.equal(headerTitle(), "Projetos");
    assert.equal(ext._view.screen, "folders");
});

await t("load failure shows a notice without the input; reopening the menu retries", async () => {
    ext._client._error = "daemon unreachable";
    ext._render();
    assert.equal(findAll(ext._content, (x) => hasClass(x, "organizedtodo-empty-title"))[0].text, "Não foi possível carregar as tarefas");
    assert.equal(ext._footer.visible, false);
    assert.equal(rows().length, 0);
    ext._button.menu.emit("open-state-changed", true);
    await flush();
    assert.equal(ext._client.error, null);
    assert.equal(headerTitle(), "Projetos");
    // the previous test deleted the last project: back to the normal empty state
    assert.equal(findAll(ext._content, (x) => hasClass(x, "organizedtodo-empty-title"))[0].text, "Nenhum projeto ainda");
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
    await type("> nota");
    const label = findAll(ext._content, (x) => hasClass(x, "organizedtodo-todo-label"))[0];
    assert.equal(label.clutterText.markup, `<span style="italic" fgalpha="70%">▎ nota</span>`);
    await click(checks()[0]); // last pending todo: the project completes
    assert.deepEqual(globalThis.__notes.at(-1), ["Projeto concluído", "Big x"]); // no markers in notifications
});

await t("clicking a name with a link opens it and closes the menu; the row does not react", async () => {
    let closed = 0;
    ext._button.menu.close = () => closed++;
    await type("ler [docs](https://gnome.org) e [x](file:///etc)");
    const row = rows().at(-1);
    const label = findAll(row, (x) => hasClass(x, "organizedtodo-row-title"))[0];
    assert.equal(label.reactive, true);
    assert.deepEqual(label.emit("button-press-event"), [true]); // EVENT_STOP: the row button never sees it
    assert.deepEqual(label.emit("button-release-event"), [true]);
    assert.deepEqual(globalThis.__opened, ["https://gnome.org"]);
    assert.equal(closed, 1);
    assert.equal(headerTitle(), "Projetos"); // did not open the project
    await type("sem link");
    assert.notEqual(findAll(rows().at(-1), (x) => hasClass(x, "organizedtodo-row-title"))[0].reactive, true);
});

await t("disable cleans up", async () => {
    ext.disable();
    assert.equal(globalThis.__unbound, "open-organizedtodo");
    assert.equal(ext._button, null);
    assert.equal(ext._client, null);
});

console.log(`\n${n} UI tests passed`);
