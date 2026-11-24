# Agent Workspace — Architecture

| Item | Value |
|---|---|
| Document | Target architecture for all phases (arc42, short form) |
| Version | 0.8 (libraries for the local API, the MCP server, the clients and the logs; adaptive layouts; 2026-11-22) |
| Readers | System architects, maintainers, contributors |
| Source of truth | `principles.md`. When this document and the principles disagree, this document is wrong. |
| Related | `prd.md` v0.9, `workflow.md`, `phase-1.md`, `tech-stack.md`, `decisions/`, `feasibility-details.md` |

This document describes the final architecture of AW. Each building block and each interface has a phase tag: **P1** (now), **P2** or **P3** (`decisions/2026-11-22-phases.md`). P1 uses the final data model, module boundaries and interfaces. P2 and P3 add implementations behind the same interfaces. `phase-1.md` gives the exact phase 1 build.

## 1. Goals and constraints
### 1.1 Quality goals
| Priority | Quality | Scenario | Measure | Phase |
|---|---|---|---|---|
| 1 | Continuity | The laptop is closed for 24 h. ubuntu-01 is on. | Tasks on ubuntu-01 continue. Gates reach the phone. | P1 |
| 1 | Continuity | `kill -9` stops awd, or ubuntu-01 reboots, during a session. | awd runs again within 10 s. No hook event is lost. AW resumes each interrupted session within 2 min. | P1 |
| 1 | Continuity | The 5-hour usage limit stops the agent. | "Paused: usage limit. Resumes at 15:45." No push. Work continues within 5 min after the reset. | P1 |
| 1 | Agreement | 3 devices work for 7 days with sleep, restarts and network loss. | 0 lost changes. Each device shows the same board after sync. | P1 |
| 2 | Ownership | The person has no cloud account. | The task loop works on the person's own devices (`prd.md` 8.5.1). | P1 |
| 2 | Remote management | The phone and ubuntu-01 are online. The human answers a gate on the phone. | The agent gets the answer within 30 s through sync (P1, spike S2), within 5 s on the live channel (P2). | P1, P2 |
| 3 | Knowledge durability | An agent writes a wrong fact. Later a disk fails. | Each change has history and Undo. Other computers keep full copies (P1). R2 keeps an encrypted off-site backup (P2). | P1, P2 |
| 4 | Privacy | An operator of a community relay, FCM, R2 or an iroh relay reads a full capture. | No task text, code or knowledge text. Only ids, addresses, sizes and timing. | P1 |
| 5 | Replaceability | A contributor adds a sync transport, an agent runtime or a session host. | 1 plugin package. The core and the file layout do not change. | P1 |

### 1.2 Constraints
1. No device is the only writer. Each device writes only its own files (4.3).
2. No device needs an open port on the internet or a fixed address.
3. Agents run on the user's devices with the user's own, unmodified agent installation. AW never reads, stores or forwards agent credentials. Structured mode (P2) uses only the user's own API key.
4. The project is open source (MIT). It runs no service that keeps user data: only the release feed, the website and the plugin registry.
5. AW controls its own sync engine. It never depends on a sync app that the user installs.
6. A feature that a missing device, network or push path blocks shows the reason and the fix (`prd.md` 8.5.1).
7. Platforms: macOS and Linux for awd, macOS first for the desktop app, Android 10 or later for the phone.

## 2. Context
### 2.1 Context diagram
```
 GitHub (code, issues) ◄─ git, API ─┐                 Anthropic ◄─ the user's own claude
┌─ PERSON A ────────────────────────┼──────────────────────────────────────────────────┐
│ MacBook Pro · local, main   ◄── file sync (P1: Syncthing) ──►   ubuntu-01 · remote   │
│ awd, engine, tmux,              full mesh: LAN, Tailscale       24/7, optional:      │
│ desktop app                     or community relay              awd, engine, tmux    │
│       ▲                                                                    ▲         │
│       └── file sync ──►  Pixel 9 · mobile: app + own engine  ◄── file sync ┘         │
│                          ▲ Web Push (FCM or ntfy) from the owner device              │
│ P2: own R2 bucket (backup, artifacts, store and forward) · own iroh relay (live)     │
└───────────────────────────────────────────┬──────────────────────────────────────────┘
                                            │ P2: peer link over iroh, scoped shares
                  PERSON B: the same set of parts, owned by person B
```
| External system | Role | Phase |
|---|---|---|
| Claude Code | The user's own installation in a session host. Talks to AW through the AW MCP server, the `aw` CLI and hooks. | P1 |
| GitHub | Code host and link source. Code never goes through AW sync. | P1 |
| Syncthing community servers | Global discovery and relays. They see device ids, IP addresses and traffic volume, not content. The user can turn them off. | P1 |
| Push service | FCM through the UnifiedPush embedded FCM distributor, or the person's own ntfy server. Sees only ciphertext. | P1 |
| Other People, platforms | People with their own AW. Mattermost, WhatsApp, Linear, Google Drive as sources and Send targets. | P2 |

### 2.2 Device roles
`decisions/2026-11-22-device-sync.md` is the record.

| Role | Example | Creates tasks | Runs agents | Notes |
|---|---|---|---|---|
| local | MacBook Pro | Yes | Yes | The main device. AW works with this device only. Exactly 1 per person. |
| remote | ubuntu-01, mac-mini-lab | Yes | Yes, the default | 0 or more. A second laptop is a remote device. |
| mobile | Pixel 9 | Yes | No | A remote control with its own copy of the files. |

1. Each project has an ordered list of devices that run agents, for example ubuntu-01, then MacBook Pro. With no remote device, the local device runs the agents.
2. A device is offline after 90 s with no heartbeat (4.4). Its tasks wait: a running task shows "Paused: ubuntu-01 offline", and queued tasks stay. AW never changes the agent or the device of a task by itself. The human can select "Assign to another device…" (`decisions/2026-11-23-manual-move.md`).
3. For shared files, the priority is local > remote > mobile, then the order in the device list (4.3.2).

## 3. Building blocks
### 3.1 Containers
| Container | Runs on | Responsibility | Phase |
|---|---|---|---|
| awd | Each computer (local and remote) | The product core: files, index, sessions, queue, continuity, knowledge, test slots, push sender, MCP server for agents (6.4). It supervises the sync engine. | P1 |
| `aw` CLI, skill, plugin directory | Each computer | Interface for hooks, scripts and agents with no MCP. Talks to the local awd only. The plugin registers the MCP server. | P1 |
| Session host | Each computer | `host-tmux` (default): tmux in its own service unit `aw-sessions`. `host-orca` (optional, per device) and a direct PTY. P1 ships and tests tmux and Orca. | P1 |
| Sync engine | Each device | Syncthing. awd or the phone app starts, configures and watches it (4.4). | P1 |
| Desktop app | Local device, macOS first | The window of the local awd: Electron main process on the awd socket, React + MUI renderer with one layout from a narrow window to a wide screen. Native notifications, menu bar, login item. Full terminal takeover. Sleep hooks. | P1 |
| Android app | Phone | Remote control: own files, own index, own log files, own engine, push receiver. One adaptive layout for phones, foldables and Samsung DeX windows. | P1 |
| R2 bucket | The person's Cloudflare account | Encrypted backup, artifacts, store and forward. | P2 |
| iroh relay | The person's VPS (Docker), optional | Fallback path for live channels and peer links. Stores nothing. | P2 |

