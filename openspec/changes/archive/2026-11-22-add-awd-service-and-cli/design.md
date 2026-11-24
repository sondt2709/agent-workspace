## Context

`packages/core` has the files layer (`openWorkspace`), the merge (`MergeEngine`) and the index (`WorkspaceIndex`). No process runs them. The docs fix the shape of the service: `docs/architecture.md` 3.2, 3.3, 4.6.1 and 6.3, `docs/phase-1.md` 3.1, 3.5 and 11, `docs/workflow.md` 4 and 8, `docs/tech-stack.md` 1.1 and 2.1 to 2.3. The merge-index result handoff gives the call order for awd (one engine per workspace, `update()` per watcher batch, `index.write()`, `lastValid`, `taskOwner`, `lastHlc`, notices).

## Goals / Non-Goals

**Goals:**
- One awd process per computer that opens each workspace folder, keeps the index current and serves the local API on a 0600 Unix socket.
- A person or a script creates and reads tasks and answers gates on one device with `aw`, with the same effect as the API.
- The OpenAPI file is generated from the zod schemas of the routes and cannot drift.
- Service units that restart awd, generated and testable without an install on the test machines.

**Non-Goals:**
- Sync engine, pairing and device keys, sessions, the agent plugin, MCP, knowledge history, push, the desktop app.
- Gate resolution (`gate.resolved`) and stage moves: the session device does them (task-loop).
- The agent commands (`aw ask`, `aw approach`, `aw ready`, ...): sessions-tmux and task-loop add them to the command tree.

## Decisions

1. **Module layout in `apps/daemon/src`.**
   ```
   settings.ts            the only reader of process.env (AW_HOME, AW_LOG_LEVEL, HOME)
   state.ts               ~/.aw folders, modes, config.yaml (device, workspaces)
   log.ts                 pino with redaction; the warning filter
   service/               the service layer: one WorkspaceService per workspace, the Daemon
   api/                   fastify app: routes, schemas, error envelope, events (thin adapter)
   cli/                   commander tree, run(argv, io), output (thin adapter)
   units/                 systemd and launchd unit text, install, uninstall, status
   bin/awd.ts, bin/aw.ts  entry points
   ```
   The API and the CLI only parse input and call the service layer (`docs/engineering-rules.md` 5.17). The CLI calls the service layer through the API, so both have the same effect.

2. **Device identity before pairing.** `~/.aw/config.yaml` holds `device: {slug, name, role}` and `workspaces: [{id, path}]`. When the file is missing, awd creates it: the slug comes from the host name (lower case, other characters to `-`), role `local`. Pairing (identity-pairing) replaces this with the signed device record. Alternative: an `AW_DEVICE` variable; rejected, because a variable for a fixed identity adds a second source.

3. **Workspace init.** `POST /v1/workspaces {path, name?, key_prefix?}`:
   - The folder has `tasks/workspace.yaml`: awd registers it (a synced folder from another device).
   - Else awd creates `tasks/workspace.yaml` (new UUIDv7, the name, `key_prefix` default `AW`, `device_order: [<device>]`), the folders `knowledge/` and `secure/` (not on a mobile device), `tasks/devices/<device>/bindings.yaml` (`may_run` true for a computer) and the schema files in `tasks/schemas/` (copies of `packages/schema/generated/schemas/*.json`).
   - At each start awd copies a missing schema file again. It never replaces a file that exists (note 33). The files are shared files of the layout.

4. **Start of one workspace** (`WorkspaceService.open`):
   1. `removeStaleTempFiles(root)`.
   2. `new WorkspaceIndex(indexPath(AW_HOME, id))`, then `new MergeEngine({root, clock, lastValid: index.documents()})`.
   3. `engine.update()`, `index.write()`.
   4. `openWorkspace({root, device, role, clock, taskOwner: engine.taskOwner, lastHlc: engine.lastHlc()})`.
   5. Subscribe `@parcel/watcher` on `<root>/tasks` (ignore `*.aw-tmp`). Each event starts a batch: wait 100 ms on the clock module, then one `refresh()`. Events during the wait join the batch.
   6. Start the heartbeat loop.
   A failed `update()` or `index.write()` is logged; the next refresh tries again (merge-index interfaces 2 and 9). A workspace whose open fails is opened again every 10 s of the clock module (note 31). After each merge, the HLC of the files layer observes `engine.lastHlc()` (note 29). `/readyz` is ready when each workspace finished step 3.

