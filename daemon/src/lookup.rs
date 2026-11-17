//! Finding projects, lists and tasks by what an AI agent knows: a name, or an id it was given.
//! The UI addresses tasks by position, but an agent that read a list a minute ago cannot trust
//! positions (the user may have reordered it), so the MCP tools name things and this module
//! resolves the names, refusing to guess when a name fits more than one.

use std::fmt;

use crate::model::{Folder, List, Workspace};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Project,
    List,
    Task,
}

impl fmt::Display for Kind {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str(match self {
            Kind::Project => "project",
            Kind::List => "list",
            Kind::Task => "task",
        })
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum LookupError {
    /// Nothing matched; `available` holds the names the agent can use instead
    NotFound {
        kind: Kind,
        query: String,
        available: Vec<String>,
    },
    /// More than one matched: guessing could change the wrong thing
    Ambiguous {
        kind: Kind,
        query: String,
        matches: Vec<String>,
    },
}

// The agent reads this text and tries again, so it says what exists, not only what failed
impl fmt::Display for LookupError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            LookupError::NotFound {
                kind,
                query,
                available,
            } if available.is_empty() => {
                write!(f, "no {kind} matches \"{query}\": there is none here")
            }
            LookupError::NotFound {
                kind,
                query,
                available,
            } => {
                write!(
                    f,
                    "no {kind} matches \"{query}\"; available: {}",
                    quoted(available)
                )
            }
            LookupError::Ambiguous {
                kind,
                query,
                matches,
            } => {
                write!(
                    f,
                    "\"{query}\" fits more than one {kind}: {}; be more specific",
                    quoted(matches)
                )
            }
        }
    }
}

fn quoted(names: &[String]) -> String {
    names
        .iter()
        .map(|name| format!("\"{name}\""))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Position of the one item that `query` names. The first rule that finds anything decides:
/// 1. the exact id (projects and lists have one; tasks do not);
/// 2. the whole name, ignoring case and surrounding spaces;
/// 3. a part of the name, also ignoring case.
fn pick<T>(
    items: &[T],
    query: &str,
    kind: Kind,
    id: impl Fn(&T) -> Option<&str>,
    name: impl Fn(&T) -> &str,
) -> Result<usize, LookupError> {
    if let Some(index) = items.iter().position(|item| id(item) == Some(query)) {
        return Ok(index);
    }
    let wanted = query.trim().to_lowercase();
    let matching = |test: &dyn Fn(&str) -> bool| -> Vec<usize> {
        (0..items.len())
            .filter(|&i| test(&name(&items[i]).trim().to_lowercase()))
            .collect()
    };
    let mut found = matching(&|candidate| candidate == wanted);
    if found.is_empty() && !wanted.is_empty() {
        found = matching(&|candidate| candidate.contains(&wanted));
    }
    let names = |indexes: &[usize]| {
        indexes
            .iter()
            .map(|&i| name(&items[i]).to_string())
            .collect()
    };
    match found.as_slice() {
        [index] => Ok(*index),
        [] => Err(LookupError::NotFound {
            kind,
            query: query.to_string(),
            available: names(&(0..items.len()).collect::<Vec<_>>()),
        }),
        _ => Err(LookupError::Ambiguous {
            kind,
            query: query.to_string(),
            matches: names(&found),
        }),
    }
}

/// Where a task is, in the terms the rest of the daemon already uses (ids and a position)
#[derive(Debug, PartialEq, Eq)]
pub struct TaskRef {
    pub folder_id: String,
    pub list_id: String,
    pub index: usize,
}

impl Workspace {
    pub fn find_folder(&self, project: &str) -> Result<&Folder, LookupError> {
        let index = pick(
            &self.folders,
            project,
            Kind::Project,
            |f| Some(f.id.as_str()),
            |f| &f.name,
        )?;
        Ok(&self.folders[index])
    }

    pub fn find_list(&self, project: &str, list: &str) -> Result<(&Folder, &List), LookupError> {
        let folder = self.find_folder(project)?;
        let index = pick(
            &folder.lists,
            list,
            Kind::List,
            |l| Some(l.id.as_str()),
            |l| &l.name,
        )?;
        Ok((folder, &folder.lists[index]))
    }

    /// The position is fresh: resolved now, just before the change that uses it
    pub fn find_task(&self, project: &str, list: &str, task: &str) -> Result<TaskRef, LookupError> {
        let (folder, list) = self.find_list(project, list)?;
        let index = pick(&list.todos, task, Kind::Task, |_| None, |t| &t.name)?;
        Ok(TaskRef {
            folder_id: folder.id.clone(),
            list_id: list.id.clone(),
            index,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Workspace {
        serde_json::from_str(r#"{"folders":[
            {"id":"f1","name":"Casa","lists":[
                {"id":"l1","name":"Compras","todos":[
                    {"name":"Comprar leite"},{"name":"Leite de coco"},{"name":"Pão"},{"name":"Pão"}]}]},
            {"id":"f2","name":"Casa de praia","lists":[]},
            {"id":"f3","name":"Trabalho","lists":[{"id":"l2","name":"Bugs","todos":[]}]}]}"#)
        .unwrap()
    }

    #[test]
    fn the_id_wins_then_the_whole_name_then_a_part() {
        let workspace = sample();
        assert_eq!(workspace.find_folder("f2").unwrap().name, "Casa de praia");
        // "Casa" is a whole name, so "Casa de praia" is not even considered
        assert_eq!(workspace.find_folder("  CASA ").unwrap().id, "f1");
        assert_eq!(workspace.find_folder("trab").unwrap().id, "f3");
    }

    #[test]
    fn ambiguous_names_are_refused_with_the_candidates() {
        let workspace = sample();
        let error = workspace.find_task("Casa", "Compras", "leite").unwrap_err();
        assert_eq!(
            error,
            LookupError::Ambiguous {
                kind: Kind::Task,
                query: "leite".into(),
                matches: vec!["Comprar leite".into(), "Leite de coco".into()],
            }
        );
        assert!(
            error
                .to_string()
                .contains("\"Comprar leite\", \"Leite de coco\"")
        );
        // Two tasks with the same name: no rule can tell them apart
        assert!(matches!(
            workspace.find_task("Casa", "Compras", "pão"),
            Err(LookupError::Ambiguous { .. })
        ));
    }

    #[test]
    fn not_found_says_what_exists() {
        let workspace = sample();
        let error = workspace.find_list("Trabalho", "Ideias").unwrap_err();
        assert_eq!(
            error.to_string(),
            "no list matches \"Ideias\"; available: \"Bugs\""
        );
        let empty = workspace.find_list("Casa de praia", "x").unwrap_err();
        assert_eq!(
            empty.to_string(),
            "no list matches \"x\": there is none here"
        );
    }

    #[test]
    fn a_blank_query_matches_nothing() {
        assert!(matches!(
            sample().find_folder("  "),
            Err(LookupError::NotFound { .. })
        ));
    }

    #[test]
    fn find_task_gives_ids_and_the_current_position() {
        let task = sample().find_task("casa", "compras", "coco").unwrap();
        assert_eq!(
            task,
            TaskRef {
                folder_id: "f1".into(),
                list_id: "l1".into(),
                index: 1,
            }
        );
    }
}