### 3.2 awd modules
```
awd
├── api         fastify HTTP + WebSocket on a Unix socket: aw CLI, hooks, desktop app      P1
├── mcp         MCP server, Streamable HTTP on 127.0.0.1, per-session token: agents (6.4) P1
├── files       collections, YAML documents, JSON Lines logs, atomic writes, write guard  P1
├── merge       ownership rules, HLC order, snapshots, task keys, conflict repair          P1
├── index       local SQLite index from the files; MongoDB query syntax (sift)             P1
├── sync        SyncTransport host: syncthing (P1); r2, iroh (P2); gdrive (P3)             P1
├── identity    device keys, signed device records, pairing, revoke                       P1
├── agents      sessions; adapters: claude (P1), codex, opencode, pi (P3); hosts: tmux,   P1
│               orca, pty (P1), Claude Code background sessions (P3)
├── continuity  reconcile, resume, pause states, usage windows, sign-in state, watchdog    P1
├── queue       agent queues, budget per login; slots: test-slot leases, fencing tokens   P1
├── kb          KnowledgeStore: files (P1), vector and graph (P3); history store; digest   P1
├── live        LiveChannel: direct wss on LAN and Tailscale (P1); iroh (P2)               P1
├── push        PushSender: Web Push (P1); offline alert in the own relay (P2)             P1
├── health      device health documents; update: self-update, rollback                    P1
├── plugins     loader, permissions (P1); marketplace (P2); links: GitHub (P1), Drive (P2) P1
├── backup      encrypted backup and restore through R2                                   P2
├── people      connections, peer links, shares, members; sources, signals, Send          P2
└── vault       sealed secrets and grants                                                 P3
```
`api` and `mcp` are thin adapters. Both call the same awd service functions, so an `aw` command and its MCP tool have the same effect and the same tests.

### 3.3 Processes on a computer
```
systemd user manager (linger: starts at boot, no login) · macOS laptop: LaunchAgents
├── awd.service               Restart=always
│   └── awd (Node.js)         files, index, sessions, queue, push; ~/.aw/run/awd.sock (0600); MCP on 127.0.0.1
│       └── syncthing serve   own --home; awd supervises the monitor and the worker pid
└── aw-sessions.service       own control group: a restart of awd does not touch it
    └── tmux -L aw            exit-empty off, remain-on-exit on; window aw-<task-id>: aw-launch → claude
```
1. systemd kills the whole control group of a unit on stop. awd and tmux are in different units, so an awd restart stops no session. Hooks are children of claude and work while awd is down.
2. The engine stops and starts with awd. A short stop is safe: Syncthing catches up within seconds after a restart or `kill -9` (ST10). A headless Mac uses a LaunchDaemon (4.6.1).

## 4. Key concepts
### 4.1 Identity, devices and pairing
1. The **master key** (Ed25519) is the recovery phrase: 24 BIP-39 words, the Ed25519 secret is HKDF-SHA256 of the seed. It lives on the local device (the keystore of awd; the first new workspace makes it), on the phone and in the phrase. It is never in a synced file and never on a remote device (decision D11). The user id is `u` + base32 of the first 16 bytes of SHA-256 of the master public key.
2. Each device has a **device key** (Ed25519 and X25519) in the OS keystore: the macOS Keychain, a 0600 file on headless Linux and on a headless Mac (LaunchDaemon), a key wrapped by the Android Keystore.
3. Each device has a **device record** `devices/<device>/device.yaml`: the device slug (`ubuntu-01`), the name, the role, the public keys, the sync device id, the addresses, a sequence number, `revoked`, `revoked_at` and a master-key signature (Ed25519 over the canonical JSON of the record as written). A reader accepts only a record with a valid signature and the highest sequence number. P2 adds the iroh endpoint id, which is the device key itself. The code is in `shared/identity`.
4. **Pairing** (P1): a device with the master key shows one code, as a QR code and as text. The code carries the AW identity and the sync device id. The new device joins through the sync engine. Both screens show a check code, and the human approves (`phase-1.md` 7). A new computer gets the workspace credential key, sealed to its device key (`decisions/2026-11-22-task-model.md` §4).
5. **Full mesh**: each awd adds each valid device record to its engine and shares `tasks` and `knowledge` with it, and `secure` only with computers. So ubuntu-01 and the phone sync while the laptop is closed (ST13).
6. **Revoke**: a device with the master key writes `revoked: true` with a new sequence number. Each device removes the revoked device from its engine. Online devices apply it within 10 s. The revoked device keeps the data that it already has. AW makes a new workspace credential key, seals it to each remaining computer, encrypts the credential files again and lists the credentials to rotate.

### 4.2 Data model
1. **Workspace folder**: one folder per workspace, `~/AW/<workspace>/` on a computer, app-private storage on the phone. It is never inside a code checkout, so it has no `.git` folder. It holds 3 Syncthing folders: `tasks` and `knowledge` on all devices, `secure` (test server configuration and credentials) on computers only. `phase-1.md` 3 has the folder tree, which is the same in all phases.
2. **Collection = folder. Document = YAML file. Log = JSON Lines file per device.** Each type has a JSON Schema, generated from zod, with a major version in `schemas/`.
3. **Event** (one line of a log): `{"v":1,"id":"<uuidv7>","hlc":"2026-11-22T14:20:01.123Z#0003","dev":"ubuntu-01","type":"gate.answered","by":"human@pixel-9","data":{…}}`.
4. **Order**: the hybrid logical clock (HLC), then the device slug, then the event id. Each device keeps its HLC above each HLC that it merged, so clock skew cannot put an answer before its question. The merge holds back an HLC more than 24 h ahead of the local clock (`phase-1.md` 3.6).
5. **Snapshot document**: `task.yaml` holds the state that its writer derived from the logs, with the log positions that it includes. A reader applies newer log lines on top. AW rebuilds a lost or damaged snapshot from the logs. The task fields follow `decisions/2026-11-22-task-model.md`: first message, approach with versions, test server, credential references, and the generic stages Backlog, Discuss, Ready, Implement, Review, Done with the "Needs you" lane. The description is a view that AW builds from these fields.
6. **Ids**: UUIDv7 for tasks, events, sessions and gates. Folder names use ids, never task keys (4.3.3).
7. **Index**: a local SQLite database outside the synced folder. AW rebuilds it from the files at any time and never syncs it. Queries use the MongoDB query syntax.
8. **Schema versions**: awd reads the current and the previous major version. AW keeps a file of a newer version unread and shows "Update AW on MacBook Pro to read 2 new files". A file that fails its schema does not stop AW. The index keeps the last valid version, and the Inbox shows the error.
9. **Never synced**: device keys, the index, the knowledge history store, the write journal, transcript copies, the engine database, the hook spool.

### 4.3 Ownership and merge
`decisions/2026-11-22-device-sync.md` is the record.

#### 4.3.1 Who writes what
| Data | File | Writer | Merge |
|---|---|---|---|
| Task state, gate result, thread messages | `tasks/<id>/log/<device>.jsonl`, snapshot `task.yaml` | The owner device: the device with the highest accepted `task.claimed` epoch. Before a claim: the device that created the task. | Only the state events of the owner at that point in the order count. A claim counts only from the device of the current assignee (`not_assignee_device`). |
| Assignment | `task.assigned` | A human on any device. Only with the project switch "Assign new subtasks to the default device" on: the session device of the parent. A task with no assignee opens "Assign task". | The newest HLC wins. |
| Gate answer | The log of the device that answers | Any device | The owner uses the first answer that it reads and writes `gate.resolved`. A later answer becomes a comment. |
| Comment | The log of the device | Any device | Append only. |
| Title, priority; the first message until the first session starts | `task.edited` events | Any device | The newest HLC wins, per field. |
| Move to another device | `task.assigned` to an agent on the other device | A human on any device | 4.3.4 |
| Test slot lease | The workspace log of the resource device | The device that has the resource | — |
| Shared files: `workspace.yaml`, `project.yaml`, `secure/test-servers.yaml`, knowledge | The file itself | Any device | The newer change wins. Two changes since the last sync: the priority rule (4.3.2). |
| Device record | `devices/<device>/device.yaml` | A device with the master key | The highest valid sequence number. |
| Health, heartbeats, push endpoints, checkout bindings, sealed credentials from the phone | `devices/<device>/…` | That device | — |

#### 4.3.2 Priority rule for shared files
1. Syncthing keeps the newer file and makes a copy `<name>.sync-conflict-<date>-<time>-<short id>` with the older content. The short id names the device whose version **won**, not the author of the copy (verification 2026-11-22).
2. `maxConflicts` stays at 10 or more. With 0, Syncthing deletes the older edit with no copy, so the rule cannot run.
3. The highest-priority online device resolves the copy. It finds the author of each version from the sha256 journal of its own writes and, for knowledge, from the change logs. It keeps the version of the higher-priority author, writes it and removes the copy. AW shows no conflict copy.
4. The other version goes to the history store. The history shows "Replaced by the MacBook Pro version" with Undo, so nothing is silent (principle 9). To lose less work, agents write each learned item to its own new file (4.8.3).

