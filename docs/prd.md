# Agent Workspace — Product Requirements Document

| Item | Value |
|---|---|
| Product | Agent Workspace (AW) |
| Document | PRD |
| Version | 0.13 (follows `principles.md`) |
| Date | 2026-11-22 |
| Readers | Stakeholders, product manager, designers |
| Status | For review. Section 13 lists the decisions for the owner. The owner's answers to Q1–Q5 and D6 are in `decisions/2026-11-22-task-model.md` §5. Section 14 lists the changes in v0.9 to v0.13. |
| Related | `principles.md`, `workflow.md`, `decisions/2026-11-22-phases.md`, `decisions/2026-11-22-device-sync.md`, `decisions/2026-11-22-task-model.md`, `decisions/2026-11-23-manual-move.md`, `decisions/2026-11-22-relay-transport.md`, `architecture.md`, `phase-1.md`, `feasibility.md` |
| Prototypes | Destination: the clickable prototype v0.4 and later (all phases, mock data). Phase 1: a separate, simple prototype with the phase 1 scope only. |

## 1. Summary
Agent Workspace (AW) lets you manage the work of your AI agents from anywhere. It is an open-source task tracker in which AI agents do the work. `principles.md` decides the product. This document cites its principles by number.

- **Your laptop is the main device.** You install AW on your local device, for example a MacBook Pro. AW works with that device only (principle 2).
- **An optional 24/7 remote device keeps the work going.** Add a cloud VM, a home PC or a Mac mini. Agents keep working while the laptop is closed (principle 2).
- **The phone is a remote control.** You do each human action from the phone. When you close the apps, no work stops (principle 1).
- **A task starts from your own words, and the human decides.** You write a first message. The agent discusses it, writes the approach and works with any workflow. You decide at gates. Each later session reads the original messages, not a summary (principles 3, 4 and 8).
- **You own all of it.** Your data are open files on your own devices. A built-in sync engine syncs them between your devices. No central AW service keeps your data (principles 5 and 9).

AW ships in 3 phases (section 10). Phase 1 is one person, their own devices, Claude Code and no cloud account. Phase 2 adds storage, the relay and People. Phase 3 adds the vault, schedules, meetings and more agents. The phase 1 approach was verified on real devices: a Mac, a Linux remote device and an Android 14 emulator (`feasibility.md`).

## 2. Problem
1. Agent work stops when the laptop closes.
2. Agents forget between sessions. The human repeats the same facts.
3. A usage limit, a reboot, a crash or a full context ends the session. Nobody restarts it until the human looks.
4. An agent can wait for hours on a terminal prompt that nobody sees.
5. The human cannot see in one place, or on the phone, which agent waits for an answer, an approval or a test slot.
6. Several agents use the same test resources at the same time, and tests fail.
7. A new session gets only a summary of the discussion. It misreads what the human wanted.

Claude Code already gives Remote Control for one local session, background sessions (research preview) and an automatic continue after a 5-hour limit. AW uses these features where it can.

## 3. Goals
| ID | Goal | Measure |
|---|---|---|
| G7 | Work continues while the laptop is closed (principle 2). | In a 24 h test with the laptop closed, ubuntu-01 finishes or reaches a gate on each task assigned to it. |
| G8 | The work survives a forced reboot (principle 2). | Power off a device during 3 working sessions. AW resumes 3 of 3 within 2 minutes after the boot. 0 gates are lost. An AW update restarts 0 sessions. |
| G9 | Agents keep knowledge and use it again (principle 3). | Fewer than 5 % of agent questions get "Already in knowledge". The human undoes fewer than 10 % of learned entries. |
| G10 | The human does each human action from the phone (principle 1). | With the laptop closed, a test user completes the task loop, a usage-limit choice, a sign-in renewal, a knowledge undo, a device approval and "Sync now" on the phone. |
| G11 | AW asks only when a decision is necessary (principle 4). | Pauses that end alone send 0 pushes. More than 80 % of pauses end with no human action. |
| G12 | AW works with only the person's own devices (principle 5). | With no cloud account, a test user completes the task loop on the laptop and on a phone on the same LAN or Tailscale. Each missing feature shows its reason and its fix (table 8.5.1). |
| G13 | All devices show the same data (principle 5). | A 7-day test with a laptop, ubuntu-01 and a phone gives 0 lost changes and the same board on each device. |
| G15 | Each session gets the original words (principle 8). | Text typed in the terminal, an answer from the phone and each agent reply show word for word in `aw thread` on another device. |
| G5 | Tests do not collide. | 0 test-slot collisions. A waiting agent shows its queue position. |
| G6 | AW itself costs 0 USD per person. | Phase 1 needs no cloud account. The main cost is the Claude plan or the API key. |
| G14 | Fast start. | Less than 15 minutes from the install command to the first started task. |

## 4. Non-goals
1. AW does not host agents, and does not create, rent or manage servers for the user.
2. AW does not replace the code editor or the terminal.
3. The AW project runs no service for its users: no relay, no storage, no directory, no push gateway.
4. AW does not increase or work around the usage limits of a Claude plan.
5. AW does not let one person's Claude plan run work for another person.
6. AW does not modify, bundle or wrap the Claude Code binary.
7. AW does not depend on a sync app that the user installs separately.
8. AW does not define, read or parse the workflow of the agent, for example OpenSpec files.
9. Phase 1 has no iOS app and no agents other than Claude Code.

## 5. Users
| Persona | Phase | Main needs |
|---|---|---|
| Laptop user | 1 | Installs AW on the laptop. Uses the full task loop there and on an Android phone. Adds a remote device later with no data loss. |
| Solo developer with a 24/7 device | 1 | Has a laptop, a cloud VM or a Mac mini, and an Android phone. Agents work day and night. Approves from the phone. |
| Tech lead | 2 | Leads 3 to 10 People. Shares tasks with People. Controls the rules and which plan or API key pays. |
| Client contact (guest) | 2 | Sees and comments on shared tasks only. |

