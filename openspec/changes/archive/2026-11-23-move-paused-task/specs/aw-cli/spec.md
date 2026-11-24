## ADDED Requirements

### Requirement: Offline pause in the task commands
`aw task list` and `aw task show` SHALL read the presence and the devices and show the pause of each task, also the offline pause of the presence: the list adds "paused: <device name> offline" to the stage, and the show prints a `Paused:` line with the next step. `--json` SHALL print the tasks with the merged `paused` field.

#### Scenario: Task of an offline device
- **WHEN** the presence lists AW-21 with the device `macbook-pro` named "MacBook Pro"
- **THEN** `aw task show AW-21` prints the line `Paused:    MacBook Pro offline.` with the next step, and `aw task list` shows `(paused: MacBook Pro offline)` after the stage
