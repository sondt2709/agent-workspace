## Why

People need the window of the local awd on the Mac to work with tasks and gates: see what needs them, answer gates, read the raw thread and create tasks. awd, the local API and the sessions exist now (tasks awd-api-cli, sessions-tmux), so the desktop app can use them.

## What Changes

- New top-level folder `desktop/` (`@aw/desktop`): an Electron 45 app built with electron-vite.
  - Main process: the one awd connection (`@aw/client` with axios on `~/.aw/run/awd.sock` and `ws+unix:` for events), reconnect with backoff, events forwarded over IPC, `resync` after each reconnect. The UI is served from `app://` with a CSP and an Emotion nonce. Main checks the sender frame of each IPC call.
  - Preload: a narrow typed bridge `window.aw` from one contract module (channel names and zod payloads). Each `on*()` returns an unsubscribe function.
  - Renderer: React 19 + MUI 9 with the theme of `shared/ui`, TanStack Query for awd data, `react-router` hash routes for the selection.
  - Screens: sidebar (workspaces, projects with Board, List, Knowledge and Files), Inbox, Board (6 stages and the "Needs you" lane, the Paused chip), List, Task detail (fields, thread, gate cards), New task, New session. One layout from a 400 px window to a wide screen.
- `shared/ui`: `createAppTheme()` with the prototype tokens (light and dark, dense defaults).
- awd: a new route `POST /v1/workspaces/{ws}/tasks/{task}/messages` writes `message.sent` to the running session of the task (sessions-tmux open issue 8). `@aw/client` gets `sendMessage()`.
- `task check` runs the `desktop/` checks (format, lint, typecheck, electron-vite build, component tests).
- Docs: `tech-stack.md` (pins), `AGENTS.md` (status, layout), `phase-1.md` 10.

Out of scope: devices and sync page, the Sync button, pairing, knowledge pages, notifications, menu bar (task desktop-devices-kb); packaging and signing; the Playwright run.

## Capabilities

### New Capabilities
- `desktop-app`: the Electron main process connection, the preload bridge, the renderer data rules and the task and gate screens.

### Modified Capabilities
- `local-api`: a new route sends a message from the person to the running session of a task.
- `repository-tooling`: the workspace has the package `desktop`, and `task check` runs its checks.

## Impact

- New package `desktop/` with new dependencies from `tech-stack.md` 1.4 and 2.4 (Electron, electron-vite, Vite, React, MUI, Emotion, TanStack Query, react-router, react-hook-form, react-resizable-panels, react-markdown, p-retry, Testing Library, jsdom).
- `shared/ui` gets MUI as a dependency.
- `daemon/src/api/messages.ts` (new), one line in `daemon/src/api/app.ts`, one method in `WorkspaceService`, `contracts/openapi.yaml` regenerated.
- `pnpm-workspace.yaml` lists `desktop`. The Electron binary downloads only on request (`electron:fetch`).
