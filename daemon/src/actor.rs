use std::error::Error;
use std::path::PathBuf;
use std::sync::mpsc;
use std::thread;

use serde_json::Value;

use crate::agent::{self, Request};
use crate::model::Workspace;
use crate::preferences::{AgentAccess, Preferences};
use crate::store::Store;

type Job = Box<dyn FnOnce(&Store) + Send>;

/// Cheap, cloneable access to the Store, which lives on its own thread
/// because gio::Settings cannot leave the thread that created it.
#[derive(Clone)]
pub struct StoreHandle {
    jobs: mpsc::Sender<Job>,
}

impl StoreHandle {
    /// `open` runs on the store thread, so the Store is created where it will live.
    pub fn spawn(
        open: impl FnOnce() -> Result<Store, Box<dyn Error>> + Send + 'static,
    ) -> Result<Self, Box<dyn Error>> {
        let (jobs, inbox) = mpsc::channel::<Job>();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
        thread::spawn(move || {
            let store = match open() {
                Ok(store) => store,
                Err(error) => {
                    let _ = ready_tx.send(Err(error.to_string()));
                    return;
                }
            };
            let _ = ready_tx.send(Ok(()));
            for job in inbox {
                job(&store);
            }
        });
        ready_rx.recv()??;
        Ok(Self { jobs })
    }

    async fn run<R: Send + 'static>(&self, job: impl FnOnce(&Store) -> R + Send + 'static) -> R {
        let (reply_tx, reply_rx) = async_channel::bounded(1);
        self.jobs
            .send(Box::new(move |store| {
                let _ = reply_tx.send_blocking(job(store));
            }))
            .expect("store thread stopped");
        reply_rx.recv().await.expect("store thread stopped")
    }

    pub async fn read<R: Send + 'static>(
        &self,
        query: impl FnOnce(&Workspace) -> R + Send + 'static,
    ) -> Result<R, String> {
        self.run(move |store| store.load().map(|workspace| query(&workspace)))
            .await
    }

    /// Load, apply, save, with the user's preferences read in the same job as the data.
    /// Nothing is saved when the stored data cannot be loaded.
    pub async fn update_with_preferences<R: Send + 'static>(
        &self,
        change: impl FnOnce(&mut Workspace, Preferences) -> R + Send + 'static,
    ) -> Result<R, String> {
        self.run(move |store| {
            let preferences = store.preferences();
            let mut workspace = store.load()?;
            let result = change(&mut workspace, preferences);
            store.save(&workspace).map_err(|error| error.to_string())?;
            Ok(result)
        })
        .await
    }

    /// Where quick add should put a todo: the remembered destination,
    /// checked against the current workspace in the same job.
    pub async fn quick_add_destination(&self) -> Result<Option<(String, String)>, String> {
        self.run(|store| {
            let (folder_id, list_id) = store.last_destination();
            let target = store.preferences().quick_add_target;
            let workspace = store.load()?;
            Ok(workspace.quick_add_destination(&folder_id, &list_id, target))
        })
        .await
    }

    pub async fn remember_destination(
        &self,
        folder_id: String,
        list_id: String,
    ) -> Result<(), String> {
        self.run(move |store| store.set_last_destination(&folder_id, &list_id))
            .await
    }

    /// Writes every project to a file, as indented JSON.
    pub async fn export_to(&self, path: PathBuf) -> Result<(), String> {
        self.run(move |store| {
            let backup = store.load()?.to_backup()?;
            std::fs::write(&path, backup)
                .map_err(|error| format!("cannot write {}: {error}", path.display()))
        })
        .await
    }

    /// Replaces every project with the ones in a backup file; returns how many it has.
    /// Nothing changes when the file cannot be read or is not a backup.
    pub async fn import_from(&self, path: PathBuf) -> Result<usize, String> {
        self.run(move |store| {
            let raw = std::fs::read_to_string(&path)
                .map_err(|error| format!("cannot read {}: {error}", path.display()))?;
            let workspace = Workspace::from_backup(&raw)?;
            store.save(&workspace).map_err(|error| error.to_string())?;
            Ok(workspace.folders.len())
        })
        .await
    }

    /// One AI agent request, in a single job: the access check, finding things by name and
    /// changing them happen with nothing in between. Returns the reply and whether it saved.
    /// Only requests that write are saved, and only when they succeed.
    pub async fn agent_call(&self, request: Request) -> Result<(Value, bool), String> {
        self.run(move |store| {
            let preferences = store.preferences();
            let needed = request.needs();
            if preferences.agent_access < needed {
                return Err(refusal(preferences.agent_access));
            }
            let mut workspace = store.load()?;
            let reply = agent::run(&mut workspace, preferences, &request)?;
            let writes = needed == AgentAccess::Write;
            if writes {
                store.save(&workspace).map_err(|error| error.to_string())?;
            }
            Ok((reply, writes))
        })
        .await
    }
}

