## Context

- `host-tmux` is the only session host. `SessionManager` keeps one `SessionTools.host` for all sessions and calls `list`, `capture`, `paste`, `keys`, `stop` and `close` on it.
- `docs/phase-1.md` 9.9 gives the Orca steps. The verification of 2026-11-22 found that the Orca screen and stream are 2 columns wide, so AW cannot read the screen.
- Spikes of this change on the Linux remote device (`orca-ide` 1.4.257, captures in the evidence folder, not in git):
  1. `worktree create --repo path:<checkout>` fails with `repo_not_found` when Orca does not know the repo. `repo add --path` fixes it.
  2. `worktree create` also opens a first terminal (a login shell) in the new worktree.
  3. `--branch <name>` on a branch that is checked out in another worktree gives `<name>-2`, and the path gets the same suffix. A branch that exists and is free is checked out as it is (review round 2, `captures/round2/spike-branch.log`).
  4. `terminal create --command "exec <script>"`: `processId` is the shell pid. After `exec` it is the pid of the script, and it is its own process group and session leader. A background child stays in that group.
  5. `terminal show`: a live terminal has `connected: true`. After a kill it has `connected: false` and `exitCause: {kind: "signaled", signal: 15}`. After `terminal close` it has `exitCause: {kind: "operator_close"}`. An unknown handle gives the error `terminal_handle_stale`.
  6. `terminal send --text <t> --enter --wait-submit 5 --json` to a process whose command line names a `claude` file gives `provider: "claude"` and a bracketed paste with an inert Escape. To another program it gives `provider: "unsupported"` and writes the text raw, so a line feed in the text is a key press.
  7. An error after the request started has `error.data.orchestrationRequestId`. `runtime_unavailable` (Orca does not run) has no request id.
  8. Orca restart: the terminals live in the Orca terminal daemon, a separate process in its own systemd scope. A SIGTERM of the runtime kept the program, the handle and the incarnation. While the runtime was down each call failed with `runtime_unavailable`. After the restart `terminal send` worked. A SIGKILL of the terminal daemon stopped the program; `terminal show` then gave `connected: false` and no `exitCause`. Orca did not run the command again.
- `ORCA_USER_DATA_PATH=<dir> orca-ide serve --port <p> --bind 127.0.0.1 --no-pairing` starts a private Orca runtime with its own data. The CLI with the same variable talks only to it.

## Goals / Non-Goals

**Goals:**
- `plugins/host-orca` implements `SessionHost` with the 9.9 steps, and the same session behaviour as tmux: the claim, the hooks, the gates, the safe delivery, the stop, the resume.
- One host per session: a person picks Orca per device, per checkout binding, or per new session.
- Tests with a fake Orca CLI from captured outputs, and a real run on the Linux remote device with the fake agent.

**Non-Goals:**
- A device with Orca and no tmux. tmux stays the default host and must be present (open issue).
- The "Take over terminal" gate for an unknown dialog in Orca (continuity task).
- Desktop and phone UI for the switch (desktop-devices-kb, android-ui).
- Remote Orca environments (`--environment`, pairing codes).

## Decisions

1. **Optional members on `SessionHost`, not a second interface.** `readsScreen?: boolean` (default true), `worktree?(input)`, `find?(ref)`, `submit?(ref, text)`, and `PaneRef.instance?`. The manager uses a member when the host has it, else the old path. Alternative: an `OrcaHost`-specific branch in the manager. Rejected: the manager would import a plugin.

2. **The host makes the worktree** (`worktree()`). Orca shows a terminal only in an Orca worktree, so Orca must create it (2-step open). The tmux host has no `worktree()`, and the manager keeps its `git worktree add`. The Orca worktree name is `aw-<task-id>`. The host:
   1. reuses an Orca worktree with that display name and the same repo, when git has `aw/<key>` checked out there; another branch (a person switched it) gives `branch_changed`, because the agent would commit to a branch that the task does not show;
   2. else finds the repo by path, or adds it with `repo add`;
   3. runs `worktree create --name aw-<task-id> --repo id:<repo> --branch aw/<key> --no-parent --setup skip --json`; when `aw/<key>` exists, it adds `--base-branch aw/<key>`, and Orca checks out that branch; when `aw/<key>` is checked out in another folder, the host refuses with `branch_in_use`, because Orca would make `aw/<key>-2` and the task (whose fold keeps the first branch) would show a branch with no new commits;
   4. closes the first terminal of the new worktree (`terminal close --worktree id:<id> --all`). When that close fails, the start fails before AW opens a terminal, and the next start that reuses the worktree closes it first (the host keeps the worktree id in memory).
   The record `cwd` is the Orca path. A task keeps its branch and its folder when it changes host (review round 2): the manager reads `git worktree list --porcelain`; a tmux session runs in the folder that has the branch when AW made it for the task (`~/.aw/worktrees/<task-id>` or the Orca worktree `aw-<task-id>`), and a session that asks for Orca while the branch is in `~/.aw/worktrees/<task-id>` runs in tmux there, with one comment. Alternative: record a new branch on the task. Rejected: it changes the fold of `shared/core` and the Kotlin model, and the work would be split over 2 branches. Alternative: let Orca show the AW worktree `~/.aw/worktrees/<id>` as an external worktree. Rejected: it changes a repo setting of the person (`externalWorktreeVisibility`).