## 6. Concepts
| Term | Definition |
|---|---|
| Workspace | A space that holds projects, shared knowledge and rules. A "Personal" workspace exists by default. |
| Project | One product or repository in a workspace. It holds tasks, project knowledge, links, device bindings and an ordered list of implementing devices. |
| Task | One unit of work in one project. It has an internal id and a short key for display, for example AW-7. A human or an agent creates it. An agent does the work. A human decides at the gates. |
| First message | The first input of the agent session, written by the creator of the task. It can start with a command, for example `/my-team:implement`. It replaces the description: AW builds the description as a view from the fields (TSK-23). |
| Approach | What the agent and the human agreed to do. The agent writes it, and each change makes a new version. The human confirms it. |
| Thread | The original messages of a task, word for word: the first message, each human and agent message, questions, answers, gates and artifacts. A summary never replaces it. |
| Credential | A project test account or an API key that a task uses. It is encrypted. Only local and remote devices get it. |
| Workflow | The method that the agent follows, for example the skill `my-team:implement` or OpenSpec only. AW does not read it. |
| Gate | A decision that only a human makes. Phase 1 gates: "Answer question", "Reply", "Confirm approach", "Assign task", "Approve command", "Approve result", "Approve knowledge change", "Approve device", "Continue after usage limit", "Take over terminal", "Fix a file". A workflow can open other gates with `aw gate`. The gate table in `workflow.md` section 3 is the canonical list. |
| Agent | An agent runtime on one device, written `claude@ubuntu-01`. It has a credential owner, a maximum of parallel working sessions and an ordered queue. |
| Session | One run of an agent on a task, with a Claude session id. It runs in a session host (tmux, Orca or a direct terminal) that survives an AW restart. A task has at most 1 running session. |
| awd | The AW service on each computer. It runs the agents, the session host and the sync engine. Agents use it through the `aw` CLI or its MCP server. The desktop app uses it through a local socket. |
| Session host | The program that keeps a session alive: tmux (default, the plain Claude Code CLI) or Orca, when the person turned on host-orca on that device. |
| Main device (role local) | The local device where the user installs AW first, for example the MacBook Pro. It creates tasks and implements. |
| Remote device (role remote) | An optional computer, for example ubuntu-01 or mac-mini-lab. It implements by default, also while the laptop is closed. Its agents create tasks too. |
| Phone (role mobile) | The Android app, for example on a Pixel 9. A remote control with its own copy of the data. It creates tasks and runs no agents. |
| Owner device | The device that runs the session of a task. Only it changes the task state. |
| AW folder, document, log | The AW folder (for example `~/AW/`) is separate, never inside a code checkout. Code goes through git. A document is one YAML file, for example `task.yaml`. A log is an append-only JSON Lines file per device. |
| Sync engine | The Syncthing engine inside awd and inside the phone app. AW starts, configures and controls it. |
| Push path | The way a closed phone app gets an alert: UnifiedPush with the embedded FCM distributor in the official build, or the person's own ntfy server. |
| Credential owner | The person whose Claude plan or API key pays for an agent. |
| Knowledge | Markdown files that agents read: shared (workspace) or project. Each change has an author, a task, a time and a diff, and the human can undo it. |
| Inbox | The list of items that need the human. Each item names its reason. |

Phase 2 adds People, members, Send, sources, subscriptions, signals, your relay and your storage (section 8.10).

## 7. User journeys
### 7.1 Install on the laptop
1. The human runs the install command from the AW website on the MacBook Pro.
2. The installer adds awd (with its built-in sync engine) and the session host as services that start at login. The desktop app starts at login too and shows an icon in the menu bar.
3. The desktop app creates the identity of the human and shows the recovery phrase. The human writes it down and confirms it.
4. The app opens `claude auth login` in a terminal, or finds the existing Claude login. AW never reads the sign-in data.
5. The human creates a workspace and a project, links the GitHub repository and selects the local checkout.
6. The setup check shows: "Starts at login: yes · Sessions survive restart: yes · Claude login ends: 18 Dec · Backup: none".
7. The human pairs the Pixel 9 with a QR code and approves it. The phone registers its push path, gets the files and shows "Synced with MacBook Pro · 2 s ago".

### 7.2 Add a remote device
1. The human runs the install command on ubuntu-01 over SSH.
2. The installer adds awd and the session host as systemd user services with linger. They start at boot with no user login.
3. In the desktop app, the human selects Devices, then "Add device". The app shows a code, valid for 10 minutes.
4. On ubuntu-01, the human runs `aw pair aw1:…`. Both screens show the same check code. The human approves.
5. ubuntu-01 gets the workspace files and shows "synced 3 s ago · route: Tailscale". The human signs in to Claude there.
6. The human puts ubuntu-01 first in the device list of the project. AW makes a checkout there.

### 7.3 A task from the first message to Done
1. On the Pixel 9, the human selects the project billing-api. The human writes the first message `/my-team:implement Add a rate limit to the public API`, and selects the test server `k3d` and the credential `staging-api-key`. The task gets the key AW-12.
2. The human assigns the task to `claude@ubuntu-01` in the same form. Without an assignee, the task waits at "Needs you: assign", because AW never assigns a task alone (TSK-26).
3. ubuntu-01 starts the session with the first message as is. The agent asks "Which limit per client?" with its own question tool. AW turns it into the gate "Answer question" and sends a push. The MacBook Pro shows a notification with one action per option; a click opens the task.
4. The human answers on the phone. The card shows "Not synced" until ubuntu-01 has the answer. ubuntu-01 uses the first answer, delivers it as the next input and writes "resolved". A later answer becomes a comment.
5. The agent proposes the approach. The phone shows the push "AW-12 · Confirm approach · v2". The human confirms it. The thread keeps each message word for word.
6. The agent runs `aw ready` with no missing item. AW checks that the knowledge and secure folders are complete on ubuntu-01. Then AW sends "Start implementing".
7. The agent implements and tests on `k3d`. It posts the result with a PR link and a test report. The human approves it, and the task is Done.

When the phone cannot reach ubuntu-01, the card shows "Not synced · ubuntu-01 not reachable". The phone tries again when it has a network.

### 7.4 Close the laptop for the night
1. At 23:00, `claude@macbook-pro` works on AW-21. `claude@ubuntu-01` has 2 working sessions and 3 queued tasks.
2. The human selects "Sync". The app shows "Synced 3 s ago". The human closes the laptop.
3. The phone shows "AW-21 · Paused: MacBook Pro is asleep." with the action "Assign to another device…". AW suggests no device and moves nothing by itself (`decisions/2026-11-23-manual-move.md`).
4. The human selects the action and `claude@ubuntu-01`. ubuntu-01 claims the task and starts a new session from the branch `aw/AW-21` (decision D10). Its first input holds the first message and the confirmed approach.
5. ubuntu-01 works all night. Each gate reaches the phone as in journey 7.3.
6. At 08:00, the laptop wakes. Its old session sees the newer claim and stops. AW pushes its unpushed work as a branch (CNT-27). Home shows "While you were away: 6 tasks done, 1 needs you, agents learned 5 things".

Without a remote device, the work on the laptop pauses. The phone shows the data from 23:00 and cannot sync until the laptop wakes. Its actions wait in its log.

## 8. Functional requirements
Phase: P1, P2 or P3 (section 10). "Must" means required for the release of that phase.

