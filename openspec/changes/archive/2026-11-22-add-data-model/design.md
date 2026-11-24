## Context

The scaffold task made placeholder packages `@aw/schema` and `@aw/core`. The docs define the AW folder (`docs/phase-1.md` 3.1), the documents (3.2), the logs (3.3), the schema rules (3.4), the ids and the HLC (3.6), the ownership table (`docs/architecture.md` 4.3.1) and the event types (`docs/workflow.md` 3, 4 and 8). This change turns these rules into code. Other tasks use it: merge-index (merge, index), awd-api-cli (the service), android-shared (the same formats in Kotlin).

## Goals / Non-Goals

**Goals:**
- One zod source for each file format, with a versioned name and a generated JSON Schema.
- Ids, HLC and clock code that later tasks and Kotlin can reuse, with test vectors.
- A `files` layer that is the only way to write workspace files: atomic, owner-checked and redacted.
- Typed errors that later tasks show as the gate "Fix a file" and as "Sync problem".
- A fixture AW folder with 3 devices.

**Non-Goals:**
- The merge of logs, the task state, claims, task keys and the index (merge-index).
- The awd service, the log buffer of 1 second and the targeted scans (awd-api-cli, sync-syncthing).
- Signature checks of device records (identity-pairing). The schema has the fields only.
- The Kotlin classes (android-shared). The generator has the place for them.

## Decisions

1. **Package split.** `@aw/schema` holds the zod schemas, the registry, the generator, the ids, the HLC, the test vectors and the fixtures (`docs/phase-1.md` 11). `@aw/core` holds the clock and the `files` layer, and depends on `@aw/schema`. The HLC takes a `{ now(): number }` time source, so `@aw/schema` does not depend on the clock module. Alternative: a separate `@aw/clock` package. Rejected: the layout of `phase-1.md` 11 is final.

2. **Field names are snake_case in all files.** The docs mix `first_message` with `resumesAt` and `basedOn`. One rule is simpler for Kotlin `@SerialName` and for people who edit the files. `docs/phase-1.md` 3.2 changes `paused` to `{cause, since, resumes_at, next_step, needs_human}`, and 9.6 changes `basedOn` to `based_on`.

3. **Loose objects.** Each object schema is `z.looseObject`: a reader keeps unknown fields, and a writer writes them back. So a new optional field is a minor change (`phase-1.md` 3.4.2), and an older awd does not drop the field of a newer awd. Known fields are checked strictly. Alternative: strict objects. Rejected: an older device would reject the files of a newer device.

4. **Versions.** A document has `kind` and `schema` (the major). An event has `v`, the major of its event type; each type starts at 1. The schema name is `<type>.v<major>`, for example `task.v1` and `event.v1`. The registry maps each kind and major to a schema. A reader accepts the current and the previous major, and reports a newer major as `NewerVersionError` ("Update AW on <device>"). An event with an unknown type is kept as an unknown event, not an error, because a new event type is a minor change.

5. **Event envelope.** `{v, id, hlc, dev, type, task?, by?, data}`. `task` is optional, because the folder of a task log names the task. `by` is `<actor>@<device>`, for example `human@pixel-9` or `claude@ubuntu-01`. `event.v1` is a discriminated union on `type`. The event types are the types of `workflow.md` 8 and 4, `architecture.md` 4.3 and 4.6, and `phase-1.md` 5 and 9 (list in `specs/workspace-schemas`). The heartbeat is the event type `device.heartbeat`, so one reader reads all JSON Lines files. `heartbeat.v1` is the same envelope narrowed to that type.

6. **JSON Schema generation.** `z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" })`. `io: "input"` makes fields with a default optional, as a file of an older minor can omit them. The generator formats each file with the Prettier config of the repository, so `pnpm format:check` passes on generated files. Output: `packages/schema/generated/schemas/<type>.v<major>.schema.json`. The scaffold already marks `packages/schema/generated/` as generated (`.gitattributes`, `.pre-commit-config.yaml`). The generator has a list of targets; the android-shared task adds the Kotlin target to it.

7. **Drift check in two places.** A Vitest test renders the schemas in memory and compares them with the files, so `task check` fails on drift. CI also runs `pnpm schema:generate` and `git diff --exit-code` plus an untracked-file check (`engineering-rules.md` 7.3.2).

