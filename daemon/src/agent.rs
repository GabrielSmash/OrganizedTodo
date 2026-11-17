//! What AI agents can ask for (the MCP tools). Requests run inside the daemon, on the store
//! thread, so finding a task by name and changing it happen in one step. The MCP process only
//! forwards them over D-Bus (AgentCall) as JSON: {"tool": "get_list", "args": {...}}.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::lookup::{Kind, TaskRef};
use crate::model::{Folder, Todo, Workspace};
use crate::preferences::{AgentAccess, Preferences};

#[derive(Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ListProjects {
    /// Also list archived (completed) projects; they are left out by default
    #[serde(default)]
    pub include_completed: bool,
}

#[derive(Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct GetList {
    /// Project name (case does not matter; a unique part is enough) or its id
    pub project: String,
    /// List name inside that project, or its id
    pub list: String,
}

#[derive(Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct SearchTasks {
    /// Text to find in task names, ignoring case
    pub text: String,
    /// Also search archived (completed) projects
    #[serde(default)]
    pub include_completed: bool,
}

#[derive(Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct AddProject {
    /// Name of the new project; refused if a project with this name exists
    pub name: String,
}

#[derive(Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct AddList {
    /// Project name or id
    pub project: String,
    /// Name of the new list; refused if the project has a list with this name
    pub name: String,
}

#[derive(Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct AddTask {
    /// Project name or id
    pub project: String,
    /// List name or id
    pub list: String,
    /// The task; markdown such as **bold** and `code` is shown formatted
    pub name: String,
}

/// Which task: every tool that changes one starts with these three
#[derive(Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct TaskArgs {
    /// Project name or id
    pub project: String,
    /// List name or id
    pub list: String,
    /// Task name (case does not matter; a unique part is enough)
    pub task: String,
}

#[derive(Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct RenameTask {
    #[serde(flatten)]
    pub at: TaskArgs,
    /// New name for the task
    pub new_name: String,
}

#[derive(Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct SetTaskNotes {
    #[serde(flatten)]
    pub at: TaskArgs,
    /// The notes, in markdown (headings, lists, checkboxes, code blocks); empty clears them
    pub notes: String,
}

#[derive(Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct FocusTask {
    #[serde(flatten)]
    pub at: TaskArgs,
    /// true (default) pins the task to the top of its list; false unpins it
    #[serde(default = "yes")]
    pub focused: bool,
}

fn yes() -> bool {
    true
}

#[derive(Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "tool", content = "args", rename_all = "snake_case")]
pub enum Request {
    ListProjects(ListProjects),
    GetList(GetList),
    SearchTasks(SearchTasks),
    AddProject(AddProject),
    AddList(AddList),
    AddTask(AddTask),
    CompleteTask(TaskArgs),
    ReopenTask(TaskArgs),
    RenameTask(RenameTask),
    SetTaskNotes(SetTaskNotes),
    FocusTask(FocusTask),
}

impl Request {
    pub fn parse(json: &str) -> Result<Request, String> {
        serde_json::from_str(json).map_err(|error| format!("not a valid request: {error}"))
    }

    /// The least access that allows this request; the daemon refuses anything below it
    pub fn needs(&self) -> AgentAccess {
        match self {
            Request::ListProjects(_) | Request::GetList(_) | Request::SearchTasks(_) => {
                AgentAccess::Read
            }
            Request::AddProject(_)
            | Request::AddList(_)
            | Request::AddTask(_)
            | Request::CompleteTask(_)
            | Request::ReopenTask(_)
            | Request::RenameTask(_)
            | Request::SetTaskNotes(_)
            | Request::FocusTask(_) => AgentAccess::Write,
        }
    }
}

