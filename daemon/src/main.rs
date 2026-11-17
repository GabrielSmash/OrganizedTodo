mod actor;
mod agent;
mod lookup;
mod mcp;
mod model;
mod preferences;
mod service;
mod store;

use std::error::Error;
use std::future::pending;

use actor::StoreHandle;
use service::{BUS_NAME, OBJECT_PATH, TodoService};
use store::Store;

fn main() -> Result<(), Box<dyn Error>> {
    match std::env::args().nth(1).as_deref() {
        // The usual case: started by D-Bus activation or the session, with no arguments
        None => {
            let store = StoreHandle::spawn(|| Store::open(&store::default_schema_dir(), None))?;
            zbus::block_on(serve(store))
        }
        // Started by an AI agent: speaks MCP on stdin/stdout and forwards to the daemon
        Some("mcp") => mcp::run(),
        Some(other) => Err(format!("unknown command {other:?}; the only one is \"mcp\"").into()),
    }
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