#### 4.3.3 Task keys
1. Each device takes the next number that it knows, for example AW-7. It needs no other device online.
2. When 2 tasks have the same key, the task from the higher-priority device keeps it. Between 2 remote devices, the device list order decides.
3. The device that created the other task writes `task.rekeyed`. The thread shows "AW-7 is now AW-9". Until then, the index shows "AW-7 · duplicate".
4. Folders and links use the task id, so nothing breaks. `aw` resolves an old key while it is unique.

#### 4.3.4 Move and repair
1. **One session per task.** A device starts or resumes a session only after it writes `task.claimed {epoch, device, session, based_on}` with an epoch above each epoch that it knows. After a wake or a reconnect, awd reads the merged logs first. A session with a lower epoch stops and shows "Moved to ubuntu-01".
2. "Move to ubuntu-01" (or "Assign to another device…" on a paused task) is a human `task.assigned` to an agent on ubuntu-01. AW never writes it by itself (`decisions/2026-11-23-manual-move.md`). The old owner sees the new assignee, stops its session, pushes the work branch (decision D10) and writes `task.released`. The new device claims the task when it reads `task.released`. Until its claim, the task shows "Moving to ubuntu-01" (`moving_to` in the merged view).
3. When the old owner is offline, the task waits until the human moves it. After the move, the new device claims the task at once and starts from the last pushed checkpoint. A claim counts only from the device of the current assignee, so the old owner cannot claim the task back. State events that the old owner wrote after the claim do not count. Its comments and artifacts still merge. When it wakes, it pushes its unpushed work as `aw/<key>-<device>-<time>` and writes a thread comment with the branch name (`comment.added`, which counts from any device; a `message.*` event of a former owner does not count); AW never drops it (task-model decision §5.5).
4. AW never deletes a task folder. It sets `archived: true`. The index accepts a log file with no `task.yaml` (ST5). A removed project (`project.removed`, `phase-1.md` 6.9) takes its tasks out of the views; their folders stay.
5. A conflict copy of a device-owned file is a fault. The owner device merges the lines by event id and removes the copy. The index reads both until then. A conflict copy of a snapshot is rebuilt from the logs. An unexpected repair creates the Inbox item "Sync problem".

### 4.4 Sync transports
| Transport | Phase | Role |
|---|---|---|
| Syncthing | P1 | File sync between the person's devices that are online at the same time. |
| R2 | P2 | Store and forward between devices that are not online together. Backup. Artifacts. |
| iroh | P2 | Live channel: terminal streams, presence, fast gate answers. Option: replication of the per-device logs, which can replace Syncthing on the phone. |
| Google Drive | P3 | Store and forward for a person with no R2 bucket. |

1. The core calls only the `SyncTransport` interface (6.1). The file layout and the ownership rules are the same for each transport. Several transports can run at the same time.
2. Each device writes only its own append-only files. So each transport stays simple: send the bytes after an offset, and send whole files by hash.
3. **Syncthing engine (P1)**: computers bundle the official signed binary. The phone app has an engine that AW CI builds from the same Syncthing source tag. awd writes `config.xml` before the first start, with discovery, relays, NAT traversal and usage reports off. After that, awd and the phone app control the engine only through its REST API (`phase-1.md` 6).
4. **Community servers**: across networks, Syncthing uses community discovery and relay servers by default. They see device ids, IP addresses and traffic volume, not the data. The switch "LAN and Tailscale only" turns them off (decision D18).
5. **Scans**: after each own write, awd calls a targeted REST scan (about 1.3 s to the other device on a LAN). "Sync now" always starts with a scan. A busy log file can lag up to 8 s.
6. **Sync before implement**: the `knowledge` and `secure` folders must be complete on a device before an agent implements there. The task shows "Waiting for sync: knowledge 92 %". The `tasks` folder is not checked, because agents write to it all the time. Terminal output never goes through file sync (4.10).
7. **Presence**: each awd writes a heartbeat event every 30 s. A device is offline for the others after 90 s with no new heartbeat. The Syncthing connection state is only a hint: a frozen laptop still showed as connected for 2 min.
8. **Reconnect interval**: 5 s during pairing and while the phone app is open, else 60 s on computers and 20 s on the phone (VS1, VM6).

### 4.5 Agents and sessions
1. **Terminal mode** (P1, works with a plan): AW starts the user's own `claude` in the session host through the fixed launcher (4.6.2). The user signs in on Anthropic's own page. Launch: `claude --session-id <uuid> -n <task-key> --plugin-dir <aw-plugin> --settings <session-settings> --permission-mode <mode> --allowedTools "Bash(aw ask *)" ... "Bash(aw thread *)" "mcp__plugin_aw_aw__*" -- "<first input>"` (one `Bash` rule per agent command, `phase-1.md` 9.1.6).
2. **Structured mode** (P2): the Agent SDK with the user's own API key and `pathToClaudeCodeExecutable` set to the user's `claude`. Never with a plan.
3. **AW plugin directory** (`plugins/agent-claude/plugin/`): `.claude-plugin/plugin.json` with `"name": "aw"`, `.mcp.json` with the server key `aw` (6.4), so the tools are `mcp__plugin_aw_aw__<tool>`. A contract test reads the manifest name and checks the allow rule in `aw-launch`. Also `skills/aw/SKILL.md`, `hooks/hooks.json` (generated per CLI version), `bin/aw`, `bin/aw-hook`, `bin/aw-statusline` (the usage windows, 4.6.6). Phase 1 has one `hooks/hooks.json` for the covered versions. The session settings file has the allow rules and the `statusLine` command. `permissions.denyInsteadOfPrompting` waits for spike S7: the 120 s hook covers the case. AW never edits the user settings or the repository `CLAUDE.md`, except the trust entry of a worktree that AW created or a folder that a person chose (4.6.2). The session settings file also holds the deny rules of the person commands, and for the session options `skipDangerousModePermissionPrompt` (skip mode) and the agent team setting (`phase-1.md` 9.1.7).
4. **First input and context**: a Discuss session gets the first message as is. A later session (a subtask, or a move) gets the first message, the confirmed approach word for word, and "Read `aw thread <key> --ancestors` before you act". A SessionStart hook (`startup`, `resume`, `compact`) returns `additionalContext` of at most 10,000 characters: the task fields, the gate state, the handoff and the knowledge list. After each compaction, the thread shows "Context compacted at 14:20". When compaction fails, AW starts a new session with a handoff.
5. **Hooks**: `aw-hook <Event>` writes one JSON file per event into the spool and exits. AW reads agent output only from hooks and the transcript, never from a terminal screen.
   - **Thread (principle 8)**: UserPromptSubmit writes each human input as raw text (the first message, typed text, delivered answers), and Stop writes each agent reply (`last_assistant_message`). No summary replaces them.
   - **Gates from the terminal**: PreToolUse turns `AskUserQuestion` into "Answer question" and `ExitPlanMode` into "Confirm approach". A turn that ends with a question opens "Reply", unless a question, approach or reply gate of the same turn is open.
   - **Other**: PermissionRequest = rule or gate, Notification = dialog open or usage state, StopFailure = pause cause, SessionEnd = transcript copy.
   - **Redaction**: each event writer replaces the credential values of the session with `[redacted:<name>]`, and its MCP token with `[redacted:mcp-token]`. The files layer does the same in each text file of a task (terminal snapshot, approach version, text artifact) before it writes the file (`phase-1.md` 3.3.5).