/// Runs a request against the data. Read-only requests do not change `workspace`;
/// the caller saves it only when the request needed write access.
/// The reply is JSON for the agent; an Err is a message it can act on.
pub fn run(
    workspace: &mut Workspace,
    preferences: Preferences,
    request: &Request,
) -> Result<Value, String> {
    match request {
        Request::ListProjects(args) => Ok(workspace
            .folders
            .iter()
            .filter(|folder| args.include_completed || !folder.completed)
            .map(project_summary)
            .collect()),
        Request::GetList(args) => {
            let (folder, list) = workspace
                .find_list(&args.project, &args.list)
                .map_err(|error| error.to_string())?;
            let tasks: Vec<Value> = list
                .todos
                .iter()
                .map(|todo| {
                    json!({
                        "name": todo.name,
                        "done": todo.is_done,
                        "focused": todo.is_focused,
                        "notes": todo.notes,
                    })
                })
                .collect();
            Ok(json!({ "project": folder.name, "list": list.name, "tasks": tasks }))
        }
        Request::SearchTasks(args) => {
            let wanted = args.text.trim().to_lowercase();
            if wanted.is_empty() {
                return Err("the text to search for is empty".into());
            }
            let mut found = Vec::new();
            for folder in &workspace.folders {
                if folder.completed && !args.include_completed {
                    continue;
                }
                for list in &folder.lists {
                    for todo in &list.todos {
                        if todo.name.to_lowercase().contains(&wanted) {
                            found.push(json!({
                                "project": folder.name,
                                "list": list.name,
                                "task": todo.name,
                                "done": todo.is_done,
                            }));
                        }
                    }
                }
            }
            Ok(Value::Array(found))
        }
        Request::AddProject(args) => {
            refuse_duplicate(
                Kind::Project,
                &args.name,
                workspace.folders.iter().map(|f| &f.name),
            )?;
            let id = workspace
                .add_folder(&args.name)
                .ok_or("the name is empty")?;
            Ok(json!({ "id": id, "name": args.name.trim() }))
        }
        Request::AddList(args) => {
            let folder = workspace
                .find_folder(&args.project)
                .map_err(|error| error.to_string())?;
            refuse_duplicate(Kind::List, &args.name, folder.lists.iter().map(|l| &l.name))?;
            let (folder_id, project) = (folder.id.clone(), folder.name.clone());
            let id = workspace
                .add_list(&folder_id, &args.name)
                .ok_or("the name is empty")?;
            Ok(json!({ "id": id, "project": project, "name": args.name.trim() }))
        }
        Request::AddTask(args) => {
            let (folder, list) = workspace
                .find_list(&args.project, &args.list)
                .map_err(|error| error.to_string())?;
            if let Some(same) = list.todos.iter().find(|t| same_name(&t.name, &args.name)) {
                let state = if same.is_done {
                    "done; use reopen_task"
                } else {
                    "pending"
                };
                return Err(format!(
                    "the task \"{}\" already exists ({state})",
                    same.name
                ));
            }
            let (folder_id, list_id) = (folder.id.clone(), list.id.clone());
            let (project, list_name, reactivated) =
                (folder.name.clone(), list.name.clone(), folder.completed);
            if !workspace.add_todo(&folder_id, &list_id, &args.name, preferences.new_todo_at) {
                return Err("the task name is empty".into());
            }
            Ok(json!({
                "project": project,
                "list": list_name,
                "task": args.name.trim(),
                "reactivated_project": reactivated,
            }))
        }
        Request::CompleteTask(at) => set_done(workspace, preferences, at, true),
        Request::ReopenTask(at) => set_done(workspace, preferences, at, false),
        Request::RenameTask(args) => {
            let found = find_task(workspace, &args.at)?;
            let todos = &workspace
                .folder(&found.folder_id)
                .and_then(|folder| folder.list(&found.list_id))
                .expect("just found")
                .todos;
            let others = todos.iter().enumerate().filter(|&(i, _)| i != found.index);
            refuse_duplicate(Kind::Task, &args.new_name, others.map(|(_, t)| &t.name))?;
            let old = task(workspace, &found).name.clone();
            if !workspace.rename_todo(
                &found.folder_id,
                &found.list_id,
                found.index,
                &args.new_name,
            ) {
                return Err("the new name is empty".into());
            }
            Ok(json!({ "task": args.new_name.trim(), "was": old }))
        }
        Request::SetTaskNotes(args) => {
            let found = find_task(workspace, &args.at)?;
            workspace.set_todo_notes(&found.folder_id, &found.list_id, found.index, &args.notes);
            Ok(json!({ "task": task(workspace, &found).name, "notes": args.notes }))
        }
        Request::FocusTask(args) => {
            let found = find_task(workspace, &args.at)?;
            let name = task(workspace, &found).name.clone();
            workspace.set_todo_focus(&found.folder_id, &found.list_id, found.index, args.focused);
            Ok(json!({ "task": name, "focused": args.focused }))
        }
    }
}

