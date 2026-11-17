//! `organizedtodo-daemon mcp`: an MCP server on stdin/stdout, started by an AI agent.
//! It owns no data: each tool becomes one AgentCall to the running daemon over the session
//! D-Bus, which checks the user's agent-access setting, finds things by name and applies the
//! change in one step. stdout carries the protocol, so nothing else may be printed there.

use std::error::Error;

use rmcp::handler::server::{router::tool::ToolRouter, wrapper::Parameters};
use rmcp::model::{Implementation, ServerCapabilities, ServerConfig};
use rmcp::{ServerHandler, ServiceExt, tool, tool_handler, tool_router};
use zbus::DBusError;

use crate::agent::{
    AddList, AddProject, AddTask, FocusTask, GetList, ListProjects, RenameTask, Request,
    SearchTasks, SetTaskNotes, TaskArgs,
};
use crate::service::{BUS_NAME, OBJECT_PATH};

/// The daemon's AgentCall, as seen from this process
#[zbus::proxy(interface = "io.github.gabrielsmash.OrganizedTodo1")]
trait Daemon {
    fn agent_call(&self, request: &str) -> zbus::Result<String>;
}

const INSTRUCTIONS: &str = "OrganizedTodo is the user's to-do list in the GNOME top bar: \
projects hold lists, lists hold tasks. Refer to them by name (case does not matter and a unique \
part is enough) or by the ids that list_projects returns. When a name fits several, the error \
lists them: use a more precise name or ask the user. Agents cannot delete anything. What you \
may do depends on the user's setting (off, read, or read and write); a refusal says how the \
user can change it.";

#[derive(Clone)]
pub struct Mcp {
    daemon: DaemonProxy<'static>,
    tool_router: ToolRouter<Self>,
}

impl Mcp {
    /// One tool call = one AgentCall. Err is shown to the agent as a failed tool call
    async fn call(&self, request: Request) -> Result<String, String> {
        let json = serde_json::to_string(&request).map_err(|error| error.to_string())?;
        self.daemon
            .agent_call(&json)
            .await
            .map_err(|error| match error {
                // The daemon's own words (refusals, names not found) are written for the agent;
                // its standard errors (Failed, InvalidArgs) arrive as FDO, others as MethodError
                zbus::Error::FDO(error) => DBusError::description(error.as_ref())
                    .map_or_else(|| error.to_string(), str::to_string),
                zbus::Error::MethodError(_, Some(text), _) => text,
                other => format!("cannot reach OrganizedTodo: {other}"),
            })
    }
}

#[tool_router]
impl Mcp {
    #[tool(
        description = "List the user's projects with their lists, ids and how many tasks \
        are pending. Call it first to learn the names to use in the other tools."
    )]
    async fn list_projects(
        &self,
        Parameters(args): Parameters<ListProjects>,
    ) -> Result<String, String> {
        self.call(Request::ListProjects(args)).await
    }

    #[tool(
        description = "Show every task of one list: its name, whether it is done, whether \
        it is focused (pinned to the top) and its notes."
    )]
    async fn get_list(&self, Parameters(args): Parameters<GetList>) -> Result<String, String> {
        self.call(Request::GetList(args)).await
    }

    #[tool(
        description = "Find tasks whose name contains a text, in every project, and tell \
        where each one is."
    )]
    async fn search_tasks(
        &self,
        Parameters(args): Parameters<SearchTasks>,
    ) -> Result<String, String> {
        self.call(Request::SearchTasks(args)).await
    }

    #[tool(description = "Create a project. Refused if one with the same name exists.")]
    async fn add_project(
        &self,
        Parameters(args): Parameters<AddProject>,
    ) -> Result<String, String> {
        self.call(Request::AddProject(args)).await
    }

    #[tool(
        description = "Create a list inside a project. Refused if the project already has a \
        list with that name."
    )]
    async fn add_list(&self, Parameters(args): Parameters<AddList>) -> Result<String, String> {
        self.call(Request::AddList(args)).await
    }

    #[tool(
        description = "Add a task to a list. It goes where the user's settings put new \
        tasks. Adding to an archived project reactivates it. Refused if the list already has a \
        task with that name; if that one is done, use reopen_task instead."
    )]
    async fn add_task(&self, Parameters(args): Parameters<AddTask>) -> Result<String, String> {
        self.call(Request::AddTask(args)).await
    }

    #[tool(
        description = "Mark a task done, with the same rules as the check in the menu: it may \
        move to the bottom, and the reply says whether the whole project is now done or was \
        archived. Asking for a task that is already done changes nothing."
    )]
    async fn complete_task(
        &self,
        Parameters(args): Parameters<TaskArgs>,
    ) -> Result<String, String> {
        self.call(Request::CompleteTask(args)).await
    }

    #[tool(
        description = "Mark a done task as pending again; its project becomes active if it \
        was archived. Asking for a pending task changes nothing."
    )]
    async fn reopen_task(&self, Parameters(args): Parameters<TaskArgs>) -> Result<String, String> {
        self.call(Request::ReopenTask(args)).await
    }

    #[tool(description = "Rename a task. Refused if another task of the list has the new name.")]
    async fn rename_task(
        &self,
        Parameters(args): Parameters<RenameTask>,
    ) -> Result<String, String> {
        self.call(Request::RenameTask(args)).await
    }

    #[tool(
        description = "Replace the notes of a task (markdown). Read the current notes with \
        get_list first if they should be kept."
    )]
    async fn set_task_notes(
        &self,
        Parameters(args): Parameters<SetTaskNotes>,
    ) -> Result<String, String> {
        self.call(Request::SetTaskNotes(args)).await
    }

    #[tool(
        description = "Focus a task: it is pinned to the top of its list and highlighted. \
        Only one task per list is focused. focused: false removes the focus."
    )]
    async fn focus_task(&self, Parameters(args): Parameters<FocusTask>) -> Result<String, String> {
        self.call(Request::FocusTask(args)).await
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for Mcp {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(
                Implementation::new("organizedtodo", env!("CARGO_PKG_VERSION"))
                    .with_title("OrganizedTodo"),
            )
            .with_instructions(INSTRUCTIONS)
    }
}

pub fn run() -> Result<(), Box<dyn Error>> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    runtime.block_on(async {
        let connection = zbus::Connection::session().await?;
        let daemon = DaemonProxy::builder(&connection)
            .destination(BUS_NAME)
            .path(OBJECT_PATH)
            .build()
            .await?;
        let mcp = Mcp {
            daemon,
            tool_router: Mcp::tool_router(),
        };
        mcp.serve(rmcp::transport::stdio()).await?.waiting().await?;
        Ok(())
    })
}