6. **Safe delivery**: `aw ask` returns at once, because the Bash tool times out after 2 minutes. AW delivers each answer as the next input only when no dialog is open: one paste (`paste-buffer -p`), then one Enter. A delivery id in the text, for example `[AW answer q-3]`, is confirmed by the UserPromptSubmit hook.
7. **New session**: the old session goes to the session history. The new one gets a handoff (plan, decisions, open questions, last comments, diff statistics) from `aw handoff` or from the transcript.
8. **Checkpoints** (decision D10): at each Stop of a session, AW pushes the work branch `aw/<task-key>` to `origin` with `--force-with-lease`, on each device (a remote device can go offline too). Only the session with the highest claim epoch pushes. The lease is the remote commit that the session based on or pushed: AW never replaces a commit that it did not see, and a failure writes one thread comment per cause. The hooks of the repository run (no `--no-verify`). Before a new worktree, AW fetches `aw/<task-key>` and bases the branch on it; a local branch with own commits stays. A move continues from it. **Degraded mode**: when managed settings block `--plugin-dir` or hooks, AW shows "Limited status".
9. **Orca** (`host-orca`, optional per device, from 1.4.257): the rules are in 4.6.2 item 4. When Orca is absent or off, AW uses tmux and `git worktree` and shows "Orca: not available".
10. **Ready protocol**: the agent calls the `ready` tool or runs `aw ready` (it returns at once; `--missing` opens questions). The daemon on the implementing device checks: the agent's latest ready report has no open missing item, the approach is confirmed, the task has an assignee, and `knowledge` and `secure` are complete (4.4). Only then AW delivers "Start implementing" and sets the stage to Implement. When the implementing device is another device, the discuss device writes `session.ended reason=moved`, the implementing device writes a new claim, and its new session runs `aw ready` there (`workflow.md` 4.7).

### 4.6 Continuity
#### 4.6.1 Service supervision
1. Linux: systemd user units `awd.service` and `aw-sessions.service` with `Restart=always`, and `loginctl enable-linger <user>` once. When `aw-sessions.service` is missing (an install from before the sessions), awd starts tmux in a transient scope (`systemd-run --user --scope`), never in the unit of awd, and logs that `aw service install` must run again. Headless Mac: a LaunchDaemon with `UserName`, `KeepAlive`, `AbandonProcessGroup=true` and `AW_KEYSTORE=file`. launchd writes the output of awd to `~/.aw/logs/awd.log`; awd copies its last 10 MB to `awd.log.1` and truncates it above 10 MB (3 old files); a failed copy (a full disk) still truncates it. Laptop: LaunchAgents, because it runs agents only while the user is logged in. Each unit sets `PATH`: the absolute folders of the PATH of the install, then `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin` and the system folders. launchd gives no PATH of the terminal, so awd would not find Homebrew tmux or `~/.local/bin/claude`; `aw service install` checks for tmux with this PATH.
2. `aw doctor` (`GET /v1/doctor`, and the desktop Setup check page) checks the service unit, the session host, `claude auth status --json` from the service context, disk, clock, the sync engine and the reach of each device, and on macOS sleep, restart after a power failure and FileVault. Each failure has a fix line. The Local Network check is not built yet.

#### 4.6.2 Session host
1. Default: `tmux -L aw` with `exit-empty off` and `remain-on-exit on`, one window per session (`aw-<task-id>`). awd only connects to it.
2. **Launcher**: awd writes the first input to a file and opens the window with exec-form arguments, never a shell string. The fixed script `aw-launch` reads the file and the 0600 credential files, then runs claude with `--` before the message. AW allows the agent commands (`Bash(aw ask *)`, `Bash(aw message *)`, ..., never the whole CLI, so the agent cannot answer its own gates), denies the person commands in the session settings and in its PreToolUse guard (in each permission mode, also in skip mode), and pre-trusts each worktree that it creates and each folder that a person chose for the task (the project checkout or another folder, openspec session-options): `aw-launch` adds only the trust entry of that worktree path to the user's Claude Code state file, after a backup, and only on a Claude Code version that the contract tests cover (`engineering-rules.md` 7.1). On another version, AW answers the trust screen through `capture-pane` before the first input. No token or user text appears in a shell command or a window name. awd reads `capture-pane` only to find dialogs, including the trust screen, for the watchdog, and for the terminal snapshot that people see (`phase-1.md` 3.1.1). `CLAUDE_CODE_NONBLOCKING_STDOUT=1` keeps a stopped reader from freezing claude.
3. Direct PTY (`node-pty`) is the fallback when tmux is missing. The PTY dies with awd, so each awd restart uses the resume path.
4. **Orca** (`host-orca`, `phase-1.md` 9.9): `aw doctor` finds the binary (the config path, then the macOS app bundle, then `orca-ide` or `orca` on PATH) and stores the full path. AW creates a session in 2 steps: `worktree create`, then `terminal create --command "exec env AW_NODE=... AW_HOME=... <aw-launch path> <session>"`. It never uses `orca agent launch`, which cannot pass the launch flags. `--command` carries only ids, because the shell history keeps it. Input: `terminal send --enter` with the safe-delivery rules of 4.5. The text is a CLI argument (no stdin input), an exception that a maintainer approved for phase 1 (`engineering-rules.md` 12). Output: only hooks and the transcript, because `terminal read` returned 2-column text. Stop: the process group of the pid from `terminal create`, then `terminal close`.

#### 4.6.3 Reconcile at start
1. Read the session records with the exact pids: the pane pid, the claude pid and the process group id. List the tmux windows with the pane pid and `pane_dead`. Match them to sessions by these stored ids, never with `pgrep -f`. Attach the reader to each live session and drain its spool.
2. Resume each session that has no live process and holds the highest claim epoch (4.6.4). When the boot time changed, revoke the test-slot leases from before the boot. Write "Sessions resumed 3/3" to device health.
3. **Forced stop** (a move, Cancel, a revoke): send SIGTERM to the process group of the pane, then SIGKILL after 5 s, then kill each remaining descendant. Background commands kept running after a `kill -9` of claude alone.

#### 4.6.4 Resume after a crash or a reboot
1. AW creates the session UUID and stores the full launch flags, because Claude Code does not restore them. Recovery: `claude --resume <uuid> <the stored flags> -- "<continue message>"` in a new window with the same name. The message is the last argument; another order lost it once. It names the interrupted step from the last PreToolUse event with no PostToolUse event.
2. Before a resume, AW checks that no live process owns the session id. AW selects Resume in the "Resume this conversation?" dialog. An unknown screen opens "Take over terminal". AW never puts a session back in `bypassPermissions` silently.
3. AW copies the transcript at each Stop and SessionEnd, because Claude Code deletes transcripts after 30 days.
4. The thread shows "ubuntu-01 restarted at 03:12. AW resumed the session at 03:13." The resume count resets only after progress (a Stop, a PostToolUse, or 10 min alive). After 2 resumes with no progress, or 5 in one hour, AW opens "Take over terminal" with a push; a lost transcript starts the session again with the first input and a note (`phase-1.md` 9.7.3).

#### 4.6.5 Pause states
The task state **Paused** has `{cause, since, resumes_at?, next_step, needs_human}`. This table is the canonical list.

| Cause | Example text | Next step | Needs the human | Push |
|---|---|---|---|---|
| `usage_limit` | Paused: usage limit. Resumes at 15:45. | Claude Code or AW continues at the reset (4.6.6). | No | No |
| `usage_limit_weekly` | Paused: weekly limit. Resumes Mon 09:00. | AW continues at the reset. The Inbox item offers Wait, Turn on usage credits, Switch this agent to an API key. | No | No |
| `continue_cap` | Paused: 3 automatic continues used. | Gate "Continue after usage limit". | Yes | Yes |
| `device_offline` | Paused: MacBook Pro is asleep. | Continues when the device is back. Action: "Assign to another device…" (no gate opens). | No | No |
| `device_restart` | Paused: ubuntu-01 restarting. | AW resumes the session after the boot (4.6.4). | No | No |
| `device_revoked` | Paused: MacBook Pro was revoked. | Action: "Change assignee". | Yes | No |
| `network_lost` | Paused: ubuntu-01 has no network. | Continues when the network is back. | No | No |
| `waiting_for_sync` | Paused: waiting for sync, knowledge 92 %. | Starts when the files arrive (4.4). Action: "Sync now". | No | No |
| `task_moving` | Paused: moving to ubuntu-01. | Starts on the new device after `task.released`, or at once when the old owner is offline (4.3.4). | No | No |
| `agent_error` | Paused: agent error (server_error). Retry at 14:32. | Retry with backoff. After 3 failures, gate "Take over terminal". | After 3 failures | With the gate |
| `login_expired` | Paused: login expired on ubuntu-01. | Action: "Sign in" (4.6.7). | Yes | Yes |