5. **Writes.** A route calls one service method. The method runs in a per-workspace `p-queue` with concurrency 1: it builds the event, appends it with `WorkspaceFiles.writeEvent()` (owner check, redaction, HLC), runs `refresh()` and returns the event with the merge decision (`applied`, `reason`) from `engine.eventRows()`. So the reply shows the merged state, and 2 writes never interleave between the HLC and the append (data-model follow-up 4). Each write in this change is a human action, so it is written at once; the 1-second log buffer of `docs/phase-1.md` 3.3.2 waits for the session events (sessions-tmux).

6. **Actor.** The socket is the person's own, so awd writes `by: human@<device>` for each write of this change. The session token (MCP) and `AW_SESSION` decide the agent actor in later tasks.

7. **Task key and selector.** Create uses `nextFreeKey(view, key_prefix)`. A task selector is the id, the key (case does not matter) or a unique id prefix of 8 or more characters. A key that 2 tasks have (a collision before the rekey) gives `409 ambiguous` with both ids.

8. **Refused merges are visible.** An edit of `first_message` after the first session, for example, is written but not applied. The reply has `applied: false` and the reason, and `aw` exits with 1 and prints the reason (principle 9).

9. **Gate answer.** `POST /v1/workspaces/{ws}/gates/{gate}/answer {answer, comment?, version?}` writes `gate.answered` with the current version of the gate. A gate that this device knows as resolved gives `409 gate_not_open` and writes nothing; a stale local view writes the answer, and the merge makes it a comment. awd does not write `gate.resolved` (task-loop).

10. **Thread paging.** `GET .../tasks/{task}/thread?after=<cursor>&limit=<n>` returns the events of the task in merge order (HLC, device, id) from the index, with `applied` and `reason`. The cursor is `<hlc>~<dev>~<id>` of the last row, so 2 events with the same HLC never fall between 2 pages. `ancestors=true` adds the threads of the parents first. Default limit 200, maximum 1000.

11. **Events stream.** `GET /v1/events` (WebSocket): awd sends `{type:"hello", version}` at connect, then `{type:"changed", workspace, tasks, workspace_changed, documents_changed, full}` after each refresh with a change, and `{type:"notice", workspace, notices}` for merge notices. The client reconnects and reloads (`resync`), so a lost message loses no state.

12. **API shape.** Resources under `/v1/`; the probes `/healthz`, `/readyz`, `/version` have no prefix. `fastify-type-provider-zod` validates bodies, params and queries with zod and serializes replies; `@fastify/swagger` makes OpenAPI 3.1 from the same schemas. `genReqId` takes a valid `X-Trace-Id` (`[A-Za-z0-9_-]{1,128}`), else a new UUIDv7. An `onSend` hook sets `X-AW-Version` and `X-Trace-Id`. `setErrorHandler` and `setNotFoundHandler` return the envelope.

    | Error | HTTP | code | aw exit |
    |---|---|---|---|
    | zod validation, bad selector | 400 | `invalid_input` | 2 |
    | unknown workspace, task, gate, route | 404 | `not_found` | 2 |
    | gate not open, ambiguous selector, existing project | 409 | `conflict`, `gate_not_open`, `ambiguous` | 1 |
    | `WriteRefusedError`, merge refused (`applied: false`) | 403 / 200 | `refused` | 1 |
    | not ready | 503 | `not_ready` | 1 |
    | write in the log, merge after it failed | 500 | `written_not_merged` | 1 |
    | other | 500 | `internal` | 1 |
    | socket missing or refused | — | — | 3 |

13. **OpenAPI file.** `apps/daemon/scripts/api-generate.ts` builds the app with no socket, calls `app.swagger({yaml: true})`, formats it with Prettier and writes `docs/api.yaml`. A Vitest test fails on drift and checks that each fastify route is in the file and each path of the file is a route. `@redocly/cli` lints the file in the evidence (`pnpm dlx`, pinned), not as a dependency: it is large and only a check.

14. **Socket and folder modes.** awd creates `~/.aw` and `run/` with mode 0700 and sets the mode again when it differs. Before `listen`, it probes an existing socket: an answer means another awd runs (exit with a message), no answer means a stale file (remove it). It listens with `umask 0o077`, then `chmod 0600`. No TCP listener exists.