### 8.1 Workspaces, projects and tasks
| ID | Requirement | Phase |
|---|---|---|
| WS-01, WS-02, WS-05 | The user must create, rename, delete and switch workspaces. A "Personal" workspace exists by default. The user creates, archives and configures projects in a workspace. | P1 |
| WS-06 | A project must show its Board, List, Knowledge, Links and Settings. Signals come in P2. | P1 |
| WS-07 to WS-09 | Links must connect a GitHub organization and repositories, with one main repository (P1), and Google Drive, Linear and Mattermost (P2). Agents use the project links as defaults. | P1 / P2 |
| TSK-01, TSK-02 | A task must belong to exactly one project. The board must have the generic stages Backlog, Discuss, Ready, Implement, Review, Done, and a "Needs you" lane. A paused task shows a "Paused" badge with its cause. | P1 |
| TSK-03, TSK-04 | A drag to another column must open a confirmation that names the effect. Each card also has a "Move to" menu and keyboard moves (WCAG 2.5.7). | P1 |
| TSK-05 | The agent reports the stage. Only a gate action of the human moves a task past a gate. | P1 |
| TSK-06, TSK-07 | The list view must group tasks by attention: Needs you, Working, Paused, Queued, Waiting for sync, Waiting for test slot, Backlog, Done. "All tasks" shows the tasks of all projects of the workspace. "My tasks" shows the tasks of the user in all workspaces. | P1 |
| TSK-08 | A task must show the first message, the approach with its versions, the test server, the credential names, the thread, the terminal output, the diff and the artifacts. | P1 |
| TSK-18 | A new task must have a first message. There is no description field and no start prompt setting. AW passes the first message as is as the first input of the session. | P1 |
| TSK-22 | A task can reference a test server and credentials by name. The human sets them, or the agent proposes them and the human confirms. | P1 |
| TSK-23 | The description must be a view that AW builds from the fields: first message, confirmed approach, test server name, links and subtasks. It never holds a credential. Each target platform has its own template. | P1 / P2 |
| TSK-19, TSK-28 | After the discussion, the agent writes the approach. Each change makes a new version. The gate "Confirm approach" confirms it. The first input of a new session holds the first message and the confirmed approach word for word, plus "Read `aw thread --ancestors` first". The context from hooks stays at 10,000 characters or less. | P1 |
| TSK-24 | The thread must hold each message as raw text: the first message, text typed in the terminal, each delivered answer and each agent reply. The owner device writes them. AW never replaces them with a summary (principle 8). | P1 |
| TSK-25 | When the agent asks in the terminal, AW must open a gate. A question tool call becomes "Answer question". A plan-mode exit becomes "Confirm approach". A turn that ends with a question becomes "Reply". | P1 |
| TSK-20 | AW must start Implement only when the approach is confirmed, the task has an assignee, and `aw ready` passed with no missing item on the implementing device after the sync before implement. Then AW sends "Start implementing". | P1 |
| TSK-21 | AW must work with any workflow, or with none. The `aw` CLI and the MCP server (MCP-01) give the same generic primitives: message, question, gate, approach, ready, create task or subtask, report stage, artifact, handoff. AW never parses the files of a workflow. | P1 |
| TSK-09 to TSK-12 | A question must show answer options and a free text field. An approach shows the steps, the test method, the risk and its decisions with a recommendation. A result shows the artifacts and a summary. Each has Approve and Request changes. A comment at a gate does not change the state (TSK-12). | P1 |
| TSK-14 | A task created from a GitHub issue (P1), a Linear ticket or a Google Doc (P2) must keep a link to its source. | P1 / P2 |
| TSK-15 | A queued task must show its position and its agent, for example "Queued · 2nd for claude@ubuntu-01". | P1 |
| TSK-16 | Each device creates task keys with no other device online. On a collision, the task of the higher-priority device (local > remote > mobile) keeps the key. The other task gets the next free number, and its thread shows the change. Folders and links use the internal id. | P1 |
| TSK-17, TSK-26 | Agents on local and remote devices can create tasks and subtasks. A task with no assignee, from a human or an agent, must show "Needs you: assign" (gate "Assign task"). AW never assigns it alone. The only exception is the project switch "Assign new subtasks to the default device", off by default. | P1 |
| TSK-27 | A subtask must start at Ready with the confirmed approach of its parent. The agent can copy fields from the parent: approach, test server, credential names, links. Its workflow can still open "Confirm approach" for its own approach. | P1 |

### 8.2 Continuity (principle 2)
`architecture.md` 4.6.5 lists the pause causes and their texts.

| ID | Requirement | Phase |
|---|---|---|
| CNT-01 | awd must run as a service that restarts after a crash. On a remote device it starts at boot with no user login. On the laptop it starts at login. awd supervises both processes of the sync engine and restarts them. | P1 |
| CNT-02 | Each session must run in a session host that survives an awd restart or update. tmux runs in its own service. After an awd restart, AW connects to the sessions again, and no session restarts. | P1 |
| CNT-04 | After a crash or a reboot, AW must stop the whole process group of the old session, by its exact process ids. Then it resumes with the same session id, the same launch settings and a message that names the interrupted step. It never turns on a bypass permission mode silently. | P1 |
| CNT-06 | After a resume, AW must write in the thread "ubuntu-01 restarted at 03:12. AW resumed the session at 03:13." Device health shows "Sessions resumed 3/3". | P1 |
| CNT-08, CNT-09 | AW must keep a copy of each session transcript on the owner device, so a session resumes after Claude Code deletes old transcripts (30 days by default). When a resume fails 2 times, AW must start a new session with a handoff. When that fails too, AW opens the gate "Take over terminal" with a push. | P1 |
| CNT-10 | Each stop must be a Paused state with a cause, a next step and a time when known. Only pauses that cannot continue alone go to the Inbox with a push. | P1 |
| CNT-11, CNT-12 | AW must read the plan usage of each Claude login from Claude Code status data, never from credentials. At a usage limit, AW must pause all sessions of that login and resume them at the reset time. Claude Code continues by itself when it can. | P1 |
| CNT-13, CNT-14 | After 3 automatic continues in one session, AW must open the gate "Continue after usage limit". At a weekly limit, AW must create one Inbox item per login with 3 choices: Wait, Turn on usage credits, Switch this agent to an API key. | P1 |
| CNT-15 | AW must start no queued task on a login above 90 % of the 5-hour window. The user can change the value. | P1 |
| CNT-16, CNT-17 | Each agent must have a maximum of working sessions (default 2) and a queue that the user reorders on the phone. A session at a gate or paused does not count. A session that comes back continues at once. | P1 |
| CNT-18 | A queued task must start only from a human action or from a rule of the credential owner. | P1 |
| CNT-19 | A running session that is not at a gate must show "No recent update" when no hook event came for 2 minutes. Other devices add at least 8 s for the sync delay. After 15 minutes, AW checks the process and resumes the session when the process is dead. | P1 |
| CNT-20 | A permission request must go to the AW rules first. An unmatched request becomes the gate "Approve command" with the command, the folder, the effect and a unique request id. Each answer names that id. | P1 |
| CNT-21 | The agent waits up to 120 s for the answer (decision D6). Then it gets "no". A deny also goes to the agent as the next input of the human. A late "Allow" becomes a one-time approval for that exact request id. | P1 |
| CNT-23 | After each context compaction, AW must give the task context again and write "Context compacted at 14:20". When a compaction fails, AW starts a new session with a handoff. | P1 |
| CNT-24 | AW must check each Claude login once per hour and push 3 days before it ends. An ended login shows "Paused: login expired" with "Sign in", which opens the device terminal. | P1 |
| CNT-26 | Home must show the health of each device: online or last seen, uptime, sessions (working, paused, queued), login end date, plan usage with a projection, disk and last sync. | P1 |
| CNT-27 | When a laptop wakes after the human moved its task to another device, AW must push the unpushed work of the laptop as the branch `aw/<key>-<device>-<time>`. It writes a thread comment (`comment.added`) and never drops the work. | P1 |

