## MODIFIED Requirements

### Requirement: Settings module
awd and `aw` SHALL read the environment only in `daemon/src/settings.ts`. `AW_HOME` SHALL select the state folder (default `~/.aw`), and `AW_LOG_LEVEL` the log level (default `info`).

#### Scenario: State folder for tests
- **WHEN** awd starts with `AW_HOME=/tmp/x`
- **THEN** it uses `/tmp/x/run/awd.sock`, `/tmp/x/config.yaml` and `/tmp/x/index/`, and it does not create `~/.aw`

### Requirement: Writes through the files layer
Each write of awd SHALL go through `WorkspaceFiles` of `shared/core` (owner check, redaction, HLC) and append to the log of this device. The writes of one workspace SHALL run one at a time. After each write, awd SHALL merge before it replies. When that merge or index write fails after the append, the reply SHALL be 500 `written_not_merged` with the path of the written file, so a client does not write it again; the next batch merges it.

#### Scenario: Create a task
- **WHEN** a client creates a task on `macbook-pro`
- **THEN** `tasks/<task-id>/log/macbook-pro.jsonl` has one valid `task.created` line with `by: human@macbook-pro`, and the reply has the merged task

#### Scenario: Parallel writes
- **WHEN** 20 clients create a task at the same time
- **THEN** each written line is valid, the 20 events have 20 different HLCs, and the keys `AW-1` to `AW-20` follow the HLC order

#### Scenario: Merge fails after the append
- **WHEN** a person creates a task and the merge after the append fails
- **THEN** `aw` exits with 1, stderr has `written_not_merged` and "Do not run the command again", and the next merge shows one task `AW-1`

### Requirement: Schema files in the workspace
Workspace init and each start SHALL copy each generated JSON Schema to `tasks/schemas/` when it is missing. awd SHALL NOT replace a schema file that exists: the file name has the schema version, and 2 devices with different AW versions must not write a shared file back and forth.

#### Scenario: Init
- **WHEN** a client initializes a new workspace folder
- **THEN** `tasks/schemas/` has each file of `contracts/schemas/`, byte for byte

#### Scenario: Schema file of another AW version
- **WHEN** `tasks/schemas/event.v1.schema.json` has another text and awd starts
- **THEN** awd keeps the file as it is, and copies only the missing files