8. **Independent validator: `@cfworker/json-schema` 4.1.6**, a dev dependency. Alternative: `ajv` 8.20. Rejected: its last release is 2026-04-24, 7 months old, so it fails rule 4.9.2. `@cfworker/json-schema` is MIT, has no dependencies, has about 16 million downloads per week, supports draft 2020-12 and had a release on 2026-11-04.

9. **Import extensions.** The source uses `.ts` import extensions, and `tsconfig.base.json` sets `rewriteRelativeImportExtensions`. Workspace packages export `./src/index.ts`. So Node 24 runs `packages/schema/scripts/generate.ts` and the crash test child with type stripping, with no build step and no `tsx` (`tech-stack.md` 2.6).

10. **HLC.** Text `<UTC ISO time with ms>#<4-digit counter>`, which sorts as text. `now()` and `receive(remote)` follow the standard HLC rules: the time part is the maximum of the last time, the remote time and the physical time; the counter grows when the time part does not change. When the counter passes 9999, the time part moves 1 ms forward and the counter starts at 0, so the text stays sortable. Events sort by HLC text, then by device slug. The test vectors in `packages/schema/test-vectors/hlc.json` hold format cases, order cases and operation sequences; the Kotlin tests read the same file.

11. **Ids.** `uuid` 14 `v7({ msecs: clock.now() })`, so the ids read the time only through the clock module.

12. **Clock.** `Clock { now(): number; sleep(ms): Promise<void> }` in `@aw/core`. `systemClock` uses `Date.now()` and `setTimeout`. `FakeClock` has `set()` and `advance()`; `advance()` resolves each sleep whose time passed. No other code reads `Date.now()`.

13. **Atomic write.** Write to `<name>.<pid>-<random>.aw-tmp` in the same folder, `fsync` the file, rename it over the target, then `fsync` the folder (best effort). The name ends with `.aw-tmp`, so the ignore pattern `*.aw-tmp` keeps it out of sync, and 2 writers in one process do not share a temp file. On an error, the writer removes the temp file. A crash leaves the old file and maybe a temp file; `removeStaleTempFiles()` removes temp files later.

14. **YAML documents.** Read: `parseDocument`, then a syntax check, then the schema of the `kind` and `schema` fields. Write: when the file exists, AW parses it and changes the existing nodes in place (a scalar keeps its node, so its comment stays), adds new keys and removes missing keys. Then it writes the result atomically. Comments on removed or replaced nodes are lost; that is the limit of the library.

15. **JSON Lines.** Append: validate, redact, `JSON.stringify` (one line, no newline inside), check the 64 KiB limit, then `appendFile`. When the file does not end with `\n` (a crash cut the last line), the writer first writes `\n`. So the cut line stays a separate bad line and the new line stays valid; the writer never rewrites a line. Read: split on `\n`. A last part with no `\n` is a half-written line: the reader skips it and reports it as `partialTail`, because the writer may still finish it. Each other bad line becomes a typed error with its line number. A line whose `dev` is not the device of the file name is a `DeviceMismatchError` ("Sync problem", `phase-1.md` 4.1). `classifyPath` gives each log a kind (`task`, `workspace`, `knowledge`, `heartbeat`). The writer refuses, and the reader reports as a schema error on `task` or `type`, an event of another task than the folder, or a known type of another kind of log: heartbeat files hold `device.heartbeat`, the knowledge log `knowledge.*`, the workspace log `slot.*`, `queue.*` and `credential.*`, a task log the other types. An unknown type (a newer minor) is not checked.