### 8.3 Agents and sessions
| ID | Requirement | Phase |
|---|---|---|
| AGT-01, AGT-02 | The assignee must be one agent on one device (`agent@device`). The human selects it (TSK-26). The picker shows each agent's queue length, and the reason for a sleeping device. | P1 |
| AGT-03 | Each running task must link to exactly one session: the Claude session id and the window in the session host. A claim with an epoch names the session that runs. A session with a lower epoch stops and shows "Moved to ubuntu-01". | P1 |
| AGT-04 | The user must create a new session with 6 fields: agent, session host (AGT-19), context (the thread and the confirmed approach, or fresh), work folder (new worktree or checkout), permission mode, first message. | P1 |
| AGT-06, AGT-07 | A change of assignee must ask for confirmation and keep the approach, the thread and the branch. When a device sleeps or goes offline, only its own sessions pause, for example "Paused: MacBook Pro is asleep." The task waits; AW never changes the agent or the device by itself. A paused task offers the human action "Assign to another device…" (a change of assignee). | P1 |
| AGT-08 | The user must open the terminal of a session, take control of the input and give it back. The desktop gives full takeover. The phone shows the terminal and sends free text as the next input. | P1 |
| AGT-17 | AW must deliver each answer and each human message to the session only when no dialog is open: one paste, then one Enter. A hook confirms each delivery id. Without a confirmation, AW retries, then shows "Answer not delivered". | P1 |
| AGT-18 | A session must start with no hidden dialog. AW trusts the worktree before the start and allows the `aw` commands. A fixed launcher reads the first message from a file. | P1 |
| AGT-10 | AW must create agents in 2 session hosts: tmux (default, the plain Claude Code CLI) and Orca, when the person turned on host-orca on that device. Orca is an optional plugin, off by default, and AW works fully without it. Both hosts are tested in phase 1. A direct terminal is the fallback when tmux is missing. AW reads the agent output from the hooks and the transcript, never from the screen of the session host. | P1 |
| AGT-19 | "New session" and each device binding of a project must have the choice "Session host": tmux (default) or Orca. Orca shows only on a device where the person turned on host-orca in Settings and the setup check found Orca 1.4.257 or later. A running session keeps its host. | P1 |
| AGT-11 | AW must start the user's own copy of Claude Code in terminal mode. The user signs in on Anthropic's own page. AW never reads, stores or forwards sign-in data or API keys. | P1 |
| AGT-12 | Each agent must show its version, its Claude credential, its credential owner and its session host, for example "claude@ubuntu-01 · Max · tmux". | P1 |
| AGT-14 | Setup must say: "A plan has a 5-hour limit and a weekly limit. One agent that works day and night uses more than a Pro or Max plan gives. For heavy 24/7 work, use an API key." | P1 |

### 8.4 Data files (principle 9)
| ID | Requirement | Phase |
|---|---|---|
| DAT-01 | AW must keep all workspace data as plain files in the AW folder: a folder per collection, a YAML file per document, a JSON Lines file per log. Task folders use the internal id, for example `tasks/0193a7c2-…/log/ubuntu-01.jsonl`. The key AW-7 is a field. | P1 |
| DAT-02 | Each document type and each event type must have a published JSON Schema with a version. People and agents can read the files with any tool. | P1 |
| DAT-03, DAT-04 | Each device must write only its own files (table 8.4.1). It merges the files of the other devices in a fixed order: change time, then device id. All devices show the same result. | P1 |
| DAT-05 | AW must build a local index from the files for search and filters. AW never syncs the index and rebuilds it on request. | P1 |
| DAT-06 | A file that fails its schema must not stop AW. AW keeps the last valid version. The Inbox names the file, the field and the error, with "Open file" and "Restore last valid version". | P1 |
| DAT-07 | A file from a newer schema version must not break an older AW. The device shows "Update AW on MacBook Pro to read 2 new files". | P1 |
| DAT-08 | Credentials and the test server configuration must be in the secure folder, which never syncs to the phone. Credentials are encrypted. AW gives them to the session only when it starts. The phone can add or replace a credential, sealed to the device keys of all paired computers, and cannot read it. | P1 |
| DAT-09 | Each event writer must replace each credential value of the session with `[redacted:<name>]` before it writes a log line. | P1 |

#### 8.4.1 Who writes what
| Data | Rule |
|---|---|
| Task state and gate result | Only the owner device. "Move to" (a human change of assignee) gives the task to another device. The old device stops its session when it sees the new assignee. |
| Task claim | The device of the assignee writes a claim with an epoch when it starts or resumes the session. A claim from another device does not count. Only the session of the highest epoch runs. |
| Assignee | A human on any device. AW never assigns a task alone, except with the project switch for subtasks. |
| Gate answer | Any device. The owner device uses the first answer and writes "resolved". A later answer becomes a comment. |
| Message, comment | Any device. Only added, never changed. |
| Title, priority, and the first message until the first session starts | Any device. The newest edit wins, per field. |
| Test slot lease | The device that has the resource. |
| Knowledge | Any device. When 2 devices changed the same file since the last sync, the higher-priority version wins (decision D17). |

### 8.5 Sync between your devices (principle 5)
| ID | Requirement | Phase |
|---|---|---|
| SYN-01 | AW must sync the files between the person's own devices with a built-in sync engine (Syncthing) in awd and in the phone app. The user never installs or opens a separate sync app (decision D14). | P1 |
| SYN-02 | AW must control the engine: devices, folders, ignore patterns, discovery and relays. AW writes its settings before the first start: no usage report, no router port mapping, and discovery and relays as SYN-06 sets them. It does not change a Syncthing that the user already runs. | P1 |
| SYN-03 | Sync must run automatically when 2 devices are online at the same time. After each of its own writes, AW asks the engine to scan that file. On the same LAN or Tailscale, a change arrives within 10 s. | P1 |
| SYN-04 | The desktop and the phone must have "Sync now" (the desktop button is "Sync"; there is no "Close laptop" flow). It always starts with a scan. AW also syncs before the laptop sleeps or shuts down, when the OS allows it. The app shows the result, for example "Synced 12 s ago" or "3 changes not synced", and suggests no move. A laptop closed without a sync is the user's own mistake. | P1 |
| SYN-05 | Each device must show the sync state of each paired device: last sync, changes that wait, route (LAN, Tailscale, community relay) and errors. | P1 |
| SYN-06 | Setup and Settings must say: "Across networks, your devices use community Syncthing discovery and relay servers. They see your IP address, your device ids and the traffic volume, not your data." A switch selects "LAN and Tailscale only" (decision D18). | P1 |
| SYN-07 | The phone app must run the engine in a foreground service with a permanent notification while sync is on. It restarts the engine each time the app opens. It warns when the battery mode of the app is "Restricted". | P1 |
| SYN-12 | AW must use 3 sync folders: tasks (all devices), knowledge (all devices) and secure (credentials and test server configuration, local and remote only). The phone gets large artifacts only on request, with a setting for mobile data. | P1 |
| SYN-08 | When 2 devices changed the same shared file since the last sync, the version of the higher-priority device wins (local > remote > mobile). The engine keeps at least 10 conflict copies per file, so it never drops an edit silently. AW finds the author of each copy from a journal of its own writes. It removes the copy and shows no copy. Undo restores the other version (KB-13). | P1 |
| SYN-09 | Each feature that a missing device, network or push path blocks must show the reason and the fix (table 8.5.1). A failure is never silent. | P1 |
| SYN-10 | The sync transport must be a plugin with one interface. P1: Syncthing. P2: your storage and your relay. P3: Google Drive. The file layout stays the same. | P1 |
| SYN-11 | Before an agent implements on a device, the knowledge and secure folders must be complete on that device. Until then, the task shows "Waiting for sync: knowledge 92 %". | P1 |

