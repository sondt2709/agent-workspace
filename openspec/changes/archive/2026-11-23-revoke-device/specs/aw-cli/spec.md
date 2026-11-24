## MODIFIED Requirements

### Requirement: Offline pause in the task commands
`aw task list` and `aw task show` SHALL read the presence and the devices and show the pause of each task, also the pause of the presence: the list adds "paused: <device name> offline" or "paused: <device name> was revoked" to the stage, and the show prints a `Paused:` line with the next step. `--json` SHALL print the tasks with the merged `paused` field and, for a revoked device, the "Needs you" reason `paused`.

#### Scenario: Task of an offline device
- **WHEN** the presence lists AW-21 with the device `macbook-pro` named "MacBook Pro"
- **THEN** `aw task show AW-21` prints the line `Paused:    MacBook Pro offline.` with the next step, and `aw task list` shows `(paused: MacBook Pro offline)` after the stage

#### Scenario: Task of a revoked device
- **WHEN** the presence lists AW-1 with the cause `device_revoked` and the device `ubuntu-01`
- **THEN** `aw task show AW-1` prints `Paused:    ubuntu-01 was revoked. Change the assignee to continue on another device.`
