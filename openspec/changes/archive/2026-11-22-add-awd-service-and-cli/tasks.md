## 1. Dependencies and files layer

- [x] 1.1 Add the pinned dependencies to `apps/daemon` and `packages/client`; deny the `@parcel/watcher` build script in the pnpm allowlist; install with the lockfile
- [x] 1.2 Add `WorkspaceFiles.removeHeartbeatLog(path)` with the guard (own `device-heartbeat` only) and its tests

## 2. awd base

- [x] 2.1 `settings.ts` (`AW_HOME`, `AW_LOG_LEVEL`, home folder) and `state.ts` (folders 0700, `config.yaml` with the device and the workspaces)
- [x] 2.2 `log.ts`: pino to stderr with redaction; the warning filter for the `node:sqlite` ExperimentalWarning
- [x] 2.3 `WorkspaceService`: open (temp files, index, engine, files, schema copy), refresh, watcher batches, snapshots, notices
- [x] 2.4 Service methods: workspace init, project add and list, task create, list, show, edit, assign, archive, thread pages, gate list and answer; per-workspace `p-queue`
- [x] 2.5 Heartbeat loop and retention through the clock module
- [x] 2.6 `Daemon`: start (socket probe, umask, chmod), stop, readiness, event bus

## 3. Local API

- [x] 3.1 fastify app with the zod type provider, `genReqId`, `onSend` headers, error and not-found handlers
- [x] 3.2 Routes for probes, status, workspaces, projects, tasks, thread, gates, issues; WebSocket `/v1/events`
- [x] 3.3 `scripts/api-generate.ts`, `docs/api.yaml`, root script `api:generate`, drift and route-match test
- [x] 3.4 Route tests through the real socket with `@aw/client` for each route and each error code, and `app.inject()` for `/readyz` before the start

## 4. Client and CLI

- [x] 4.1 `@aw/client`: axios on `socketPath`, trace id, version check, `AwApiError`, `AwUnreachableError`, events on `ws+unix:`
- [x] 4.2 `aw` command tree with `run(argv, io)`, text and `--json` output, exit codes
- [x] 4.3 Service units: render functions, `aw service install|uninstall|status` with an injected runner, `--print`
- [x] 4.4 Entry points `bin/awd.ts` and `bin/aw.ts`; package `bin` fields
- [x] 4.5 CLI tests in process against a daemon on a temp socket

## 5. Docs

- [x] 5.1 `docs/tech-stack.md` rows and pins, `docs/phase-1.md` 3.1 (`config.yaml`, heartbeat retention), `AGENTS.md` status and commands

## 6. Verification

- [x] 6.1 E2E on this Mac: awd as a child process with a temp `AW_HOME` and AW folder, the CLI flow, a gate of another device, the files and the index, SIGKILL during writes and restart
- [x] 6.2 Socket and folder modes; the OpenAPI lint with `@redocly/cli`
- [x] 6.3 Break each new test once and restore it; `task check` passes

## 7. Review round 1

- [x] 7.1 The HLC of the files layer observes the merged HLC after each merge; `aw gate answer` exits with 1 when the merge makes the answer a comment
- [x] 7.2 The LaunchDaemon runs awd as the user that ran `sudo`
- [x] 7.3 A workspace that does not open is opened again on the clock; a second init tries again and reports the error
- [x] 7.4 A write whose merge fails after the append gives `written_not_merged`
- [x] 7.5 `@aw/client` parses each reply with the API schemas (moved to `@aw/client/schemas`), and `ready()` returns the 503 body
- [x] 7.6 Smaller items: an ambiguous workspace name gives 409, inits run one at a time, the socket path check runs before listen, schema files are never replaced, `aw thread --ancestors` prints the next cursor of a parent, the `KillMode` comment
- [x] 7.7 Break each new test once and restore it; `task check` passes
