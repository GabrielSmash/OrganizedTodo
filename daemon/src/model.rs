use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Workspace {
    #[serde(default)]
    pub folders: Vec<Folder>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub completed: bool,
    #[serde(default)]
    pub lists: Vec<List>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct List {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub todos: Vec<Todo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Todo {
    pub name: String,
    #[serde(default)]
    pub is_done: bool,
    // The JS UI only writes isFocused when true; keep the stored JSON identical
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_focused: bool,
    // Only written when there is something: todos without notes keep the same JSON
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub notes: String,
}

fn is_false(value: &bool) -> bool {
    !*value
}

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

impl List {
    pub fn undone_count(&self) -> usize {
        self.todos.iter().filter(|todo| !todo.is_done).count()
    }
}

impl Folder {
    pub fn undone_count(&self) -> usize {
        self.lists.iter().map(List::undone_count).sum()
    }

    pub fn list(&self, list_id: &str) -> Option<&List> {
        self.lists.iter().find(|list| list.id == list_id)
    }

    pub fn list_mut(&mut self, list_id: &str) -> Option<&mut List> {
        self.lists.iter_mut().find(|list| list.id == list_id)
    }
}

impl Workspace {
    pub fn folder(&self, folder_id: &str) -> Option<&Folder> {
        self.folders.iter().find(|folder| folder.id == folder_id)
    }

    pub fn folder_mut(&mut self, folder_id: &str) -> Option<&mut Folder> {
        self.folders
            .iter_mut()
            .find(|folder| folder.id == folder_id)
    }

    // Only the tests look a list up by both ids
    #[cfg(test)]
    pub fn list(&self, folder_id: &str, list_id: &str) -> Option<&List> {
        self.folder(folder_id)?.list(list_id)
    }

    pub fn list_mut(&mut self, folder_id: &str, list_id: &str) -> Option<&mut List> {
        self.folder_mut(folder_id)?.list_mut(list_id)
    }

    /// Where a quick-added todo goes, as (folder id, list id): the remembered
    /// list while it exists in an active project, otherwise the first list of
    /// the first active project; None when there is no list at all.
    /// Completed projects are skipped: adding to one would reactivate it.
    pub fn quick_add_destination(
        &self,
        folder_id: &str,
        list_id: &str,
    ) -> Option<(String, String)> {
        if let Some(folder) = self.folder(folder_id)
            && !folder.completed
            && folder.list(list_id).is_some()
        {
            return Some((folder_id.to_string(), list_id.to_string()));
        }
        self.folders
            .iter()
            .filter(|folder| !folder.completed)
            .find_map(|folder| {
                let list = folder.lists.first()?;
                Some((folder.id.clone(), list.id.clone()))
            })
    }

    pub fn add_folder(&mut self, name: &str) -> Option<String> {
        let name = name.trim();
        if name.is_empty() {
            return None;
        }
        let id = new_id();
        self.folders.push(Folder {
            id: id.clone(),
            name: name.to_string(),
            completed: false,
            lists: Vec::new(),
        });
        Some(id)
    }

    pub fn rename_folder(&mut self, folder_id: &str, name: &str) -> bool {
        let name = name.trim();
        if name.is_empty() {
            return false;
        }
        let Some(folder) = self.folder_mut(folder_id) else {
            return false;
        };
        folder.name = name.to_string();
        true
    }

    pub fn remove_folder(&mut self, folder_id: &str) -> bool {
        let before = self.folders.len();
        self.folders.retain(|folder| folder.id != folder_id);
        self.folders.len() != before
    }

    pub fn set_folder_completed(&mut self, folder_id: &str, completed: bool) -> bool {
        let Some(folder) = self.folder_mut(folder_id) else {
            return false;
        };
        folder.completed = completed;
        true
    }

    pub fn add_list(&mut self, folder_id: &str, name: &str) -> Option<String> {
        let name = name.trim();
        if name.is_empty() {
            return None;
        }
        let folder = self.folder_mut(folder_id)?;
        let id = new_id();
        folder.lists.push(List {
            id: id.clone(),
            name: name.to_string(),
            todos: Vec::new(),
        });
        Some(id)
    }

    pub fn rename_list(&mut self, folder_id: &str, list_id: &str, name: &str) -> bool {
        let name = name.trim();
        if name.is_empty() {
            return false;
        }
        let Some(list) = self.list_mut(folder_id, list_id) else {
            return false;
        };
        list.name = name.to_string();
        true
    }

    pub fn remove_list(&mut self, folder_id: &str, list_id: &str) -> bool {
        let Some(folder) = self.folder_mut(folder_id) else {
            return false;
        };
        let before = folder.lists.len();
        folder.lists.retain(|list| list.id != list_id);
        folder.lists.len() != before
    }

    pub fn add_todo(&mut self, folder_id: &str, list_id: &str, name: &str) -> bool {
        let name = name.trim();
        if name.is_empty() {
            return false;
        }
        let Some(folder) = self.folder_mut(folder_id) else {
            return false;
        };
        let Some(list) = folder.list_mut(list_id) else {
            return false;
        };
        list.todos.push(Todo {
            name: name.to_string(),
            is_done: false,
            is_focused: false,
            notes: String::new(),
        });
        // A completed project that gets a pending todo is not completed anymore
        folder.completed = false;
        true
    }

    pub fn remove_todo(&mut self, folder_id: &str, list_id: &str, index: usize) -> bool {
        let Some(list) = self.list_mut(folder_id, list_id) else {
            return false;
        };
        if index >= list.todos.len() {
            return false;
        }
        list.todos.remove(index);
        true
    }

    pub fn rename_todo(
        &mut self,
        folder_id: &str,
        list_id: &str,
        index: usize,
        name: &str,
    ) -> bool {
        let name = name.trim();
        if name.is_empty() {
            return false;
        }
        let Some(todo) = self
            .list_mut(folder_id, list_id)
            .and_then(|list| list.todos.get_mut(index))
        else {
            return false;
        };
        todo.name = name.to_string();
        true
    }

    /// Notes may be empty (that clears them); trailing blank lines are dropped.
    pub fn set_todo_notes(
        &mut self,
        folder_id: &str,
        list_id: &str,
        index: usize,
        notes: &str,
    ) -> bool {
        let Some(todo) = self
            .list_mut(folder_id, list_id)
            .and_then(|list| list.todos.get_mut(index))
        else {
            return false;
        };
        todo.notes = notes.trim_end().to_string();
        true
    }

    /// Flip a todo's done state.
    /// Returns true when this made every todo of the project done; completing
    /// the project is then up to the user. Unchecking a todo reactivates a
    /// completed project.
    pub fn toggle_todo(&mut self, folder_id: &str, list_id: &str, index: usize) -> bool {
        let Some(folder) = self.folder_mut(folder_id) else {
            return false;
        };
        let Some(todo) = folder
            .list_mut(list_id)
            .and_then(|list| list.todos.get_mut(index))
        else {
            return false;
        };
        todo.is_done = !todo.is_done;
        let is_done = todo.is_done;

        if !is_done {
            folder.completed = false;
            return false;
        }
        !folder.completed && folder.undone_count() == 0
    }

    /// Focused todo is kept at the top of its list; only one per list.
    pub fn set_todo_focus(
        &mut self,
        folder_id: &str,
        list_id: &str,
        index: usize,
        focused: bool,
    ) -> bool {
        let Some(list) = self.list_mut(folder_id, list_id) else {
            return false;
        };
        if index >= list.todos.len() {
            return false;
        }
        for todo in &mut list.todos {
            todo.is_focused = false;
        }
        if focused {
            let mut todo = list.todos.remove(index);
            todo.is_focused = true;
            list.todos.insert(0, todo);
        }
        true
    }

    /// Move a todo from one index to another inside the same list.
    pub fn reorder_todo(&mut self, folder_id: &str, list_id: &str, from: usize, to: usize) -> bool {
        let Some(list) = self.list_mut(folder_id, list_id) else {
            return false;
        };
        let size = list.todos.len();
        if from >= size || to >= size || from == to {
            return false;
        }
        let todo = list.todos.remove(from);
        list.todos.insert(to, todo);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_keeps_js_format() {
        let raw = r#"{"folders":[{"id":"a","name":"P","completed":false,"lists":[{"id":"b","name":"L","todos":[{"name":"t","isDone":true}]}]}]}"#;
        let workspace: Workspace = serde_json::from_str(raw).unwrap();
        assert_eq!(serde_json::to_string(&workspace).unwrap(), raw);
    }

    fn sample() -> Workspace {
        serde_json::from_str(r#"{"folders":[
            {"id":"f1","name":"A","completed":false,"lists":[
                {"id":"l1","name":"L","todos":[{"name":"x","isDone":true},{"name":"y","isDone":false}]},
                {"id":"l2","name":"M","todos":[{"name":"z","isDone":false}]}]},
            {"id":"f2","name":"B","completed":true,"lists":[
                {"id":"l3","name":"N","todos":[{"name":"w","isDone":false}]}]}]}"#).unwrap()
    }

    #[test]
    fn counts_pending_todos() {
        let workspace = sample();
        let folder = workspace.folder("f1").unwrap();
        assert_eq!(folder.undone_count(), 2);
        assert_eq!(workspace.list("f1", "l1").unwrap().undone_count(), 1);
    }

    #[test]
    fn lookups_return_none_for_unknown_ids() {
        let workspace = sample();
        assert!(workspace.folder("nope").is_none());
        assert!(workspace.list("f1", "nope").is_none());
    }

    #[test]
    fn add_folder_trims_name_and_rejects_blank() {
        let mut workspace = Workspace::default();
        assert!(workspace.add_folder("   ").is_none());
        let id = workspace.add_folder("  Work  ").unwrap();
        let folder = workspace.folder(&id).unwrap();
        assert_eq!(folder.name, "Work");
        assert!(!folder.completed);
    }

    #[test]
    fn rename_complete_and_remove_folder() {
        let mut workspace = sample();
        assert!(workspace.rename_folder("f1", " New "));
        assert_eq!(workspace.folder("f1").unwrap().name, "New");
        assert!(!workspace.rename_folder("f1", "  "));
        assert!(!workspace.rename_folder("nope", "X"));

        assert!(workspace.set_folder_completed("f1", true));
        assert!(workspace.folder("f1").unwrap().completed);

        assert!(workspace.remove_folder("f1"));
        assert!(!workspace.remove_folder("f1"));
        assert!(workspace.folder("f1").is_none());
    }

    #[test]
    fn add_list_requires_existing_folder_and_name() {
        let mut workspace = sample();
        assert!(workspace.add_list("nope", "X").is_none());
        assert!(workspace.add_list("f1", "  ").is_none());
        let id = workspace.add_list("f1", " Inbox ").unwrap();
        let list = workspace.list("f1", &id).unwrap();
        assert_eq!(list.name, "Inbox");
        assert!(list.todos.is_empty());
    }

    #[test]
    fn rename_and_remove_list() {
        let mut workspace = sample();
        assert!(workspace.rename_list("f1", "l1", "Renamed"));
        assert_eq!(workspace.list("f1", "l1").unwrap().name, "Renamed");
        assert!(!workspace.rename_list("f1", "nope", "X"));
        assert!(!workspace.rename_list("f1", "l1", " "));

        assert!(workspace.remove_list("f1", "l1"));
        assert!(!workspace.remove_list("f1", "l1"));
        assert!(!workspace.remove_list("nope", "l2"));
        assert_eq!(workspace.folder("f1").unwrap().lists.len(), 1);
    }

    #[test]
    fn add_todo_reactivates_completed_folder() {
        let mut workspace = sample();
        assert!(!workspace.add_todo("f2", "l3", "  "));
        assert!(!workspace.add_todo("f2", "nope", "X"));
        assert!(workspace.add_todo("f2", "l3", " New "));
        let folder = workspace.folder("f2").unwrap();
        assert!(!folder.completed);
        let todo = folder.list("l3").unwrap().todos.last().unwrap();
        assert_eq!(todo.name, "New");
        assert!(!todo.is_done);
    }

    #[test]
    fn remove_and_rename_todo_by_index() {
        let mut workspace = sample();
        assert!(!workspace.remove_todo("f1", "l1", 5));
        assert!(workspace.rename_todo("f1", "l1", 1, " Y2 "));
        assert!(!workspace.rename_todo("f1", "l1", 9, "Z"));
        assert!(!workspace.rename_todo("f1", "l1", 0, " "));
        assert!(workspace.remove_todo("f1", "l1", 0));
        let todos = &workspace.list("f1", "l1").unwrap().todos;
        assert_eq!(todos.len(), 1);
        assert_eq!(todos[0].name, "Y2");
    }

    #[test]
    fn notes_are_saved_cleared_and_only_written_when_present() {
        let mut workspace = sample();
        assert!(workspace.set_todo_notes("f1", "l1", 0, "# Plan\n- step\n\n"));
        assert!(!workspace.set_todo_notes("f1", "l1", 9, "x"));
        let raw = serde_json::to_string(&workspace).unwrap();
        assert!(raw.contains(r##""notes":"# Plan\n- step""##));
        assert!(workspace.set_todo_notes("f1", "l1", 0, ""));
        assert!(!serde_json::to_string(&workspace).unwrap().contains("notes"));
    }

    #[test]
    fn quick_add_destination_keeps_the_remembered_list_or_falls_back() {
        let mut workspace = sample();
        let pair = |folder: &str, list: &str| Some((folder.to_string(), list.to_string()));
        assert_eq!(
            workspace.quick_add_destination("f1", "l2"),
            pair("f1", "l2")
        );
        // never used, deleted list, or a completed project: first list of the first active project
        assert_eq!(workspace.quick_add_destination("", ""), pair("f1", "l1"));
        assert_eq!(
            workspace.quick_add_destination("f1", "gone"),
            pair("f1", "l1")
        );
        assert_eq!(
            workspace.quick_add_destination("f2", "l3"),
            pair("f1", "l1")
        );
        // an active project without lists is skipped
        let empty = workspace.add_folder("Empty").unwrap();
        workspace.folders.rotate_right(1);
        assert_eq!(workspace.folders[0].id, empty);
        assert_eq!(workspace.quick_add_destination("", ""), pair("f1", "l1"));
        // no list anywhere
        assert!(workspace.remove_folder("f1"));
        assert_eq!(workspace.quick_add_destination("", ""), None);
    }

    #[test]
    fn toggle_reports_all_done_without_completing_folder() {
        let mut workspace = sample();
        assert!(!workspace.toggle_todo("f1", "l1", 1));
        assert!(workspace.toggle_todo("f1", "l2", 0));
        assert!(!workspace.folder("f1").unwrap().completed);
        // Completing is the user's choice; unchecking a todo still reactivates
        assert!(workspace.set_folder_completed("f1", true));
        assert!(!workspace.toggle_todo("f1", "l2", 0));
        assert!(!workspace.folder("f1").unwrap().completed);
        assert!(!workspace.toggle_todo("f1", "l2", 9));
    }

    #[test]
    fn focus_moves_todo_to_top_and_is_unique() {
        let mut workspace = sample();
        assert!(workspace.set_todo_focus("f1", "l1", 1, true));
        assert!(workspace.set_todo_focus("f1", "l1", 1, true));
        let todos = &workspace.list("f1", "l1").unwrap().todos;
        assert_eq!(todos[0].name, "x");
        assert!(todos[0].is_focused);
        assert!(!todos[1].is_focused);

        assert!(workspace.set_todo_focus("f1", "l1", 0, false));
        assert!(
            workspace
                .list("f1", "l1")
                .unwrap()
                .todos
                .iter()
                .all(|todo| !todo.is_focused)
        );
        assert!(!workspace.set_todo_focus("f1", "l1", 5, true));
    }

    #[test]
    fn reorder_moves_todo_within_list() {
        let mut workspace = sample();
        assert!(!workspace.reorder_todo("f1", "l1", 0, 0));
        assert!(!workspace.reorder_todo("f1", "l1", 0, 2));
        assert!(workspace.reorder_todo("f1", "l1", 0, 1));
        let names: Vec<&str> = workspace
            .list("f1", "l1")
            .unwrap()
            .todos
            .iter()
            .map(|todo| todo.name.as_str())
            .collect();
        assert_eq!(names, ["y", "x"]);
    }
}
