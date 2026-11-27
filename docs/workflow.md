# Agent Workspace — Workflow

| Item | Value |
|---|---|
| Document | The work process of AW, step by step |
| Version | 0.3 (phase 1), 2026-11-22 |
| Readers | Product owner, architects, implementers, coding agents |
| Rules from | `principles.md`, `decisions/2026-11-22-task-model.md`, `decisions/2026-11-22-device-sync.md`, `decisions/2026-11-22-phases.md`, `decisions/2026-11-22-relay-transport.md` (push) |
| Changes in 0.3 | MCP tools next to the `aw` commands (section 8), macOS notifications, tmux and Orca as session hosts |

This document tells what happens from "the human has a task" to "the task is done". It does not depend on one agent workflow. Section 10 shows how two different workflows use the same steps. The answers of the product owner are in `decisions/2026-11-22-task-model.md` §5.

## 1. Devices
| Role | Example | Creates tasks | Implements | Notes |
|---|---|---|---|---|
| local | MacBook Pro | Yes | Yes | The main device. 1 per person. AW works with this device only. |
| remote | ubuntu-01, a second laptop | Yes (its agents) | Yes, default | 0 or more. Each project has an ordered list of implementing devices. |
| mobile | Pixel 9 | Yes | No | A remote control. |

1. The devices sync the AW folder (for example `~/AW/`) with built-in Syncthing, in 3 separate Syncthing folders: `tasks`, `knowledge` and `secure` (section 9).
2. Each device writes only its own log files. Code goes through git, never through the AW folder.
3. **Presence comes from AW heartbeats, not from the Syncthing connection state.** Each device writes a heartbeat every 30 s. The other devices show it offline after 90 s with no new heartbeat. In the test, a frozen laptop stayed "connected" in Syncthing for 2 minutes.
4. awd supervises both Syncthing processes (the monitor and the worker). It restarts the engine when the worker stops or does not answer its REST API.

## 2. Task fields
| Field | Written by | Note |
|---|---|---|
| Id | AW | A UUIDv7. It never changes. Folders, links and tmux window names use it. The work branch is `aw/<key>` as at the first session, and it does not change after a rekey (4.8.3). |
| Key | AW | `AW-12`, a display alias. A collision gives one task a new key (`task.rekeyed`), and the thread shows the change. `aw` commands accept the key or the id. |
| First message | The human who creates the task | The first input of the agent. AW passes it as is, for example `/my-team:implement Add a rate limit to the public API`. |
| Proposal | The agent | Versioned. One version is open at a time: a new version replaces it. The human approves it at the gate "Approve proposal", or discusses it with a message (`decisions/2026-11-26-proposal-and-discussion.md`). |
| Test server | The human, or the agent proposes it | A name from `secure/test-servers.yaml`. |
| Credentials | The human | Names of encrypted entries. Every event writer and the text files of a task replace a credential value with `[redacted:<name>]`, also in base64 and URL-encoded form. |
| Assignee | The human (or the project switch for subtasks) | `agent@device`, for example `claude@ubuntu-01`. AW never assigns a task alone (4.1, 4.6). |
| Parent, subtasks, dependencies | The agent or the human | A subtask starts only when its dependencies are done. |
| Thread | The session device, plus each device for its own answers | The raw text of all human and agent messages, questions, answers, gates, proposal versions, artifacts and system messages (4.3). Never a summary. |

The description is a view of these fields. AW builds it when it sends the task to another platform (phase 2).

## 3. Stages and gates
| Stage | The task enters when | The task leaves when |
|---|---|---|
| Backlog | The human parks the task, or a task has no assignee. | The human assigns it or starts it. |
| Discuss | The session starts with the first message. | The human approves the proposal. |
| Ready | The proposal is approved. A subtask starts here (4.6). | AW sends "Start implementing" (4.7). |
| Implement | AW sends "Start implementing". | The agent posts the result. |
| Review | The agent posts the result (`aw result`). | The human approves the result, or requests changes (back to Implement). |
| Done | The human approves the result. | — |

- **Needs you** is a lane, not a stage. It shows each task with an open gate.
- **Paused** is a state on top of a stage, always with a cause and a next step: usage limit (resumes at 14:00), device offline (waits until the device is back; the human can assign the task to another device), device restart (resumes alone), login expired (needs you), waiting for sync, moved to another device.
- Only a gate action of the human moves a task past a gate. A comment never changes the stage.

This table is the canonical list of phase 1 gates. The other documents refer to it.

