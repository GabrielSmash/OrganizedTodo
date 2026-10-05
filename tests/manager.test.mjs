import assert from "node:assert/strict";
import { TodoListManager, undoneCount, todoCount } from "../manager.js";

function fakeExtension(workspace = "") {
    const store = { workspace };
    return {
        store,
        getSettings: () => ({
            get_string: (k) => store[k],
            set_string: (k, v) => { store[k] = v; },
        }),
    };
}
const make = (workspace) => { const ext = fakeExtension(workspace); return [new TodoListManager(ext), ext]; };
let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok -", name); };

t("empty first run -> no projects, nothing written", () => {
    const [m, ext] = make();
    assert.deepEqual(m.getFolders(), []);
    assert.equal(m.getTotalUndone(), 0);
    assert.equal(ext.store.workspace, "");
});

t("create folders/lists/todos, reject blank names, trim", () => {
    const [m] = make();
    assert.equal(m.addFolder("   "), null);
    const f = m.addFolder("  Projeto A ");
    assert.equal(f.name, "Projeto A");
    assert.equal(m.addList("nope", "x"), null);
    const l1 = m.addList(f.id, "Features");
    const l2 = m.addList(f.id, "Fixes");
    assert.equal(m.addTodo(f.id, l1.id, " "), false);
    assert.equal(m.addTodo(f.id, l1.id, "login"), true);
    assert.equal(m.addTodo(f.id, l2.id, "bug"), true);
    assert.equal(todoCount(m.getFolder(f.id)), 2);
    assert.equal(undoneCount(m.getFolder(f.id).lists[0]), 1);
    assert.equal(m.getTotalUndone(), 2);
});

t("rename folder and list", () => {
    const [m] = make();
    const f = m.addFolder("A"); const l = m.addList(f.id, "L");
    assert.equal(m.renameFolder(f.id, "B"), true);
    assert.equal(m.renameFolder(f.id, "  "), false);
    assert.equal(m.renameList(f.id, l.id, "M"), true);
    assert.equal(m.getFolder(f.id).name, "B");
    assert.equal(m.getList(f.id, l.id).name, "M");
});

t("auto-complete only when the LAST todo across ALL lists is checked", () => {
    const [m] = make();
    const f = m.addFolder("P"); const a = m.addList(f.id, "a"); const b = m.addList(f.id, "b");
    m.addTodo(f.id, a.id, "1"); m.addTodo(f.id, a.id, "2"); m.addTodo(f.id, b.id, "3");
    assert.equal(m.toggleTodo(f.id, a.id, 0), false);
    assert.equal(m.toggleTodo(f.id, a.id, 1), false); // list a done, b still pending
    assert.equal(m.getFolder(f.id).completed, false);
    assert.equal(m.toggleTodo(f.id, b.id, 0), true);  // last one
    assert.equal(m.getFolder(f.id).completed, true);
    assert.equal(m.getFolders(false).length, 0);
    assert.equal(m.getFolders(true).length, 1);
    assert.equal(m.getTotalUndone(), 0);
});

t("empty project never auto-completes; empty list does not block completion", () => {
    const [m] = make();
    const f = m.addFolder("P"); m.addList(f.id, "empty"); const b = m.addList(f.id, "b");
    assert.equal(m.getFolder(f.id).completed, false);
    m.addTodo(f.id, b.id, "x");
    assert.equal(m.toggleTodo(f.id, b.id, 0), true);
});

t("unchecking or adding a todo reactivates a completed project; manual reactivate works", () => {
    const [m] = make();
    const f = m.addFolder("P"); const l = m.addList(f.id, "l");
    m.addTodo(f.id, l.id, "1"); m.toggleTodo(f.id, l.id, 0);
    assert.equal(m.getFolder(f.id).completed, true);
    m.toggleTodo(f.id, l.id, 0);
    assert.equal(m.getFolder(f.id).completed, false);
    m.toggleTodo(f.id, l.id, 0);
    m.addTodo(f.id, l.id, "2");
    assert.equal(m.getFolder(f.id).completed, false);
    m.toggleTodo(f.id, l.id, 1);
    assert.equal(m.getFolder(f.id).completed, true);
    assert.equal(m.setFolderCompleted(f.id, false), true);
    assert.equal(m.getFolders(false).length, 1);
});

