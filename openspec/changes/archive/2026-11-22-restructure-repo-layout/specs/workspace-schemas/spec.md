## MODIFIED Requirements

### Requirement: Generated JSON Schemas
`pnpm schema:generate` SHALL write one JSON Schema 2020-12 file per schema name to `contracts/schemas/<type>.v<major>.schema.json`, from `z.toJSONSchema()`, formatted with the Prettier config of the repository (`shared/config`). The generator SHALL have one list of targets, so that a later task can add the Kotlin classes. A test SHALL fail when a generated file is missing, extra or different from the current zod schemas.

#### Scenario: Schemas are current
- **WHEN** a contributor runs `pnpm schema:generate` on a clean tree
- **THEN** `git status --porcelain` is empty

#### Scenario: Schema change without a new generation
- **WHEN** a contributor changes a zod schema and does not run `pnpm schema:generate`
- **THEN** the drift test fails and names the stale file

#### Scenario: Independent validator
- **WHEN** the fixture test validates each fixture document and each fixture log line with `@cfworker/json-schema` against the generated JSON Schema
- **THEN** each file is valid, and each invalid sample of the schema tests is invalid

### Requirement: Hybrid logical clock
The HLC SHALL be the text `<UTC time, ISO 8601 with ms>#<4-digit counter>`. The `hlc` field SHALL reject a date that does not exist, for example `2026-13-45T25:00:00.000Z#0000`. A device SHALL keep its HLC above each HLC that it made or merged. The merge SHALL not give the clock an HLC that is more than the skew bound (default 24 hours) ahead of the local time. Events SHALL sort by the HLC text, then by the device slug, then by the event id. The test vectors in `contracts/test-vectors/hlc.json` SHALL hold format, order and operation cases that the TypeScript and the Kotlin tests both run.

#### Scenario: Clock skew
- **WHEN** a device with a clock 5 minutes behind reads an event with a later HLC and then writes an answer
- **THEN** the HLC of the answer is greater than the HLC of the event

#### Scenario: Same millisecond
- **WHEN** a device makes 2 HLCs in the same millisecond
- **THEN** the second HLC has the same time and a counter 1 higher

#### Scenario: Counter overflow
- **WHEN** the counter is at 9999 and the time does not change
- **THEN** the next HLC has a time 1 ms later and the counter 0

### Requirement: Shared fixture folder
`contracts/fixtures/workspace/` SHALL be an AW folder with `tasks/`, `knowledge/` and `secure/`, 3 devices (`macbook-pro` local, `ubuntu-01` remote, `pixel-9` mobile), 1 project and 1 task with a log from each device. It SHALL use synthetic data only. `contracts/fixtures/merge/<case>/` SHALL hold merge cases: `case.json` (the description and the local time), `files/` (files added to or replacing files of the base folder) and `expected.json` (the expected view). The cases SHALL cover a gate answered twice, an offline task key collision, claim epochs, a device that goes offline, a far-future HLC and a truncated log line.

#### Scenario: Each fixture file is valid
- **WHEN** the fixture test reads each YAML document and each JSON Lines line of the fixture folder
- **THEN** each one is valid against its zod schema and its generated JSON Schema

#### Scenario: Each merge case gives its expected view
- **WHEN** the merge test builds the folder of a merge case and merges it at the local time of `case.json`
- **THEN** the view equals `expected.json`
