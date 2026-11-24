## MODIFIED Requirements

### Requirement: Hybrid logical clock
The HLC SHALL be the text `<UTC time, ISO 8601 with ms>#<4-digit counter>`. The `hlc` field SHALL reject a date that does not exist, for example `2026-13-45T25:00:00.000Z#0000`. A device SHALL keep its HLC above each HLC that it made or merged. The merge SHALL not give the clock an HLC that is more than the skew bound (default 24 hours) ahead of the local time. Events SHALL sort by the HLC text, then by the device slug. The test vectors in `packages/schema/test-vectors/hlc.json` SHALL hold format, order and operation cases that the TypeScript and the Kotlin tests both run.

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
`packages/schema/fixtures/workspace/` SHALL be an AW folder with `tasks/`, `knowledge/` and `secure/`, 3 devices (`macbook-pro` local, `ubuntu-01` remote, `pixel-9` mobile), 1 project and 1 task with a log from each device. It SHALL use synthetic data only. `packages/schema/fixtures/merge/<case>/` SHALL hold merge cases: `case.json` (the description and the local time), `files/` (files added to or replacing files of the base folder) and `expected.json` (the expected view). The cases SHALL cover a gate answered twice, an offline task key collision, claim epochs, a device that goes offline, a far-future HLC and a truncated log line.

#### Scenario: Each fixture file is valid
- **WHEN** the fixture test reads each YAML document and each JSON Lines line of the fixture folder
- **THEN** each one is valid against its zod schema and its generated JSON Schema

#### Scenario: Each merge case gives its expected view
- **WHEN** the merge test builds the folder of a merge case and merges it at the local time of `case.json`
- **THEN** the view equals `expected.json`
