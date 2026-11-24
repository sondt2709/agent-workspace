## 1. Files layer (shared/core)

- [x] 1.1 Write the unit tests first: approach and text artifact redacted (string and UTF-8 bytes, URL form, `mcp-token`), binary bytes (not UTF-8, NUL byte) unchanged, the return value, a sealed file unchanged. Run them on the base and keep the failing output.
- [x] 1.2 Add `isText(bytes)` and redact the rules `task-terminal`, `task-approach` and `task-artifact` in `writeFile`; return the written content; add `redactText`.
- [x] 1.3 Change the old terminal test line that asserted a raw text artifact.

## 2. Daemon

- [x] 2.1 `WorkspaceService.writeTaskFile` returns the written content.
- [x] 2.2 `SessionManager.#copyFile` returns the written bytes (size and sha256 of `artifact.added`, result text).
- [x] 2.3 The ExitPlanMode approach hook compares the file with the redacted plan.
- [x] 2.4 Fake agent: `use-credential <name> <bytes>` (header comment too).
- [x] 2.5 New `daemon/src/loop/redaction.e2e.test.ts`: long reply, `aw approach`, `aw artifact add`, `aw result --artifact image.bin`, `aw handoff`, a plan with the value (and its hook retry), the token in a long message; grep the workspace folder; sha256 of the binary. Run it on the base (fails) and after.

## 3. Phone (android)

- [x] 3.1 Room query of the workspace events of one type (`WorkspaceIndex.workspaceEvents`).
- [x] 3.2 New `SealedOutboxCleanup` in `android/control` with JVM tests (removal, other phone, mobile writer, no import, second run).
- [x] 3.3 `AppGraph`: run the cleanup after each snapshot in its own collector with a try/catch, then the targeted scan.

## 4. End-to-end

- [x] 4.0 host-tmux: the `|` separator and the strict field parse, with a unit test (found by the first Docker run on tmux 3.3a).

- [x] 4.1 `e2e/docker/Dockerfile`: `git` and `tmux`; new `e2e/compose.redaction.yaml` (`AW_CLAUDE`).
- [x] 4.2 New `e2e/src/credential-redaction.docker.test.ts`: 2 computers, the session on macbook-pro, grep both workspace folders (0 values, markers), binary sha256. Run it on the base (value found) and on the final code.
- [x] 4.3 Phone journey on the Linux test computer with the Android emulator: pair, add `staging-api-key` on the phone, `credential.imported`, the sealed file is gone on the phone and on the computer; a session with the credential; grep the phone folder.

## 5. Docs and checks

- [x] 5.1 `docs/phase-1.md` 3.3.5 and 10.2, `docs/architecture.md` redaction lines, `docs/engineering-rules.md` 5.11, `SECURITY.md` token row.
- [x] 5.2 Break each new test once and restore it.
- [x] 5.3 `task check` in shared, daemon, plugins, e2e; `task android:check`; `task leakcheck`; `openspec validate --strict`.