t("focus moves todo to top, single per list; unfocus keeps position", () => {
    const [m] = make();
    const f = m.addFolder("P"); const l = m.addList(f.id, "l");
    ["a", "b", "c"].forEach((x) => m.addTodo(f.id, l.id, x));
    m.setTodoFocus(f.id, l.id, 2, true);
    let todos = m.getList(f.id, l.id).todos;
    assert.deepEqual(todos.map((x) => x.name), ["c", "a", "b"]);
    assert.equal(todos[0].isFocused, true);
    m.setTodoFocus(f.id, l.id, 2, true);
    todos = m.getList(f.id, l.id).todos;
    assert.deepEqual(todos.filter((x) => x.isFocused).map((x) => x.name), ["b"]);
    m.setTodoFocus(f.id, l.id, 0, false);
    todos = m.getList(f.id, l.id).todos;
    assert.equal(todos.some((x) => x.isFocused), false);
    assert.deepEqual(todos.map((x) => x.name), ["b", "c", "a"]);
});

t("reorder and bounds", () => {
    const [m] = make();
    const f = m.addFolder("P"); const l = m.addList(f.id, "l");
    ["a", "b", "c"].forEach((x) => m.addTodo(f.id, l.id, x));
    assert.equal(m.reorderTodo(f.id, l.id, 0, 2), true);
    assert.deepEqual(m.getList(f.id, l.id).todos.map((x) => x.name), ["b", "c", "a"]);
    assert.equal(m.reorderTodo(f.id, l.id, 1, 1), false);
    assert.equal(m.reorderTodo(f.id, l.id, 0, 9), false);
    assert.equal(m.reorderTodo(f.id, l.id, -1, 0), false);
});

t("remove todo/list/folder and unknown ids", () => {
    const [m] = make();
    const f = m.addFolder("P"); const l = m.addList(f.id, "l");
    m.addTodo(f.id, l.id, "a");
    assert.equal(m.removeTodo(f.id, l.id, 5), false);
    assert.equal(m.removeTodo(f.id, l.id, 0), true);
    assert.equal(m.removeList(f.id, "nope"), false);
    assert.equal(m.removeList(f.id, l.id), true);
    assert.equal(m.removeFolder("nope"), false);
    assert.equal(m.removeFolder(f.id), true);
    assert.equal(m.toggleTodo("x", "y", 0), false);
});

t("renameTodo trims, keeps isDone/isFocused, rejects blank and unknown", () => {
    const [m] = make();
    const f = m.addFolder("P"); const l = m.addList(f.id, "l");
    m.addTodo(f.id, l.id, "a"); m.addTodo(f.id, l.id, "b");
    m.toggleTodo(f.id, l.id, 1);
    m.setTodoFocus(f.id, l.id, 1, true);   // b moves to index 0, focused and done
    assert.equal(m.renameTodo(f.id, l.id, 0, "  b2  "), true);
    const [b, a] = m.getList(f.id, l.id).todos;
    assert.deepEqual([b.name, b.isDone, b.isFocused], ["b2", true, true]);
    assert.equal(a.name, "a");
    assert.equal(m.renameTodo(f.id, l.id, 0, "   "), false);
    assert.equal(m.renameTodo(f.id, l.id, 9, "x"), false);
    assert.equal(m.renameTodo(f.id, "nope", 0, "x"), false);
    assert.equal(m.renameTodo("nope", l.id, 0, "x"), false);
    assert.equal(m.getList(f.id, l.id).todos[0].name, "b2");
});

t("corrupt workspace JSON does not throw and is not overwritten by reading", () => {
    const [m, ext] = make("{broken");
    assert.deepEqual(m.getFolders(), []);
    assert.equal(ext.store.workspace, "{broken");
});

t("valid JSON with the wrong shape is treated as empty", () => {
    const [m] = make('{"folders":"nope"}');
    assert.deepEqual(m.getFolders(), []);
});

t("unique ids", () => {
    const [m] = make();
    const ids = new Set(Array.from({ length: 200 }, (_, i) => m.addFolder(`f${i}`).id));
    assert.equal(ids.size, 200);
});

console.log(`\n${n} tests passed`);
