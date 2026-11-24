## Context
awd (task awd-api-cli) has the workspaces, the merge, the index, the local API on `~/.aw/run/awd.sock` and the `aw` CLI. It writes only human events. The verification on 2026-11-22 (Claude Code 2.1.330 on a Linux remote device) showed that the plugin, the hooks, `aw ask` and answers as the next input work, and it found the gaps that `docs/phase-1.md` 9 closes: the trust screen, the allow rule for `aw`, `--` before the message, the delivery id, the unique permission request id, the process-group kill and the order of the continue message.

Three tasks run in parallel from the same commit. This change keeps its code in `plugins/host-tmux`, `plugins/agent-claude`, `shared/plugin-api` and new files in `daemon/src/sessions/`, with small edits in the existing daemon files.

```
 other device                     this device: awd                                tmux -L aw (own unit on Linux)
 gate.answered ──sync──▶ merge ─▶ SessionManager                                  window aw-<task-id>
 message.sent                     claim loop ─▶ task.claimed {epoch}               aw-launch <session>
                                  start/resume ─▶ first-input.md, launch.json ──▶   └─ exec claude --session-id … -- "<msg>"
                                  resolve gate ─▶ gate.resolved                          hooks: aw-hook <Event>
                                  delivery: load-buffer, paste-buffer -p, Enter ──▶        │
                                  spool drain ◀─ ~/.aw/sessions/<id>/spool/*.json ◀──────┤ (works while awd is down)
                                  permission  ◀─ POST /v1/sessions/<id>/permission ◀─────┘ (waits up to 120 s)
                                  agent cmds  ◀─ POST /v1/sessions/<id>/{ask,message,stage,artifacts,handoff}
```

## Goals / Non-Goals

**Goals:**
- Start, resume and stop Claude Code sessions in tmux for the tasks assigned to an agent of this device.
- Put each human input and each agent reply in the thread as raw text, from the hooks.
- Deliver answers and messages safely, with a confirmed delivery id, also after an awd restart.
- Turn `aw ask`, `AskUserQuestion`, `ExitPlanMode`, a reply that ends with a question, and permission requests into gates.
- Keep the sessions alive when awd stops, and resume a dead session with the stored flags and a continue message.

**Non-Goals:**
- The MCP server, its token and the plugin `.mcp.json` (task mcp-server). The allow rule `mcp__plugin_aw_aw__*` is already in `aw-launch`.
- `aw approach`, `aw ready`, `aw result`, `aw task create` by an agent, `aw slot`, `aw done`, stage moves after Discuss (task task-loop). The command tree has the place for them.
- Usage limits, the statusline, pause states, queues, the watchdog after 2 and 15 min, the checkpoint push and the wake branch (task continuity).
- Credential values and their redaction in the session (identity-pairing): the session has no credential yet.
- `host-orca` and `host-pty`.

## Decisions

1. **Plugins behind `shared/plugin-api`.** `SessionHost` (`detect`, `open`, `list`, `alive`, `capture`, `paste`, `keys`, `stop`, `close`) and `AgentRuntimeAdapter` (`detect`, `authStatus`, `launchArgs`, `parseHook`, `hookOutput`, and the optional `hasConversation` and `trustFolder`) are plain TypeScript interfaces. awd imports the 2 bundled plugins in one file, `daemon/src/sessions/plugins.ts`; the hook and launch binaries and the CLI also reach them only through that file and the interfaces (review round 3). A plugin never imports another plugin. Alternative: dynamic loading by manifest: not needed until a third-party plugin exists.

2. **Hooks write a spool file; awd reads the spool.** `aw-hook <Event>` reads the hook JSON on stdin and writes `~/.aw/sessions/<session>/spool/<time>-<seq>-<pid>-<event>.json` with a temp file and a rename, then exits. awd reads the spool in name order at start and every 500 ms on the clock module (a merge with a change also starts a check), handles each file once, and moves it to `spool/done/`. Alternative: `fs.watch`: one more moving part, and the 500 ms check is fast enough for a hook. So no hook event is lost while awd is down. Alternative: HTTP hooks: they fail while awd restarts (`tech-stack.md` 1.3).

