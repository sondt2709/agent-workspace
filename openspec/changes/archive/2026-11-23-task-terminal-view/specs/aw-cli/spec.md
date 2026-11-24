## ADDED Requirements

### Requirement: Terminal command
`aw terminal <task>` SHALL print the device and the capture time of the newest snapshot, then its text, or the note of the terminal route. It SHALL print the open command of the session. `--json` SHALL print the route reply. It SHALL be a person command: in a session it SHALL exit 1 with the refusal of the route.

#### Scenario: Snapshot
- **WHEN** the person runs `aw terminal AW-12` and ubuntu-01 wrote a snapshot
- **THEN** the output starts with "ubuntu-01 · captured" and the time, then shows the screen

#### Scenario: In a session
- **WHEN** an agent runs `aw terminal AW-12` in its session
- **THEN** the command exits 1 with the refusal
