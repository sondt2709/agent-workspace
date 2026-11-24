## ADDED Requirements

### Requirement: Session options of a task
A person SHALL set 3 session options for a task: the permission mode (`default`, `accept_edits`, `skip`), agent teams (on or off) and the working folder (`worktree`, `checkout`, or `folder` with an absolute path). New task, New session and the Assign dialog of the desktop, New task and New session of the phone, and `aw task create|assign` SHALL send them as `session_options` of `task.created` or `task.assigned`. A project SHALL have a default permission mode (`permission_mode` of `project.yaml`, default `default`), set in the project Settings and with `aw project edit --permission-mode`.

#### Scenario: New task with skip permissions
- **WHEN** a person creates a task with "Skip permissions", "Agent teams" on and "Project checkout"
- **THEN** `task.created` has `session_options {permission_mode: "skip", agent_teams: true, work_in: "checkout", folder: null}` and the task view shows these values

#### Scenario: No options
- **WHEN** a person creates a task with no options
- **THEN** the event has no `session_options`, and the session uses a worktree, the project default mode and no teams

### Requirement: Only a person sets the options
awd SHALL refuse `session_options` on a create or assign request of a session caller, and a project edit of `permission_mode` by a session caller, with 403 `refused`. The effective permission mode SHALL be the task value, else the project default; a project default `skip` SHALL count only when a person created the task.

#### Scenario: Agent subtask in a skip project
- **WHEN** the project default is `skip` and an agent creates a subtask with `aw task create` in its session
- **THEN** the effective mode of the subtask is `default`

#### Scenario: Agent sends options
- **WHEN** a session caller sends `session_options` to the create route
- **THEN** awd answers 403 `refused` and writes no event

### Requirement: Guard of a session
Each session SHALL have the AW guard, in every mode: the deny rules of the person `aw` commands in the session settings, and the PreToolUse check of `aw-hook`. The check SHALL deny a Bash command whose text names a person `aw` command at a word start (also inside `sh -c "…"`), the awd socket, or a path in AW_HOME outside `worktrees/`; a file edit tool on a path in AW_HOME outside `worktrees/` or in a workspace folder; a Read in AW_HOME outside `worktrees/` and the credentials folder of the session. awd SHALL write one thread comment for each deny.

#### Scenario: Wrapped person command in skip mode
- **WHEN** an agent in a skip session runs `sh -c "aw gate answer <gate> Allow"`
- **THEN** the PreToolUse hook denies it with "AW denied" and the gate stays open

#### Scenario: Work in the worktree
- **WHEN** an agent runs `cat <AW_HOME>/worktrees/aw-AW-1/README.md`
- **THEN** the guard allows it

### Requirement: Launch with the options
The session settings file SHALL have `skipDangerousModePermissionPrompt: true` for `skip`, and `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1"` with `teammateMode: "in-process"` for agent teams. `claude` SHALL get `--permission-mode` with `default`, `acceptEdits` or `bypassPermissions`. The session record and `launch.json` SHALL keep the mode and the teams value; a resume SHALL keep them.

#### Scenario: Skip session starts
- **WHEN** a session of a task with the effective mode `skip` starts
- **THEN** the arguments have `--permission-mode bypassPermissions` and no warning dialog shows

### Requirement: Show where and how a session works
The task SHALL show the permission mode, agent teams and "Works in <path> · branch <branch>" of the running session, else the effective values for the next session. The desktop SHALL show a red chip "Skips permissions" and a chip "Agent teams" in the task header, Copy for the path, and Open when the session runs on this device. The phone SHALL show the same values on the task.

#### Scenario: Running skip session
- **WHEN** a session runs in skip mode in `<AW_HOME>/worktrees/aw-AW-1`
- **THEN** the task header has the red chip "Skips permissions" and Properties show "Works in <AW_HOME>/worktrees/aw-AW-1 · branch aw/AW-1"

### Requirement: Phone session actions
The phone SHALL have "Stop session" for a running session, which writes the person event `session.stop_requested {session}`, and "New session", which writes a person `task.assigned` with the chosen agent and options. The session device SHALL stop the named session with the reason `stopped`.

#### Scenario: Stop from the phone
- **WHEN** the person taps "Stop session" on the phone
- **THEN** the session device stops the session, and the task shows "Session ended (stopped)"

### Requirement: Workspace dialogs survive a narrow window
The desktop dialogs Add a workspace, Rename and Remove from this device SHALL live in the dialog provider, so a window resize below 600 px that hides the navigation SHALL NOT close them (npc-11).

#### Scenario: Rename during a resize
- **WHEN** the person types a new name in Rename and the window gets narrower than 600 px
- **THEN** the dialog stays open with the typed name
