## ADDED Requirements

### Requirement: Pause of an offline device
The renderer SHALL merge the presence `offline_tasks` into the pause of each task that has no pause of its own: cause, since, the device and its name, `needs_human` true only for `device_revoked`. The Board chip, the List group Paused, the Inbox rows, the task detail and the Assign dialog SHALL show "Paused · <device name> offline", and the task detail SHALL offer "Assign to another device…". The presence SHALL be read again every 10 s. An offline pause SHALL show no notification.

#### Scenario: Owner device offline
- **WHEN** the presence lists AW-21 in `offline_tasks` with the device `macbook-pro` named "MacBook Pro", and AW-21 has no pause event
- **THEN** the List shows AW-21 in Paused with "Paused · MacBook Pro offline", and the task detail shows "Assign to another device…"

#### Scenario: Own pause wins
- **WHEN** a task has the pause `usage_limit` and is also in `offline_tasks`
- **THEN** the chip shows the usage limit