A pause is not a gate. Only a pause that needs the human sends a push, except `device_revoked`, which the human made. The desktop app shows a notification for `device_revoked` (4.10.6), because the revoke can come from another computer. `device_offline` and `device_revoked` come from the presence, not from a `task.paused` event. A paused session does not count toward the maximum of its agent.

#### 4.6.6 Usage limits
1. `aw-statusline` sends `rate_limits.five_hour` and `rate_limits.seven_day` (`used_percentage`, `resets_at`) to the spool, then runs the user's own statusline command. A StopFailure with `error=rate_limit` and a window at 100 % sets the pause. Terminal text is a fallback only.
2. A reset in less than 24 h: Claude Code continues by itself. AW confirms with `quota_auto_resume_fired` and sends Enter on `quota_auto_resume_stale`. AW continues by itself only after a restart, or for a reset more than 24 h away (`resets_at` + 2 min).
3. After 3 automatic continues in one session, AW opens "Continue after usage limit". AW obeys `quota_auto_resume_disabled`.
4. All sessions of one login share the windows. AW starts no queued task above 90 % of the 5-hour window and creates one Inbox item per login.

#### 4.6.7 Sign-in state
1. AW reads only `claude auth status --json`, once per hour. It never reads credential files, the Keychain or token values. It pushes 3 days before `loginExpiresAt`.
2. Sign in from the phone: AW opens `claude auth login` in a terminal window. The user pastes the code in the terminal view. AW does not parse, log or record it. `claude setup-token` is an advanced option for a headless Mac (decision D7).

#### 4.6.8 Agent queue
1. Each agent (`claude@ubuntu-01`) has `maxWorking` (default 2) and an ordered queue. A session at a gate, paused or ended does not count.
2. AW starts a queued task only when the device is online, the count is below the maximum, the login is valid and below the budget, and the disk is less than 95 % full.
3. A task enters the queue only by a human action or by a rule of the credential owner. The device of the agent applies `queue.reordered` events from any device. The newest order wins.
4. Each device shows the position and the cause of a queued task from the merged files: the task views, the presence, and the `queue` limits that the device of the agent writes into its `health.yaml` (`phase-1.md` 9.6.11).

#### 4.6.9 Watchdog
1. Every 30 s, awd checks the pane, the time of the last hook event and a hash of the screen. After 2 min with no hook event and no pane change, while the session runs and no gate is open, the task shows "No recent update" with the last terminal line. Other devices add 8 s for sync.
2. After 15 min: a dead process gets a resume. A prompt that no hook reported opens "Take over terminal" (in Orca, AW cannot read the screen: a turn with no hook event for 15 min opens it). A busy process shows "Busy for 15 min: `npm test`". AW never kills a live process.

#### 4.6.10 Unattended permission prompts
1. The PermissionRequest hook (`aw-hook permission`) waits on the awd socket. AW rules answer first. An unmatched call becomes "Approve command" with a unique request id (`p-<uuidv7>`). Each answer names that id; a counter id approved the wrong command in the verification.
2. After 120 s, the hook returns `deny` with `interrupt: true`. A later "Allow" becomes a one-time approval for that exact request id: AW delivers "Approved: run it again", and the hook allows the matching retry.
3. The model reads a hook deny only as a tool error. So AW also delivers each deny as the next input of the human: "Denied by human@pixel-9: <reason>".
4. `denyInsteadOfPrompting: true` keeps a session from blocking on a hidden prompt. **Not verified:** the hook runs before this denial (spike S7). Fallback: turn it off and use the hook timeout and the Notification `permission_prompt`.
5. The push, timeout and reminder rule of each gate is in the gate table of `workflow.md` section 3.

#### 4.6.11 Self-update without killing sessions
1. awd downloads the release to `~/.aw/versions/<version>/` and checks the project Ed25519 signature (a detached base64 signature `aw-<version>.tar.gz.sig` over the sha256 of the tarball, checked with `node:crypto`). It stops the engine, switches the `current` link (and `previous` to the old version) and exits. The new version reconciles (4.6.3).
2. After 3 failed starts, the launcher goes back to the previous version. The launcher is a POSIX sh script (`daemon/src/continuity/launcher.ts`): it reads `versions/failed-starts`, switches `current` and `previous` at 3, adds 1, and runs awd of `current`; awd writes 0 after it was ready for 60 s. AW never updates claude and never restarts `aw-sessions` by itself.

#### 4.6.12 Device health
1. Each device writes `devices/<device>/health.yaml` at most once per 60 s: boot time, versions, sessions, usage per login with a projection, login end dates, disk, sync state per peer.
2. Disk above 85 % gives a warning. At 95 %, AW starts no session and sends one push. With no second computer, health shows "No backup · a lost laptop loses the workspace · Add a remote device".

### 4.7 Test slots
1. Each device declares resources and capacities, for example `k3d: 1`. `aw slot acquire k3d` asks the device that has the resource. It returns `{slot, fencingToken, ttlMs}` or a queue position. The lease events go to the workspace log of that device.
2. The TTL runs on the clock of that device (the only writer of its leases); it is 30 min, at most 24 h (the event schema). awd renews the lease of a running session at `ttl/3` (the session heartbeat), and a second acquire of the holder also renews it. On expiry, the device revokes the lease. After a reboot, it revokes all leases from before the boot; each new lease has a higher fencing token. Phase 1 gives a lease only to a session on the device that has the resource (`phase-1.md` 9.6.12).

### 4.8 Knowledge
#### 4.8.1 Store
1. Knowledge is Markdown in `knowledge/shared/` (workspace) and `knowledge/projects/<project>/`. Rules are in `knowledge/shared/rules/`. The apply mode, the lock and the provenance are in the YAML front matter of each file, so no shared metadata file exists.
2. The `KnowledgeStore` interface (6.2) hides the storage. Files is the P1 store. Vector and graph stores (P3) index the same files.
3. The context builder selects files by scope and apply mode, reports the size budget and warns before it drops a file. It returns a list with a short header (at most 9,000 characters, below the 10,000-character hook limit); the agent reads the files itself (`phase-1.md` 5.9).

#### 4.8.2 History without git in the synced folder
1. Each knowledge change is an event in `knowledge/log/<device>.jsonl`: the path, the new content hash, the base hash, the author, the task and the kind (`learned`, `edit`, `undo`, `replaced`).
2. Each computer keeps each version that it sees in a history store outside the synced folder: `~/.aw/history/<workspace>/<sha256>`. Before awd writes a knowledge file, it copies the current content into the store, and the watcher stores each human edit. At pairing, a new computer copies the store from a paired computer through the pairing folder. The phone reads the history from a computer.
3. Syncthing "simple" file versioning, with its folder outside the AW folder, keeps each version that another device changed or deleted. It never keeps an edit of the device itself, so the copy before write is necessary. In the verification, "staggered" mode lost a version.
4. **Undo** writes the old content as a new change. Undo from the phone is a request event. The highest-priority online computer that has the version applies it. Option: `aw kb export --git <path>` writes a git repository outside the synced folder (decision D16).
5. Backup: in P1, each paired computer has a full copy, and the plain files work with the user's own backup tool. P2 adds the encrypted R2 backup.

#### 4.8.3 Learned knowledge
1. At the end of each task, the agent runs `aw learn` or records "Nothing new" (decision D3). Each learned item is a new file, for example `knowledge/projects/billing-api/learned/2026-11-22-test-db-reset.md`. Each step also writes `task.learned` to the task log, so the thread shows "Learned by claude@ubuntu-01: <path>" with Undo, or "Nothing new learned". AW does not block `done` without the step; it reminds the agent and writes a thread comment.
2. A change to a rule, a locked file or shared knowledge waits for "Approve knowledge change". In P2, knowledge from signals waits too. This gate sends no push of its own. The change is a suggestion record in the knowledge log (`knowledge.suggested`) until a human accepts or rejects it (`phase-1.md` 5.8).
3. One daily digest in the Inbox: "Agents learned 4 things. 1 change waits for approval." No push.