#### 8.5.1 What each feature needs in phase 1
| Feature | Needs | When it is missing, AW shows |
|---|---|---|
| Agents, sessions, continuity, gates, knowledge with history, test slots, `aw` CLI | The main device only | — |
| Work while the laptop is closed | A remote device that is on | "Paused: MacBook Pro is asleep" and "Add a remote device" |
| Sync between 2 devices | Both online at the same time, and a route: LAN, Tailscale or a community relay | "Not synced · ubuntu-01 not reachable · last synced 22:04" |
| Phone updates while the laptop is closed | A remote device that is on | "MacBook Pro is asleep · data from 23:02" |
| Live terminal of a session on another device | The same LAN or Tailscale | "The live terminal needs the same network or Tailscale. Showing the output from 14:20." |
| Push while the phone app is closed | A push path | "Alerts arrive only while the app is open. Set up push." |
| Sync on the phone in the background | Battery mode not "Restricted" | "Sync stops in the background. Change the battery mode of AW." |
| A second copy of the data | A second paired computer | "No backup · a lost laptop loses the workspace · Add a remote device" |

### 8.6 Devices and remote control
| ID | Requirement | Phase |
|---|---|---|
| DEV-16 | A person must have one main device (role local, the first install), 0 or more remote devices and phones. Local and remote devices create tasks and implement. A phone creates tasks and does not implement. No device is the only writer. | P1 |
| DEV-01, DEV-02 | The user must pair a device with a QR code or a one-time code, a code check and an approval. The code holds the device key, the sync device id, the addresses and a one-time secret. Pairing also sets up the sync. During pairing and while the phone app is open, devices retry a connection every 5 s. | P1 |
| DEV-03 | Each device must show its role, its status with a cause, its tools, its test slots, its sessions and its sync state. A device is online only when its AW heartbeat is fresh. The connection state of the sync engine does not count. | P1 |
| DEV-04 | The user must revoke a device. The confirmation names the sessions that stop. All other devices remove it from the sync. | P1 |
| DEV-05 | A project must have an ordered list of implementing devices, each with a checkout path, for example ubuntu-01, then MacBook Pro. A device is offline after 90 s with no heartbeat. Its tasks wait, also the queued tasks: AW moves no task by itself. The human can assign a task to another device, which continues from the last pushed step. | P1 |
| DEV-06 | The user must set the number of test slots per resource and device. An agent acquires a slot before it tests and releases it after. | P1 |
| DEV-09 | One install command must install awd, the session host and the sync engine. On a remote device, `aw pair <code>` then reads the code from the desktop app. | P1 |
| DEV-10, DEV-11 | The setup check (`aw doctor`) must check the service, the session host, the Claude login, disk, clock, the sync engine and the reach of each device. On macOS it also checks sleep, power restart and FileVault. Each failure shows a fix. | P1 |
| DEV-13, DEV-15 | When no remote device exists, AW must show an offer that the user can dismiss: "Add a remote device: agents keep working while this laptop is closed." A remote device joins with its own agents and test slots. | P1 |
| RMT-01 | The phone app and the desktop app must be remote controls. The phone runs no agents. Closing an app stops no work. | P1 |
| RMT-02 | The phone app must do each phase 1 human action. Screens: Inbox, all phase 1 gates, push, task list, new task, new session, queue order. Also: device health, sync state, "Sync now", the terminal view with free text input, add or replace a credential. Also: knowledge history with Undo, "Approve device" and "Revoke device". | P1 |
| RMT-04 | The desktop app must be the window of awd on the same computer. The Electron main process talks only to the local awd, over a Unix socket, never a network port. awd connects to other devices. The app shows the work of all paired devices and gives full terminal takeover. | P1 |
| RMT-09 | Both apps must use Material components: the desktop app uses React with MUI, and the Android app uses Material 3. The desktop app follows `design.md`: a dense, quiet Mac look with one accent, bundled fonts and a native macOS window, in the layout of the prototype. | P1 |
| RMT-10 | The Android app must have one responsive layout for phones, foldables (folded, unfolded, tabletop) and Samsung DeX windows. The width of the window selects the layout, not the device. A narrow window shows one pane and a bottom bar. A wide window shows a side rail, and the list and the detail side by side, for example the Inbox and the open gate. A fold, an unfold or a window resize keeps the open item and the typed text. Each screen works with a mouse and a keyboard: hover, right-click menus, shortcuts and a visible focus. | P1 |
| RMT-11 | The desktop app must work from a narrow window (400 px) to a wide screen. In a narrow window, the detail replaces the list. In a wider window, the list and the detail show side by side, and the person can drag the divider. On a wide screen, a third pane shows the thread or the terminal. | P1 |
| RMT-05, RMT-06 | Each screen must show the age of the data per device, for example "ubuntu-01 · synced 10 s ago". An action goes at once to the device's own log and shows "Not synced" until the owner device has it. | P1 |
| RMT-07, RMT-08 | No device may need an open port on the internet or a fixed address. The live terminal of a session on another device must use a direct connection on the LAN or Tailscale. P2 adds your relay. | P1 |

### 8.7 Inbox and notifications
| ID | Requirement | Phase |
|---|---|---|
| INB-01 | The Inbox must collect all items that need the human. P1: gates, pauses that need the human, the daily digest, schema errors, credentials to rotate and sync problems. P2: shares, connection requests, signals, stopped sources. | P1 / P2 |
| INB-02 to INB-04 | Each item must name the reason, for example "Confirm approach". The user acts on it inside the Inbox, marks it as done or snoozes it. It comes back on new activity. | P1 |
| INB-05 | The phone gets a push only when the human must act, when work finished, or when work stopped and cannot continue alone. | P1 |
| INB-07 to INB-09 | The notification center must have the tabs All, Unread and Errors. AW groups items with the same cause, for example one usage-limit item per login. After an absence, Home must show a summary, for example "While you were away: 6 tasks done, 1 needs you, agents learned 5 things". | P1 |
| INB-10 | Push is required in phase 1. The owner device of a gate sends a standard Web Push (VAPID keys, encrypted content) through the UnifiedPush embedded FCM distributor, with no AW server. Fallback: the person's own ntfy server. A spike comes before the phone release. | P1 |
| INB-11, INB-12 | Without a push path, the phone gets alerts only while the app is open, and Settings say so. The push must hold an encrypted preview: the task key, the gate and one line. The phone then syncs and shows the full gate card. | P1 |
| INB-13 | Each gate must have a push, timeout or reminder rule. The gate table in `workflow.md` section 3 has the rule of each gate. "Approve command" waits 120 s, then denies, and a late "Allow" approves that request id once. Most other gates have no timeout (principle 4) and a reminder push after 1 h and 24 h. A test slot lease expires 30 min after the last session heartbeat. | P1 |
| INB-14 | On macOS, the desktop app must show a native notification for each gate and for finished work. A question has one action per option, and Reply has an inline reply. "Approve command" has "Allow once" only when the full command fits in the notification. Confirm approach and Approve result have no action, because the human must read the text. A click opens the task in every case. | P1 |
| INB-15 | The desktop app must run as a login item with a menu bar icon that shows the count of items that need you. Notifications arrive while the window is closed, and closing the window stops no work. Notifications and the login item need a signed and notarized app. They cannot break through a Focus mode. | P1 |

