## Why
A person must confirm an approach and approve a result with the full context: the decisions with their recommendation, the full text of each approach version, and the artifacts. Today the desktop and the phone show only parts of it, a long thread hides the newest events, and a Done push says "A gate needs you" (gaps M19, M23, M24; fix list 0-7, 0-8, 0-20).

## What Changes
- The thread route of the local API gets the optional query values `newest`, `before` and `types`, and the reply field `prev` (additions only).
- Desktop: the thread shows the newest 500 events with "Show older". The gate cards and the task fields read the work events of the task through a `types` query, so a long thread never hides a gate.
- Desktop and phone gate cards show the decisions of `gate.opened` with their options and the recommended option, and cut the generated decision block of the text.
- Desktop and phone: the Approach field lists each version, and each version opens to its full file text. A version newer than the confirmed one shows "Waits for you".
- Desktop and phone: "Approve result" lists the artifacts. Desktop "Open" opens document types in the default app and shows other types in Finder. The phone downloads an artifact on request.
- Desktop: a clear notice when awd refuses an answer (`gate_not_open`), does not apply it, or keeps it as a comment. Phone: a closed card when the phone answer became a comment.
- Phone: the thread shows the newest 500 events with "Show older".
- Phone: Download adds a `!` exception for the artifact file to the ignore list of the tasks folder. A switch "Use mobile data for artifacts" (default off) and a metered-network check guard it.
- The push preview gets the field `kind` (`gate`, `done`, `login_expired`, `login_ends`). The phone titles are "AW-12 · Done", "AW-12 · Login expired" and "AW-12 · Login ends soon".

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `local-api`: the thread route reads the newest page, a page before a cursor, and a type filter.
- `push-sender`: the preview has the field `kind`.
- `android-sync-engine`: the ignore list of the tasks folder has the `!` lines of the requested artifacts.
- `android-app`: gate cards with decisions, full approach versions, artifacts with Download, the thread window, the late-answer card, the push titles of Done and login.
- `desktop-app`: gate cards with decisions, full approach versions, artifacts with Open, the answer notices, the thread window.

## Impact
- Code: `daemon/src/service/workspace.ts`, `daemon/src/api/app.ts`, `shared/client`, `daemon/src/loop/rules.ts`, `daemon/src/loop/loop.ts`, `daemon/src/sessions/manager.ts`, `plugins/push-webpush`, the desktop main and renderer, `android/shared` (index queries), `android/control`, `android/engine`, `android/app`.
- Contracts: `contracts/openapi.yaml` (regenerated, additions only); the push preview in `docs/phase-1.md` 8.3.
- No new dependency. No change to the schemas of documents or events. No data migration (the Room change adds queries only).