15. **Logs.** pino to stderr (fd 2), JSON lines, level from `AW_LOG_LEVEL` (default `info`). `redact` removes `token`, `secret`, `key`, `cookie`, `password` and `authorization` fields at depth 1 and 2 and in request headers. The service units send stderr to `~/.aw/logs/awd.log` (launchd) or the journal (systemd). `aw` writes only its messages to stderr and its result to stdout.

16. **`node:sqlite` ExperimentalWarning.** Node 24.22.3 (the pin) prints no warning; Node 24.14 prints one, and the engines range starts at 24.15. Decision: filter. `bin/awd.ts` removes the default `warning` listener and adds one that drops only an `ExperimentalWarning` whose message starts with `SQLite`, and logs each other warning with pino. It then imports the daemon, because a static import loads `node:sqlite` before the listener. Alternative: `--disable-warning=ExperimentalWarning`; rejected, because it hides each experimental warning.

17. **Heartbeats and retention.** Every 30 s (clock module) awd appends `device.heartbeat {boot_time}` to `tasks/devices/<device>/heartbeat/<UTC date>.jsonl` of each workspace. Once per loop day, it removes its own heartbeat files with a date more than 7 days before today, through `WorkspaceFiles.removeHeartbeatLog(path)`. The guard allows only the `device-heartbeat` rule of this device. A merge notice `removed` for a heartbeat file with a date older than 7 days is retention, not a Sync problem; each other notice is logged at `warn` and kept in the service until `aw status` shows it.

18. **Snapshots.** After each refresh, awd writes `task.yaml` (`toTaskDocument`) of each changed task whose owner is this device, when the text differs. The merge does not read `task.yaml`, so the write does not start a new merge.

19. **CLI.** commander 15 with `@commander-js/extra-typings`. `run(argv, io)` with `io = {stdout, stderr, env}` builds a new program each call, uses `exitOverride()` and `configureOutput()` to the io object, and returns the exit code. `--json` on each read and write command. Global `--workspace <name|id>`: the default is the only workspace; with more, `aw` asks for the option (exit 2). `aw task create` reads the first message from `--first-message-file <path>` (`-` is stdin) or `--first-message <text>`.

20. **Service units.** Pure functions render the text: `systemdUnit()`, `launchAgentPlist()`, `launchDaemonPlist()`. The label is `com.agentworkspace.awd`. The program is the absolute Node path and the absolute `bin/awd.ts` path (exec form, no shell). systemd: `Restart=always`, `RestartSec=2`. LaunchAgent: `KeepAlive` true, `RunAtLoad`. LaunchDaemon: also `UserName` (the user that ran `sudo`, note 30) and `AbandonProcessGroup`. systemd keeps `KillMode=control-group`: a stop of awd kills each process in its cgroup, so sessions-tmux must start the tmux server in its own unit (`systemd-run --user --scope`, `docs/architecture.md` 4.6.1 item 1). `aw service install` writes the file and runs `systemctl --user` or `launchctl` through `execa` (an injected runner in tests); `--print` writes the text to stdout and changes nothing. The tests check the text and the commands with the fake runner; the test plan never installs a unit on the test machines.

21. **Dependencies.** All in the tech-stack library list. `@parcel/watcher` has an `install` script that builds from source only when no prebuilt package is present; the pnpm build allowlist denies it, so only the N-API prebuilds load (`docs/engineering-rules.md` 4.6).

## Implementation notes

These decisions came up during the build. Each one follows the recommendation.

22. **Workspace selector `-`.** The route parameter `{ws}` takes the id, the name, or `-` for the only workspace. `aw` sends `-` when `--workspace` is not given, so a person with one workspace never types it.
23. **`/readyz` with a failed workspace.** `/readyz` is ready when each workspace is open or has a recorded error. A missing folder (for example an unmounted disk) must not keep `aw-launch` waiting forever; the error shows in `checks.workspaces` and in `aw status`.
24. **A POST with no body sends `{}`.** fastify refuses a POST with no content type (415). `@aw/client` sends `{}` as JSON for each write with no body.
25. **The event stream in `docs/api.yaml`.** `@fastify/websocket` hides its routes from `@fastify/swagger`. A `transformObject` step adds `GET /v1/events` back with the replies 101 and 404, adds the root `security: []` (the socket mode is the access control), and removes the unused `*Input` copies of the reply schemas. `@redocly/cli` 2.78 lint: valid, with 4 accepted warnings: the 3 probes have no 4XX reply, and the WebSocket route answers 101, not 2XX.
26. **Operation ids.** Each route has an `operationId` (`createTask`, `answerGate`, ...), so a generated client has stable names.
27. **Service unit of a headless Mac.** launchd does not set `HOME` for a LaunchDaemon, so the plist sets it. `aw service install --headless` refuses to run without root (exit 2) and prints the `sudo` command.
28. **The ExperimentalWarning check of the E2E test** cannot fail on Node 24.22.3, because that version prints no warning. The unit test of the filter (`log.test.ts`) is the test that can fail.