### 8.8 Knowledge (principle 3)
| ID | Requirement | Phase |
|---|---|---|
| KB-01, KB-02 | Knowledge must have 2 scopes: shared (workspace) and project. The user can move a file between them. An agent must load the project knowledge, the shared knowledge and the rules at each session start, resume and context compaction. | P1 |
| KB-03, KB-04 | Each file must have an apply mode (Always, Auto, Files or Manual). It shows its source, its author, the tasks that used it and the last validation time. | P1 |
| KB-05 | At the end of each task, the agent must write what it learned to the project knowledge, or record "Nothing new" (decision D3). Each learned item goes to its own new file. | P1 |
| KB-07, KB-08 | Each device must keep a full copy of the knowledge. An edit on any device, by a human or an agent, becomes a change with its author. When 2 devices changed the same file, the higher-priority version wins, and Undo restores the other version (decision D17). | P1 |
| KB-09 | A project must show the effective context of its agents with a size budget. AW never drops a file without a warning. | P1 |
| KB-11 | An agent change to a rule, a locked file or shared knowledge must wait for "Approve knowledge change". In P2, knowledge from signals waits too. | P1 / P2 |
| KB-12 | AW must create one daily digest, for example "Agents learned 4 things", with Undo per entry. It sends no push by default. | P1 |
| KB-13 | Each computer must keep the full knowledge history outside the AW folder, with no `.git` folder in a synced folder (decision D16). The history holds the changes from other devices and the device's own edits: AW copies a file before it writes it. The user undoes any change from the desktop and the phone. | P1 |
| KB-15 | A new computer must get all knowledge and history from a paired computer at pairing (P1). Restore from your storage with the recovery phrase comes in P2. | P1 / P2 |
| KB-16, KB-17 | Agents must get knowledge from links: GitHub (P1), Google Drive and Linear (P2). The task shows the linked items that the agent read. The AW skill must tell the agent to search the knowledge first. Each question card has "Already in knowledge" with a link to the file. | P1 / P2 |
| KB-10 | Knowledge storage must be a plugin. Files is the default. Vector and graph storage come in P3. | P1 / P3 |

### 8.9 Rules, skill, CLI and plugins
| ID | Requirement | Phase |
|---|---|---|
| RUL-01 | Rules must exist at 3 levels: workspace, project and user. A higher level wins. The workspace owner can lock a rule. | P1 |
| RUL-03 to RUL-05 | The AW skill, the `aw` CLI and the MCP server must give the rules, the task, the thread and the knowledge to the agent. The agent uses the CLI or the MCP tools for questions, approaches, results, artifacts, test slots and learned knowledge. Command rules allow or deny a command before AW opens "Approve command" (RUL-05). | P1 |
| PLG-03 | Plugin types: agent, session host, sync transport, knowledge storage, link. P1 ships them built in, with tmux and Orca as session hosts. | P1 |
| MCP-01 | awd must give agents an MCP server with the Streamable HTTP transport. Its tools match the `aw` primitives: thread, ask, approach, ready, task create (with fields copied from the parent), message, gate, stage, slot acquire and release, artifact add, result, handoff, learn, done. `workflow.md` section 8 is the single list. Read-only resources give the task fields and the knowledge list. | P1 |
| MCP-02 | The MCP server must listen on 127.0.0.1 only. Each session gets its own token, which acts only on that session and its task. The AW plugin registers the server for Claude Code. | P1 |
| MCP-03 | The `aw` CLI must stay for hooks, scripts and agents without MCP. A tool and the CLI command give the same result, because both call the same awd code. Gates and answers never depend on MCP. When the MCP tools are missing, the skill tells the agent to use the CLI. | P1 |
| MCP-04 | Devices must show the MCP state of each computer, for example "MCP: on · 3 session tokens active · last call 12 s ago". | P1 |

### 8.10 Phase 2
| ID | Requirement | Phase |
|---|---|---|
| STO-01 to STO-06, KB-14 | Each person can connect their own Cloudflare R2 bucket or another S3-compatible bucket, with encrypted data only and a cap (default 8 GB). Devices that are not online together sync through your storage within 2 minutes. AW makes an encrypted off-site backup. An artifact share link expires (default 1 h). | P2 |
| RLY-01 to RLY-09, CNT-28 | Each person can run their own optional iroh relay. It forwards end-to-end encrypted data and stores no user content. Device health shows the relay state. A terminal stream uses a direct path when it can. "Stay connected" keeps the phone connected. The relay can send an opt-in offline alert (D4). | P2 |
| AGT-13, AGT-15, AGT-16 | Structured mode (Agent SDK) with the user's own API key only, never a plan. Cost per task and per agent, with a budget. | P2 |
| WS-03, TSK-13 | A workspace holds members: Owner, Member or Guest. A Guest sees only the selected projects. Comments support `@` mentions. | P2 |
| PPL-01 to PPL-03, PPL-12, PPL-14 | The user connects with other AW users by a one-time invite and a safety code. A share has View, Comment or Edit and uses a peer link with scoped access. An unreachable side shows "Paused: Person B is not reachable". | P2 |
| PPL-04, PPL-08 to PPL-11 | On a plan agent, only the credential owner starts sessions, sends input, takes over the terminal and answers gates. Other People create tasks and comment. API-key input is off by default. Each session header names the credential owner. | P2 |
| PPL-05 to PPL-07 | Send to a person, GitHub, Linear, Google Drive, a Markdown file, Mattermost or WhatsApp, with a preview. A send to Linear uses the description template (TSK-23). AW records each send. | P2 |
| SIG-01 to SIG-11 | Sources collect messages from Mattermost, WhatsApp, GitHub and Linear. Subscriptions read them in batches and create signals with reasoning, citations and suggested actions. | P2 |
| RMT-03, INB-06, PLG-01, PLG-02 | The phone does each P2 human action and shows an ongoing notification per task. A plugin marketplace shows the permissions of each plugin. | P2 |

### 8.11 Phase 3
| ID | Requirement | Phase |
|---|---|---|
| P3-01 | Vault: agents request secrets with the gate "Grant secret": once, for the task, or deny. | P3 |
| P3-02 to P3-04 | Schedules create tasks at set times (decision D2). Meetings give a local transcript and action items. Canvas: the human and the agent edit a doc, a sheet or a design. Agent changes wait until the human applies them. | P3 |
| P3-05 to P3-07 | More agents (Codex, opencode, pi), more sources (Slack, email), Claude Code background sessions as a session host. | P3 |
| P3-08, PPL-01b | Google Drive as a sync transport. Handles on the person's own relay, with no central directory (decision D13). | P3 |

## 9. Non-functional requirements
| ID | Requirement |
|---|---|
| NFR-01 | Privacy: task data, code and knowledge stay on the person's own devices. The sync engine encrypts all traffic between devices. Community servers see IP addresses, device ids and traffic volume, never content. |
| NFR-02 | Offline: each device works alone. Agents continue and gates wait. Actions wait in the device log and sync later. A lost device loses only the changes that no other device has. |
| NFR-03 | Latency: a gate is in the Inbox of the owner device within 5 s. The push reaches the phone within 10 s (target; spike S1 confirms it). A change reaches an online device within 10 s on the LAN or Tailscale (measured: about 2.3 s median). |
| NFR-04, NFR-07 | Cost and openness: AW itself costs 0 USD per person. The apps, awd and the plugins are open source, and the files use published schemas. |
| NFR-05 | Accessibility: WCAG 2.2 AA for the desktop app, with keyboard use and a non-drag alternative. |
| NFR-06 | Security: device keys stay on the device. A revoke takes effect within 10 s on online devices. No secret goes into a synced file in clear text. Text from a task, for example the first message, never goes into a shell command line. The MCP server accepts only loopback requests with a valid session token. |
| NFR-08 | Platforms: macOS and Linux for the main device and remote devices. Android 10 or later for the phone, with the same app on foldables, tablets and Samsung DeX, in any orientation and window size (RMT-10). macOS first for the desktop app, in any window size (RMT-11). |
| NFR-09, NFR-12 | Continuity: an awd restart or update stops 0 sessions. awd restarts within 10 s after a crash. AW resumes sessions within 2 minutes after awd starts. Freshness (NFR-12): with no fresh evidence for 2 minutes, AW shows "No recent update", never "Working" (CNT-19). |
| NFR-13 | Vendor terms: AW never modifies, bundles or wraps Claude Code and never hides one of its sign-in methods. AW names never contain "Claude Code". |

