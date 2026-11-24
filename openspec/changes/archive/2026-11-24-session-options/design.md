## Context

Each session starts with `--permission-mode default` in a git worktree `<AW_HOME>/worktrees/<task id>` (tmux) or the Orca worktree `aw-<task id>`. The person cannot change the mode, turn on agent teams or pick the folder (F-6, F-7, F-8). The gate "Approve command" comes from the PermissionRequest hook. A person `aw` command (`aw gate answer`, ...) is blocked in 3 layers: no allow rule (so it asks), the CLI refuses it when `AW_SESSION` is set, and awd refuses each person route to a process of the session tree (`daemon/src/api/caller.ts`).

The spike of 2026-11-24 (Claude Code 2.1.330 and 2.1.331, model haiku, on a Linux test computer) found:
1. In `bypassPermissions`, deny rules and a PreToolUse deny hold; the PermissionRequest hook never fires.
2. A deny rule matches the command text: `sh -c "aw gate answer g3 yes"` ran.
3. The warning dialog of bypass mode blocks an interactive start unless the `--settings` file has `"skipDangerousModePermissionPrompt": true`.
4. Agent teams in-process: one pane; teammate events have the lead session id and `agent_id`; a teammate ends with SubagentStop and TeammateIdle, never Stop; the PreToolUse hook runs for teammate tools; teammates inherit the mode.

## Goals / Non-Goals

**Goals:**
- A person sets the permission mode, agent teams and the working folder per task, from the desktop, the phone and the CLI, with a project default for the mode.
- Skip mode keeps every AW rule that matters: an agent never answers its own gate, never does a person action, never edits AW files with a file tool, and never gives skip to another task.
- Each screen shows where the session works and in which mode.

**Non-Goals:**
- Claude Code plan mode (decision 1).
- A sandbox of the operating system for skip sessions (open item).
- Options per teammate; resume of in-process teammates (Claude Code does not support it).

## Decisions

1. **Modes `default`, `accept_edits`, `skip`.** AW names; the Claude adapter maps them to `default`, `acceptEdits`, `bypassPermissions`. No `plan`: Claude Code leaves plan mode only through an approved ExitPlanMode, and AW denies ExitPlanMode to open "Confirm approach", so the agent would stay in plan mode. AW's Discuss stage with "Confirm approach" is the plan step. Alternative (a plan mode with a one-time ExitPlanMode approval after "Confirm") needs its own spike.
2. **Where the values live.** `project.yaml` `permission_mode` (default `default`). `task.created` and `task.assigned` carry an optional object `session_options {permission_mode, agent_teams, work_in, folder}`. The newest applied event with the object replaces the task options as a whole. The task view has `session_options` (null when no person set them) and `created_by`. Alternative (one flat field per option, as `session_host`) makes partial updates and ambiguous merges.
3. **Only a person.** The TS and Kotlin folds keep `session_options` only when `by` starts with `human@`; else the event applies as before and the decision reason is `session_options_ignored`. awd refuses `session_options` and `aw project edit --permission-mode` from a session caller (403 `refused`). The effective mode (`effectiveSessionOptions(task, project)` in `shared/core`, mirrored in Kotlin): the task value, else the project default; a project `skip` counts only when `created_by` is a person. So an agent subtask (`aw task create` in a session) gets `default` or `accept_edits`, never `skip`.
4. **The guard (all modes).** Layers, from the outside in:
   a. Deny rules in the session settings: `Bash(aw <c>)` and `Bash(aw <c> *)` for each person command of the CLI (`HUMAN_COMMANDS`).
   b. The PreToolUse hook (`daemon/src/sessions/guard.ts`, called by `aw-hook` with no awd call, so it works while awd is down): deny a Bash command whose text has `aw <person command>` after a start, a space, `;`, `&`, `|`, `(`, `` ` ``, `'` or `"`; or the text `awd.sock`; or a path in AW_HOME that is not in `worktrees/`. Deny Edit, Write, MultiEdit and NotebookEdit on a path in AW_HOME (except `worktrees/`) or in a workspace folder. Deny Read in AW_HOME, except `worktrees/` and the credentials folder of the session. The hook spools the event with `denied: <reason>`, and awd writes one comment "AW denied <tool>: <reason>".
   c. The CLI refusal and d. the awd refusal stay as they are.
   The guard runs in every mode: one rule set, and these actions are never right for an agent. Residual risk (SECURITY.md): in skip mode a Bash command can still write AW files by a path that the text check does not see (a variable, an encoded path). A person accepts this with the red chip.
