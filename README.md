# Agent Workspace

Agent Workspace (AW) lets a person manage the work of AI coding agents from the desktop app or the phone.
The agents run on the person's own computers and keep working while the laptop is closed.
The devices sync their files directly. No central AW service keeps your data.

## Status

Phase 1 is complete. The repository has these parts:

- The documents, the checks (`scripts/`) and `contracts/`.
- `shared/schema`, `shared/core` (files, merge, index), `shared/client`, `shared/config`, `shared/ui` (the MUI theme) and `shared/plugin-api` (the `KnowledgeStore`, `SyncTransport`, `SessionHost` and `AgentRuntimeAdapter` interfaces).
- `shared/identity` (master key, device keys, signed device records, pairing codes, sealing, keystore), with the identity, pairing and credential services of awd.
- `daemon/`: awd, the local API, the `aw` CLI, the service units, the agent sessions and `bin/aw-launch`.
- The MCP server in `daemon/src/mcp/`.
- The work loop in `daemon/src/loop/`: stages, ready checks, subtasks, notices, gate pushes and reminders, knowledge gates.
- The install commands (`aw engine install`, `aw service install|move-keys`) in `daemon/src/install/`.
- The setup check (`aw doctor`, `GET /v1/doctor`) in `daemon/src/service/doctor.ts`.
- The continuity rules in `daemon/src/continuity/`: resume policy, pauses, usage limits from `aw-statusline`, sign-in state, agent queue, watchdog, test slots, wake branch, device health, self-update with the rollback launcher.
- The npm package build (`daemon/scripts/build.ts`) and `THIRD_PARTY_NOTICES` (with a copy in the APK).
- `plugins/kb-files` (the knowledge store) and `plugins/sync-syncthing` (the sync engine, its pins and the conflict resolver).
- `plugins/host-tmux` and `plugins/host-orca` (the optional Orca session host and its fake CLI).
- `plugins/agent-claude`: the AW plugin for Claude Code with its `.mcp.json`, and the fake agent.
- `plugins/push-webpush`: the Web Push sender (VAPID and RFC 8291).
- `desktop/`: the Electron main process with the notifications, the menu bar Tray and the login item, and the preload bridge.
- The React + MUI renderer of `desktop/`: the Inbox, the Board, the List, the task detail, the gate cards, New task and New session, Devices & sync, pairing, Knowledge, Files, Credentials, Settings, the project Settings and the workspace menu.
- The Docker e2e setup (`e2e/compose.yaml`).
- `android/shared`: the Kotlin shared module of the Android app.
- `android/engine`: the Android sync engine build and controller.
- `android/identity`: the identity formats of the phone (canonical JSON, the pairing code and request, the check code, the device record check, the device key, the age sealer).
- `android/control`: the logic of the phone screens (screen states, gate rules, routes, the phone actions, the credential outbox with the age sealer, the push file, the phone pairing).
- `android/app`: the engine foreground service, the adaptive Compose screens, the QR scanner adapter, the Keystore box of the device key and the UnifiedPush receiver.
- The Compose screens of `android/app`: Home, Inbox, Tasks, Task detail, New task, Devices, Add credential and Pair with a computer.

`plugins/live-direct` is a placeholder. The items marked **planned** in the documents do not exist yet.

Read `docs/README.md` for the design, and `docs/phase-1.md` for the phase 1 scope.

## Build and check

You need Node 24.15 or later (the exact version is in `.nvmrc`), go-task 3 and pre-commit 4.

1. Select the Node version: `nvm use`.
2. Enable pnpm through corepack: `corepack enable`.
3. Install the dependencies: `pnpm install --frozen-lockfile`.
4. Install the git hooks: `pre-commit install`.
5. Run all checks: `task check`.

`task check` runs the YAML extension check, then the check of each folder (Prettier, ESLint, the typecheck and the tests; in `android/` ktlint, detekt and the JVM tests, with a JDK 21), then the leak check. Run `task --list` to see each task.

## Layout

One folder per deliverable. The root holds only repo-wide files.

| Folder | Content |
|---|---|
| `contracts/` | JSON Schemas, schema samples, the OpenAPI file, fixtures and test vectors for all languages |
| `daemon/` | awd and the `aw` CLI |
| `desktop/` | The Electron app: main process, preload bridge, React + MUI renderer |
| `shared/` | TypeScript libraries and the TypeScript tool config (`shared/config`) |
| `plugins/` | Sync, agent, session host, knowledge, push and live plugins |
| `e2e/` | End-to-end tests |
| `android/` | Gradle Kotlin Multiplatform project: `shared/` (file model, merge, index), `identity/` (pairing formats, record check, age sealer), `engine/` (the build of `libawsync.so` and the engine controller), `control/` (the logic of the phone screens), `app/` (the Android app: Compose screens, engine service, push receiver) |
| `scripts/` | Repo-wide checks |

The decision is in `docs/decisions/2026-11-23-repo-layout.md`.

## Contribute

Read `AGENTS.md` and `docs/engineering-rules.md` before you change something. Report a vulnerability as `SECURITY.md` says.

## License

MIT. See `LICENSE`.