/// A project as the agent sees it in list_projects: names, ids and how much is left
fn project_summary(folder: &Folder) -> Value {
    let lists: Vec<Value> = folder
        .lists
        .iter()
        .map(|list| {
            json!({
                "id": list.id,
                "name": list.name,
                "pending": list.undone_count(),
                "tasks": list.todos.len(),
            })
        })
        .collect();
    json!({
        "id": folder.id,
        "name": folder.name,
        "completed": folder.completed,
        "pending": folder.undone_count(),
        "lists": lists,
    })
}

fn same_name(a: &str, b: &str) -> bool {
    a.trim().to_lowercase() == b.trim().to_lowercase()
}

/// Agents find things by name: a second "Home" would make "Home" ambiguous for good
fn refuse_duplicate<'a>(
    kind: Kind,
    name: &str,
    existing: impl IntoIterator<Item = &'a String>,
) -> Result<(), String> {
    match existing
        .into_iter()
        .find(|current| same_name(current, name))
    {
        Some(current) => Err(format!("a {kind} named \"{current}\" already exists")),
        None => Ok(()),
    }
}

fn find_task(workspace: &Workspace, at: &TaskArgs) -> Result<TaskRef, String> {
    workspace
        .find_task(&at.project, &at.list, &at.task)
        .map_err(|error| error.to_string())
}

/// The task `found` points to. It was resolved in this same call, so it exists
fn task<'a>(workspace: &'a Workspace, found: &TaskRef) -> &'a Todo {
    let folder = workspace.folder(&found.folder_id).expect("just found");
    let list = folder.list(&found.list_id).expect("just found");
    &list.todos[found.index]
}