## 10. Release plan
The phases are accepted (`decisions/2026-11-22-phases.md`).

### Phase 1 (now): all P1 requirements
In:
- **Work:** workspaces, projects with GitHub links, tasks with first message, approach, test server and credentials, board, list, Inbox, the task loop with gates.
- **Agents:** Claude Code in terminal mode with the user's own `claude`, in tmux (default) or in Orca where the person turned it on, the agent queue, safe delivery of answers, one session per task.
- **Agent interface:** the `aw` CLI and the MCP server (Streamable HTTP) with the same primitives.
- **Continuity:** resume after a reboot, a crash or an update, usage limits, login checks, Paused with a cause.
- **Knowledge, test slots, rules, the `aw` CLI and the skill.**
- **Devices:** the main device, optional remote devices, an Android phone, pairing that sets up the sync.
- **Data:** YAML and JSON Lines files with schemas, the local index, schema errors in the Inbox.
- **Sync:** built-in Syncthing with 3 folders, "Sync now", sync before sleep, sync before implement, sync state, the priority rule for shared files.
- **Push:** Web Push from the owner device through UnifiedPush (embedded FCM distributor) or the person's own ntfy server.
- **Apps:** the desktop app (macOS first, React with MUI, native notifications, menu bar icon, login item) and the Android app (Material 3) with each phase 1 human action (RMT-02). Both apps have one responsive layout: phones, foldables and Samsung DeX on Android, and narrow to wide windows on the desktop (RMT-10, RMT-11).

Out:
- The relay. A live terminal on another device works only on the LAN or Tailscale.
- Your storage (R2): no off-site backup, no sync between devices that are not online together, no artifact links.
- People, members, sharing, Send, sources, subscriptions, signals, Google Drive and Linear links.
- The marketplace, structured mode, cost per agent, the offline alert, "Stay connected".
- Everything in phase 3 (section 8.11), iOS and agents other than Claude Code.

Phase 1 uses the final data model, module boundaries and interfaces: the sync transport, the agent adapter, the session host and the knowledge store. Phase 2 (section 8.10) adds implementations behind them and does not rewrite phase 1. `phase-1.md` and `architecture.md` show the structure.

## 11. Risks
| Risk | Effect | Mitigation |
|---|---|---|
| Anthropic's consumer terms forbid access "through automated or non-human means". AW starts queued tasks and resumes sessions on a plan. | Anthropic could limit this use. | Decision D5. Use interactive Claude Code and its automatic continue. Keep CNT-13, CNT-18 and 2 sessions per agent. Recommend an API key for heavy 24/7 work. |
| One agent that works day and night uses more than a Pro or Max plan gives. A login has a fixed end date. | Work pauses for hours or days. | Resume at the reset time. Show usage and a projection. Check the login every hour and push 3 days before. |
| Unattended resume fails: a dialog, the 30-day transcript cleanup, lost launch settings. | A session does not continue after a reboot. | Trust the worktree before the start. Keep transcript copies. Store the launch settings. Then a handoff, then "Take over terminal". |
| The agent asks in the terminal, or an answer arrives while a dialog is open. | The session waits with no gate, or the answer selects a wrong option. | Terminal questions become gates (TSK-25). Safe delivery with a confirmed delivery id (AGT-17). |
| Two devices run a session for the same task after a move. | Two sessions push to the same branch. | A claim with an epoch (AGT-03). The laptop keeps its unpushed work as a branch (CNT-27). |
| A laptop-only user loses the laptop, or the phone cannot sync while the laptop sleeps. | The workspace is lost, or the phone shows old data. | Say so plainly (table 8.5.1, journey 7.4). Offer "Add a remote device". P2 adds R2. |
| A human and an agent edit the same knowledge file on 2 devices. | One edit is replaced. | The higher-priority version wins. Undo restores the other version. Agents write each learned item to a new file (D17, KB-08). |
| Android stops background work: Doze, standby buckets and the battery mode "Restricted". | The phone shows old data. | A foreground service with a permanent notification (in the test, a file arrived in 3.1 s in deep Doze). A warning for "Restricted" mode, which stopped sync in the test. An engine restart at each app open. |
| Google Play rejects the always-on foreground service or the bundled engine. | No Play release. | Spike S4 with Play internal testing. Releases on F-Droid and GitHub. |
| Volunteers run the Syncthing community discovery and relay servers. They see device ids, IP addresses and encrypted traffic. They can be slow or down. | Slow sync on other networks. | Say so at setup (SYN-06). "LAN and Tailscale only" switch. P2 adds your own relay. |
| Google documents Web Push with VAPID to FCM badly. Push was not tested on the emulator. | Pushes in the official build stop. | Spike before the phone release. The person's own ntfy server is the fallback (D12). |
| Claude Code changes its CLI, hooks or terms. | Sessions stop working. | Agent adapter. Version gates. Contract tests per version. |
| awd is down when a session starts. Claude Code then marks the MCP server failed and does not retry. | The agent has no AW tools. | The launcher checks awd before it starts `claude`. The skill falls back to the `aw` CLI. Gates and answers use hooks, not MCP. |
| Orca changes its CLI. A restart of Orca with a running session is not verified. | Sessions in Orca stop. | Orca stays optional, with a minimum version. Phase 1 tests restart, a multi-line answer and the dialogs on macOS and Linux. tmux stays the default. |
| An unsigned desktop build shows no notifications and cannot be a login item. | People miss gates on the Mac. | Sign and notarize each release and each build that tests notifications. The phone push stays the main alert. |
| No emulator runs Samsung DeX, and foldables differ by model. | A layout fault shows only on a real device. | Use the standard Android window size classes, with no device-specific code. Test on the foldable and desktop-window emulators. Check a real Galaxy foldable and DeX before each release. |

## 12. Open questions
1. Must a weekly-limit pause send one push? It ends alone, but the work can stop for days.
2. Must AW hold pushes that are not urgent during quiet hours?
3. How long do devices keep finished transcripts and old knowledge versions?
4. Does the phone get all workspaces, or only the workspaces that the user selects?
5. How does AW compact large logs with no coordinator?

## 13. Decisions for the owner
This is the master list. `architecture.md` and `feasibility.md` use the same D-numbers; `architecture.md` also gives D19 to D21 as ADR-21, ADR-19 and ADR-20.

