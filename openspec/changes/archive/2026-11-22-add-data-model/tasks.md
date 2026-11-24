## 1. Setup

- [x] 1.1 Add `zod` 4.6.7 and `uuid` 14.0.3 to `@aw/schema`, `yaml` 2.9.1 and `zod` to `@aw/core`, `@cfworker/json-schema` 4.1.6 and `prettier` as dev dependencies; add the `@aw/schema` workspace dependency to `@aw/core`
- [x] 1.2 Set `rewriteRelativeImportExtensions` in `tsconfig.base.json`; export `./src/index.ts` from both packages
- [x] 1.3 Add the `@cfworker/json-schema` row to `docs/tech-stack.md` 2.6 (rule 4.11)

## 2. Schemas (`@aw/schema`)

- [x] 2.1 Common field schemas: UUIDv7, device slug, HLC text, actor `name@device`, task key, project slug, credential name, ISO time, sha256
- [x] 2.2 Document schemas: workspace, project, task, device, health, bindings, test-servers
- [x] 2.3 Event envelope and the data schema of each event type; `event.v1` union and `heartbeat.v1`
- [x] 2.4 Registry of schema names, kinds and majors; version check helper (current, previous, newer)
- [x] 2.5 Unit tests: valid and invalid samples for each document and event type

## 3. Ids and HLC

- [x] 3.1 `newId(timeSource)` with `uuid` `v7({msecs})`
- [x] 3.2 HLC module: format, parse, compare, `now()`, `receive()`, counter overflow, event order by HLC then device
- [x] 3.3 Test vectors `packages/schema/test-vectors/hlc.json` and the tests that run them; ordering and clock skew tests

## 4. Generation

- [x] 4.1 `renderSchemas()` with the list of targets (JSON Schema now; Kotlin hook) and Prettier formatting
- [x] 4.2 `packages/schema/scripts/generate.ts` and the root script `pnpm schema:generate`
- [x] 4.3 Drift test and the CI step "Generated schemas are current"

## 5. Files layer (`@aw/core`)

- [x] 5.1 Clock module: `systemClock`, `FakeClock`
- [x] 5.2 Typed errors (`AwFileError` and its codes)
- [x] 5.3 Atomic write and `removeStaleTempFiles()`; tests for an error before the rename and a SIGKILL crash in a child process
- [x] 5.4 YAML documents: read with validation and versions; write that keeps comments
- [x] 5.5 JSON Lines: append (newline repair, 64 KiB limit) and read (partial tail, bad lines, device mismatch, unknown types)
- [x] 5.6 Write guard: path classification by the ownership table and the refusal rules
- [x] 5.7 Redaction: plain, base64, base64url, URL-encoded, inside longer base64; deep walk of the event
- [x] 5.8 `openWorkspace()` API that joins the guard, the documents, the logs and the redaction, and an event writer with the HLC and ids

## 6. Fixtures

- [x] 6.1 Fixture AW folder with 3 devices, 1 project, 1 task with logs of all 3 devices, knowledge and secure files
- [x] 6.2 Fixture test: each file valid with zod and with `@cfworker/json-schema`
- [x] 6.3 Round trip test: write the fixture folder through the API, read it back, compare

## 7. Docs and verification

- [x] 7.1 Update `docs/phase-1.md` 3.2 and 9.6 (snake_case fields), `AGENTS.md` (`pnpm schema:generate` no longer planned)
- [x] 7.2 Break each new test once and see it fail, then restore
- [x] 7.3 Run `task check`, `pnpm schema:generate` drift check, `openspec validate --strict`, and gitleaks on the tree