/// complete_task and reopen_task: the same rules as the check in the menu
/// (where done tasks go, and archiving when the project is all done)
fn set_done(
    workspace: &mut Workspace,
    preferences: Preferences,
    at: &TaskArgs,
    done: bool,
) -> Result<Value, String> {
    let found = find_task(workspace, at)?;
    let current = task(workspace, &found);
    let name = current.name.clone();
    // Asking twice is fine: the agent may not know the state; toggling would undo it
    if current.is_done == done {
        return Ok(json!({ "task": name, "done": done, "changed": false }));
    }
    let toggled = workspace
        .toggle_todo(
            &found.folder_id,
            &found.list_id,
            found.index,
            preferences.done_todo,
            preferences.project_completion,
        )
        .expect("just found");
    let archived = workspace
        .folder(&found.folder_id)
        .is_some_and(|f| f.completed);
    Ok(json!({
        "task": name,
        "done": done,
        "changed": true,
        "project_all_done": toggled.all_done,
        "project_archived": archived,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preferences::ProjectCompletion;

    #[test]
    fn requests_are_a_tool_and_its_args() {
        assert_eq!(
            Request::parse(r#"{"tool":"get_list","args":{"project":"Casa","list":"Compras"}}"#)
                .unwrap(),
            Request::GetList(GetList {
                project: "Casa".into(),
                list: "Compras".into(),
            })
        );
        // Optional flags may be left out
        assert_eq!(
            Request::parse(r#"{"tool":"list_projects","args":{}}"#).unwrap(),
            Request::ListProjects(ListProjects {
                include_completed: false
            })
        );
    }

    #[test]
    fn unknown_tools_and_missing_args_are_errors() {
        let error = Request::parse(r#"{"tool":"delete_everything","args":{}}"#).unwrap_err();
        assert!(error.starts_with("not a valid request"));
        assert!(Request::parse(r#"{"tool":"get_list","args":{"project":"Casa"}}"#).is_err());
    }

    #[test]
    fn reading_needs_read_access() {
        let request = Request::ListProjects(ListProjects {
            include_completed: false,
        });
        assert_eq!(request.needs(), AgentAccess::Read);
        assert!(AgentAccess::Off < request.needs());
    }

    fn sample() -> Workspace {
        serde_json::from_str(r#"{"folders":[
            {"id":"f1","name":"Casa","lists":[
                {"id":"l1","name":"Compras","todos":[
                    {"name":"Leite","isDone":true},{"name":"Pão","isFocused":true,"notes":"integral"}]}]},
            {"id":"f2","name":"Antigo","completed":true,"lists":[
                {"id":"l2","name":"Feito","todos":[{"name":"Leite velho","isDone":true}]}]}]}"#)
        .unwrap()
    }

    fn ask(workspace: &mut Workspace, json: &str) -> Result<Value, String> {
        run(
            workspace,
            Preferences::default(),
            &Request::parse(json).unwrap(),
        )
    }

    #[test]
    fn list_projects_counts_pending_and_hides_archived_unless_asked() {
        let mut workspace = sample();
        let active = ask(&mut workspace, r#"{"tool":"list_projects","args":{}}"#).unwrap();
        assert_eq!(
            active,
            json!([{"id":"f1","name":"Casa","completed":false,"pending":1,
                "lists":[{"id":"l1","name":"Compras","pending":1,"tasks":2}]}])
        );
        let all = ask(
            &mut workspace,
            r#"{"tool":"list_projects","args":{"include_completed":true}}"#,
        )
        .unwrap();
        assert_eq!(all.as_array().unwrap().len(), 2);
    }

    #[test]
    fn get_list_finds_by_name_and_shows_every_task() {
        let mut workspace = sample();
        let reply = ask(
            &mut workspace,
            r#"{"tool":"get_list","args":{"project":"casa","list":"compras"}}"#,
        )
        .unwrap();
        assert_eq!(reply["list"], "Compras");
        assert_eq!(
            reply["tasks"][1],
            json!({"name":"Pão","done":false,"focused":true,"notes":"integral"})
        );
        let error = ask(
            &mut workspace,
            r#"{"tool":"get_list","args":{"project":"Casa","list":"Bugs"}}"#,
        )
        .unwrap_err();
        assert!(error.contains("available: \"Compras\""));
    }

    #[test]
    fn search_tasks_looks_everywhere_but_archived_unless_asked() {
        let mut workspace = sample();
        let found = ask(
            &mut workspace,
            r#"{"tool":"search_tasks","args":{"text":"LEITE"}}"#,
        )
        .unwrap();
        assert_eq!(
            found,
            json!([{"project":"Casa","list":"Compras","task":"Leite","done":true}])
        );
        let everywhere = ask(
            &mut workspace,
            r#"{"tool":"search_tasks","args":{"text":"leite","include_completed":true}}"#,
        )
        .unwrap();
        assert_eq!(everywhere.as_array().unwrap().len(), 2);
        assert!(
            ask(
                &mut workspace,
                r#"{"tool":"search_tasks","args":{"text":" "}}"#
            )
            .is_err()
        );
    }

    #[test]
    fn creating_needs_write_access_and_refuses_names_that_exist() {
        assert_eq!(
            Request::parse(r#"{"tool":"add_task","args":{"project":"a","list":"b","name":"c"}}"#)
                .unwrap()
                .needs(),
            AgentAccess::Write
        );
        let mut workspace = sample();
        let project = ask(
            &mut workspace,
            r#"{"tool":"add_project","args":{"name":" Work "}}"#,
        )
        .unwrap();
        assert_eq!(project["name"], "Work");
        let error = ask(
            &mut workspace,
            r#"{"tool":"add_project","args":{"name":"casa"}}"#,
        )
        .unwrap_err();
        assert_eq!(error, "a project named \"Casa\" already exists");
        let list = ask(
            &mut workspace,
            r#"{"tool":"add_list","args":{"project":"Work","name":"Bugs"}}"#,
        )
        .unwrap();
        assert_eq!(list["project"], "Work");
        assert!(
            ask(
                &mut workspace,
                r#"{"tool":"add_list","args":{"project":"Work","name":"bugs"}}"#
            )
            .is_err()
        );
    }

    #[test]
    fn add_task_goes_where_asked_and_points_to_reopen_for_a_done_twin() {
        let mut workspace = sample();
        let reply = ask(
            &mut workspace,
            r#"{"tool":"add_task","args":{"project":"Casa","list":"Compras","name":"Café"}}"#,
        )
        .unwrap();
        assert_eq!(reply["reactivated_project"], false);
        assert_eq!(workspace.folders[0].lists[0].todos[2].name, "Café");
        let error = ask(
            &mut workspace,
            r#"{"tool":"add_task","args":{"project":"Casa","list":"Compras","name":"leite"}}"#,
        )
        .unwrap_err();
        assert_eq!(
            error,
            "the task \"Leite\" already exists (done; use reopen_task)"
        );
        // Adding to an archived project brings it back, as in the menu
        let reply = ask(
            &mut workspace,
            r#"{"tool":"add_task","args":{"project":"Antigo","list":"Feito","name":"Novo"}}"#,
        )
        .unwrap();
        assert_eq!(reply["reactivated_project"], true);
        assert!(!workspace.folders[1].completed);
    }

    #[test]
    fn complete_follows_the_preferences_and_asking_twice_changes_nothing() {
        let mut workspace = sample();
        let preferences = Preferences {
            project_completion: ProjectCompletion::Automatic,
            ..Preferences::default()
        };
        let complete = Request::parse(
            r#"{"tool":"complete_task","args":{"project":"Casa","list":"Compras","task":"pão"}}"#,
        )
        .unwrap();
        let reply = run(&mut workspace, preferences, &complete).unwrap();
        assert_eq!(reply["changed"], true);
        assert_eq!(reply["project_all_done"], true);
        assert_eq!(reply["project_archived"], true);
        let again = run(&mut workspace, preferences, &complete).unwrap();
        assert_eq!(again["changed"], false);
        // Reopening brings the project back
        let reply = ask(
            &mut workspace,
            r#"{"tool":"reopen_task","args":{"project":"Casa","list":"Compras","task":"Pão"}}"#,
        )
        .unwrap();
        assert_eq!(reply["changed"], true);
        assert!(!workspace.folders[0].completed);
    }

    #[test]
    fn rename_notes_and_focus_change_the_named_task() {
        let mut workspace = sample();
        let error = ask(
            &mut workspace,
            r#"{"tool":"rename_task","args":{"project":"Casa","list":"Compras","task":"Pão","new_name":"leite"}}"#,
        )
        .unwrap_err();
        assert_eq!(error, "a task named \"Leite\" already exists");
        let reply = ask(
            &mut workspace,
            r#"{"tool":"rename_task","args":{"project":"Casa","list":"Compras","task":"Pão","new_name":"PÃO"}}"#,
        )
        .unwrap();
        assert_eq!(reply, json!({"task":"PÃO","was":"Pão"}));
        ask(
            &mut workspace,
            r#"{"tool":"set_task_notes","args":{"project":"Casa","list":"Compras","task":"leite","notes":"2 L"}}"#,
        )
        .unwrap();
        assert_eq!(workspace.folders[0].lists[0].todos[0].notes, "2 L");
        // Focus moves the task to the top, as in the menu
        ask(
            &mut workspace,
            r#"{"tool":"focus_task","args":{"project":"Casa","list":"Compras","task":"leite"}}"#,
        )
        .unwrap();
        let todos = &workspace.folders[0].lists[0].todos;
        assert_eq!(
            (todos[0].name.as_str(), todos[0].is_focused),
            ("Leite", true)
        );
        assert!(!todos[1].is_focused);
    }

    #[test]
    fn parameter_docs_become_schema_descriptions_for_the_agent() {
        let schema = serde_json::to_value(schemars::schema_for!(RenameTask)).unwrap();
        let properties = &schema["properties"];
        assert_eq!(
            properties["new_name"]["description"],
            "New name for the task"
        );
        // flatten: the task fields sit next to new_name, as in the JSON the agent sends
        assert!(properties["project"]["description"].is_string());
    }
}