3. **`--command "exec env AW_NODE='<node>' AW_HOME='<home>' '<aw-launch>' <session>"`.** Orca types the command into a login shell. `exec` replaces the shell, so the pid from `terminal create` is the pid of aw-launch and then of claude (aw-launch uses execve), and the process group is that pid. The values are paths of AW in single quotes; a path with a single quote is refused. No message, no user text and no token is in the command (9.9.2). Alternative: no `exec`. Rejected: the agent is then a job of the shell, in another process group, and a stop of the stored group misses it.

4. **`find(ref)` from `terminal show`, never from the screen.** Live: `connected: true` and the same `incarnationId` as `ref.instance`. Dead: `connected: false`; the status is the exit code, or 128 + the signal. `terminal_handle_stale` gives null (gone). `runtime_unavailable` and other failures throw, so the manager skips the session in this check and never resumes a session whose agent can still run. `list()` gives only the terminals with a title `aw-...` and pid 0, because Orca does not list pids; the manager uses `find()` for Orca.

5. **Stop.** The host signals only when `find()` shows the stored incarnation and the process table has the stored pid in the stored group. A live terminal gets the tmux sequence: SIGTERM to the group, SIGKILL after the grace time, then SIGKILL to each remaining descendant from the table read before the first signal. A dead terminal gets the signals only for the members of the group that started after `opened`. Then `close()` runs `terminal close`. The process table helpers are a copy of `host-tmux/src/process-table.ts`: a plugin never imports another plugin. Alternative: move them to `shared/plugin-api`. Rejected for now: it changes `host-tmux` during parallel work (open issue).

6. **Input with one call: `submit(ref, text)`.** `terminal send --terminal <h> --text <text> --enter --wait-submit 10 --json`. Orca bracket-pastes the text for a recognized agent. After a failure with `orchestrationRequestId` and a code that does not say "not sent" (`terminal_handle_stale`, `request_mismatch`, `invalid_argument`, `runtime_unavailable`), the host keeps the id for that terminal and text, and the next try of the same text uses `--retry-request <id>`. `terminal_not_writable` keeps the id too: its reply says "re-issue the exact command with --retry-request <id>; do not retry it without that ID". A failure with no request id (`timeout` after 15 s, the wait of 10 s and 5 s for the CLI, so a hung Orca holds the one check queue of awd for at most 15 s; `cli_failed`; `bad_reply`) can have sent the text. The host does not guess; the manager sends again only after `DELIVERY_RETRY_MS`, only while the hooks say idle, and only when no UserPromptSubmit confirmed the delivery id. A text that reached the input but was not submitted can then be typed twice; AW accepts this rare case, because a lost answer is worse. The text is one argument of the CLI (it has no stdin or file input), so the host refuses a text over 100 KiB (Linux limits one argument to 128 KiB); an event line is at most 64 KiB, so an answer or a message is shorter. A local user can read the argument with `ps` during the call: this is an exception to AGENTS.md (no user text in a command line), recorded in `docs/engineering-rules.md` 12, and it needs the approval of a maintainer. Until then the host is off unless `AW_ORCA_ALLOW_TEXT_IN_ARGV=1` (review round 2): a merge then breaks no rule by default, and the approval removes one switch. Alternative: block only `submit()`. Rejected: a session would start in Orca and never get an answer. A reply with `provider: "unsupported"` is logged as a warning: a multi-line text can then arrive as more than one prompt. `paste()` and `keys()` throw for Orca.

7. **Delivery rule for a host that does not read the screen.** The manager sends only after the SessionStart of the current pane (`record.ready_pane`, kept in the record so an awd restart keeps it), only when the record is not `busy` (the hooks say the agent is idle), no permission request waits, and no `permission_prompt` or `elicitation_dialog` notification is open. Before the SessionStart, aw-launch runs or Claude Code loads, and Orca writes the text raw: each line feed is an Enter. A pane with no SessionStart after 120 s gets one comment (the screen can show a dialog that AW cannot see). The screen check, the trust screen answer and the "Answer waits" comment run only for a host that reads the screen. tmux keeps its rules.

