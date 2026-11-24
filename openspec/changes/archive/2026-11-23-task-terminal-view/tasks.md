## 1. Redaction before a cut (fix list 0-41, review finding 4)

- [x] 1.1 `shared/core` files layer: decode `task-terminal` bytes with replacement characters and always redact them; test with a byte 0xE9
- [x] 1.2 `buffer.ts`: redact the long text before the 2,000-character preview; test with a value at character 1,990
- [x] 1.3 `loop/agent.ts`: redact the content before `titleOf` and `gateText` in `approach`, `gate` and `result`; test with a value across the title cut
- [x] 1.4 `context.ts` `toolSummary` takes a redact function; the manager passes the files redaction; test with a long Bash command
- [x] 1.5 Watchdog: the "Last terminal line" comes from the redacted screen (one manager line; no unit test: the watchdog runs on the real clock)

## 2. Snapshot writer (awd)

- [x] 2.1 `daemon/src/sessions/terminal-snapshot.ts`: header, `snapshotText` (redact, then cut to 200 lines and 64 KiB at a line start), `parseSnapshot`, `TerminalSnapshots` write rule (30 s and hash change; gate write at once)
- [x] 2.2 `contracts/fixtures/terminal/cases.json` (parse cases) and the TypeScript test that runs them
- [x] 2.3 `EventBuffer` optional `afterWrite(task, type)` hook (errors logged); the manager writes a snapshot after each `gate.opened` of a running tmux session of this device
- [x] 2.4 The manager writes the periodic snapshot in the watchdog check; no snapshot for Orca
- [x] 2.5 Unit tests of the rule (first write, 30 s, same hash, gate write), the header and the cut
- [x] 2.6 Daemon e2e test with real tmux and the fake agent: a gate writes the snapshot with the marker

## 3. Route, client and CLI

- [x] 3.1 `shared/client/src/terminal.ts`: zod schema and types of the reply; `DesktopClient.terminal`
- [x] 3.2 `daemon/src/service/terminal.ts` `terminalView` (newest snapshot, note, open and sign_in targets) and the local target of the session manager (`SessionService.localTerminal`)
- [x] 3.3 `daemon/src/api/terminal-routes.ts` person route, registered in `app.ts`; `pnpm api:generate`
- [x] 3.4 `aw terminal <task>` (`daemon/src/cli/terminal.ts`), registered in `run.ts`
- [x] 3.5 Route and CLI tests: snapshot of another device, newest of 2, local tmux argv, remote ssh command, Orca note, session caller 403

## 4. Desktop

- [x] 4.1 `desktop/src/main/terminal.ts`: `TerminalLauncher` adapter (osascript, orca with `execFile`) and `openTerminal`; tests with a fake launcher (local tmux, Orca, remote, sign in)
- [x] 4.2 Bridge calls `terminal` and `openTerminal` (`contract.ts`, `channels.ts`, `calls.ts`, `index.ts`)
- [x] 4.3 Renderer: `TerminalView.tsx` (Terminal tab), `OpenTerminalButton` on the "Take over terminal" card and "Sign in" on the `login_expired` pause; tests

## 5. Phone

- [x] 5.1 `android/control` `TerminalPane.kt` (parse, newest, texts) and `TerminalPaneTest` on the shared fixture
- [x] 5.2 Task detail Terminal section in `TaskScreens.kt` with the model reload as the key

## 6. Docs and checks

- [x] 6.1 `docs/phase-1.md` 3.1, 3.3.5, 10.1, 10.13
- [x] 6.2 Docker e2e `e2e/src/terminal-view.docker.test.ts` (project `aw-task-terminal-view`)
- [x] 6.3 `task check` in shared, daemon, desktop, e2e; `task android:check`; `task leakcheck`; `openspec validate --strict`
- [x] 6.4 Evidence: breaks of each new test, desktop journey after, phone on an Android emulator
