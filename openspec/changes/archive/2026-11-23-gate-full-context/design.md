## Context
- The desktop reads the thread with `limit: 1000` from offset 0 (`queries.ts`), so it shows the oldest 1000 events (fix list 0-7). The phone reads the oldest 500 (`WorkspaceModel.kt`, fix list 0-20).
- `gate.opened` has `data.decisions` (`shared/schema/src/events.ts`). `gateText` in `daemon/src/loop/agent.ts` also appends them to the text as a "## Decisions" block. No client renders `data.decisions`.
- The approach versions are files `tasks/<task>/approach/v<n>.md`. The desktop Approach field shows only the first line of the gate text.
- `result.posted` names the artifacts (`artifacts/<device>/<name>`, paths in the task folder). Each has an `artifact.added` with its size and sha256. No client lists them.
- The phone ignores `/*/artifacts` in the tasks folder, with no exception (`EngineSetup.kt`).
- The Done push and the login pushes send `gate_kind: null`, and the phone title then falls back to "A gate needs you".

## Goals / Non-Goals
Goals: the journey of the handoff: decisions, full approach, artifacts, Done push title, answer notices, the newest thread events.
Non-goals: task edits and archive UI (N30), board moves (N32), the Fix a file gate (N24), the description view (N15). A choice of a non-recommended decision option in the card (the person uses "Request changes" with a comment, as the gate text says).

## Decisions
1. **Thread paging in the API.** `GET .../thread` gets `newest=true` (the newest `limit` events), `before=<cursor>` (the `limit` events before the cursor) and `types=<a,b>` (only these types). Each page stays oldest first. The reply gets `prev`: the cursor of the first event of the page when older events exist, else null. `next` keeps its meaning. `ancestors` pages use the same values. Alternative: the client reads all pages and keeps the end. Rejected: it reads the whole thread at each change.
2. **Desktop thread window.** `useThread` reads `newest=true&limit=500`. "Show older" sets a page count. The query function then reads each older page with `before=prev` and joins them, so the window stays one consistent list after each refresh. A line above the oldest shown event says how the person reads more.
3. **Work events query.** `useWorkEvents` reads `types=gate.opened,approach.proposed,result.posted,artifact.added&newest=true&limit=1000`. The gate cards, the Approach field and the result artifacts use it, not the thread window.
4. **Decision block.** The UIs render `data.decisions` and cut the text at the last `\n\n## Decisions\n` when `data.decisions` is not empty. awd keeps the text, so the CLI and the agents still read the decisions. Both languages use the same marker string.
5. **Full approach.** Each version row opens to the file text. Desktop: the task file route (`taskFile`). Phone: the synced file of the tasks folder. The confirm card keeps the gate text (cut at 16 KB with a pointer to the file).
6. **Approach chip (0-8).** "Confirmed" for the confirmed version. "Waits for you" for the latest version when no version is confirmed or the latest is newer than the confirmed one. "Replaced" for the others.
7. **Desktop Open.** New main call `openTaskArtifact {ws, task, path}` in `desktop/src/main/artifacts.ts`. The path must start with `artifacts/`, be a file of the task files route, and its real path must stay in `tasks/<task>/`. The types `png jpg jpeg gif webp pdf txt md log json xml csv` open in the default app (`shell.openPath`). Other types show in Finder (`shell.showItemInFolder`). A synced file can be a program, and the default app of a program runs it.
8. **Answer notices (desktop).** After `answerGate`: the error `gate_not_open` gives "Another answer resolved this gate first: “<answer>”. AW did not send your answer."; `applied: false` gives "AW did not use your answer: <reason>."; an answer of the reply gate with `use: comment` gives "Your answer came after another answer. It is a comment now."
9. **Late answer (phone).** The phone writes to its own log, so it learns of a late answer only after a merge. A resolved gate whose newest answer of this phone has `use: comment` shows a closed card in the task detail: "Your answer “X” came after the answer of <device>. It is a comment now."
10. **Phone thread.** New Room query `threadNewest(task, limit)` (`ORDER BY hlc DESC, dev DESC, id DESC LIMIT`, then reversed). The model reads `limit + 1` rows to know if older events exist. "Show older" adds 500.
11. **Phone artifacts.**
    - `ArtifactList.of(rows, files)` gives each `artifact.added` of the task (newest per path) with its size and state: `REMOTE`, `REQUESTED`, `LOCAL` (the file exists with the size of the event).
    - `ArtifactRequests` keeps the requested paths in `<files>/artifact-requests/<workspace>.txt`, one `<task>/<path>` per line. A path must match `^[0-9a-f-]{36}/artifacts/[a-z0-9-]+/[A-Za-z0-9._-]+$`, so it has no pattern character.
    - `EngineSetup.ignoresOf(workspace, kind)` puts `!/<task>/<path>` lines before `/*/artifacts`. `SyncEngineController.applyIgnores(workspace)` sends the new list at once when the engine runs; else the next config step sends it.
    - `ArtifactRule.check(metered, allowMobileData)` runs at the Download tap. On a metered network with the switch off it refuses with "You are on mobile data. Connect to Wi-Fi, or turn on Use mobile data for artifacts." A started download continues.
    - The switch "Use mobile data for artifacts" is a phone-local file `<files>/artifacts-mobile-data` (default off). It shows on the Devices screen: the phone has no Settings screen yet.
    - Open: `ACTION_VIEW` with a `FileProvider` URI (androidx.core, already a dependency) and a read grant.
12. **Push kind.** The preview JSON gets `kind`: `gate` for a gate or "Assign task" push, `done`, `login_expired`, `login_ends`. `gate_kind` keeps its meaning. Phone title: the gate label for `gate`; "Done", "Login expired", "Login ends soon" for the others; "A gate needs you" for an unknown push with no gate kind.

## Risks / Trade-offs
- [A file of an unknown type in Finder can still be opened by the person] → AW never opens it itself; Finder shows the type.
- [The Syncthing walker skips an ignored folder] → the `!` line is rooted with no wildcard, and the puller creates the parent folders. The emulator journey checks that the file arrives.
- [A download that starts on Wi-Fi continues on mobile data] → accepted for phase 1; the check runs at the tap.
- [The decision marker string changes in awd] → the UI then shows the block twice; a shared test case in both languages uses the awd output.

## Migration Plan
No data migration. Old clients ignore the new query values and the `kind` field.

## Open Questions
(none)
