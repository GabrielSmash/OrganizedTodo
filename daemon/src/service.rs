use zbus::fdo;
use zbus::interface;
use zbus::object_server::SignalEmitter;

use crate::actor::StoreHandle;
use crate::model::Workspace;

pub const BUS_NAME: &str = "io.github.gabrielsmash.OrganizedTodo";
pub const OBJECT_PATH: &str = "/io/github/gabrielsmash/OrganizedTodo";

pub struct TodoService {
    store: StoreHandle,
}

impl TodoService {
    pub fn new(store: StoreHandle) -> Self {
        Self { store }
    }

    /// Every mutation goes through here: apply, save, then tell clients to refresh.
    async fn update<R: Send + 'static>(
        &self,
        emitter: &SignalEmitter<'_>,
        change: impl FnOnce(&mut Workspace) -> R + Send + 'static,
    ) -> R {
        let result = self.store.update(change).await;
        if let Err(error) = Self::changed(emitter).await {
            eprintln!("organizedtodo: failed to emit Changed: {error}");
        }
        result
    }
}

#[interface(name = "io.github.gabrielsmash.OrganizedTodo1")]
impl TodoService {
    /// The whole workspace as JSON, in the same format stored in GSettings.
    async fn get_workspace(&self) -> fdo::Result<String> {
        self.store
            .read(|workspace| serde_json::to_string(workspace))
            .await
            .map_err(|error| fdo::Error::Failed(error.to_string()))
    }

    // D-Bus has no optional values: an empty id means nothing was created.
    async fn add_folder(
        &self,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
        name: String,
    ) -> String {
        self.update(&emitter, move |workspace| workspace.add_folder(&name))
            .await
            .unwrap_or_default()
    }

    async fn rename_folder(
        &self,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
        folder_id: String,
        name: String,
    ) -> bool {
        self.update(&emitter, move |workspace| {
            workspace.rename_folder(&folder_id, &name)
        })
        .await
    }

    async fn remove_folder(
        &self,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
        folder_id: String,
    ) -> bool {
        self.update(&emitter, move |workspace| {
            workspace.remove_folder(&folder_id)
        })
        .await
    }

    async fn set_folder_completed(
        &self,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
        folder_id: String,
        completed: bool,
    ) -> bool {
        self.update(&emitter, move |workspace| {
            workspace.set_folder_completed(&folder_id, completed)
        })
        .await
    }

    async fn add_list(
        &self,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
        folder_id: String,
        name: String,
    ) -> String {
        self.update(&emitter, move |workspace| {
            workspace.add_list(&folder_id, &name)
        })
        .await
        .unwrap_or_default()
    }

    async fn rename_list(
        &self,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
        folder_id: String,
        list_id: String,
        name: String,
    ) -> bool {
        self.update(&emitter, move |workspace| {
            workspace.rename_list(&folder_id, &list_id, &name)
        })
        .await
    }

    async fn remove_list(
        &self,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
        folder_id: String,
        list_id: String,
    ) -> bool {
        self.update(&emitter, move |workspace| {
            workspace.remove_list(&folder_id, &list_id)
        })
        .await
    }

    async fn add_todo(
        &self,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
        folder_id: String,
        list_id: String,
        name: String,
    ) -> bool {
        self.update(&emitter, move |workspace| {
            workspace.add_todo(&folder_id, &list_id, &name)
        })
        .await
    }

    async fn remove_todo(
        &self,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
        folder_id: String,
        list_id: String,
        index: u32,
    ) -> bool {
        self.update(&emitter, move |workspace| {
            workspace.remove_todo(&folder_id, &list_id, index as usize)
        })
        .await
    }

    async fn rename_todo(
        &self,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
        folder_id: String,
        list_id: String,
        index: u32,
        name: String,
    ) -> bool {
        self.update(&emitter, move |workspace| {
            workspace.rename_todo(&folder_id, &list_id, index as usize, &name)
        })
        .await
    }

    /// Returns true when this toggle completed the whole project.
    async fn toggle_todo(
        &self,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
        folder_id: String,
        list_id: String,
        index: u32,
    ) -> bool {
        self.update(&emitter, move |workspace| {
            workspace.toggle_todo(&folder_id, &list_id, index as usize)
        })
        .await
    }

    async fn set_todo_focus(
        &self,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
        folder_id: String,
        list_id: String,
        index: u32,
        focused: bool,
    ) -> bool {
        self.update(&emitter, move |workspace| {
            workspace.set_todo_focus(&folder_id, &list_id, index as usize, focused)
        })
        .await
    }

    async fn reorder_todo(
        &self,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
        folder_id: String,
        list_id: String,
        from: u32,
        to: u32,
    ) -> bool {
        self.update(&emitter, move |workspace| {
            workspace.reorder_todo(&folder_id, &list_id, from as usize, to as usize)
        })
        .await
    }

    #[zbus(signal)]
    async fn changed(emitter: &SignalEmitter<'_>) -> zbus::Result<()>;
}