8. **Host choice of a new session.** In order: the `session_host` of the newest event that names one, from the applied `task.assigned` events and `task.created` (so `aw task create --host orca` with no assignee, then `aw task assign`, runs in Orca); the `session_host` of the checkout binding; `orca` when `use_orca` is true; else `tmux`. When the choice is `orca` but `use_orca` is false, Orca is not available, or the contract tests do not cover the Claude Code version (aw-launch pre-trusts the worktree only for a covered version, and AW cannot answer a trust screen in Orca), the session runs in tmux and the task gets one comment with the cause. The Orca state is detected again at most once per 60 s. A record keeps its host (`record.host`), so a resume uses the same host. Alternative: refuse the start. Rejected: the work stops for a setting.

9. **`session_host` is optional (no default) in `task.created` and `task.assigned`.** Old events parse the same, and the merge does not change. Bindings get `use_orca` with the default `false` (it is a device setting) and an optional `session_host` per checkout.

10. **Minimum Orca version 1.4.257.** It is the version of the Linux remote device where the verification and this change ran. 1.4.268 was only the version of the Mac when the docs were written; it was never tested with AW. 1.4.257 has `--wait-submit` and `--retry-request`.

11. **Detect order**: `AW_ORCA`; `/Applications/Orca.app/Contents/Resources/bin/orca` on macOS; `orca-ide` in `PATH`; `orca` in `PATH`. A binary must give a version that matches `^\d+\.\d+\.\d+` at the start of the first line of `--version` (a prerelease suffix and later lines are ignored) and a `status --json` with `ok: true`, `runtime.state: "ready"` and `runtime.reachable: true`. On Linux `orca` in `PATH` can be the screen reader, so the version check is needed.

12. **A stop keeps the Orca worktree**, as the tmux host keeps `~/.aw/worktrees/<id>`: it holds the work and the branch. `OrcaHost.removeWorktree()` and `forgetRepo()` exist for tests and a later uninstall.

13. **The fake Orca CLI runs each terminal in a private tmux server** (`FAKE_ORCA_TMUX`, `FAKE_ORCA_SOCKET`), keeps its state in `FAKE_ORCA_STATE`, and prints JSON in the shape of the captured replies. So the daemon e2e test can run the same session flow with no Orca. The same test file runs against the real Orca when `AW_E2E_ORCA=1` and `AW_ORCA` names the binary.

14. **Real runs use a private Orca runtime** (`ORCA_USER_DATA_PATH` in a wrapper script that `AW_ORCA` names). The person's Orca app, repos and terminals stay untouched, and the restart test can stop the runtime.

15. **A host that does not answer.** `find()` throws, and the manager neither resumes nor stops the session. After `HOST_NOTICE_MS` (120 s) the task gets one comment with the time and the last error, and one comment when the host answers again. `terminal show` and `status` have a time limit of 5 s (not 30 s), because they run in the one serial check queue of awd. A forced stop then fails with 503 `not_ready`, and the session keeps running. A failure of the signals keeps its own cause (also 503). While such a session runs, a new assignment of its task starts no new session (review round 3): the new session could fall back to tmux and run in the same Orca worktree next to the agent that AW could not stop. The task gets one comment "The new session waits", and the new session starts after the stop. When Orca shows the stored handle with another incarnation, the manager closes it with no signal before a resume, and a stop closes it too.

## Risks / Trade-offs

- [The fake agent is not a "recognized agent" of Orca] → the test names the fake through a file called `claude`; the real run records the `provider` value. A real Claude Code is recognized (spike 6).
- [Orca changes its JSON] → each reply goes through a declared zod schema with only the fields that AW reads, so a change gives one `bad_reply` error that names the field; the contract tests use captured replies with the capture date.
- [User text in the argv of `terminal send`] → readable with `ps` by each local user for up to the call time (15 s). Exception row in `docs/engineering-rules.md` 12, not approved. Until a maintainer approves it, the Orca host is off unless `AW_ORCA_ALLOW_TEXT_IN_ARGV=1` (detect gives "not available" with that cause, and `submit()` refuses each text); then remove the switch. Ask Orca for stdin or file input.
- [A kill of the Orca terminal daemon stops the agent] → AW resumes it in a new terminal, as after a tmux kill-server.
- [The person's Orca hooks in `~/.claude/settings.json` also run in AW sessions of a real Claude Code] → they do not change AW hooks; recorded as an open issue.
- [Copy of the process table code] → a later task moves it to a shared package.

## Migration Plan

None. Old bindings files and events parse as before. Sessions without `record.host` are tmux sessions.

## Open Questions

None that block. See the open issues of the result handoff.
