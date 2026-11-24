## ADDED Requirements

### Requirement: Terminal section on the phone
The task detail SHALL have a Terminal section with the newest synced snapshot of the task from `tasks/<task>/terminal/`: the screen in a monospace block, "Captured <time> on <device> · <age>", "No terminal snapshot yet" with no file, and the Orca note for an Orca session. The phone SHALL read the files again at each reload of the workspace model, so a new snapshot shows with no new event.

#### Scenario: Snapshot synced
- **WHEN** ubuntu-01 wrote a snapshot of AW-12 and it synced to the phone
- **THEN** the task detail shows its text and "Captured … on ubuntu-01"