| Gate | Opened by | Human actions | Push, timeout or reminder |
|---|---|---|---|
| Answer question | `aw ask`, or the `AskUserQuestion` tool. It shows as an agent message with option buttons. A new question or proposal replaces it. | Select an option, or write an answer | Push. No timeout. Reminder push after 1 h and 24 h. |
| Reply | A turn that ends with a question, and no question, proposal or reply gate of the same turn is open. A new question or proposal replaces it. | Write a reply | Push. No timeout. Reminder push after 1 h and 24 h. |
| Approve proposal | `aw proposal`, or the `ExitPlanMode` tool. A new version replaces it. | Approve. A message is the discussion. | Push. No timeout. Reminder push after 1 h and 24 h. |
| Assign task | A task with no assignee (4.1, 4.6) | Assign `agent@device` | Push when an agent created the task. Reminder push after 24 h. |
| Approve command | A permission request of the agent | Allow once · Allow for this task · Deny | Push. The hook waits 120 s, then denies. While the agent waits, a late "Allow" becomes a one-time approval for that request id. AW closes the gate ("Denied after 120 s") at the next turn of the session, or at another request more than 120 s later (rule 4). |
| Approve result | `aw result` | Approve · Request changes | Push. No timeout. Reminder push after 1 h and 24 h. |
| Approve knowledge change | An agent change to a rule, a locked file or shared knowledge | Approve · Reject | No push. It stays in the daily digest until the human answers. |
| Approve device | A new device asks to pair | Approve · Reject | No push. The pairing code expires after 10 min. |
| Continue after usage limit | 3 automatic continues in one session | Continue now · Wait for the reset | Push. No timeout. Reminder push after 24 h. |
| Take over terminal | An unknown screen, or a failed resume and handoff | Open the terminal · Stop the task | Push. No timeout. Reminder push after 1 h and 24 h. |
| Fix a file | A schema error after a manual edit | Open file · Restore last valid version | No push at open. Reminder push after 24 h. |
| Custom gate | `aw gate` from a workflow | Its options, or a reply | Push. No timeout. Reminder push after 1 h and 24 h. |

1. Each gate has a unique id (a UUIDv7). Each answer names the gate id and the version that it answers. An answer to an old version becomes a comment.
2. The session device resolves a gate with the first answer that it receives. A later answer becomes a comment.
3. No gate opens by itself to move a task. AW never changes the agent or the device of a task (`decisions/2026-11-23-manual-move.md`).
4. **Gates with no session.** The owner device closes each open gate that no session can use, with the answer "Session ended" (rule 2 then makes each later answer a comment):
   - "Approve command" when its session ends, for each reason (stopped, crashed, moved, replaced, done).
   - "Answer question", "Reply", "Approve proposal", "Continue after usage limit" and "Custom gate" when a person stopped the session, or the task is done. After a move or a replace, the next session gets these gates. After a crash, "Resume again" resumes the same session.
   - "Approve result", "Take over terminal" and the gates that need no session stay open.
5. A test slot lease lasts 30 min, and the session heartbeat renews it. A test server that stays up for Review stops at the approval, 24 h after "Request changes", or when the human stops it.

## 4. Main flow
### 4.1 Create the task
1. On local or mobile, the human selects the project and writes the first message. Optional: assignee, test server, credentials, parent task, and the session options (4.2.1).
2. The creating device writes `task.created` with a new id and the next free key that it knows.
3. A task with no assignee stays in Backlog and opens the gate "Assign task" ("Needs you: assign"). AW never assigns it alone (task-model decision §5.1).
4. Syncthing copies the log to the other devices. Mobile can create a task while the laptop sleeps; the remote device sees it directly.

### 4.2 Start the session
1. The daemon on the device of the assignee (`agent@device`) sees `task.assigned`. It writes `task.claimed {epoch, device, session}` with an epoch 1 higher than the highest epoch that it knows. It claims only when the task has no accepted claim, or when the newest accepted `task.assigned` sorts after the accepted claim. When the accepted claim is on another device (a move, `architecture.md` 4.3.4), it claims after `task.released` of that device, or at once when that device is offline.
2. A claim counts only from the device of the current assignee. The merge ignores a claim from another device and reports it (`not_assignee_device`). So AW never moves a task by itself, and a laptop that wakes after the human moved its task cannot take it back (`decisions/2026-11-23-manual-move.md`).
3. Only the session with the highest epoch runs. The merge order (HLC, then device id) picks the same winner on every device.
4. After a wake or a reconnect, the daemon reads the merged log first. It stops each session with a lower epoch, and the task shows "Moved to ubuntu-01".
5. The daemon writes the first input to `~/.aw/sessions/<session-id>/first-input.md`. It never puts user text in a shell command line.
6. The daemon starts the fixed wrapper `aw-launch <session-id>` in a tmux window (default), or in an Orca terminal when the device turned on `host-orca` (`worktree create`, then `terminal create`). It uses separate arguments and no shell string.
7. The wrapper marks the worktree as trusted (`architecture.md` 4.6.2), so that the trust screen does not open. It checks `/readyz` on the awd socket and exports `AW_MCP_URL` and `AW_MCP_TOKEN`. Then it runs (`phase-1.md` 9.1):
   `claude --session-id <uuid> -n <key> --plugin-dir <aw-plugin> --settings <session-settings> --permission-mode <mode> --allowedTools "Bash(aw ask *)" ... "Bash(aw thread *)" "mcp__plugin_aw_aw__*" -- "<first input>"`. The mode comes from the session options (4.2.1).