5. **The launch.** The record keeps `launch.permission_mode` (AW name) and new `launch.agent_teams`. The session settings file (now built by the adapter, `sessionSettings()`): `permissions.allow` (agent commands), `permissions.deny` (4a), the AW status line, for skip `skipDangerousModePermissionPrompt: true`, for teams `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1"` and `teammateMode: "in-process"`. A resume keeps the record values; a new session takes the effective options of the task at its start.
6. **Work in.**
   - `worktree` (default): as before. A new tmux folder is `<AW_HOME>/worktrees/aw-<key>` (`-2`, `-3` when another task has that name); a new Orca worktree is `aw-<key>`. A task keeps the folder of its earlier sessions (the session records, the folder where git has the branch, the old `worktrees/<task id>`); the Orca host also finds `aw-<task id>` and `aw-<created key>`.
   - `checkout`: AW prepares `aw/<key>` from `origin` as before and runs `git switch aw/<key>` in the project checkout; the session runs there. A clean tmux worktree that AW made for an earlier session of the task gives the branch free (`git worktree remove`, no force; found by the phone journey). A later `worktree` session refuses a branch that the checkout has, with a comment, so it never works in the checkout by mistake. A running session of another task in the same checkout, a git refusal (local changes that conflict, the branch checked out in another folder) or a checkout that is not a git repository stops the start with one comment. The dialog says "This changes the branch and the files of your checkout."
   - `folder`: the session runs in the absolute folder as it is: no branch change, `branch` null, no checkpoint push. awd refuses a relative path, a missing folder, and a folder in AW_HOME or in a workspace folder. The task cannot move to a device that does not have the folder.
   AW pre-trusts a folder that a person chose (checkout, folder) as it pre-trusts its own worktrees.
7. **What the screens show.** `session.started` gets `permission_mode`, `agent_teams` and `work_in`; the session view gets `cwd`, `branch`, `permission_mode`, `agent_teams`, `work_in`. The task shows the values of the running session, else the effective values for the next session. Desktop: a red chip "Skips permissions" and a chip "Agent teams" in the task header; Properties rows "Permissions", "Agent teams", "Works in <path> · branch aw/<key>" with Copy, and Open when the session device is this device (bridge `openFolder`, a path of a session record only). New task, New session and the Assign dialog get one shared block of fields. Project settings get the project default.
8. **Phone.** The task shows the 3 values. New task and New session (an assign with options) set them; "Other folder" is a text field with an absolute path, checked on the computer at the start. "Stop session" writes `session.stop_requested {session}` (person only); the session device stops that session with the reason `stopped`. The desktop keeps its direct stop.

## Risks / Trade-offs

- [Skip mode lets an agent run any command as the user] → only a person sets it, never inherited by agent subtasks, red chip, the guard, and SECURITY.md says it plainly.
- [The text guard can block a legal command that names AW_HOME] → it allows `worktrees/`, which holds the work; the comment shows each deny.
- [Checkout mode changes the person's branch] → the dialog warns; one session per checkout; git refuses conflicting changes.
- [Teams: the lead can start a turn with no prompt] → AW already treats PreToolUse as busy; Stop logic sees only the lead.
- [Format change] → loose objects; old events read as defaults; the Kotlin fold changes in the same commit.

## Migration Plan

No migration. Old tasks have no `session_options`: worktree, project default, no teams. Old folders keep their names. Rollback: older awd ignores the new fields; a skip task then starts in default mode (safe direction).

## Open Questions

- Plan mode (decision 1) and an OS sandbox for skip sessions: later tasks.
