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
    ) -> Result<R, String> {
        self.run(move |store| store.load().map(|workspace| query(&workspace)))
            .await
    }

    /// Nothing is saved when the stored data cannot be loaded.
    pub async fn update<R: Send + 'static>(
        &self,
        change: impl FnOnce(&mut Workspace) -> R + Send + 'static,
    ) -> Result<R, String> {
        self.run(move |store| {
            let mut workspace = store.load()?;
            let result = change(&mut workspace);
            store.save(&workspace).map_err(|error| error.to_string())?;
            Ok(result)
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
        let result =
            futures_lite::future::block_on(handle.update(|workspace| workspace.add_folder("Work")));
        assert!(result.is_err());
        let raw = futures_lite::future::block_on(handle.run(|store| store.raw()));
        assert_eq!(raw, "{not json");
    }

    #[test]
    fn spawn_reports_open_errors() {
        assert!(StoreHandle::spawn(|| Store::open(Path::new("/nonexistent"), None)).is_err());
    }
}
