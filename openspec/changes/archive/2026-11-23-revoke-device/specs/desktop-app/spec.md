## MODIFIED Requirements

### Requirement: Pause of an offline device
The renderer SHALL merge the presence `offline_tasks` into the pause of each task: cause, since, the device and its name, `needs_human` true only for `device_revoked`. A `device_offline` row SHALL apply only to a task that has no pause of its own; a `device_revoked` row SHALL replace the own pause. A pause that needs the human SHALL add the "Needs you" reason `paused` with its cause, so the task shows in the "Needs you" lane of the Board, the group "Needs you" of the List, the Inbox and the Tray count. The Board chip, the List group, the Inbox, the task detail and the Assign dialog SHALL show "Paused · <device name> offline" or "Paused · <device name> was revoked". The task detail SHALL offer "Assign to another device…" for an offline device and "Change assignee…" for a revoked device. The presence SHALL be read again every 10 s. An offline pause SHALL show no notification.

#### Scenario: Owner device offline
- **WHEN** the presence lists AW-21 in `offline_tasks` with the device `macbook-pro` named "MacBook Pro", and AW-21 has no pause event
- **THEN** the List shows AW-21 in Paused with "Paused · MacBook Pro offline", and the task detail shows "Assign to another device…"

#### Scenario: Own pause wins
- **WHEN** a task has the pause `usage_limit` and is also in `offline_tasks` with `device_offline`
- **THEN** the chip shows the usage limit

#### Scenario: Device revoked
- **WHEN** the presence lists AW-21 with the cause `device_revoked` and the device `ubuntu-01`
- **THEN** the List shows AW-21 in "Needs you", the Inbox has its card with "Paused · ubuntu-01 was revoked." and "Change assignee…", and the button opens the Assign dialog
