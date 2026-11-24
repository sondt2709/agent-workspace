# Decision: task model and workflow independence

| Item | Value |
|---|---|
| Date | 2026-11-22 |
| Status | Accepted by the product owner |
| Updated | 2026-11-22: test server path `secure/`, credential key on computers only, open item 1 closed by §5.3 |
| Replaces | The task "description" field and any "start prompt" setting |
| Related | `2026-11-22-device-sync.md` (credentials, sync before implement) |

## Context
An AW task is not a Jira or Linear ticket. The human does not write a full description. The human starts a conversation, and the agent and the human agree on the approach. The agent works with a workflow (for example the skills `my-team:implement`, `my-team:implement-loop`, or OpenSpec only). Workflows change over time.

## Decision
### 1. Task fields
| Field | Written by | Rule |
|---|---|---|
| First message | The human who creates the task | The first input of the agent session. It replaces the description. AW passes it as is. It can contain a command, for example `/my-team:implement` or `/opsx:explore`. |
| Approach | The agent, after the discussion | The human confirms it with the gate "Confirm approach". Each change makes a new version. Later sessions and subtasks get the confirmed approach as context. |
| Test server | The human, or the agent proposes and the human confirms | A reference to an entry in `secure/test-servers.yaml` (phase 1: a file in the AW folder). |
| Credentials | The human adds them | References to encrypted credential entries. Values never appear in the thread, the knowledge or the logs. |
| Other fields | As before | Project, assignee `agent@device`, state, thread, gates, artifacts, sessions, parent task, subtasks, dependencies, links. |

There is no start prompt setting.

**The description is a view, not a field.** AW builds it from the fields: first message, confirmed approach, test server (name only), links and subtasks. Credentials never appear in it. A target platform (for example Linear in phase 2) gets the description from a template per platform.

**The original conversation stays visible (principle 8).** Each implementing session gets the confirmed approach and the full original thread of the task: the first message and all messages, questions and answers between the human and the agents. A subtask also gets the thread of its parent task. The agent reads it with `aw thread <key>`. A summary never replaces the original messages.

### 2. Ready to implement
The agent must check that it has enough information before it implements. Its workflow decides what "enough" is. AW starts the implement stage only when all of these are true:
1. The human confirmed the approach.
2. The agent reported "Ready" (`aw ready`) with no missing item, or it listed the missing items as questions.
3. The task has an assignee (for subtasks: the human assigned it).
4. The sync before implement is complete on the device (`2026-11-22-device-sync.md`).

### 3. AW does not depend on one workflow
1. AW gives generic primitives through the `aw` CLI and the AW skill: message, question, gate (any Markdown, with optional decisions that each have a recommendation), approach, ready, create task or subtask, report stage, artifact, handoff.
2. A workflow uses these primitives. AW does not read or parse the files of a workflow (for example OpenSpec files or a loop README).
3. AW works with any workflow, with OpenSpec only, or with no workflow.
4. Board stages are generic: Backlog, Discuss, Ready, Implement, Review, Done, plus the "Needs you" lane. The agent reports the stage. Only a gate action of the human moves a task past a gate.

### 4. Credentials
1. When a computer (local or remote) is paired, it gets the workspace credential key, sealed to its device key. The phone never gets it (§5.3).
2. Credential values are encrypted with that key in the AW folder.
3. The implementing device decrypts a credential only when the session of the task starts. It gives the value to the session as an environment variable or a file.
4. The Claude login is never a credential in AW. Each device signs in to Claude itself.

### 5. Answers of the product owner (2026-11-22)
1. A task with no assignee waits for the human: it shows "Needs you: assign". AW never assigns it alone. This is true for tasks of humans and of agents. The project switch "Assign new subtasks to the default device" (off by default) stays the only exception.
2. A subtask starts at Ready with the confirmed approach of its parent. The agent can copy fields from the parent when it creates the subtask (approach, test server, credential names, links). Its workflow can still open "Confirm approach".
3. The phone can send free text to a running session (delivered safely as the next input). The phone can add or replace a credential, but it cannot read it.
4. Push is required in phase 1: Web Push from the device that owns the gate, through the UnifiedPush embedded FCM distributor; fallback: the person's own ntfy server. A spike comes before the phone release.
5. A laptop that wakes after the human moved its task (AW never moves a task by itself, `2026-11-23-manual-move.md`): AW pushes its unpushed work as the branch `aw/<key>-<device>-<time>` and writes a thread comment (`comment.added`). It never drops the work.
6. "Approve command" waits 120 s, then denies. A late "Allow" is a one-time approval of that exact request id.

## Open items
None. §5.3 answers the former item 1: the phone seals a new credential to the device keys of all paired computers (`phase-1.md` 10.2).
