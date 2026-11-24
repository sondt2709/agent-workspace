## MODIFIED Requirements

### Requirement: Device health
Each session manager SHALL write `tasks/devices/<device>/health.yaml` at most once per 60 s with the boot time, the versions, the sessions with their state (`running`, `gate`, `paused`, `ended`), the usage windows and the login end date, the disk use, the queue limits `queue: {max_working, disk_full_percent, login_valid}`, and the placeholders `sync: []` and `last_backup: null`.

#### Scenario: Health file
- **WHEN** a session runs on the device
- **THEN** `health.yaml` validates against `health.v1` and lists the session with the state `running`

#### Scenario: Queue limits
- **WHEN** awd runs with `AW_MAX_WORKING=3` and a valid sign-in
- **THEN** `health.yaml` has `queue.max_working: 3`, `queue.disk_full_percent: 95` and `queue.login_valid: true`
