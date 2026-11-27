## ADDED Requirements

### Requirement: Start again after a person assignment
awd SHALL write the comment of a failed start with `kind: "start_failed"`. When the newest applied person `task.assigned` of a task is newer than the last failed start of that task on this device, awd SHALL try the start at its next check, with no start retry wait, and a new failure SHALL write its comment again, also for the same cause. With no newer person assignment, the start retry wait and the "one comment for each cause" rule SHALL stay.

#### Scenario: Restart after a failed start
- **WHEN** the start of AW-1 failed, and a person assigns AW-1 again to the same agent 1 s later
- **THEN** awd tries the start within 5 s, and the thread gets a second "The session did not start" comment

#### Scenario: No person assignment
- **WHEN** the start of AW-1 failed, and no person assigns it again
- **THEN** awd tries again only after the start retry wait, and writes no second comment for the same cause