3. **Hooks that must answer do it without awd.**
   - SessionStart prints `additionalContext` from `~/.aw/sessions/<session>/context.md`, which awd writes before each start and resume (at most 10,000 characters).
   - PreToolUse for `AskUserQuestion` and `ExitPlanMode` makes the gate id (UUIDv7) in the hook, puts it in the spool file, and denies the tool with "AW sent this to the human as gate <id>. End your turn. The answer arrives as your next input." awd opens the gate with that id from the spool.
   - PermissionRequest makes the request id `p-<uuidv7>`, writes the spool file, then waits on `POST /v1/sessions/<session>/permission` (it tries again while awd is down) until awd answers or 120 s pass. Then it denies with `interrupt: true`.
   - The hook command is `aw-hook` of the plugin `bin/`; it runs `daemon/src/bin/aw-hook.ts` with the node of awd. It loads no CLI library, so a hook takes about 0.1 s.

4. **Thread from hooks** (principle 8):
   - UserPromptSubmit writes `message.human`. The source is `first` for the first prompt of a new session, `answer` for a prompt that starts with `[AW answer <gate>]`, `phone` or `typed` for `[AW message <id> from <device>]` (by the role of that device), and `typed` for other text. The delivery id is the gate id or the message id.
   - A prompt that starts with `[AW resume]` is the continue message: awd writes `session.resumed` with the text, not `message.human`.
   - Stop writes `message.agent` from `last_assistant_message`. When the text ends with `?` (after the trailing spaces and Markdown marks) and no gate `question`, `confirm_approach` or `reply` of this session opened after its last `message.human` is open, awd opens the gate `reply` (review round 2: an old gate does not stop it).

5. **Actors.** Agent text and agent gates have `by: claude@<device>`. `message.human` has the human: `human@<device of the answer>` for an answer, else `human@<this device>`. awd events (claim, session, resolution) have `by: aw@<device>`.

6. **One-second log buffer** (`phase-1.md` 3.3.2). `message.agent`, `task.progress`, `artifact.added`, `handoff.written` and `session.resumed` wait in a buffer per task. The buffer writes its events when 1 s passed since its first event. A gate, a claim, a session start or end, a stage change and `message.human` are written at once, and an immediate write first writes the buffer of its task, so the log keeps the order of the hooks. Each event gets its HLC when it enters the buffer.

7. **Gate resolution and delivery from the log.** The session device resolves each open gate of its tasks with the first pending answer in merge order (`gate.resolved` with `answer_event`), then delivers `[AW answer <gate>] <answer>`. A message `message.sent` to the session is delivered as `[AW message <id> from <device>] <text>`. A text is delivered when the log has a `message.human` with that `delivery_id`. So after an awd restart, awd finds each resolved gate and each message with no confirmation and delivers it again. This is only the gate resolution that the delivery needs; task-loop adds the stage moves.

8. **Safe delivery** (`phase-1.md` 9.4). One function per session, one text at a time. It waits while a dialog is open:
   - a PermissionRequest of the session waits for its answer;
   - the last Notification is `permission_prompt` or `elicitation_dialog`, and no later hook event came;
   - `capture-pane` of the visible screen shows the layout of a dialog: a footer ("Esc to cancel", "Enter to confirm") in the last 8 lines, a selection cursor on an option (`❯ 1. Yes`, `❯ No, exit`) above it, and no prompt line below it. Free dialog text is not enough (review round 1): the agent text of the last turn stays on the screen, and a reply gate opens exactly when it ends with a question such as "Do you want to use Postgres?".
   Then it runs `load-buffer` (the text on stdin), `paste-buffer -p -d`, and `send-keys Enter`. It waits 30 s for the confirmation, at most 3 attempts. Then it writes the comment "Answer not delivered" with the last 40 lines of the pane (the event writer redacts the credential values of the session), and the record keeps the id in `failed_deliveries`, so the next texts go on. A dialog on the screen that blocks a text for 90 s gets one comment "Answer waits". A busy turn is not a dialog: Claude Code queues the text and submits it when the turn ends. So no retry counts while the record is `busy` (from a UserPromptSubmit to the next Stop, StopFailure or `idle_prompt` Notification): the 30 s start after the turn.

