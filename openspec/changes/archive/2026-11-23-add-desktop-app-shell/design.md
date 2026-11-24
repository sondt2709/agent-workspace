## Context

awd serves the local API on `~/.aw/run/awd.sock` (fastify, OpenAPI in `contracts/openapi.yaml`), with the event stream `GET /v1/events` (`hello`, `changed`, `notice`). `@aw/client` has the typed client (axios with `socketPath`, `ws` with `ws+unix:`). The task view of the merge has the stage, the "Needs you" reasons, the pause, the gates with their answers, the approach versions, the session and the claim. The text of a gate is in its `gate.opened` event in the thread. `shared/ui` is a placeholder. The prototype (`aw-p1-src`) sets the layout, the wording and the dense neutral look.

## Goals / Non-Goals

**Goals:**
- An Electron app that builds and typechecks in `task check`, with the security rules of `tech-stack.md` 1.4 and `engineering-rules.md` 5.18.
- The task and gate screens of the handoff, on real awd data.
- Component tests where the screens have logic.

**Non-Goals:**
- Devices, sync, pairing, knowledge, Files content, notifications, menu bar (desktop-devices-kb).
- Packaging, signing, auto-update. A Playwright run (Test later).

## Decisions

1. **Folder layout.** `desktop/src/shared/contract.ts` (the bridge contract), `src/main/` (Node), `src/preload/`, `src/renderer/` (React). electron-vite 6 builds the 3 parts into `out/`. Two tsconfig files: `desktop/tsconfig.json` (main, preload, contract; NodeNext, Node types) and `desktop/src/renderer/tsconfig.json` (renderer and contract; Bundler, DOM, no Node types). ESLint finds the nearest one for each file. Alternative: one tsconfig. Rejected: the renderer must not see Node types.
2. **One call channel with a method union.** The contract has a zod discriminated union of the allowed calls (`status`, `workspaces`, `projects`, `tasks`, `task`, `thread`, `gates`, `sessions`, `createTask`, `editTask`, `assignTask`, `archiveTask`, `answerGate`, `sendMessage`, `stopSession`). The preload exposes `call(method, args)`, typed by the contract, which sends `aw:call` with `{method, args}`. The channel names and the types are in `channels.ts` (no runtime dependency, so the sandboxed preload bundle has no zod); the zod schemas are in `contract.ts` (main only). Main parses the payload, checks the sender frame (`app://`), and calls `AwClient`. Errors return as a plain `{ok: false, error: {code, message, status}}` (an Error object loses its fields over IPC). Alternative: one channel per method. Rejected: more handlers, same check. Alternative: a generic `request(path)`. Rejected: too wide for the security boundary.
3. **Events.** Main sends `aw:event` (the parsed stream message), `aw:connection` (`connecting`, `online`, `offline` with the reason and the next try) and `aw:resync` (after each reconnect). The preload `on*()` functions return an unsubscribe function. The renderer invalidates by key: a `changed` message with `full` or `workspace_changed` invalidates the workspace; else the listed tasks, the task lists, the gates and the threads of those tasks. `resync` invalidates all queries.
4. **Reconnect.** `AwConnection` opens the event stream. When it closes or fails, it waits a backoff (500 ms × 2^n, at most 30 s, with jitter) through an injected clock (`sleep`), and opens again. `p-retry` runs the attempts (`minTimeout: 0`, `onFailedAttempt` waits, as `tech-stack.md` 2.1 says). Calls go through the same `AwClient`; an unreachable awd gives the error code `unreachable`.
5. **Serving and CSP.** `protocol.handle("app")` serves `out/renderer/`. Each HTML reply gets a new nonce: main puts it in the `Content-Security-Policy` header (`default-src 'none'; script-src 'self'; style-src-elem 'self' 'nonce-<n>'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'`) and in a `<meta name="csp-nonce">` tag. The renderer reads the tag and creates the Emotion cache with `nonce`. In development (`electron-vite dev`), the window loads the Vite server URL with no CSP, because the React refresh preamble is an inline script. `sandbox`, `contextIsolation` on, `nodeIntegration` off, navigation and `window.open` refused (links open with `shell.openExternal` only for `https:`).
6. **Routes hold the selection.** `createHashRouter`: `/` (redirects to the Inbox of the first workspace), `/w/:ws/inbox`, `/w/:ws/p/:project/board`, `/w/:ws/p/:project/list`, `/w/:ws/p/:project/knowledge`, `/w/:ws/p/:project/files`, `/w/:ws/tasks/:task`. A list or board selection is the search param `task`. From 840 px the selected task shows next to the list in `react-resizable-panels`; below 840 px a selection opens the task route (Back returns). From 1200 px the task detail shows the thread and the fields side by side.
7. **Board lanes.** A task in the "Needs you" lane does not show again in its stage column, so each card shows once.
8. **Gate cards from the gate view and the thread.** The card type comes from `gate.kind`; the buttons come from `gate.options`. The text and the request come from the `gate.opened` event of the thread (`useThread`). Approve command shows a countdown from the HLC time of `gate.opened` (120 s). Confirm approach and Approve result have "Request changes" with a required comment. Reply and Question have a free-text answer. Assign has the agent choice. Fix a file shows the options. An answer that this device sent shows "Answer sent · waits for <owner>" until the gate resolves.
9. **New session = a human `task.assigned`.** awd claims a task again when a newer human `task.assigned` sorts after the claim (`workflow.md` 4.2). The dialog assigns the selected `agent@device`. The host field shows tmux; Orca is disabled until host-orca reports it (open issue).
10. **Send a message.** A new service method `WorkspaceService.sendMessage(task, text)` writes `message.sent {id, text, to_session}` for the running session of the task, else 409 `conflict` ("No session runs"). The route is in a new file `daemon/src/api/messages.ts` with one registration line, to keep the merge with parallel tasks small.
11. **Theme.** `createAppTheme()` in `shared/ui` maps the prototype tokens to the MUI palette (`primary` = ink, `warning` = "Needs you", `info` = running, `success` = done, `error`), typography (13 px base, Inter/system), shape 6 px, dense defaults (`size: "small"`, dense lists, small tables). The app uses `colorSchemes` light and dark with `cssVariables`.
12. **Electron binary.** Electron 45 has no install script: `pnpm install` does not download the binary, and build, typecheck and tests do not need it. `pnpm --filter @aw/desktop electron:fetch` (the `install-electron` bin) downloads it for a run of the app. No `allowBuilds` entry is necessary.
13. **Small shared exports.** `@aw/client/types` (the reply types with no runtime import, so the renderer does not type-check Node code) and `@aw/core/clock` (the clock module, so main does not bundle the whole core).
14. **Renderer clock.** `src/renderer/src/clock.ts` gives `useNow()` through a React context; tests give a fixed clock. Main uses `systemClock` of `@aw/core/clock`, and the connection tests use `FakeClock`.

## Risks / Trade-offs

- [The app was not started in this task (lean mode)] → The result handoff lists a Playwright run and a manual run in "Test later".
- [A `changed` event with many tasks invalidates many queries] → Queries of tasks that are not on screen are inactive and do not refetch.
- [The thread is loaded for each gate card in the Inbox] → TanStack Query dedupes by task; one thread request per task.
- [Electron 45.3.2, not 45.4.1] → The 7-day release age rule; the next install takes the newer patch.