| ID | Decision | Recommendation |
|---|---|---|
| D1 | Release phases 1, 2 and 3 (section 10). | Accepted (`decisions/2026-11-22-phases.md`). |
| D2 | Schedules are in phase 3. A simple "Repeat this task" rule could come in phase 2. | Open. |
| D3 | Agents write learned knowledge directly, with history and Undo. Rules, locked files and shared knowledge still need approval. | Accept. One daily digest, no push by default. |
| D4 | Opt-in offline alert in your own relay. The relay keeps the last-seen time and the push subscription. | Phase 2, off by default. |
| D5 | AW starts queued tasks and resumes sessions on a plan with no human typing. | Accept with CNT-12, CNT-13, CNT-15, CNT-16, CNT-18 and the API-key advice. |
| D6 | Timeout of the "Approve command" gate. | Accepted: 120 s, then deny. A late "Allow" becomes a one-time approval for that request id (task-model §5.6). |
| D7 | Allow `claude setup-token` for a headless Mac mini. AW never reads the token. | Allow as an advanced option. |
| D8 | On a plan agent, only the credential owner drives the sessions. | Accept (phase 2, when People exist). |
| D9 | Platforms. | Main device: macOS or Linux. Remote device: Linux first, macOS with the setup check. |
| D10 | At each stop of a laptop session, AW pushes the work branch `aw/<task-key>` to the project remote. A move by the human ("Assign to another device…") continues from it. | Accept. On by default for laptops. Work that was not pushed before a move: CNT-27 (task-model §5.5). |
| D11 | The master key lives only in the desktop app on the main device, on the phone and in the recovery phrase. It signs the device list. | Accept. It is never in a synced file or on a remote device. |
| D12 | Push: the owner device sends Web Push (VAPID, RFC 8291) through UnifiedPush with the embedded FCM distributor in the official app. Fallback: the person's own ntfy server. | Accepted: required in phase 1, after a spike on a real phone (task-model §5.4). |
| D13 | Handles resolve on the person's own relay. No central directory. | Accept. Phase 3. |
| D14 | AW includes the Syncthing engine in awd and in the Android app and controls it. The Android build follows `researchxxl/syncthing-android`, the maintained fork since the official app was archived in Dec 2024. | Accept. No separate Syncthing app. On Android, a foreground service with a permanent notification, not short sync bursts: it was verified in deep Doze, and bursts depend on push, which is not verified yet. |
| D15 | Task keys without a coordinator. | Accepted (device-sync decision rule 7): the next free number, priority on a collision. |
| D16 | Knowledge history without `.git` in a synced folder. | Each computer keeps the old versions outside the AW folder: the engine's file versions for changes from other devices, and AW's own copy before each local write. An optional git export lives outside the AW folder too. |
| D17 | Knowledge edits on 2 devices. | Accepted (device-sync decision rule 6): the higher-priority version wins, and Undo restores the other version. |
| D18 | Syncthing community discovery and relays. | On by default, said plainly at setup. A switch turns them off for LAN and Tailscale only. |
| D19 | Session hosts in phase 1. | Accepted (owner, 2026-11-22): tmux by default and Orca when installed and turned on for the device, both tested. Orca stays a plugin (`decisions/2026-11-22-modules.md`). |
| D20 | Agent interface. | Accepted (owner, 2026-11-22): an MCP server with Streamable HTTP next to the `aw` CLI, with the same awd code behind both. |
| D21 | Desktop app UI and alerts. | Accepted (owner, 2026-11-22): React with MUI, a Unix socket to awd, macOS notifications, a menu bar icon and a login item. |
| D22 | The local API uses the fastify library, not own routing code. | Proposed: accept. Less own code, and the same schemas check each request (`tech-stack.md` 2.2). |
| D23 | Redux Toolkit is not in phase 1. | Proposed: accept. TanStack Query holds the awd data and the route holds the selection. A store adds a second pattern for little state. Add Redux Toolkit when 3 or more screens share client-only state. |
| D24 | Desktop routes use react-router, the router of our other projects, not TanStack Router. | Proposed: accept (`engineering-rules.md` 4.10). TanStack Router has typed search parameters. With react-router, one small zod hook does the same check. |
| D25 | The library exceptions in `engineering-rules.md` 12: old or 0.x releases and small user bases. | Proposed: approve each row with its review date. |
| D26 | Two panes on an unfolded foldable in portrait (medium width) use an experimental Android API. | Proposed: use it when spike S14 passes. Else 1 pane at that width until the API is stable. |
| D27 | Languages of the apps. | Proposed: English only in phase 1. Keep the UI text in Android string resources and in one text module of the desktop app, so a translation needs no code change. Select a translation library then. |

The owner's answers to the questions Q1–Q5 of the verification are in `decisions/2026-11-22-task-model.md` §5.

## 14. Changes in v0.9 to v0.13
| Version | Change |
|---|---|
| v0.13 | Manual move (`decisions/2026-11-23-manual-move.md`): AW never changes the agent or the device of a task. Removed: the gate "Continue on another device", the move of queued tasks after 10 min offline, the "Close laptop" flow. A paused task offers "Assign to another device…"; the desktop button is "Sync" (AGT-06, AGT-07, DEV-05, SYN-04, journey 7.4, D10). |
| v0.12 | Section 13 lists 6 new decisions for the owner (D22 to D27): libraries, the router, the library exceptions, two panes at medium width and the languages. |
| v0.11 | Screen sizes: one responsive layout for the Android app on phones, foldables and Samsung DeX, with a mouse and a keyboard (RMT-10), and a desktop layout from a narrow window to a wide screen (RMT-11). NFR-08, the release plan and a new risk (no DeX emulator) name them. |
| v0.10 | Agent interface: an MCP server with Streamable HTTP next to the `aw` CLI (MCP-01 to MCP-04, TSK-21, RUL-03, D20). |
| v0.10 | Session hosts: tmux (default) and Orca when turned on per device, both tested in phase 1, with a "Session host" choice (AGT-04, AGT-10, AGT-19, D19). |
| v0.10 | Desktop app: a Unix socket to awd (RMT-04), React with MUI and Material Design on both apps (RMT-09), macOS notifications with actions, a menu bar icon and a login item (INB-14, INB-15, D21). Journeys 7.1 and 7.3 show them. |
| v0.10 | New concept "Session host", the MCP rule in NFR-06, and 3 new risks (MCP server down at start, Orca changes, unsigned builds). |
| v0.9 | Task model and sessions (decision task-model): first message, approach, test server, credentials, the description as a view, the thread word for word (principle 8), new TSK-22 to TSK-28 and goal G15. Terminal questions become gates, with the new gate "Reply". "Start implementing" only after `aw ready` on the implementing device (TSK-20). Remote agents create tasks (DEV-16). AW never assigns a task alone (TSK-26), and subtasks start at Ready (TSK-27). One session per task with a claim and an epoch (AGT-03), safe delivery (AGT-17), a launcher with no hidden dialog (AGT-18). "Approve command" waits 120 s, not 24 h, with a request id (CNT-20, CNT-21, D6). One gate table with a rule for each gate (INB-13). |
| v0.9 | Data and sync: task folders by internal id (DAT-01), credential redaction (DAT-09), 3 sync folders (SYN-12), settings before the first engine start (SYN-02), a scan after each write and before "Sync now", a write journal for conflict copies (SYN-08), presence by heartbeat (DEV-03), Undo of the device's own edits (KB-13, D16). Phone: a foreground service with a permanent notification, a "Restricted" battery warning and an engine restart at each app open (SYN-07, D14). Push is required with a spike first. Free text and write-only credentials. |
| v0.9 | Removed: the gate "Approve plan", open questions 6 and 7 (now task-model §5.5 and §5.4), the list of proposed defaults (now task-model §5), the repeated phase 2 and 3 list, and the separate journey "Answer a gate from the phone" (now in journey 7.3). Several rows are merged with their IDs kept. |
