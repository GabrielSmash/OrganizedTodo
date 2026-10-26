// Stand-in for client.js in the UI tests: same API, but backed by the in-memory
// TodoListManager instead of the D-Bus daemon. Like the real client, queries
// read a copy that is refreshed only after a change, and mutations are async.
import { TodoListManager, undoneCount, todoCount } from "./manager.js";

export { undoneCount, todoCount };

export class TodoClient {
    _manager;
    _onChange;
    _workspace = { folders: [] };
    // Tests set this to simulate a daemon that cannot load the data
    _error = null;

    constructor(onChange) {
        this._onChange = onChange;
        this._manager = new TodoListManager({ getSettings: () => globalThis.__settings });
    }

    async connect() {
        await null;
        this._refresh();
    }

    destroy() {
        this._onChange = null;
    }

    get error() {
        return this._error;
    }

    async refresh() {
        this._error = null;
        this._refresh();
    }

    // Plays the role of the daemon's Changed signal
    _refresh() {
        if (!this._onChange) {
            return;
        }
        this._workspace = this._manager._read();
        this._onChange();
    }

    async _mutate(change) {
        const result = change(this._manager);
        await null;
        this._refresh();
        return result;
    }

    getFolders(completed = false) {
        return this._workspace.folders.filter((folder) => !!folder.completed === completed);
    }

    getFolder(folderId) {
        return this._workspace.folders.find((folder) => folder.id === folderId) ?? null;
    }

    getList(folderId, listId) {
        return this.getFolder(folderId)?.lists.find((list) => list.id === listId) ?? null;
    }

    addFolder(name) { return this._mutate((m) => m.addFolder(name)?.id ?? null); }
    renameFolder(folderId, name) { return this._mutate((m) => m.renameFolder(folderId, name)); }
    removeFolder(folderId) { return this._mutate((m) => m.removeFolder(folderId)); }
    setFolderCompleted(folderId, completed) { return this._mutate((m) => m.setFolderCompleted(folderId, completed)); }
    addList(folderId, name) { return this._mutate((m) => m.addList(folderId, name)?.id ?? null); }
    renameList(folderId, listId, name) { return this._mutate((m) => m.renameList(folderId, listId, name)); }
    removeList(folderId, listId) { return this._mutate((m) => m.removeList(folderId, listId)); }
    addTodo(folderId, listId, name) { return this._mutate((m) => m.addTodo(folderId, listId, name)); }
    removeTodo(folderId, listId, index) { return this._mutate((m) => m.removeTodo(folderId, listId, index)); }
    renameTodo(folderId, listId, index, name) { return this._mutate((m) => m.renameTodo(folderId, listId, index, name)); }
    toggleTodo(folderId, listId, index) { return this._mutate((m) => m.toggleTodo(folderId, listId, index)); }
    setTodoFocus(folderId, listId, index, focused) { return this._mutate((m) => m.setTodoFocus(folderId, listId, index, focused)); }
    reorderTodo(folderId, listId, fromIndex, toIndex) { return this._mutate((m) => m.reorderTodo(folderId, listId, fromIndex, toIndex)); }
}
