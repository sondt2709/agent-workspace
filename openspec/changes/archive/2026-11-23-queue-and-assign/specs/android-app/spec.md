## ADDED Requirements

### Requirement: Queue on the phone
The phone SHALL apply the queue rule to its own index: the applied `queue.reordered` events (the newest per agent), the `health.yaml` of each device, the presence and the tasks. A queued task row SHALL show "Queued · 2nd for claude@ubuntu-01" and the cause, and the task detail SHALL have the field "Queue" with the same text.

#### Scenario: Queued row
- **WHEN** AW-4 waits second for `claude@ubuntu-01` with 2 working sessions
- **THEN** its row shows "Queued · 2nd for claude@ubuntu-01" and "2 sessions working"
