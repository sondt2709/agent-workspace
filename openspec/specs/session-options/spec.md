# session-options Specification

## Purpose
The session options of a task: the permission mode (including Skip permissions, set only by a person), Claude Code agent teams and the working folder (a separate worktree, the project checkout or another folder). Who sets them, the effective value, the AW guard of each session, the launch, what each screen shows, and the phone session actions.
## Requirements
### Requirement: Session options of a task
A person SHALL set 3 session options for a task: the permission mode (`default`, `accept_edits`, `skip`), agent teams (on or off) and the working folder (`worktree`, `checkout`, or `folder` with an absolute path). New task, New session and the Assign dialog of the desktop, New task and New session of the phone, and `aw task create|assign` SHALL send them as `session_options` of `task.created` or `task.assigned`. A project SHALL have a default permission mode (`permission_mode` of `project.yaml`, default `default`), set in the project Settings and with `aw project edit --permission-mode`.

#### Scenario: New task with skip permissions
- **WHEN** a person creates a task with "Skip permissions", "Agent teams" on and "Project checkout"
- **THEN** `task.created` has `session_options {permission_mode: "skip", agent_teams: true, work_in: "checkout", folder: null}` and the task view shows these values

#### Scenario: No options
- **WHEN** a person creates a task with no options
- **THEN** the event has no `session_options`, and the session uses a worktree, the project default mode and no teams

### Requirement: The warning of skip permissions
The desktop (New task, New session, Assign, project Settings) and the phone SHALL show a warning with "Skip permissions": the agent runs each command as the person with no gate, and a hidden command can still act as the person in AW.

#### Scenario: A person selects skip permissions
- **WHEN** a person selects "Skip permissions" in New task
- **THEN** the dialog shows "A hidden command can still act as you in AW"

### Requirement: Only a person sets the options
awd SHALL refuse `session_options` on a create or assign request of a session caller, and a project edit of `permission_mode` by a session caller, with 403 `refused`. The effective permission mode SHALL be the task value, else the project default; a project default `skip` SHALL count only when a person created the task.

#### Scenario: Agent subtask in a skip project
- **WHEN** the project default is `skip` and an agent creates a subtask with `aw task create` in its session
- **THEN** the effective mode of the subtask is `default`

#### Scenario: Agent sends options
- **WHEN** a session caller sends `session_options` to the create route
- **THEN** awd answers 403 `refused` and writes no event

### Requirement: Guard of a session
Each session SHALL have the AW guard, in every mode: the deny rules of the person `aw` commands in the session settings, and the PreToolUse check of `aw-hook`. The check SHALL deny a Bash command whose text names a person `aw` command at a word start (also inside `sh -c "…"`), the awd socket, a workspace folder, or a path in AW_HOME outside `worktrees/` and the credentials folder of the session (as a path, `~/…`, `$HOME/…` or `$AW_HOME`, with no `..` out of these folders, and as a relative path with `..` from the working folder, or a relative path after a `cd` to `~`, `$HOME`, `${HOME}` or an absolute folder (soc-15)); a file edit tool on a path in AW_HOME outside `worktrees/` or in a workspace folder; a Read, Grep, Glob (also the folder of its pattern) or LS in AW_HOME outside `worktrees/` and the credentials folder of the session. A file tool path SHALL count with its symbolic links resolved. The hook SHALL print its deny also when it cannot write its event. awd SHALL write one thread comment for each deny.

The check SHALL compare the command names and the folder paths in any case, and SHALL resolve each path with the native real path (the case on disk): the default macOS file system finds `AW gate answer` and `~/.AW/sessions/<id>/mcp-token` as `aw` and `~/.aw` (final check fc1-8).

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

### Requirement: Agent teams follow the lead
AW SHALL follow the lead session only. A gate tool (AskUserQuestion, ExitPlanMode) of a teammate or a subagent (a hook event with `agent_id`) SHALL open no gate: the PreToolUse hook SHALL deny it with "a teammate asks the team lead", and awd SHALL write one comment "AW denied <tool>".

#### Scenario: A teammate asks a question
- **WHEN** a teammate calls AskUserQuestion
- **THEN** the hook denies the call, no gate opens, and the thread has one comment "AW denied AskUserQuestion"

### Requirement: Show where and how a session works
The task SHALL show the permission mode, agent teams and "Works in <path> · branch <branch>" of the running session, else the effective values for the next session. The desktop SHALL show a red chip "Skips permissions" and a chip "Agent teams" in the task header, Copy for the path, and Open when the session runs on this device. Open SHALL open only a real folder that is not a macOS bundle (an extension such as `.app`, or a `Contents/Info.plist`), because Finder starts a bundle; for a file or a bundle it SHALL show an error and open nothing. The phone SHALL show the same values on the task.

#### Scenario: Running skip session
- **WHEN** a session runs in skip mode in `<AW_HOME>/worktrees/aw-AW-1`
- **THEN** the task header has the red chip "Skips permissions" and Properties show "Works in <AW_HOME>/worktrees/aw-AW-1 · branch aw/AW-1"

#### Scenario: Open a session folder that is an app
- **WHEN** a session of `AW-1` works in the folder `/Applications/Example.app` on this device and the person selects Open
- **THEN** the app shows "/Applications/Example.app is an app or a bundle. AW does not open it." and Finder starts nothing

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

### Requirement: Permissions at the top of New task
The desktop New task SHALL show the Permissions menu in the row of the assignee, above "Start the agent now", so it shows with no scroll. The Session block of New task SHALL keep only Agent teams and Work in. New session and "Assign to another device…" SHALL keep the Permissions menu in their Session block.

#### Scenario: Open New task
- **WHEN** the person opens New task
- **THEN** the Permissions menu is next to the Assignee field, and the Session block has no second Permissions menu

### Requirement: Skip permissions preselected in New task
New task on the desktop and on the phone SHALL preselect "Skip permissions" (owner decision 38). The person SHALL be able to select "Project default · <mode>", "Default" or "Accept edits" instead. "Project default" SHALL send no session options. A task that an agent creates SHALL never get `skip` from this preselect or from a project default.

#### Scenario: Open New task
- **WHEN** a person opens New task for billing-api
- **THEN** Permissions shows "Skip permissions" and the skip warning

#### Scenario: Project default
- **WHEN** the person selects "Project default" and creates the task
- **THEN** `task.created` has no `session_options`