#### 4.8.4 Direct edits and links
1. Humans can edit the files with any editor. The file watcher records each change as an `edit` event by `human@<device>`. A PreToolUse rule denies agents Edit and Write on the knowledge folder with "Use `aw learn`".
2. Link plugins fetch GitHub content (P1), and Google Drive and Linear content (P2). Link content is untrusted data in prompts.

### 4.9 Push
1. **P1: the owner device sends standard Web Push** (RFC 8030, 8291, 8292). Push is required in P1 (task-model decision §5.4). Each computer has its own VAPID key. The phone registers one UnifiedPush instance per computer, so no device shares a push key.
2. **Push path**: the official build uses the UnifiedPush embedded FCM distributor. FCM accepts Web Push with VAPID, so no AW service is in the path. Fully owned: the person's own ntfy server (decision D12, spike S1).
3. The body is encrypted for the phone (`aes128gcm`, at most 3 KB): event id, task key, gate, one line. FCM sees only ciphertext.
4. Each gate push always shows a notification, because FCM can lower the priority of pushes with no visible notification. The phone starts its sync service when it does not run, and shows the full gate card (`phase-1.md` 8).
5. Policy: a push for a gate, for finished work, and for a pause that needs the human. No push for a pause that continues alone, for the digest or for "Approve knowledge change". P2 adds the opt-in offline alert in the person's own iroh relay (decision D4).

### 4.10 Remote control and live channel
1. The phone and the desktop app are remote controls. Closing them stops no work. The desktop app is the window of the local awd and reads through the local API (6.3).
2. The phone has its own copy of the files and its own index. A human action goes at once to its own log. The card shows "Not synced" until the owner device writes the result. Each screen shows the age of the data per device, for example "ubuntu-01 · synced 10 s ago".
3. **LiveChannel P1**: `wss://` from the phone, or from the local awd of the desktop app, to the awd of the session device on the LAN or Tailscale. TLS pins both sides to the device keys in the device records. It carries terminal streams (at most 10 frames/s, 64 KiB per frame, only while viewed) and terminal takeover. The Electron main process never opens it: the local awd relays the stream over `awd.sock` (6.3).
4. Without a live channel, the phone shows the last terminal snapshot from the files ("Showing the output from 14:20"). The phone can send free text to a running session: a `message.sent` event in its own log. The session device delivers it safely (4.5) and writes `message.human` from the UserPromptSubmit hook, so the thread has the text once.
5. **LiveChannel P2**: iroh behind the same interface. Direct when possible, the person's own relay as fallback, app-layer encryption inside (`decisions/2026-11-22-relay-transport.md`).
6. **Desktop notifications** (P1, macOS): the Electron main process shows a native notification for each gate, each finished task and each pause that needs the human, with the push policy of 4.9. Actions: one action per option of a question, an inline reply for Reply, and "Allow once" for a command when the full command fits in the 256-byte body. Confirm approach, Approve result and a longer command have no action, because the human must read the text. A click opens the task in every case, so no notification has an "Open" button. The id is the gate id, and the group is the task. An answer on any device closes the notification when the answer syncs.
7. **Menu bar and login item**: the app runs as a menu bar app, also with no window, and starts at login. When the person quits it, awd works on and the phone push still arrives. At the next start, the app attaches its handlers to the notifications that Notification Center still holds, and Home shows "While you were away". Notifications, actions and the login item need the signed and notarized app; an unsigned build shows the gates only in the Inbox.
8. **Phone sync pattern**: one foreground service with a permanent notification runs the engine. The app restarts the engine each time it opens and warns when the battery mode is "Restricted". The verification chose this over short `dataSync` bursts: a file arrived in 3.1 s in deep Doze, and bursts depend on a push that is not verified yet (`phase-1.md` 6.7).

