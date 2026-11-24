## ADDED Requirements

### Requirement: Redacted agent files
Each task file that awd writes from agent text SHALL go through the redaction of the files layer: the long message file `artifacts/<device>/text-<id>.md`, the approach version of the ExitPlanMode hook and of `approach`, and each copied file of `artifact add`, `result` (the result file and its artifacts) and `handoff`. `artifact.added` SHALL have the size and the sha256 of the written bytes, and the gate "Approve result" SHALL show the written result text. A retry of the ExitPlanMode hook SHALL compare the version file with the redacted plan, so it writes no second version.

#### Scenario: Agent writes the value in its files
- **WHEN** a session with the credential `staging-api-key` writes the value in a long reply, an approach, a copied text file, a result and a handoff
- **THEN** each file in the task folder has `[redacted:staging-api-key]`, and no file in the workspace folder has the value

#### Scenario: Binary artifact of a session
- **WHEN** the agent adds a binary file that has the value inside
- **THEN** the artifact has the same bytes, and `artifact.added` has the sha256 of the file on disk

#### Scenario: Hook retry of a plan with a value
- **WHEN** the ExitPlanMode hook of a plan with the value runs a second time
- **THEN** awd finds the redacted `approach/v1.md` and writes no `approach/v2.md`