16. **Write guard.** `classifyPath(relativePath)` maps a path under the workspace root to an entry of the ownership table (`architecture.md` 4.3.1, `phase-1.md` 3.1). `checkWrite()` refuses: a path outside the table, `..` parts, `*.aw-tmp` and `*.sync-conflict-*` names, a file of another device, a device record without the master key, the `secure` folder on a mobile device, a `task.yaml` of a task that this device does not own (the caller gives the owner, from merge-index later), and a second write of `approach/v<n>.md`. The refusal is a `WriteRefusedError` with the path and the rule. A `*.aw-tmp` or `*.sync-conflict-*` name is refused in any part of the path, because the sync engine ignores such a folder too. `classifyPath` also gives the identity field of a document (`id` of `task.yaml`, `slug` of `project.yaml` and `device.yaml`, `device` of `health.yaml` and `bindings.yaml`). `readDocument` and `writeDocument` compare it with the folder name, so a device cannot write its own `health.yaml` as another device. `writeDocument` reads the old file first and refuses to write over a newer major version (`NewerVersionError`), so an older AW never drops the fields of a newer one.

17. **Redaction.** `createRedactor([{name, value}])`. For each value AW makes these forms: plain, standard base64 and base64url (with and without padding), and the URL encodings: `encodeURIComponent`, RFC 3986 (curl `--data-urlencode`, Python `quote_plus`, which also encode `!'()*`), Python `quote` (keeps `/`) and the WHATWG form encoding (`URLSearchParams`: keeps `*`, encodes `~`), each with upper- and lower-case hex and with `%20` or `+`. For values of 6 characters or more, it also adds the base64 parts that do not depend on the offset of the value inside a longer base64 text (offsets 0, 1 and 2), for example an HTTP Basic auth header; each part is 7 or more base64 characters. It replaces the longest form first with `[redacted:<name>]`. The event writer validates the event, then `redactBySchema` walks it with its zod schema: it redacts each string with no strict format (no regex, UUID or date format) and each key and value that the schema does not know, and never changes the envelope, a known field name or a formatted field (ids, HLC, slugs, hashes, enums). So a short secret such as `2026` cannot break an HLC or an id. Then the writer validates the event again. Values shorter than 4 characters are redacted in the plain form only, because their encoded forms match normal text. The MCP token uses the name `mcp-token`. `writeFile` also redacts a terminal snapshot (`terminal/<device>.txt`). It does not change an artifact, so the sha256 of `artifact.added` stays true; the sessions task redacts an artifact before it writes it, if needed.

18. **Typed errors.** One base class `AwFileError` with a `code`: `parse_error`, `schema_error` (with `issues: [{path, field, message}]`), `newer_version`, `unsupported_version`, `device_mismatch`, `line_too_long`, `write_refused`. Each has the relative file path, and the line for a log. The gate "Fix a file" and "Sync problem" use them later.

19. **Fixtures.** `packages/schema/fixtures/workspace/` is a full AW folder: `tasks/` with `workspace.yaml`, a workspace log, 3 devices with records, health, bindings and heartbeats, 1 project, 1 task with logs from all 3 devices and `approach/v1.md`; `knowledge/` with 1 file and a change log; `secure/test-servers.yaml`. The data is synthetic (`docs/engineering-rules.md` 3.2). The values of keys and signatures are fixed placeholders, not real keys.

## Risks / Trade-offs

- [Loose objects accept a misspelled optional field] → The reader keeps it; the field stays unused. The fixtures and the tests check the known fields.
- [The JSON Schemas from zod can differ from the zod checks, for example regex flavors] → The fixture test validates each fixture file with `@cfworker/json-schema` too, and the invalid samples are checked by both.
- [A future HLC from a device with a wrong clock moves all HLCs forward] → The order stays correct. merge-index or device health can warn about the skew; this change does not limit it.
- [Redaction of short values] → Values below 4 characters are redacted in the plain form only. A credential that short is not a real secret.
- [A secret inside a formatted field (id, HLC, slug) stays] → These fields have a strict format and hold no credential. A redaction there would break the event, so the redaction skips them.
- [A crash leaves `*.aw-tmp` files] → Sync ignores them, readers ignore them, and `removeStaleTempFiles()` removes them.
- [`rewriteRelativeImportExtensions` changes the base tsconfig of all packages] → It only allows `.ts` extensions; the `.js` imports of the other placeholders still work.

## Migration Plan

No data exists yet. The schemas start at major 1.

## Open Questions

- The phone file `push.yaml` and `sealed/<id>.age` have no schema yet. The push and pairing tasks add them as new kinds (a minor change).
- Task `priority` has no defined scale in the docs. A later task adds it as an optional field.