9. **Permission gate** (`phase-1.md` 9.5). awd opens `approve_command` with the request id and the options `Allow once`, `Allow for this task`, `Deny`, and holds the HTTP request. The first answer in merge order decides:
   - `Allow once` and `Allow for this task` answer `allow`. "Allow for this task" adds a rule for the task: the same tool and, for `Bash`, the same command.
   - Any other answer is a deny with the answer as the reason. awd also delivers "[AW answer <gate>] Denied by human@<device>: <reason>" as the next input.
   - After 120 s (`PERMISSION_TIMEOUT_MS`, on the clock module) awd answers deny with `interrupt: true`. The gate stays open. A later "Allow" adds a one-time approval for the same tool and input, and awd delivers "[AW answer <gate>] Approved: run it again". The next matching request is allowed at once, one time.
   - A rule of the task answers before a gate opens.

10. **Claims** (`workflow.md` 4.2, `decisions/2026-11-23-manual-move.md`). After each merge with a change, the manager checks each task that is not archived or done and whose assignee is `claude@<this device>`. It writes `task.claimed {epoch: highest known + 1, device, session, based_on}` when the task has no accepted claim, when the newest accepted `task.assigned` sorts after the accepted claim, or when the accepted claim is on another device and that device released it. AW never claims because the other device is offline (`decisions/2026-11-23-manual-move.md`; review round 2 removed that branch). It starts the session only when the merge applied the claim. A running session of this device stops ("Moved to <device>") when the assignee device or the claim is not this device and session any more: awd writes `session.ended {reason: moved}` and `task.released`. It stops with `session.ended {reason: replaced}` and `task.released` when a person assigns the task again on this device: another agent (`codex@<this device>`), or the same agent (a new `task.assigned` after the claim), and then a new session claims it in the same check, after the stop. awd never claims for another device. A task whose session cannot start (for example `git worktree add` fails) gets one comment with the cause and a new try after 60 s; the other tasks and the delivery steps of the check go on.

11. **Session start.**
   - The working folder is a git worktree `~/.aw/worktrees/<task-id>` on the branch `aw/<key>`, made from the project checkout in `bindings.yaml` of this device (`git worktree add`). With no checkout, the task gets the comment "No checkout of <project> on <device>" and no session starts. A checkout that is not a git repository gets no session either (review round 3): the trust entry is only for a folder that AW created (`architecture.md` 4.6.2), and 2 tasks must not share one folder.
   - The first input is the first message (Discuss). For a subtask or a task with a confirmed approach, it is the first message, the confirmed approach word for word, and "Read `aw thread <key> --ancestors` before you act." (`phase-1.md` 9.2).
   - awd writes `first-input.md`, `context.md`, `launch.json` (mode, argv without the message, the environment, the trust entry) and `session.json` (the record) with mode 0600 in `~/.aw/sessions/<session>/` (0700).
   - awd writes `task.stage_changed` backlog → discuss for a task in Backlog, and `session.started` with the pids at the first SessionStart hook (`phase-1.md` 9.3).

12. **`aw-launch` is a Node script that ends with `process.execve`.** It reads `launch.json`, checks `/readyz` on the socket (up to 10 s, else exit 3), writes the trust entry, reads the message file, and replaces itself with `claude` and the arguments `[--session-id|--resume] <uuid> -n <key> --plugin-dir <dir> --settings <file> --permission-mode default --allowedTools "Bash(aw ask *)" "Bash(aw message *)" "Bash(aw stage *)" "Bash(aw artifact add *)" "Bash(aw handoff *)" "Bash(aw thread *)" "mcp__plugin_aw_aw__*" [--model <m>] -- <message>`. The rules cover only the agent commands (review round 1): with `Bash(aw *)` the agent could run `aw gate answer` with no prompt and answer its own gates as the human. The CLI also refuses the commands of a person when `AW_SESSION` is set (exit code 1). So the pane pid is the claude pid, and no shell parses the message. `daemon/bin/aw-launch` is a small `sh` wrapper that runs it with the node of awd (`AW_NODE`). Alternative: a `sh` script that reads the arguments: `sh` cannot read a JSON file safely, and `eval` is not allowed.

