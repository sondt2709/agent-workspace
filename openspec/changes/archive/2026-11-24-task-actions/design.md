## Context

`task.archived` exists in the schema and the merge, and `aw task archive` writes it. Nothing writes an unarchive. The session manager of the session device stops a session when its task is archived, with the reason `moved` (it releases the claim and pushes the wake branch). The phone writes `session.stop_requested {session}`, and the session device stops that session with the reason `stopped`. The desktop stops only a session of this Mac, through `POST /v1/sessions/:session/stop`.

## Goals / Non-Goals

**Goals:**
- One service method for each action; the CLI, the local API and the desktop use it. The phone writes the same events.
- Stop a session on each device from each app.
- Archive a task with a running session in one step, with one confirm.
- Unarchive a task from the desktop, the phone and the CLI.

**Non-Goals:**
- No MCP tool: these are person actions (principle 4).
- No change to the Board: archived tasks stay out of it.

## Decisions

1. **Stop by event, also on this device.** `stopTaskSession` writes `session.stop_requested {session}` for the running session of the view. The session manager checks each 500 ms, so a session on this Mac stops in about one second. Reason: one code path for all devices; the phone already uses it.
2. **Archive guard.** `archiveTask(ref, {stop})` refuses with `conflict` when a session runs and `stop` is not true: `A session runs for AW-7 on ubuntu-01. Stop it first, or archive with --stop: "aw task archive AW-7 --stop".` With `stop`, the service writes `session.stop_requested` and then `task.archived`. An archived task gives `conflict` "is already archived".
3. **New event `task.unarchived {}`.** The merge sets `archived = false`. Both events apply from each device, as `task.archived` does today (a person route writes them). Merge order decides: the newest event wins. An old reader that does not know the type marks it `unknown_type` and keeps the task archived.
4. **Archived means `stopped`.** `#stopReason` returns `stopped` for an archived task (before: `moved`). The claim stays with a stopped record, so AW does not start a session after an unarchive. A person starts one with "New session" or an assign. The `session.stop_requested` check runs before the archive check.
5. **Desktop.** The header has an icon button "Task actions" (⋯) with a menu. "Stop session…" shows when a session runs. "Archive task…" shows when the task is not archived; "Unarchive task" shows when it is archived. Stop and Archive open a confirm dialog (design 8.8). The List adds a group "Archived" after "Done", closed at the start; each row has an "Unarchive" button. The Session summary keeps the state and loses its Stop button.
6. **Phone.** The task header gets a "⋯" menu with the same items, and the confirm dialogs. The old header Stop button moves into the menu. `PhoneActions.archiveTask(task)` writes `session.stop_requested` first when a session runs; `unarchiveTask(task)` writes `task.unarchived`. `ScreenStates.tasksByStage` adds a group `archived` ("Archived") after Done.
7. **CLI.** `aw task stop`, `aw task archive --stop`, `aw task unarchive` are person commands (`HUMAN_COMMANDS`), so a session caller gets a refusal and the guard denies them.

## Risks / Trade-offs

- [The session device is offline] → The stop request waits in the log; the device stops the session when it syncs. The confirm text says that the device stops it.
- [The archive no longer pushes the wake branch] → An archive is a person stop, as "Stop session" is. The work stays in the worktree, and a person can start a new session after an unarchive.
- [Old phone or awd versions] → They ignore `task.unarchived`, so the task shows archived there until they update.
