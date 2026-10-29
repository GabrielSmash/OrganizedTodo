mod actor;
mod model;
mod service;
mod store;

use std::error::Error;
use std::future::pending;

use actor::StoreHandle;
use service::{BUS_NAME, OBJECT_PATH, TodoService};
use store::Store;

fn main() -> Result<(), Box<dyn Error>> {
    let store = StoreHandle::spawn(|| Store::open(&store::default_schema_dir(), None))?;
    zbus::block_on(serve(store))
}

async fn serve(store: StoreHandle) -> Result<(), Box<dyn Error>> {
    // Kept alive for the whole process: dropping the connection releases the bus name
    let _connection = zbus::connection::Builder::session()
        .name(BUS_NAME)
        .allow_name_replacements(false)
        .replace_existing_names(false)
        .serve_at(OBJECT_PATH, TodoService::new(store))
        .build()
        .await?;
    pending::<()>().await;
    Ok(())
}