8. The tmux window has `remain-on-exit` on, so AW can read the exit status. AW records the exact pid and the process group of the session.
9. The AW plugin registers the AW MCP server and gives the agent the AW skill ("The human is not at this terminal. Use the AW tools, or the `aw` commands when the tools are missing, for each question, proposal, result and handoff. The answer arrives as your next input."). At SessionStart, it gives at most 10,000 characters: the task fields, the rules, the list of knowledge files, and "Read the full thread with `aw thread <key> --ancestors` before you act."
10. The agent follows its own workflow. AW does not know or read that workflow.

#### 4.2.1 Session options
A person sets 3 options in New task, New session and "Assign to another device…", on the desktop, the phone or with `aw task create|assign` (openspec session-options):
1. **Permissions**: Default (the agent asks for each command and edit that has no rule), Accept edits (it edits files in its folder with no question), or Skip permissions (`--permission-mode bypassPermissions`: no gate for each command). The project has a default (`project.yaml` `permission_mode`, `aw project edit --permission-mode`). Skip permissions is the default mode (owner decision 38): a new workspace, a new project and a project with no value use it, and New task (desktop and phone) preselects it. A person can choose Default or Accept edits for a task, a project or new projects. Only a person sets "Skip permissions": the merge ignores the options of an agent event, awd refuses them from a session caller, and a project default "Skip permissions" counts only for a task that a person created. So a subtask of an agent never gets it. The task shows a red chip "Skips permissions". The AW guard checks only the command text, so a hidden command can still act as the person in AW (`SECURITY.md`); the warning of the option says so.
2. **Agent teams** (on by default in New task and New session of a person; an agent subtask gets no teams): the session settings turn on the Claude Code agent team setting with the in-process display. The teammates run in the pane of the lead and get its permission mode. AW follows the lead session: a question or a plan of a teammate opens no gate (the hook tells the teammate to ask the lead). A resume continues without the teammates.
3. **Work in**: a separate worktree (default, `~/.aw/worktrees/aw-<key>` with tmux, the Orca worktree `aw-<key>` with Orca), the project checkout (AW checks out `aw/<key>` there; one session at a time; it changes the branch and the files of the person's checkout; a clean AW worktree of an earlier session of the task is removed first), or another folder (an absolute folder on the session device, as it is: no worktree, no branch, no checkpoint push).
The task shows "Works in <folder> · branch aw/<key>" with Copy, and Open on the session device. In each mode the AW guard of the PreToolUse hook denies a person `aw` command, the awd socket and the AW files (`phase-1.md` 9.1.7).

### 4.3 Thread and delivery
1. The session device writes each message to the thread as raw text:
   - `message.human` from the `UserPromptSubmit` hook, with its source (`first`, `typed`, `answer`, `phone`) and the `delivery_id` of a delivered text.
   - `message.agent` from the `Stop` hook (`last_assistant_message`) with `source: turn`. It shows only in the Session tab. The agent sends its updates through AW: a turn with no update gets one notice `message.sent {kind: nudge}` (`decisions/2026-11-25-agent-pushes-updates.md`).
2. AW reads agent output only from the hooks and the transcript. It never reads the terminal screen (an Orca terminal can be 2 columns wide).
3. A device that sends an answer or a message writes it to its own log first: `gate.answered`, or `message.sent {id, text, to_session}`. Only the session device writes `message.human`, so the thread has each text once. `aw thread` shows an undelivered `message.sent` as "Not delivered yet".
4. The session device delivers the text to the session with one function:
   1. Wait until no dialog is open (no permission prompt, no picker, no auto-continue wait).
   2. Add the prefix `[AW answer <gate-id>]` or `[AW message <message-id> from <device>]`.
   3. Paste the text with bracketed paste (`tmux load-buffer`, `paste-buffer -p`), then press Enter once.
   4. Wait for the `UserPromptSubmit` hook to confirm the id. Make at most 3 attempts, 30 s apart. Then show "Answer not delivered" with the pane snapshot.
5. The phone can send free text to a running session. It goes through the same delivery as the next input (task-model decision §5.3).

### 4.4 Questions
1. The agent runs `aw ask AW-12 "Which limit per client?" --details-file limits.md --option "100/min::Enough for the web app" --option "1000/min::For the batch jobs"`. The command returns at once.
2. AW writes `gate.opened` (kind `question`) and opens the gate. The question is the title. The details are the text: the full context of the decision (the options, trade-offs, risks and a recommendation), because the human sees only the gate. Details over 16 KiB keep their start in the gate, and the full text is in `artifacts/<device>/text-<gate>.md`. An option with a description adds `questions` to the gate.
3. The device that owns the gate sends a Web Push (VAPID) to the phone through the UnifiedPush embedded FCM distributor, with no AW server. The fallback is the person's own ntfy server. Push is required in phase 1, and a spike runs before the phone release (task-model decision §5.4). The desktop app shows a macOS notification with one action per option. A click opens the task (`architecture.md` 4.10).
4. The human answers on any device. That device writes `gate.answered` to its own log.
5. The session device resolves the gate (section 3), writes `gate.resolved`, and delivers the answer (4.3).
6. Hooks catch the questions of a workflow that does not use `aw`:
   - `AskUserQuestion`: a `PreToolUse` hook opens the gate "Answer question" with each question, its header, its multiSelect value and each option with its description (`questions`). It denies the tool with "AW sent this question to the human as gate `<id>`. End your turn." With 2 or more questions or a multiSelect question, the card shows each question with its options and "Send answers". The answer is one text in the format of the Claude Code tool result: `"<question>"="<label>", "<question>"="<label>, <label>"`.
   - A turn that ends with a question, when no question, proposal or reply gate of the same turn is open: the `Stop` hook opens the gate "Reply".
7. A question or reply gate with no details (an older gate, or a question like "see the message above") shows "Context" on its card: the agent messages after the last event of a person before the gate, at most 5.
8. The agent asks each question only with `aw ask` (never also with `aw message`), and all its open questions in one ask. A new question replaces the older open questions of the task: the session device resolves them with "Replaced by a newer question", and a later answer becomes a comment. A ready item ("Missing: <item>" of `aw ready`) stays open.

### 4.5 Proposal
1. Discuss is a conversation of messages and questions. When no question is open, the agent runs `aw proposal AW-12 --file proposal.md`. The file is Markdown. A proposal has no open question and no choice. The agent never asks for permission to write a proposal.
2. In plan mode, a `PreToolUse` hook on `ExitPlanMode` turns the plan into the same gate.
3. The gate "Approve proposal" opens with the one option "Approve". It replaces the open proposal ("Replaced by proposal v<n>") and the open questions. Each new file is a new version: `proposal/v<n>.md`.
4. To change the proposal, the human writes a message. The agent answers it, or sends a new version.
5. On approve, the stage changes to Ready, and AW delivers "Proposal v2 approved. Run `aw ready AW-12` and end your turn."
6. The approved proposal becomes a task field. The thread keeps all versions. The versions from before the rename stay in `approach/v<n>.md`; the numbers continue after them.

A team can run AW with its own skill (here the example namespace `my-team:`) or with OpenSpec only. The steps of AW are the same.

| Step | A team skill (`my-team:implement`) | OpenSpec only |
|---|---|---|
| First message | `/my-team:implement Add a rate limit …` | `/opsx:explore Add a rate limit …` |
| Discuss | Questions with `aw ask` | Explore; questions with `aw ask` |
| Questions in the terminal | `AskUserQuestion` and a final question become gates (4.4) | The same |
| Proposal | The plan of the skill, with no open question, as `proposal.md` | The OpenSpec proposal and design summary as `proposal.md` |
| Subtasks | Optional | Optional |
| Implement | The implement and test steps of the skill | `/opsx:apply`, `/opsx:verify` |
| Review | The result with its evidence as `result.md` | The verify report as `result.md` |
| Done | The last step of the skill | `/opsx:archive` |

## 11. Verification
The process was verified on a local Mac, the remote test box (Linux, tmux, Orca, Claude Code) and an Android 14 emulator (`feasibility-details.md` section 10). Not tested yet: push wake-up (spike before the phone release), a real remote network and relay, a real lid close, battery use on a Pixel 9, the timeout path of the permission hook.
