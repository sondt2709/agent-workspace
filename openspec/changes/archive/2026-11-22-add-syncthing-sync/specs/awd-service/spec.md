## ADDED Requirements

### Requirement: Sync engine in awd
When the engine binary exists (`AW_SYNC_ENGINE`, else `<AW_HOME>/engine/syncthing`), awd SHALL start the sync engine after it opened the workspaces, add the 3 folders of each open workspace and of each workspace that `aw workspace init` adds, and stop the engine before it closes the workspaces. awd SHALL pass each write of the files layer to the transport (targeted scan) and to the write journal. awd SHALL NOT wait for the engine start before it is ready or before the heartbeat starts. The settings module SHALL read `AW_SYNC_ENGINE`, `AW_SYNC_LISTEN`, `AW_SYNC_COMMUNITY` (`on` or `off`, default `on`) and `AW_SYNC_TEST_PEERS` (`on` or `off`, default `off`).

#### Scenario: Start and stop
- **WHEN** awd starts with an engine binary and one workspace, and then gets SIGTERM
- **THEN** the engine runs with the 3 folders of the workspace while awd runs, and no engine process is left after awd exits

#### Scenario: Engine that never answers
- **WHEN** awd starts with an engine binary whose REST API never answers
- **THEN** `/readyz` answers 200 with `sync_engine: "starting"`, and awd stops the engine process at its stop

#### Scenario: Bad community value
- **WHEN** `AW_SYNC_COMMUNITY` is `maybe`
- **THEN** awd does not start and the error names the variable and the allowed values