## Review round 1

The code review of the first commit found these defects. Each fix follows the recommendation of the review.

29. **HLC after a merge.** awd gave the merged HLC to the files layer only at open. After a merge of events of a device whose clock runs ahead (the merge accepts up to 24 h), an answer of this device got an HLC before its gate, and the merge made it a comment (`gate_unknown`) with exit code 0. Now each successful merge calls `files.hlc.observe(engine.lastHlc())`. `aw` also treats a `gate.answered` reply with a reason (`gate_unknown`, `old_version`, `late_answer`) as not counted: exit 1 and the reason on stderr (principles 4 and 9).
30. **LaunchDaemon user.** `aw service install --headless` needs root, so `os.userInfo()` was root and the plist had `UserName root`. The settings module now reads `SUDO_USER`, `SUDO_UID` and `SUDO_GID`; the CLI finds the home folder of that user with `dscl . -read /Users/<name> NFSHomeDirectory` (through the injected runner) and uses it for `UserName`, `HOME`, the default `AW_HOME` and the log path. It refuses root with no `SUDO_USER` or with `SUDO_USER=root` (exit 2). Before the load, it makes `AW_HOME` and `logs/` with mode 0700 and gives them to that user, because launchd opens the log file before awd starts.
31. **Failed open.** A workspace whose first merge or index write failed never opened again until a restart. Now the daemon tries the open again every 10 s on the clock module with a new `WorkspaceService`, and clears the error when it opens. A second `aw workspace init` of the folder tries at once and gives 503 `not_ready` with the error while it fails (it gave 200 "Registered" before).
32. **Saved write reported as a failure.** When the merge after an append failed, the API gave 500 `internal`, and a person who ran `aw task create` again made a second task. Now the reply is 500 `written_not_merged` with the path, and `aw` prints "Do not run the command again".
33. **Schema files.** At each start, 2 synced devices with different AW versions wrote the shared schema files back and forth. Now awd writes a schema file only when it is missing; the file name has the schema version.
34. **Client parse.** `@aw/client` cast each reply. The zod schemas of the API moved from `apps/daemon/src/api/schemas.ts` to `packages/client/src/schemas.ts` (export `@aw/client/schemas`); awd uses them for the routes and `docs/api.yaml` (no change to the file), and the client parses each reply and each stream message with them (`docs/engineering-rules.md` 5.2). A reply that does not match gives `AwProtocolError`. `ready()` returns the `/readyz` body also on 503, and `events()` calls `onMessage` outside the parse `try`.
35. **Smaller fixes.** A workspace name that 2 workspaces have gives 409 `ambiguous` with the ids. `initWorkspace` runs in a daemon-level queue, so 2 parallel inits of one new folder make one id. The socket path length check runs in `startServer` before `listen`. `aw thread --ancestors` prints the next cursor of each parent page that has more events.

## Risks / Trade-offs

- [The CLI runs `.ts` files with Node type stripping; Node does not strip types under `node_modules`] → Phase 1 runs from the repository. The npm package build with `tsc` (`docs/tech-stack.md` 2.6) belongs to release-pipeline; open issue.
- [A watcher misses an event] → Each API write refreshes at once; a restart reads all files again.
- [A full re-read after a retention removal on each device] → Once per day per device; 10,000 events merge in about 270 ms.
- [The host name slug is not unique between devices] → Pairing sets the final slug; until then `config.yaml` can be edited.
- [Two awd processes start at the same moment and both see a stale socket] → Rare; the second `listen` fails with `EADDRINUSE` and exits.

## Migration Plan

New code only. No workspace file changes format. Undo: remove the commit, then remove `~/.aw/` on the test machine.

## Open Questions

None. Each decision above follows the recommendation of the docs.