/// What the agent is told when the user has not allowed what it asked for
fn refusal(access: AgentAccess) -> String {
    match access {
        AgentAccess::Off => "AI agents are turned off in OrganizedTodo; the user can allow \
            them in its settings, tab \"AI agents\""
            .into(),
        _ => "OrganizedTodo only lets AI agents read; to change anything, the user must choose \
            \"Read and change them\" in its settings, tab \"AI agents\""
            .into(),
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    fn memory_handle() -> StoreHandle {
        StoreHandle::spawn(|| {
            let schema_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../schemas");
            Store::open(&schema_dir, Some(&gio::memory_settings_backend_new()))
        })
        .unwrap()
    }

    #[test]
    fn update_persists_between_calls() {
        let handle = memory_handle();
        let id = futures_lite::future::block_on(
            handle.update_with_preferences(|workspace, _| workspace.add_folder("Work")),
        )
        .unwrap()
        .unwrap();
        let name = futures_lite::future::block_on(
            handle.read(move |workspace| workspace.folder(&id).map(|folder| folder.name.clone())),
        )
        .unwrap();
        assert_eq!(name.as_deref(), Some("Work"));
    }

    #[test]
    fn update_never_overwrites_corrupted_data() {
        let handle = memory_handle();
        futures_lite::future::block_on(handle.run(|store| store.set_raw("{not json")));
        let result = futures_lite::future::block_on(
            handle.update_with_preferences(|workspace, _| workspace.add_folder("Work")),
        );
        assert!(result.is_err());
        let raw = futures_lite::future::block_on(handle.run(|store| store.raw()));
        assert_eq!(raw, "{not json");
    }

    #[test]
    fn update_with_preferences_sees_the_current_keys() {
        use crate::preferences::NewTodoAt;
        let handle = memory_handle();
        let seen = |handle: &StoreHandle| {
            futures_lite::future::block_on(
                handle.update_with_preferences(|_, preferences| preferences.new_todo_at),
            )
            .unwrap()
        };
        assert_eq!(seen(&handle), NewTodoAt::Bottom);
        futures_lite::future::block_on(
            handle.run(|store| store.set_string("new-todo-position", "top")),
        );
        assert_eq!(seen(&handle), NewTodoAt::Top);
    }

    #[test]
    fn quick_add_destination_follows_quick_add_target() {
        let handle = memory_handle();
        let destination =
            || futures_lite::future::block_on(handle.quick_add_destination()).unwrap();
        futures_lite::future::block_on(handle.update_with_preferences(|workspace, _| {
            let folder = workspace.add_folder("Work").unwrap();
            workspace.add_list(&folder, "Inbox");
        }))
        .unwrap();
        assert!(destination().is_some());
        futures_lite::future::block_on(
            handle.run(|store| store.set_string("quick-add-target", "ask")),
        );
        assert_eq!(destination(), None);
    }

    #[test]
    fn export_then_import_restores_the_projects_and_a_bad_file_changes_nothing() {
        use futures_lite::future::block_on;
        let handle = memory_handle();
        let path =
            std::env::temp_dir().join(format!("organizedtodo-test-{}.json", uuid::Uuid::new_v4()));
        let names = |handle: &StoreHandle| {
            block_on(handle.read(|workspace| {
                workspace
                    .folders
                    .iter()
                    .map(|folder| folder.name.clone())
                    .collect::<Vec<_>>()
            }))
            .unwrap()
        };
        block_on(handle.update_with_preferences(|workspace, _| workspace.add_folder("Work")))
            .unwrap();
        block_on(handle.export_to(path.clone())).unwrap();
        block_on(handle.update_with_preferences(|workspace, _| workspace.add_folder("Later")))
            .unwrap();
        assert_eq!(block_on(handle.import_from(path.clone())).unwrap(), 1);
        assert_eq!(names(&handle), ["Work"]);
        std::fs::write(&path, "{}").unwrap();
        assert!(block_on(handle.import_from(path.clone())).is_err());
        assert_eq!(names(&handle), ["Work"]);
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn spawn_reports_open_errors() {
        assert!(StoreHandle::spawn(|| Store::open(Path::new("/nonexistent"), None)).is_err());
    }

    #[test]
    fn agent_calls_follow_agent_access_and_only_successful_writes_are_saved() {
        let handle = memory_handle();
        let call = |json: &str| {
            futures_lite::future::block_on(handle.agent_call(Request::parse(json).unwrap()))
        };
        let allow = |value: &'static str| {
            futures_lite::future::block_on(
                handle.run(move |store| store.set_string("agent-access", value)),
            )
        };
        let add = r#"{"tool":"add_project","args":{"name":"Work"}}"#;
        let list = r#"{"tool":"list_projects","args":{}}"#;

        assert!(call(list).unwrap_err().contains("turned off"));
        allow("read");
        assert_eq!(call(list).unwrap(), (serde_json::json!([]), false));
        let refused = call(add).unwrap_err();
        assert!(refused.contains("only lets AI agents read"));
        // The option's name as the settings window shows it (prefs.js), so the agent can guide the user
        assert!(refused.contains("\"Read and change them\""));
        allow("write");
        let (reply, saved) = call(add).unwrap();
        assert_eq!((reply["name"].as_str(), saved), (Some("Work"), true));
        // Saved: the next call sees it; a refused duplicate saves nothing
        assert!(call(add).unwrap_err().contains("already exists"));
        assert_eq!(call(list).unwrap().0.as_array().unwrap().len(), 1);
    }
}