### 4.11 Phase 2 parts
1. **R2** (the person's own bucket): each device writes only its own objects under `ws/<workspace>/dev/<device>/`. Objects are encrypted on the device and written once. Each device has its own head object, so no compare-and-swap is necessary. Uses: store and forward, the backup with the recovery phrase, artifacts with share links (default 1 h), a cap (default 8 GB).
2. **iroh and the person's relay**: devices dial each other by key. `access.http` admits only paired keys. The live channel and peer links use it. The relay stores nothing, except the opt-in offline-alert record (D4).
3. **People and sharing**: a share is a signed grant over the peer link. Person B's devices write only their own log files, and the same rules merge them (4.3). **Also in P2** (`prd.md` 8.10): the credential owner rule (D8), sources, signals, Send, structured mode, cost per agent, the marketplace.

### 4.12 Phase 3 parts
`prd.md` 8.11 lists the P3 parts. Each part comes behind an interface of section 6. The vault adds the gate "Grant secret". Canvas uses Yjs over the live channel. Codex, opencode and pi are agent adapters. Google Drive is a sync transport. Vector and graph stores are knowledge stores.

## 5. Runtime views
### 5.1 The human answers a gate on the phone (P1)
1. `claude@ubuntu-01` runs `aw ask AW-12 --options "A|B"`. The command returns at once.
2. awd on ubuntu-01 appends `gate.opened` to its log, scans the file and sends a Web Push with an encrypted preview.
3. The Pixel 9 shows "AW-12 · Answer question". Its sync service gets the gate on the LAN, on Tailscale or through a community relay.
4. The human taps "A". The phone appends `gate.answered` to its own log and scans it. The card shows "Not synced".
5. ubuntu-01 reads the answer. With no dialog open, it pastes `[AW answer q-1] A` into the session and presses Enter. The UserPromptSubmit hook confirms the delivery id, and awd appends `gate.resolved`. Measured: 0.3–0.4 s from the answer in the log to the agent.
6. In P2, the answer also goes over the live channel (less than 5 s), or through R2 when the 2 devices are not online together.

### 5.2 Laptop closed for the night (P1)
1. 23:00. `claude@macbook-pro` works on AW-21. `claude@ubuntu-01` has 2 working sessions and 3 queued tasks.
2. The human selects "Sync". The app shows "Synced 3 s ago". The human closes the laptop. AW scans again on the sleep notice, when the OS allows it.
3. After 90 s with no heartbeat from the laptop, ubuntu-01 shows AW-21 as "Paused: MacBook Pro is asleep". No push, no gate. The task waits.
4. The human selects "Assign to another device…" on the phone and `claude@ubuntu-01`. The phone writes a human `task.assigned`. ubuntu-01 writes `task.claimed` with epoch 2 and starts from the checkpoint `aw/AW-21`.
5. 08:00. The laptop wakes. It reads the merged logs before it resumes anything, sees the new assignee and epoch 2, and stops its session. It pushes its unpushed work as `aw/AW-21-macbook-pro-0800` with a thread comment (`comment.added`). Home shows "While you were away: 6 tasks done, 1 needs you".

### 5.3 The same knowledge file changes on 2 devices (P1)
1. The human edits `testing.md` on the laptop. At the same time, `claude@ubuntu-01` changes the same file with `aw kb`. The devices are not connected.
2. They connect. Syncthing keeps the newer file (from ubuntu-01) and makes a conflict copy with the laptop content. The copy name ends with the short id of ubuntu-01, the winner.
3. The laptop is the highest-priority online device. Its write journal shows that the copy is its own last write. The laptop (local) wins over ubuntu-01 (remote), so it writes the laptop version and removes the copy. Measured: 1.6–1.9 s.
4. The ubuntu-01 version goes to the history store. The history of `testing.md` shows "Replaced by the MacBook Pro version" with Undo.

## 6. Interfaces
### 6.1 Sync transport (P1: syncthing; P2: r2, iroh; P3: gdrive)
```ts
interface SyncTransport {
  id: string;                                            // "syncthing", "r2", "iroh", "gdrive"
  start(): Promise<void>; stop(): Promise<void>;
  addPeer(record: PeerRecord): Promise<void>;            // {device, sync_id, role, addresses}, from a signed device record
  removePeer(device: string): Promise<void>;             // revoke
  addFolder(f: { workspace: string; kind: "tasks" | "knowledge" | "secure"; path: string; ignore: string[] }): Promise<void>;
  wrote(paths: string[], workspace?: string): void;      // targeted scan after a write
  syncNow(o: { timeoutMs: number }): Promise<SyncResult>;
  pause(): Promise<void>; resume(): Promise<void>;
  status(): Promise<PeerStatus[]>;
  events(): AsyncIterable<SyncEvent>;
}
interface PeerStatus { device: string; connected: boolean; route?: "lan" | "tailscale" | "relay" | "internet" | "storage";
  needItems: number; needBytes: number; inSync: boolean; lastSeen?: string; lastSynced?: string }
interface SyncResult { at: string; pending: { device: string; items: number; reason: "offline" | "timeout" }[] }
```
The Kotlin app has the same interface. Contract tests run both clients against each pinned engine version. `shared/plugin-api/src/sync.ts` is the TypeScript source; `internet` is a direct connection outside the LAN.

### 6.2 Other interfaces
`shared/plugin-api` holds each interface in TypeScript. The Kotlin app has `SyncTransport` and the file model only.

| Interface | Main methods | P1 | Later |
|---|---|---|---|
| AgentRuntimeAdapter | `detect()`, `start(o)` (AW stores the launch flags), `resume(id, {launch, prompt, transcriptPath})`, `processes()`, `authStatus()`, `transcript(id)`. A `SessionHandle` has `send`, `answer(requestId, {allow, input, message, interrupt})`, `interrupt`, `stop`, `events`. | claude (terminal mode) | P2 structured mode; P3 codex, opencode, pi |
| SessionHost | `detect() → {version, survivesDaemonRestart}`, `open({name, cwd, launcher, env})`, `list()`, `alive(ref)`, `capture(ref, lines)`, `send(ref, keys)`, `attach(ref)`, `close(ref)`. Refs are stored ids, never live handles. | tmux, orca, pty | P3 Claude Code background sessions |
| KnowledgeStore | `list(scope)`, `read(path, version?)`, `write({path, content, base, author, task, kind})`, `history(path)`, `undo(change, by)`, `search(q, {scope, limit})` | files | P3 vector, graph |
| LiveChannel | `connect(device)`, `stream(ref)`, `send(ref, keys)`, `close()` | direct wss | P2 iroh |
| PushSender | `register(phone, subscription)`, `send(phone, preview)` | Web Push | P2 offline alert |
| Link | `resolve(link)`, `fetch(link, sinceVersion?) → {content, version}` | GitHub | P2 Google Drive, Linear |
| Storage | `put(key, bytes)`, `get(key)`, `list(prefix)`, `presign(key, op, ttl)` | — | P2 R2 |
| Source, Send target | `channels()`, `collect(cursor)`, `post()`; `fields()`, `preview()`, `send()` | — | P2 |

### 6.3 Local API and file API
1. awd serves HTTP and WebSocket with fastify on `~/.aw/run/awd.sock` (mode 0600, folder 0700) for the `aw` CLI, the permission hook and the desktop app. It never listens on TCP for this API. The schema is OpenAPI 3.1 in `contracts/openapi.yaml`. Each reply carries `X-AW-Version` and `X-Trace-Id`. `/healthz`, `/readyz` (engine, index, session host) and `/version` are the probes.
2. **Desktop app**: only the Electron main process connects, with axios (`socketPath`) and `ws` (`ws+unix:`), and reconnects with backoff. The main process also gets the terminal streams of other devices on this socket and forwards them to the renderer through the bridge: the local awd owns the LiveChannel to them (4.10.3). The renderer keeps awd data in TanStack Query, and awd events invalidate its queries. The renderer is sandboxed with context isolation. It calls a narrow typed API that the preload script exposes through `contextBridge`. The main process checks the sender frame of each IPC call and serves the UI from `app://` with a CSP.
3. The files are a public API. Each release publishes the JSON Schemas in `schemas/` (principle 9).

### 6.4 MCP server for agents
1. The `mcp` module serves MCP Streamable HTTP (spec 2026-07-28, stateless, `@modelcontextprotocol/fastify`) at `http://127.0.0.1:<port>/mcp` (default port 7433, `phase-1.md` 9.8). Claude Code cannot use a Unix socket as an MCP URL, so this endpoint uses TCP. It binds to loopback only, never `0.0.0.0`, and checks the Host and Origin headers.
2. **Auth**: awd mints one bearer token for each session and binds it to {session, task, device}. A call can change only that task and create its subtasks; `thread` can also read the ancestors. The token is in `~/.aw/sessions/<session>/mcp-token` (0600). `aw-launch` reads it and exports `AW_MCP_URL` and `AW_MCP_TOKEN`. awd revokes the token when the session stops, ends, moves, is replaced or fails. The same token is the agent identity on the local API: the CLI and the hooks send it, and the person routes refuse it (`phase-1.md` 5.10). A bad token gets 401 with no `WWW-Authenticate` header, so Claude Code starts no OAuth flow. The token never enters an event: each live token is in the redaction set of the event writer (`[redacted:mcp-token]`), with the credential values.
3. **Registration**: the AW plugin `.mcp.json` declares the server `aw` with `"type": "http"`, `url` `${AW_MCP_URL:-…}` and the header `Authorization: Bearer ${AW_MCP_TOKEN:-none}`. The tools are `mcp__plugin_aw_aw__<tool>`.
4. **Tools** mirror the `aw` commands (`workflow.md` 8): `thread`, `ask`, `approach`, `ready`, `task_create` (with the copy fields from the parent), `message`, `gate`, `stage`, `slot_acquire`, `slot_release`, `artifact_add`, `result`, `handoff`, `learn`, `done`. **Resources** (read-only): the task fields and the knowledge list. Answers still reach the agent as its next input (4.5.6). AW sends no MCP push to the agent.
5. **Down at start**: Claude Code retries 3 times, then marks the server failed for the session. So `aw-launch` checks `/readyz` on the socket before it starts claude. awd restarts within 10 s, inside the 5 reconnects (about 31 s) of Claude Code after a drop. When the tools are missing, the skill tells the agent to use the `aw` CLI. Fallback transport `aw mcp` (a stdio server that forwards to the socket): not built, because spike S12 passed.

## 7. Deployment
| Setup | Devices | Status |
|---|---|---|
| Laptop only | MacBook Pro | P1. Work pauses while the laptop sleeps. "No backup" warning. |
| Laptop and phone | MacBook Pro, Pixel 9 | P1. The phone syncs only while the laptop is awake. |
| Laptop, remote device, phone | MacBook Pro, ubuntu-01, Pixel 9 | P1. Recommended. Agents work while the laptop is closed. |
| People | Each person has their own set | P2. Peer links over iroh. |

The install steps are in `prd.md` 7.1 and 7.2. The feature matrix is `prd.md` 8.5.1. The service units are in 3.3 and 4.6.1.

## 8. Cross-cutting concepts
| Concept | Decision |
|---|---|
| Encryption | P1: Syncthing TLS 1.3 between devices that check each other's device id; RFC 8291 for push; `wss://` pinned to device keys for the live channel; credential files encrypted with age to the workspace credential key, which pairing seals to the device key of each computer (`decisions/2026-11-22-task-model.md` §4). P2: app-layer AEAD inside iroh streams; R2 objects encrypted on the device. |
| Secrets | Device keys never leave the device. The master key never lives on a remote device. The `secure` folder never syncs to the phone; the phone adds a credential only as a value sealed to the device keys of all paired computers (task-model decision §5.3). The Claude login is never a file in the workspace folder. |
| Agent credentials | AW never reads them. It reads only `claude auth status --json`, the statusline JSON and hook events. |
| Untrusted input | Issues, link content, messages (P2) and web content are data. Prompt envelopes mark them. |
| Time | UTC and the HLC in files. Screens show local time. One clock module, so tests use a fake clock. |
| Versioning | Each document and event type has a schema major version. Engine, agent, Orca and tmux features are gated by version. |
| Observability, errors | JSON logs with `trace_id` (pino; Kermit on Android), a debug bundle export, device health, no telemetry. One error envelope: `{error: {code, message, details?}, trace_id}`. |
| Naming | "AW agent, powered by Claude". No AW name contains "Claude Code". The UI says "Sync by Syncthing" as plain text, with no logo. |

## 9. Architecture decisions
| ID | Decision | Rejected | Phase | Record |
|---|---|---|---|---|
| ADR-01 | 3 phases. P1 uses the final data model, modules and interfaces. Later phases add parts and never rewrite P1. | Phases 1a, 1b, 2 of PRD v0.7 | All | `decisions/2026-11-22-phases.md` |
| ADR-02 | The laptop is the main device. Remote devices are optional. The phone is a remote control. No single writer: per-device files, ownership rules, HLC order. | One device that orders the event log (v0.3, v0.4); CRDT for all data | P1 | `decisions/2026-11-22-device-sync.md` |
| ADR-03 | Data as open files: YAML documents, JSON Lines logs, JSON Schema from zod. A local SQLite index, never synced, with MongoDB query syntax. | SQLite or a binary log as the synced store | P1 | This document, 4.2 |
| ADR-04 | Sync is a plugin interface. Syncthing is built in for P1, and AW controls it. | A Syncthing app that the user installs; an own protocol in P1; a Kotlin BEP library (none is maintained) | P1 | `decisions/2026-11-22-device-sync.md` |
| ADR-05 | Computers bundle the official notarized Syncthing binary, configure it before the first start and control it with REST. Android: AW CI builds the engine from the same source tag as `libawsync.so`, with an own Kotlin client, in a foreground service with a permanent notification. 3 Syncthing folders: tasks, knowledge, secure. | `lib/syncthing` in a Go sidecar (unstable API; kept as fallback); gomobile (plan B); a copy of the fork's MPL code; short `dataSync` bursts (fallback) | P1 | This document, 4.4; `phase-1.md` 6 |
| ADR-06 | Shared files: the newer change wins, then local > remote > mobile. AW finds the authors from its write journal, removes conflict copies and keeps the other version in the history store. `maxConflicts` ≥ 10. | Conflict copies for the human to choose; the author from the copy name | P1 | `decisions/2026-11-22-device-sync.md` |
| ADR-07 | Knowledge history: a per-device change log, a content-addressed history store outside the synced folder with copy before write, and Syncthing "simple" versioning outside the AW folder. | A `.git` folder in the synced folder (corruption); git on one device only; "staggered" versioning | P1 | This document, 4.8.2 |
| ADR-08 | Task keys: the next number that the device knows, priority on a collision, ids in folders and links. | Number blocks per device; provisional keys; a device suffix | P1 | `decisions/2026-11-22-device-sync.md` |
| ADR-09 | Own identity: master key, device keys, signed device records. | Firebase Auth | P1 | This document, 4.1 |
| ADR-10 | Terminal mode with the user's own `claude`. Structured mode only with the user's API key. | The SDK or `claude -p` with a plan | P1, P2 | This document, 4.5 |
| ADR-11 | Sessions run in tmux in its own service unit, started by a fixed launcher, one session per task by claim epochs. Hooks write the raw thread to a spool. AW writes input by paste only when no dialog is open. | A PTY that awd owns; `http` hooks; `send-keys` typing; reading the screen | P1 | This document, 4.5, 4.6.2 |
| ADR-12 | A usage limit is a pause with a cause and a resume time. | Fail, or retry in a loop | P1 | This document, 4.6.6 |
| ADR-13 | Agents write learned knowledge directly, each item in a new file, with Undo and a digest. Rules, locked files and shared knowledge wait for approval (D3). | Approval of each fact | P1 | This document, 4.8.3 |
| ADR-14 | Permission prompts go to a PermissionRequest hook that waits 120 s, with a unique request id. A deny also goes as human input. `denyInsteadOfPrompting` is the safety net. | PreToolUse `defer`; `bypassPermissions`; counter ids | P1 | This document, 4.6.10 |
| ADR-15 | Push: standard Web Push from the owner device, one VAPID key per computer, through UnifiedPush embedded FCM or the person's ntfy (D12). | A project push gateway; push through a relay | P1 | This document, 4.9 |
| ADR-16 | iroh with the person's own relay for the live channel and peer links. | WebSocket relay on Cloudflare Durable Objects; a central relay; Tailscale only | P2 | `decisions/2026-11-22-relay-transport.md` |
| ADR-17 | R2 is the person's own storage. Each device writes only its own encrypted, write-once objects. | Project storage; one shared head object | P2 | This document, 4.11 |
| ADR-18 | Plugins are packages with a manifest and permissions. P1 ships them built in. P2 adds the marketplace. | Vendor code in the core | P1, P2 | This document, 6 |
| ADR-19 (D20) | Agents use an MCP server in awd (Streamable HTTP on 127.0.0.1, per-session token). The `aw` CLI stays. Both call the same service code. | MCP on a Unix socket (Claude Code cannot connect); MCP only, with no CLI | P1 | This document, 6.4 |
| ADR-20 (D21) | The desktop app talks to awd only from its main process over `awd.sock`. The renderer uses a preload bridge. | A TCP port; a socket in the renderer | P1 | This document, 6.3 |
| ADR-21 (D19) | P1 ships and tests `host-tmux` (default) and `host-orca` (optional plugin, per device). | Orca in the core; Orca only after P1 | P1 | `decisions/2026-11-22-modules.md` |

## 10. Risks
The product risks are in `prd.md` 11. This table adds the architecture risks.

| Risk | Phase | Mitigation |
|---|---|---|
| A device writes a file that it does not own. | P1 | Write guard in `files`. Readers reject an event whose `dev` does not match its file. Conflict tests in CI. |
| A hot log file falls behind on the other device (up to 8 s). | P1 | Write each log file at most once per second, then a targeted scan. Readers allow 8 s. Terminal output does not use file sync. |
| A credential value enters a synced log or task file through a hook, an agent reply, an approach or an artifact. | P1 | Each event writer and the files layer redact the session's credential values in events and text files. A CI test writes a credential in each and checks the synced folder. |
| Completion shows 100 % while a peer is offline (ST8). | P1 | Status per peer from `needItems`, `remoteState` and the connection. |
| The Syncthing REST API changes. It has no stability promise. | P1 | Pin the engine version. Contract tests per version in TypeScript and Kotlin. |
| Google Play rejects a bundled executable or the `specialUse` foreground service. Battery mode "Restricted" stops sync. | P1 | Spikes S4, S10. Fallback: `dataSync` bursts; gomobile plan B; F-Droid and GitHub releases. A warning for "Restricted". |
| The `wss://` live channel with certificates pinned to device keys fails between the Kotlin app and awd. | P1 | Spike S9. Without it, the phone shows the terminal snapshot. |
| The merge code in TypeScript and Kotlin disagrees. | P1 | Shared fixture folders with the expected index result, run in both test suites. |
| Another local process uses the MCP port, or an agent uses its token on another task. | P1 | Loopback, Host and Origin checks; tokens bound to one session and task. A bad token gets 401 or 403 with no OAuth prompt; spike S12 selects the code. |

## 11. Open decisions
`prd.md` section 13 is the master list, with the same D-numbers. Architecture items:
1. Log compaction with no coordinator: each device rolls its own old log lines into a snapshot segment. The rule is open (`prd.md` open question 5).
2. Retention of the history store and of transcript copies (`prd.md` open question 3).
3. iroh replication of the per-device logs as a Syncthing replacement on the phone (P2), when iroh-blobs is production quality.

## 12. Glossary
The product terms are in `prd.md` section 6. This document adds:

| Term | Definition |
|---|---|
| Workspace folder | The synced folder of one workspace, for example `~/AW/personal/`. |
| Device slug | The short, fixed name of a device in file names and agent names, for example `ubuntu-01`. |
| Snapshot document | A YAML document that its writer derives from the logs, for example `task.yaml`. |
| HLC | Hybrid logical clock. It orders the events of all devices. |
| Shared file | A file that any device can change, for example a knowledge file. The priority rule resolves 2 changes. |
| Claim | The `task.claimed` event with an epoch. The device with the highest epoch runs the only session of the task. |
| History store | The content-addressed store of knowledge versions outside the synced folder. |
| Sync transport | A plugin that moves the files between devices: Syncthing (P1), R2 and iroh (P2), Google Drive (P3). |
| Live channel | A direct connection for terminal streams and takeover: wss on LAN or Tailscale (P1), iroh (P2). |
| MCP server | The `mcp` module of awd. Agents call the AW tools through it (6.4). |
