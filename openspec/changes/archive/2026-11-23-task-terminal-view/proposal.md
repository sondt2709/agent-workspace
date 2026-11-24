## Why

A person cannot see the screen of a session from another device, and cannot open its terminal from the desktop app. No code writes `tasks/<task>/terminal/<device>.txt` (gap M12), the desktop and the phone have no terminal view (M12b, M12c), and "Take over terminal" and the `login_expired` pause give only a text hint (M18). Also, some writers cut agent text before the redaction, so a prefix of a credential value can sync (fix list 0-41).

## What Changes

- awd writes a terminal snapshot for each running tmux session: at most once per 30 s when the screen hash changed, and at once after each `gate.opened` of the task. The file has one JSON header line (device, session, host, socket, window, capture time) and the screen. The writer redacts the full screen before it cuts it to 200 lines and 64 KiB.
- The files layer always decodes and redacts the bytes of a terminal snapshot (review finding 4 of credential-redaction).
- Each writer that cuts agent text redacts the full text first: the long message preview, the gate text and title of an approach, a custom gate and a result, the permission gate summary, and the "Last terminal line" of the watchdog (fix list 0-41).
- New person route `GET /v1/workspaces/{ws}/tasks/{task}/terminal`: the newest snapshot (text, device, time), a note for an Orca session (AW does not read its screen), and how the person opens the terminal and signs in (an argv for this device, a command to copy for another device).
- New CLI command `aw terminal <task>`.
- Desktop: a Terminal tab in the task detail; a main-process call `openTerminal` that opens Terminal.app with `tmux attach` for a local tmux session, activates the Orca worktree for a local Orca session, and gives the ssh command to copy for a remote device. "Open the terminal" on the "Take over terminal" card and "Sign in" (`claude auth login`) on the `login_expired` pause.
- Phone: a Terminal section in the task detail with the newest synced snapshot and its time.

## Capabilities

### New Capabilities
- `terminal-snapshot`: the snapshot file of a session screen: its format, the write rule, the redaction before the cut, and the readers on the desktop and the phone.

### Modified Capabilities
- `workspace-files`: the redaction of a terminal snapshot decodes bytes with replacement characters and always redacts them.
- `agent-sessions`: each writer redacts agent text before it cuts it.
- `local-api`: the terminal route.
- `aw-cli`: the command `aw terminal`.
- `desktop-app`: the Terminal tab, "Open the terminal" and "Sign in".
- `android-app`: the Terminal section of the task detail.

## Impact

- Code: `daemon/src/sessions/` (new `terminal-snapshot.ts`, small changes in `manager.ts`, `buffer.ts`, `context.ts`, `service.ts`), `daemon/src/loop/agent.ts`, `daemon/src/continuity/watchdog.ts`, new `daemon/src/service/terminal.ts`, `daemon/src/api/terminal-routes.ts`, `daemon/src/cli/terminal.ts`; `shared/core/src/files/workspace.ts`; new `shared/client/src/terminal.ts`; `desktop/src/main/terminal.ts` and the renderer; `android/control` `TerminalPane.kt` and the task screen.
- Contracts: `contracts/openapi.yaml` (generated, additions only), new `contracts/fixtures/terminal/cases.json`. The snapshot file format is a new public format (approval A).
- No new dependency. The desktop starts `osascript` and `orca` with exec-form arguments.
- Docs: `docs/phase-1.md` 3.1, 3.3.5, 10.1, 10.13.
