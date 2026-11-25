## MODIFIED Requirements

### Requirement: Kotlin merge equals the TypeScript merge
The Kotlin `MergeEngine` SHALL give the same `{view, presence}` as the TypeScript engine for each case in `contracts/fixtures/merge/`, for each read order of the log files. It SHALL port the order, the ownership and claim rules, the gate rules, the key collisions, the priority, the workspace log, presence, the 24 h HLC bound, the last valid document and `toTaskDocument`.

#### Scenario: Merge cases
- **WHEN** the JVM tests merge each case at its `now`
- **THEN** the parsed JSON of `{view, presence}` equals the parsed `expected.json`

#### Scenario: Rule cases
- **WHEN** the JVM tests merge the cases `task-rules` and `workspace-rules`
- **THEN** each rule that the other cases do not use (rekey, first message lock, assignment switch, proposal file, unknown session, leases, credential names) gives the TypeScript result

#### Scenario: Read order
- **WHEN** the JVM tests merge each case with the reversed order and 39 seeded shuffles of the log files
- **THEN** each result equals `expected.json`

#### Scenario: Snapshot
- **WHEN** `toTaskDocument` runs on the task AW-7 of the base case
- **THEN** the result equals the fixture `task.yaml` with its defaults