13. **Trust entry.** On Claude Code 2.1.x from 2.1.319 (the covered range), `aw-launch` copies `~/.claude.json` to `~/.aw/backups/claude-<time>.json` (0600) and sets only `projects["<worktree>"].hasTrustDialogAccepted = true`, with a temp file and a rename. On another version it writes nothing. Then, on each check until the first SessionStart of the window (at most 120 s after the open), awd looks for the trust screen and answers it with fixed keys once per window (no user text): `Enter` only when the cursor is on "Yes, I trust this folder", after one `Down` at most (review round 2: the option order of an uncovered version is not known). The trust entry reads the file again just before the rename and starts again when Claude Code changed it, writes the target of a symlink, and keeps the last 5 backups.

14. **tmux host.**
   - The binary is `AW_TMUX`, else the first `tmux` in `PATH` that is not under a `/.orca/` folder. The socket name is `AW_TMUX_SOCKET` (default `aw`).
   - awd writes `~/.aw/run/tmux.conf` (`exit-empty off`, `remain-on-exit on`, `default-size 200x50`, `history-limit 5000`) and starts the server with `-f` and `new-session -d -s aw -n aw-host -- tail -f /dev/null` (tmux needs one window per session). On Linux, when the user unit `aw-sessions.service` is installed (`Type=forking`, `Restart=no`, `KillMode=process`), awd starts it with `systemctl --user start`, so the server is in its own control group. The LaunchAgent gets `AbandonProcessGroup`.
   - A window: `new-window -d -t aw: -n aw-<task-id> -c <cwd> -e AW_NODE=<node> -P -F <ids> -- <aw-launch> <session>`. Two or more arguments, so tmux runs no shell.
   - Pids: the pane pid (it is the claude pid after `execve`) and the process group from `ps -o pgid=`.
   - Stop: SIGTERM to the process group, SIGKILL after 5 s, then SIGKILL to each remaining descendant from the process table (`ps -A -o pid=,ppid=,pgid=,etime=`), then `kill-window`. The stop signals nothing when tmux does not list the pane with the stored pane id and pid (after a reboot or a `kill-server` the pids can belong to other programs). In a dead pane it signals, one by one, only the members of the process group that started after the pane opened (`opened` in the pane ref).

15. **Reconcile and resume** (`architecture.md` 4.6.3 and 4.6.4). At start, and every 5 s, the manager lists the panes. A live pane with the stored pane pid is attached (spool drain, deliveries). A dead pane, or no pane, of a session that holds the accepted claim is resumed: awd kills the dead window, writes a new `context.md` and `continue.md`, and opens a new window with mode `resume` and the stored flags. The continue message is "[AW resume] AW resumed this session after the agent process stopped at <UTC time>. The interrupted step was <tool>: <input>. Check its result before you run it again." The interrupted step is the last PreToolUse with no PostToolUse. A session that does not reach SessionStart after 2 resumes gets the comment "Resume failed" and stays stopped (continuity adds the gate "Take over terminal"). A session whose agent has no conversation yet (no prompt reached it and its transcript does not exist: it stopped before its first prompt, or aw-launch did not get `/readyz` in time) cannot resume: it opens again with mode `new`, `--session-id` and the first input, at most 3 times, and this does not count as a resume (review round 3). When the window of a new session does not open, awd removes that session record and folder, so the next try (after 60 s) writes a new claim.

16. **Agent commands.** `aw-launch` exports `AW_SESSION`, `AW_TASK` (the task id), `AW_WORKSPACE`, `AW_HOME` and `CLAUDE_CODE_NONBLOCKING_STDOUT=1`. The commands call `/v1/sessions/<session>/...`. awd checks that the session record exists, is not stopped, and that the task argument is the task of the session; else 403 `refused`. The actor is the agent of the record. `aw ask` returns at once with exit code 0 and "End your turn now".

17. **Settings.** `AW_TMUX`, `AW_TMUX_SOCKET`, `AW_CLAUDE` (the claude binary; default `claude` in `PATH`; tests give the fake agent) and `AW_CLAUDE_MODEL` (optional `--model`; the real-device check uses `haiku`). Reason: tests and the real-device check need another binary, socket and model without code changes.

18. **Fake agent** (`plugins/agent-claude/src/testing/fake-claude.ts`, bin `testing/bin/claude`). It parses the launch flags, shows the trust screen for an untrusted folder, reads its `hooks.json` and runs each hook command with JSON copied from the captured payloads (`src/testing/payloads.ts`, with the source and the capture date), and keeps a transcript. It reads the terminal in raw mode, joins a bracketed paste into one input, and reacts to small commands in the input: `ask <question> | <a|b>` (runs `aw ask`), `write <file> <text>` (a Write tool with a permission request), `bash <command>`, `reply <text>`; other text gets the reply "Got: <text>".

