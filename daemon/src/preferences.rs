//! What the user chose in the preferences window that changes how the data is handled.
//! Plain values: the model receives them as arguments and never reads GSettings.

/// Where a new todo goes in its list
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum NewTodoAt {
    #[default]
    Bottom,
    /// First, but below the focused todo
    Top,
}

/// What happens to a todo marked done
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DoneTodo {
    #[default]
    Stay,
    /// To the end of its list, losing the focus
    ToBottom,
}

/// What happens when the last pending todo of a project is marked done
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ProjectCompletion {
    /// The UI shows a Complete button
    #[default]
    Button,
    /// The project is archived at once
    Automatic,
}

/// Where quick add puts a todo
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum QuickAddTarget {
    #[default]
    Remember,
    /// No destination: the dialog opens on the picker
    Ask,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Preferences {
    pub new_todo_at: NewTodoAt,
    pub done_todo: DoneTodo,
    pub project_completion: ProjectCompletion,
    pub quick_add_target: QuickAddTarget,
}
