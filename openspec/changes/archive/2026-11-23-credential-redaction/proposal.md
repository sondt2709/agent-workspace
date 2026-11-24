## Why

A credential value that an agent writes in a long reply, an approach, a result or a copied file syncs in plain text to every device, the phone too (gap M13, `docs/prd.md` DAT-08 and DAT-09). The files layer redacts only event lines and terminal snapshots. Also, the phone never removes its sealed credential file after a computer imports it, although `docs/phase-1.md` 10.2 says so (gap M22). The sealed value then stays on each device and is not covered by a rotation after a revoke.

## What Changes

- The files layer redacts each text file of a task before it writes it: the terminal snapshot (as now), the approach versions and the artifacts. The artifacts include the long message files (`artifacts/<device>/text-<id>.md`), the files of `aw artifact add`, the result file, the result artifacts and the handoff file.
- A file is text when it is a string, or bytes that are strict UTF-8 with no NUL byte. AW writes other bytes (a binary artifact) as they are.
- `artifact.added` has the size and the sha256 of the written (redacted) bytes, so the hash describes the synced file.
- The session token (`mcp-token`) is in the same redaction, so it is replaced in these files too. It was already in the redaction of events.
- The phone removes `tasks/devices/<phone>/sealed/<id>.age` after a `credential.imported` with that id, from this phone and written by a computer, merges. The delete syncs to each computer.
- The fake agent gets the command `use-credential <name> <bytes>` for the tests.
- The tmux host reads its `-F` format lines with the separator `|` and refuses a line with another field count. tmux before 3.4 (3.2a of Ubuntu 22.04, 3.3a of Debian 12) prints a tab as `_`, so no session started there (a defect of sessions-tmux that the Docker e2e found).
- The e2e test image gets `git` and `tmux`, and a new Docker e2e test checks the synced files of 2 computers.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `workspace-files`: "Redaction" covers the approach versions and the text artifacts, with the text rule; `writeFile` returns the written content.
- `credentials`: "Secrets for the redaction" covers the text files of a task, also for the session token.
- `android-app`: "Credential outbox" removes the sealed file after the import.
- `session-host-tmux`: new requirement "Format lines of each tmux version".
- `agent-sessions`: new requirement "Redacted agent files": the copied files of a session (artifact, result, handoff) and the long message file are redacted, and `artifact.added` has the hash of the written bytes.

## Impact

- `shared/core/src/files/workspace.ts` and `redact.ts`; `daemon/src/service/workspace.ts`; `daemon/src/sessions/manager.ts` (the copy and the approach compare only).
- `android/shared` (one Room query, no schema change), `android/control` (new `SealedOutboxCleanup.kt`), `android/app/AppGraph.kt` (one collector).
- `plugins/host-tmux/src/tmux.ts` (format separator and the field check).
- `plugins/agent-claude/src/testing/fake-claude.ts`; `e2e/docker/Dockerfile`, new `e2e/compose.redaction.yaml` and `e2e/src/credential-redaction.docker.test.ts`.
- Docs: `docs/phase-1.md` 3.3.5 and 10.2, `docs/architecture.md`, `SECURITY.md`. No new dependency, no schema change, no API change.
