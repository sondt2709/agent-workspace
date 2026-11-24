## 1. Workspace and tooling

- [x] 1.1 Add `desktop` to `pnpm-workspace.yaml` and the `desktop:check` include in the root `Taskfile.yaml`
- [x] 1.2 Create `desktop/package.json` (`@aw/desktop`, 5 standard scripts plus `build`, `dev`, `electron:fetch`), `tsconfig.json` (node and web projects), `eslint.config.js`, `electron.vite.config.ts`, `vitest.config.ts`, `Taskfile.yaml`
- [x] 1.3 Add the MUI theme `createAppTheme()` to `shared/ui` with a test

## 2. awd route for messages

- [x] 2.1 `WorkspaceService.sendMessage()` and the route in `daemon/src/api/messages.ts`, registered in `app.ts`
- [x] 2.2 `sendMessageBody`, `AwClient.sendMessage()`, regenerate `contracts/openapi.yaml`
- [x] 2.3 Route tests: message to a running session, 409 with no session, 400 for an empty text

## 3. Main process and bridge

- [x] 3.1 `src/shared/contract.ts`: channels, call union with zod args, `AwBridge` type, result envelope
- [x] 3.2 `src/main/settings.ts`, `connection.ts` (event stream, reconnect with backoff, states, resync), `calls.ts` (dispatch to `AwClient`, error mapping)
- [x] 3.3 `src/main/protocol.ts` (`app://` with CSP and nonce, path check), `src/main/index.ts` (window, security handlers, sender check, menu without reload)
- [x] 3.4 `src/preload/index.ts` exposes `window.aw`
- [x] 3.5 Tests: backoff and reconnect states, call dispatch and refusal, protocol path and CSP

## 4. Renderer

- [x] 4.1 Entry: Emotion cache with the nonce, theme, QueryClient, router, event wiring (invalidations, resync)
- [x] 4.2 Shell: sidebar (drawer, rail, temporary drawer), workspaces and projects, connection banner, shortcuts (`CmdOrCtrl+N`)
- [x] 4.3 Inbox, Board (6 stages + Needs you lane, Paused chip), List (groups), list/detail panes
- [x] 4.4 Task detail: fields, thread, message box; gate cards for each kind with countdown and request changes
- [x] 4.5 New task and New session dialogs
- [x] 4.6 Component tests with a fake `window.aw`: gate cards, board columns, new task title, event invalidation

## 5. Docs and checks

- [x] 5.1 `docs/tech-stack.md` pins, `AGENTS.md` status and layout, `docs/phase-1.md` 10 (desktop shell state)
- [x] 5.2 `task check` passes
