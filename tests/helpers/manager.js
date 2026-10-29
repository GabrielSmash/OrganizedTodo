// In-memory engine behind tests/helpers/fake-client.mjs. Mirrors the rules of
// daemon/src/model.rs, which is what the extension really uses.
// Workspace shape (stored as one JSON string in GSettings):
// { folders: [ { id, name, completed, lists: [ { id, name, todos: [ { name, isDone, isFocused? } ] } ] } ] }
const WORKSPACE = "workspace";

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Pending todos in a folder or in a list. */
export function undoneCount(node) {
    if (node.lists) {
        return node.lists.reduce((total, list) => total + undoneCount(list), 0);
    }
    return node.todos.filter((todo) => !todo.isDone).length;
}

/** All todos in a folder or in a list. */
export function todoCount(node) {
    if (node.lists) {
        return node.lists.reduce((total, list) => total + todoCount(list), 0);
    }
    return node.todos.length;
}

export class TodoListManager {
    GSettings;
    constructor(extension) {
        this.GSettings = extension.getSettings();
    }

    // ---- persistence ----

    _read() {
        const raw = this.GSettings.get_string(WORKSPACE);
        if (!raw) {
            return { folders: [] };
        }
        try {
            const data = JSON.parse(raw);
            if (Array.isArray(data?.folders)) {
                return data;
            }
        }
        catch (e) {
            console.error(`organizedtodo: invalid workspace JSON: ${e}`);
        }
        return { folders: [] };
    }

    _write(data) {
        this.GSettings.set_string(WORKSPACE, JSON.stringify(data));
    }

    _folder(data, folderId) {
        return data.folders.find((folder) => folder.id === folderId);
    }

    _list(data, folderId, listId) {
        return this._folder(data, folderId)?.lists.find((list) => list.id === listId);
    }

    // ---- queries ----

    getFolders(completed = false) {
        return this._read().folders.filter((folder) => !!folder.completed === completed);
    }

    getFolder(folderId) {
        return this._folder(this._read(), folderId) ?? null;
    }

    getList(folderId, listId) {
        return this._list(this._read(), folderId, listId) ?? null;
    }

    /** Pending todos across active (non-completed) projects. */
    getTotalUndone() {
        return this.getFolders(false).reduce((total, folder) => total + undoneCount(folder), 0);
    }

    // ---- folders ----

    addFolder(name) {
        name = name.trim();
        if (!name) {
            return null;
        }
        const data = this._read();
        const folder = { id: newId(), name, completed: false, lists: [] };
        data.folders.push(folder);
        this._write(data);
        return folder;
    }

    renameFolder(folderId, name) {
        name = name.trim();
        const data = this._read();
        const folder = this._folder(data, folderId);
        if (!name || !folder) {
            return false;
        }
        folder.name = name;
        this._write(data);
        return true;
    }

    removeFolder(folderId) {
        const data = this._read();
        const before = data.folders.length;
        data.folders = data.folders.filter((folder) => folder.id !== folderId);
        if (data.folders.length === before) {
            return false;
        }
        this._write(data);
        return true;
    }

    setFolderCompleted(folderId, completed) {
        const data = this._read();
        const folder = this._folder(data, folderId);
        if (!folder) {
            return false;
        }
        folder.completed = completed;
        this._write(data);
        return true;
    }

    // ---- lists ----

    addList(folderId, name) {
        name = name.trim();
        const data = this._read();
        const folder = this._folder(data, folderId);
        if (!name || !folder) {
            return null;
        }
        const list = { id: newId(), name, todos: [] };
        folder.lists.push(list);
        this._write(data);
        return list;
    }

    renameList(folderId, listId, name) {
        name = name.trim();
        const data = this._read();
        const list = this._list(data, folderId, listId);
        if (!name || !list) {
            return false;
        }
        list.name = name;
        this._write(data);
        return true;
    }

    removeList(folderId, listId) {
        const data = this._read();
        const folder = this._folder(data, folderId);
        if (!folder) {
            return false;
        }
        const before = folder.lists.length;
        folder.lists = folder.lists.filter((list) => list.id !== listId);
        if (folder.lists.length === before) {
            return false;
        }
        this._write(data);
        return true;
    }

    // ---- todos ----

    addTodo(folderId, listId, name) {
        name = name.trim();
        const data = this._read();
        const folder = this._folder(data, folderId);
        const list = this._list(data, folderId, listId);
        if (!name || !list) {
            return false;
        }
        list.todos.push({ name, isDone: false });
        // A completed project that gets a pending todo is not completed anymore
        folder.completed = false;
        this._write(data);
        return true;
    }

    removeTodo(folderId, listId, index) {
        const data = this._read();
        const list = this._list(data, folderId, listId);
        if (!list || index < 0 || index >= list.todos.length) {
            return false;
        }
        list.todos.splice(index, 1);
        this._write(data);
        return true;
    }

    renameTodo(folderId, listId, index, name) {
        name = name.trim();
        const data = this._read();
        const todo = this._list(data, folderId, listId)?.todos[index];
        if (!name || !todo) {
            return false;
        }
        todo.name = name;
        this._write(data);
        return true;
    }

    /** Like the daemon: trailing blank lines dropped; empty notes leave no "notes" key. */
    setTodoNotes(folderId, listId, index, notes) {
        const data = this._read();
        const todo = this._list(data, folderId, listId)?.todos[index];
        if (!todo) {
            return false;
        }
        notes = notes.trimEnd();
        if (notes) {
            todo.notes = notes;
        }
        else {
            delete todo.notes;
        }
        this._write(data);
        return true;
    }

    /**
     * Flip a todo's done state.
     * Returns true when this made every todo of the project done, in which
     * case the project is marked completed. Unchecking a todo reactivates a
     * completed project.
     */
    toggleTodo(folderId, listId, index) {
        const data = this._read();
        const folder = this._folder(data, folderId);
        const todo = this._list(data, folderId, listId)?.todos[index];
        if (!todo) {
            return false;
        }
        todo.isDone = !todo.isDone;
        let justCompleted = false;
        if (!todo.isDone) {
            folder.completed = false;
        }
        else if (!folder.completed && undoneCount(folder) === 0) {
            // todoCount > 0 is implied: the todo we just checked exists
            folder.completed = true;
            justCompleted = true;
        }
        this._write(data);
        return justCompleted;
    }

    /** Focused todo is kept at the top of its list; only one per list. */
    setTodoFocus(folderId, listId, index, focused) {
        const data = this._read();
        const list = this._list(data, folderId, listId);
        if (!list || !list.todos[index]) {
            return false;
        }
        for (const todo of list.todos) {
            delete todo.isFocused;
        }
        if (focused) {
            const [todo] = list.todos.splice(index, 1);
            todo.isFocused = true;
            list.todos.unshift(todo);
        }
        this._write(data);
        return true;
    }

    /** Move a todo from one index to another inside the same list. */
    reorderTodo(folderId, listId, fromIndex, toIndex) {
        const data = this._read();
        const list = this._list(data, folderId, listId);
        if (!list) {
            return false;
        }
        const size = list.todos.length;
        if (fromIndex < 0 || toIndex < 0 || fromIndex >= size || toIndex >= size || fromIndex === toIndex) {
            return false;
        }
        const [item] = list.todos.splice(fromIndex, 1);
        list.todos.splice(toIndex, 0, item);
        this._write(data);
        return true;
    }
}
