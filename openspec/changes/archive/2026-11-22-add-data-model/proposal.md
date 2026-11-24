## Why

Each later phase 1 task (merge and index, awd, sync, sessions, the apps) reads and writes the files of the AW folder. Without one typed and checked file model, each task would parse the files in its own way, and a bad file or a leaked credential could reach other devices.

## What Changes

- `packages/schema`: zod schemas for each document (`workspace.yaml`, `project.yaml`, `task.yaml`, `device.yaml`, `health.yaml`, `bindings.yaml`, `secure/test-servers.yaml`) and for the event envelope with each event type of `docs/workflow.md`, also the heartbeat line. Each schema has a versioned name `<type>.v<major>`.
- `pnpm schema:generate` writes `packages/schema/generated/schemas/<type>.v<major>.schema.json` (JSON Schema 2020-12 from `z.toJSONSchema()`). A test and a CI step fail when the generated files are not current. The generator has one place where the android-shared task adds the Kotlin classes.
- UUIDv7 ids from the clock module, a hybrid logical clock (HLC) with test vectors in `packages/schema/test-vectors/hlc.json`, and a clock module with a fake clock for tests.
- `packages/core` `files` layer: atomic writes (`*.aw-tmp`, then rename), YAML documents that keep comments, JSON Lines append and read with validation, a write guard from the ownership table, redaction of credential values (plain, base64, URL-encoded), and typed errors with the file, the line, the path and the field.
- A shared fixture AW folder with 3 devices (`macbook-pro` local, `ubuntu-01` remote, `pixel-9` mobile) in `packages/schema/fixtures/workspace/`.
- New libraries: `zod`, `yaml`, `uuid` (already in `docs/tech-stack.md`), and `@cfworker/json-schema` for the tests (new row).
- `docs/phase-1.md` 3.2 uses the snake_case field names of the schemas.

## Capabilities

### New Capabilities
- `workspace-schemas`: the zod schemas of the AW files, their versions, the generated JSON Schemas, the ids, the HLC and the shared fixtures.
- `workspace-files`: the `files` layer of `packages/core`: the clock, atomic writes, YAML documents, JSON Lines logs, the write guard, the redaction and the typed file errors.

### Modified Capabilities
- `repository-tooling`: CI checks that the generated JSON Schemas are current.

## Impact

- Code: `packages/schema`, `packages/core`, the root `package.json` (`schema:generate`), `.github/workflows/ci.yaml`, `tsconfig.base.json` (`.ts` import extensions, so Node runs the generator directly).
- Dependencies: `zod` 4.6.7, `yaml` 2.9.1, `uuid` 14.0.3, `@cfworker/json-schema` 4.1.6 (dev).
- Interfaces: the file formats and the event envelope are public contracts (phase-1.md 12). Later tasks (merge-index, awd-api-cli, android-shared) build on the exports of `@aw/schema` and `@aw/core`.
- Out of scope: merge and index, the awd service, the sync engine, sessions, the log buffer of 1 second.
