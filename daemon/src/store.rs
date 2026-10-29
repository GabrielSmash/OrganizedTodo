use std::error::Error;
use std::path::{Path, PathBuf};

use gio::prelude::*;

use crate::model::Workspace;

const SCHEMA_ID: &str = "org.gnome.shell.extensions.organizedtodo";
const EXTENSION_UUID: &str = "organizedtodo@gabrielsmash.github.io";
const WORKSPACE_KEY: &str = "workspace";

pub fn default_schema_dir() -> PathBuf {
    gio::glib::user_data_dir()
        .join("gnome-shell/extensions")
        .join(EXTENSION_UUID)
        .join("schemas")
}

pub struct Store {
    settings: gio::Settings,
}

impl Store {
    pub fn open(
        schema_dir: &Path,
        backend: Option<&gio::SettingsBackend>,
    ) -> Result<Self, Box<dyn Error>> {
        let default_source = gio::SettingsSchemaSource::default();
        let source =
            gio::SettingsSchemaSource::from_directory(schema_dir, default_source.as_ref(), false)?;
        let schema = source
            .lookup(SCHEMA_ID, false)
            .ok_or_else(|| format!("schema {SCHEMA_ID} not found in {}", schema_dir.display()))?;
        let settings = gio::Settings::new_full(&schema, backend, None);
        Ok(Self { settings })
    }

    /// A corrupted value is an error, not an empty workspace: otherwise the
    /// next save would overwrite the user's data with nothing.
    pub fn load(&self) -> Result<Workspace, String> {
        let raw = self.settings.string(WORKSPACE_KEY);
        if raw.is_empty() {
            return Ok(Workspace::default());
        }
        serde_json::from_str(&raw).map_err(|error| format!("invalid workspace JSON: {error}"))
    }

    pub fn save(&self, workspace: &Workspace) -> Result<(), Box<dyn Error>> {
        let raw = serde_json::to_string(workspace)?;
        self.settings.set_string(WORKSPACE_KEY, &raw)?;
        Ok(())
    }

    #[cfg(test)]
    pub fn raw(&self) -> String {
        self.settings.string(WORKSPACE_KEY).to_string()
    }

    #[cfg(test)]
    pub fn set_raw(&self, raw: &str) {
        self.settings.set_string(WORKSPACE_KEY, raw).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_store() -> Store {
        let schema_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../schemas");
        let backend = gio::memory_settings_backend_new();
        Store::open(&schema_dir, Some(&backend)).unwrap()
    }

    #[test]
    fn empty_key_loads_empty_workspace() {
        assert!(memory_store().load().unwrap().folders.is_empty());
    }

    #[test]
    fn save_then_load_roundtrip() {
        let store = memory_store();
        let mut workspace = Workspace::default();
        let id = workspace.add_folder("Work").unwrap();
        store.save(&workspace).unwrap();
        assert_eq!(store.load().unwrap().folder(&id).unwrap().name, "Work");
    }

    #[test]
    fn invalid_json_is_an_error() {
        let store = memory_store();
        store.set_raw("{not json");
        assert!(store.load().is_err());
    }
}
