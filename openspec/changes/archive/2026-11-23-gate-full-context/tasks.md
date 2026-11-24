## 1. Base evidence
- [x] 1.1 Run the desktop journey script on the base tree and keep the screenshots and logs
- [x] 1.2 Write the failing unit tests first (thread newest, push kind, phone title, phone thread, approach chip) and keep their base output

## 2. Local API and awd
- [x] 2.1 Add `newest`, `before`, `types` and `prev` to `threadQuery`, `threadPage`, the service `thread` and the route (with ancestors)
- [x] 2.2 Add `kind` to the push preview (`plugins/push-webpush`, `loop/rules.ts`, `loop/loop.ts`, the login pushes in `sessions/manager.ts`)
- [x] 2.3 Regenerate `contracts/openapi.yaml`; add the shared decision cut case to `contracts/fixtures/gates/decision-text.json`

## 3. Desktop
- [x] 3.1 `useThread` window with "Show older"; `useWorkEvents`; the Thread component
- [x] 3.2 Gate card: decisions, the cut text, the result artifacts with Open, the answer notices
- [x] 3.3 Approach field: full text per version and the "Waits for you" fix (0-8)
- [x] 3.4 Main call `openTaskArtifact` in `desktop/src/main/artifacts.ts` with its registration lines

## 4. Phone
- [x] 4.1 Room `threadNewest`, `taskEvents`; the model thread window with "Show older"
- [x] 4.2 Push title per `kind`
- [x] 4.3 Gate card decisions and the cut text; the Approach section with full text; the late-answer card
- [x] 4.4 `ArtifactList`, `ArtifactRequests`, `ArtifactRule`; the ignore lines in `EngineSetup` and `SyncEngineController.applyIgnores`
- [x] 4.5 App: the Artifacts section, Download and Open (`FileProvider`), the mobile-data switch on Devices, the thread "Show older"

## 5. Docs and checks
- [x] 5.1 Update `docs/phase-1.md` 8.3 and 10.3
- [x] 5.2 Break each new test once and restore the code
- [x] 5.3 `task check` in shared, daemon, plugins, desktop, e2e; `task android:check`; `task leakcheck`

## 6. End-to-end
- [x] 6.1 Docker e2e `e2e/src/gate-full-context.docker.test.ts` on `-p aw-gate-full-context`
- [x] 6.2 Desktop journey after the change (screenshots, logged open calls)
- [x] 6.3 Phone journey on an Android emulator
