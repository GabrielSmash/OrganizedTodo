import Gio from "gi://Gio";

const BUS_NAME = "io.github.gabrielsmash.OrganizedTodo";
const OBJECT_PATH = "/io/github/gabrielsmash/OrganizedTodo";

// Must match the #[interface] in daemon/src/service.rs
const INTERFACE_XML = `
<node>
  <interface name="io.github.gabrielsmash.OrganizedTodo1">
    <method name="GetWorkspace">
      <arg type="s" direction="out"/>
    </method>
    <method name="AddFolder">
      <arg name="name" type="s" direction="in"/>
      <arg type="s" direction="out"/>
    </method>
    <method name="RenameFolder">
      <arg name="folder_id" type="s" direction="in"/>
      <arg name="name" type="s" direction="in"/>
      <arg type="b" direction="out"/>
    </method>
    <method name="RemoveFolder">
      <arg name="folder_id" type="s" direction="in"/>
      <arg type="b" direction="out"/>
    </method>
    <method name="SetFolderCompleted">
      <arg name="folder_id" type="s" direction="in"/>
      <arg name="completed" type="b" direction="in"/>
      <arg type="b" direction="out"/>
    </method>
    <method name="AddList">
      <arg name="folder_id" type="s" direction="in"/>
      <arg name="name" type="s" direction="in"/>
      <arg type="s" direction="out"/>
    </method>
    <method name="RenameList">
      <arg name="folder_id" type="s" direction="in"/>
      <arg name="list_id" type="s" direction="in"/>
      <arg name="name" type="s" direction="in"/>
      <arg type="b" direction="out"/>
    </method>
    <method name="RemoveList">
      <arg name="folder_id" type="s" direction="in"/>
      <arg name="list_id" type="s" direction="in"/>
      <arg type="b" direction="out"/>
    </method>
    <method name="AddTodo">
      <arg name="folder_id" type="s" direction="in"/>
      <arg name="list_id" type="s" direction="in"/>
      <arg name="name" type="s" direction="in"/>
      <arg type="b" direction="out"/>
    </method>
    <method name="RemoveTodo">
      <arg name="folder_id" type="s" direction="in"/>
      <arg name="list_id" type="s" direction="in"/>
      <arg name="index" type="u" direction="in"/>
      <arg type="b" direction="out"/>
    </method>
    <method name="RenameTodo">
      <arg name="folder_id" type="s" direction="in"/>
      <arg name="list_id" type="s" direction="in"/>
      <arg name="index" type="u" direction="in"/>
      <arg name="name" type="s" direction="in"/>
      <arg type="b" direction="out"/>
    </method>
    <method name="ToggleTodo">
      <arg name="folder_id" type="s" direction="in"/>
      <arg name="list_id" type="s" direction="in"/>
      <arg name="index" type="u" direction="in"/>
      <arg type="b" direction="out"/>
    </method>
    <method name="SetTodoFocus">
      <arg name="folder_id" type="s" direction="in"/>
      <arg name="list_id" type="s" direction="in"/>
      <arg name="index" type="u" direction="in"/>
      <arg name="focused" type="b" direction="in"/>
      <arg type="b" direction="out"/>
    </method>
    <method name="ReorderTodo">
      <arg name="folder_id" type="s" direction="in"/>
      <arg name="list_id" type="s" direction="in"/>
      <arg name="from" type="u" direction="in"/>
      <arg name="to" type="u" direction="in"/>
      <arg type="b" direction="out"/>
    </method>
    <signal name="Changed"/>
  </interface>
</node>`;

const TodoProxy = Gio.DBusProxy.makeProxyWrapper(INTERFACE_XML);

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

/**
 * Client of organizedtodo-daemon. Keeps the last workspace received so that
 * queries (and rendering) stay synchronous; every mutation is async and the
 * daemon's Changed signal refreshes the copy and calls `onChange`.
 */
export class TodoClient {
    _proxy = null;
    _changedId = null;
    _workspace = { folders: [] };
    _onChange;

    constructor(onChange) {
        this._onChange = onChange;
    }

    async connect() {
        const proxy = await TodoProxy.newAsync(Gio.DBus.session, BUS_NAME, OBJECT_PATH);
        // destroy() may have run while the proxy was being created
        if (!this._onChange) {
            return;
        }
        this._proxy = proxy;
        this._changedId = this._proxy.connectSignal("Changed", () => this._refresh());
        await this._refresh();
    }

    destroy() {
        if (this._changedId !== null) {
            this._proxy.disconnectSignal(this._changedId);
        }
        this._changedId = null;
        this._proxy = null;
        this._onChange = null;
    }

    async _refresh() {
        let data;
        try {
            const [raw] = await this._proxy.GetWorkspaceAsync();
            data = JSON.parse(raw);
        }
        catch (e) {
            console.error(`organizedtodo: failed to load workspace: ${e}`);
            return;
        }
        // destroy() may have run while the call was in flight
        if (!this._proxy) {
            return;
        }
        this._workspace = Array.isArray(data?.folders) ? data : { folders: [] };
        this._onChange();
    }

    async _call(method, ...args) {
        const [result] = await this._proxy[`${method}Async`](...args);
        return result;
    }

    // ---- queries (synchronous, from the last received workspace) ----

    getFolders(completed = false) {
        return this._workspace.folders.filter((folder) => !!folder.completed === completed);
    }

    getFolder(folderId) {
        return this._workspace.folders.find((folder) => folder.id === folderId) ?? null;
    }

    getList(folderId, listId) {
        return this.getFolder(folderId)?.lists.find((list) => list.id === listId) ?? null;
    }

    // ---- mutations (async; D-Bus has no null, so an empty id means "not created") ----

    async addFolder(name) {
        return (await this._call("AddFolder", name)) || null;
    }

    renameFolder(folderId, name) {
        return this._call("RenameFolder", folderId, name);
    }

    removeFolder(folderId) {
        return this._call("RemoveFolder", folderId);
    }

    setFolderCompleted(folderId, completed) {
        return this._call("SetFolderCompleted", folderId, completed);
    }

    async addList(folderId, name) {
        return (await this._call("AddList", folderId, name)) || null;
    }

    renameList(folderId, listId, name) {
        return this._call("RenameList", folderId, listId, name);
    }

    removeList(folderId, listId) {
        return this._call("RemoveList", folderId, listId);
    }

    addTodo(folderId, listId, name) {
        return this._call("AddTodo", folderId, listId, name);
    }

    removeTodo(folderId, listId, index) {
        return this._call("RemoveTodo", folderId, listId, index);
    }

    renameTodo(folderId, listId, index, name) {
        return this._call("RenameTodo", folderId, listId, index, name);
    }

    /** Resolves to true when this made every todo of the project done. */
    toggleTodo(folderId, listId, index) {
        return this._call("ToggleTodo", folderId, listId, index);
    }

    setTodoFocus(folderId, listId, index, focused) {
        return this._call("SetTodoFocus", folderId, listId, index, focused);
    }

    reorderTodo(folderId, listId, fromIndex, toIndex) {
        return this._call("ReorderTodo", folderId, listId, fromIndex, toIndex);
    }
}