19. **Plugin directory in `plugins/agent-claude/plugin/`**, not the package root: `--plugin-dir` then sees only the plugin files, not `package.json` and `src/`.
20. **`/readyz` reports the session host as `ok` or `failed`** (the enum of the existing reply schema), and it does not change the readiness: a device with no tmux still serves the API.
21. **Dialog check on the visible screen only** (found in the tests): `capture-pane` with the scrollback saw a closed permission dialog and blocked each delivery.
22. **A resume first stops the process group of the dead agent** (found in the tests): the background command of the killed agent kept running and could run the same step twice.
23. **The sessions are off in `startTestDaemon` by default**, so the existing tests do not start agents; the session tests turn them on with the fake agent and a private tmux socket.
24. **No poison event** (review round 1). A spool file that fails 5 times moves to `spool/failed/` with a comment on the task. The ExitPlanMode gate is idempotent: a retry reuses the version file with the same plan. A text that does not fit in a 64 KiB log line goes to `artifacts/<device>/text-<id>.md`, and the event keeps the first 2,000 characters and the path. A failed write of the log buffer keeps its events for the next try; after 3 tries it drops the event with a comment.
25. **One failing task never stops the manager** (review round 1): each task and session step has its own error handling, and a failed first check still starts the 500 ms loop.
26. **Stable event ids of hook steps** (review round 3). The id of each event of a spool file is a UUIDv7 with the hook time and 74 bits of the sha256 of `<session>/<file>/<step>`. Before a write, awd skips a step whose id is in the index. So a crash between the write and the move to `spool/done/` writes no second line, and a retried Stop opens no second Reply gate. The `confirm_approach` and `question` gates of PreToolUse use the same steps, so a `written_not_merged` of the first event does not skip the gate.
27. **An answer that comes after a new claim goes to the new session** (review round 3). After a move or a new session on the device, an open question, approach or reply gate of the earlier session stays open in the SessionStart context; its answer is delivered to the current session when the gate was resolved after the current claim. A permission gate of an earlier session is never delivered: its tool call ended with that agent.
28. **The setup tries again** (review round 3). With no tmux or no agent binary at the start, the open workspaces wait; awd looks again every 60 s and writes one comment per open task of `claude@<device>` with no claim. `/readyz` reports `session_agent` next to `session_host`.
29. **tmux outside the awd unit** (review round 3). On Linux with no `aw-sessions.service`, awd starts the tmux server with `systemd-run --user --scope` and logs a warning to run `aw service install` again; only when that fails does tmux start in the process tree of awd.
30. **A long first input stays in its file** (review round 3). Above 96 KiB, the argv message is a short text that names `first-input.md` (Linux refuses one argument over 128 KiB with E2BIG).
31. **Accepted exception: the refusal of person commands is in the CLI** (review round 3). The allow rules are the main layer; the CLI refusal is the second. The local API and the service layer accept `gate answer` and `task assign` from any process on the socket of the user, as for any local client. The MCP server task must keep the same split (agent tools only).

## Risks / Trade-offs
- [Claude Code changes the state file or the hook payloads] → The trust entry is written only on the covered versions, with a backup; the payload parser accepts unknown fields; the contract tests read the recorded payloads.
- [`process.execve` is new in Node 24] → It works on the pinned 24.22.3 with no warning (checked); the engines range starts at 24.15, where it exists.
- [The spool grows] → awd moves each handled file to `spool/done/` and removes `done` files older than 7 days at start.
- [A paste into a dialog that the detector does not know] → The delivery checks 3 sources; the 3-attempt limit and the "Answer not delivered" comment make a fault visible.
- [Parallel tasks change the same daemon files] → New code is in new files; each existing file gets a few lines.

## Migration Plan
No data migration. A device without tmux reports `session_host: failed` in `/readyz` (and `session_agent: failed` without the agent binary) and starts no session until they answer.

## Open Questions
- Spike S7 (`permissions.denyInsteadOfPrompting` runs after the hook) is not run; the session settings do not set it, and the 120 s hook covers the case.
