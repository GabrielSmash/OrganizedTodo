use std::error::Error;
use std::sync::mpsc;
use std::thread;

use crate::model::Workspace;
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
    ) -> R {
        self.run(move |store| query(&store.load())).await
    }

    pub async fn update<R: Send + 'static>(
        &self,
        change: impl FnOnce(&mut Workspace) -> R + Send + 'static,
    ) -> R {
        self.run(move |store| {
            let mut workspace = store.load();
            let result = change(&mut workspace);
            if let Err(error) = store.save(&workspace) {
                eprintln!("organizedtodo: failed to save workspace: {error}");
            }
            result
        })
        .await
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
        let id =
            futures_lite::future::block_on(handle.update(|workspace| workspace.add_folder("Work")))
                .unwrap();
        let name = futures_lite::future::block_on(
            handle.read(move |workspace| workspace.folder(&id).map(|folder| folder.name.clone())),
        );
        assert_eq!(name.as_deref(), Some("Work"));
    }

    #[test]
    fn spawn_reports_open_errors() {
        assert!(StoreHandle::spawn(|| Store::open(Path::new("/nonexistent"), None)).is_err());
    }
}
