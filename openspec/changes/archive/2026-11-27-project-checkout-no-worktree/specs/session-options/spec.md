## MODIFIED Requirements

### Requirement: Session options of a task
A person SHALL set 4 session options for a task: the permission mode (`default`, `accept_edits`, `skip`), agent teams (on or off), the working folder (`worktree`, `checkout`, or `folder` with an absolute path) and, for `checkout`, "Switch to the task branch" (`switch_branch`, on by default). New task, New session and the Assign dialog of the desktop, New task and New session of the phone, and `aw task create|assign` SHALL send them as `session_options` of `task.created` or `task.assigned`. A project SHALL have a default permission mode (`permission_mode` of `project.yaml`, default `default`), set in the project Settings and with `aw project edit --permission-mode`. The label of agent teams SHALL be "Agent teams", with no "experimental".

#### Scenario: New task with skip permissions
- **WHEN** a person creates a task with "Skip permissions", "Agent teams" on and "Project checkout"
- **THEN** `task.created` has `session_options {permission_mode: "skip", agent_teams: true, work_in: "checkout", folder: null, switch_branch: true}` and the task view shows these values

#### Scenario: Project checkout with no branch switch
- **WHEN** a person selects "Project checkout" and turns off "Switch to the task branch"
- **THEN** the event has `switch_branch: false`, and the form says that the session works on the branch that is checked out

#### Scenario: No options
- **WHEN** a person creates a task with no options
- **THEN** the event has no `session_options`, and the session uses a worktree, the project default mode and no teams

## ADDED Requirements

### Requirement: Separate worktree needs a commit
New task, New session and "Assign to another device…" on the desktop, and New task and New session on the phone, SHALL disable "Separate worktree" when the health of the assignee device has `has_commit: false` for the checkout of the project. The form SHALL show "This checkout has no commit yet. Make a first commit to use a separate worktree." and SHALL select "Project checkout" when "Separate worktree" was selected. With no health value, the option SHALL stay enabled.

#### Scenario: Checkout with no commit
- **WHEN** the person opens New task for my-notes, whose checkout on macbook-pro has no commit
- **THEN** "Separate worktree" is disabled with the hint, and "Project checkout" is selected

#### Scenario: After the first commit
- **WHEN** the health of macbook-pro changes to `has_commit: true`
- **THEN** "Separate worktree" is enabled again

### Requirement: Agent teams and start preselected
New task and New session on the desktop and on the phone SHALL preselect "Agent teams". New task SHALL preselect "Start the agent now" when the project has a device. The person SHALL be able to turn each one off. A task that an agent creates SHALL get no agent teams from this preselect.

#### Scenario: Open New task
- **WHEN** a person opens New task for billing-api, which has the device macbook-pro
- **THEN** "Agent teams" is on, "Start the agent now" is on, and the assignee is `claude@macbook-pro`

#### Scenario: Agent subtask
- **WHEN** an agent creates a subtask with `aw task create` and no options
- **THEN** the subtask has no agent teams
