## Context

`WorkspaceFiles.writeFile` (`shared/core/src/files/workspace.ts`) redacts only the rule `task-terminal`. 4 writers put agent text into the synced `tasks` folder with no redaction:

1. The long message file `artifacts/<device>/text-<id>.md` (`daemon/src/sessions/buffer.ts`).
2. The approach version of the ExitPlanMode hook (`SessionManager`, approach gate).
3. The approach version of `aw approach` and the MCP tool (`daemon/src/loop/agent.ts` `proposeApproach`).
4. The copied files of a session: `aw artifact add`, the result file and its artifacts, the handoff (`SessionManager.#copyFile`).

The redactor of the files layer already has the credential values and the session tokens (`WorkspaceService.setSecrets`, sources `credentials` and `sessions`). The base capture is in the gate message (`base-writefile-8e1c923.log`).

On the phone, `CredentialOutbox.add` writes `tasks/devices/<phone>/sealed/<id>.age`. awd imports it and writes `credential.imported {name, from, sealed}` to its workspace log. No code removes the sealed file.

## Goals / Non-Goals

**Goals:**
- No credential value and no session token in an agent text file of the synced folder.
- A binary artifact keeps its bytes, and `artifact.added` describes the file on disk.
- The phone removes its sealed file after the import.

**Non-Goals:**
- An agent that names any credential in a subtask (fix list 0-1).
- Knowledge files (the knowledge store already redacts; edge cases N10).
- Redaction after an awd restart of a value that a session got before (N28).
- A redaction of the value inside a binary file.

## Decisions

1. **Redact in the files layer, by rule.** `writeFile` redacts the rules `task-terminal`, `task-approach` and `task-artifact`. Each writer of a task text file gets it with no change. Alternative: redact in each caller. Rejected: a later writer can forget it.
2. **Text rule.** A string is text. A byte array is text when `TextDecoder("utf-8", { fatal: true })` decodes it and it has no NUL byte (the rule of git for a binary file). Other bytes stay as they are. Alternative: a list of extensions. Rejected: agent files have any name (`.log`, `.json`, no extension). An ASCII-only binary (rare) counts as text; that redacts more, never less.
3. **Unchanged bytes stay the same object.** When the redaction changes nothing, `writeFile` writes the input as it is. So a text file with no secret keeps its exact bytes.
4. **`writeFile` returns the written content.** `WorkspaceService.writeTaskFile` returns it. `#copyFile` returns the written bytes, so `artifact.added` `size` and `sha256`, and the result text of the gate, describe the synced file. The hash rule of `docs/phase-1.md` 3.3.5 stays: the hash is of the file in the folder.
5. **`WorkspaceFiles.redactText(text)`.** The ExitPlanMode hook compares the version file with the plan to make a retry idempotent. The file is now redacted, so the hook compares it with the redacted plan.
6. **Session tokens.** No new code: the tokens are in the same redactor since mcp-server (`sessions/service.ts` `#redactTokens`). Tests prove `[redacted:mcp-token]` in a long message file.
7. **Phone removal.** New `SealedOutboxCleanup` (`android/control/.../SealedOutboxCleanup.kt`). After each snapshot of the workspace model, it reads the applied `credential.imported` events of the workspace log from the Room index (new query `WorkspaceIndex.workspaceEvents(type)`). For each event with `from` = this phone and a `sealed` id, written by a device whose record is a computer (not mobile, not revoked), it deletes `tasks/devices/<phone>/sealed/<sealed>.age` when the file exists, then runs the targeted scan. One import is enough: `secure/credentials/` syncs to all computers. `AppGraph` runs it in its own collector with a try/catch, so an error does not stop the rekey collector (review 0-26).
8. **Test agent.** The fake agent command `use-credential <name> <bytes>` reads `$AW_CREDENTIALS_DIR/<name>` as an agent does, writes `approach.md`, `notes.txt`, `result.md`, `handoff.md` and `image.bin` (bytes that are not UTF-8, with the value inside) in its folder, and ends the turn with a reply of <bytes> characters that has the value.
9. **Docker e2e.** `e2e/docker/Dockerfile` installs `git` and `tmux` (task move-paused-task adds the same 2 packages). The new override `e2e/compose.redaction.yaml` sets `AW_CLAUDE` to the fake agent. The test pairs 2 containers with test peers, runs the session on macbook-pro and greps the workspace folder of both containers.

10. **tmux format separator.** The first Docker run failed: tmux 3.3a printed `@1_%1_271` for the format `#{window_id}\t#{pane_id}\t#{pane_pid}`, so `new-window` gave "no ids" and no session started. tmux before 3.4 escapes a tab in a format. The host now uses `|` (AW window names never have it) and refuses a line with another field count, with the tmux version in the error (the lead approved it). The fake agent also gets `steps` and `plan-file`, so the first message of a task drives the whole agent part of the journey, and no test message holds the value.

## Risks / Trade-offs

- [A text artifact changes when it has a secret] → its hash is of the changed bytes, and the redaction marker shows the change. The agent keeps its own copy in the worktree.
- [A short secret (4 to 5 characters) matches normal text in a large file] → the encoded forms start at 4 characters and the embedded base64 forms at 6 (existing rules). The change only adds markers; it never adds a value.
- [A binary file with the value inside syncs as it is] → recorded in `docs/phase-1.md` 3.3.5. A person must not attach a binary that holds a value.
- [A delete of the sealed file before a second computer imports it] → not a problem: the first import writes `secure/credentials/<name>.age` for all computers, and the import of the other computers skips an id with `credential.imported`.
- [The Dockerfile line conflicts with move-paused-task at the merge] → both add the same packages; the merge keeps one line.
