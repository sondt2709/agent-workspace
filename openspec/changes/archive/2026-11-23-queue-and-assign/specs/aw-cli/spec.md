## ADDED Requirements

### Requirement: Queue command
`aw queue` SHALL print, for each agent with queued tasks, a line with the agent and its working sessions, then one line per task with the position, the key, the title and the cause, then the tasks that need an assignee with their creator. With no queued task it SHALL print "No task waits for a session.". `--json` SHALL print the route reply. The CLI SHALL refuse `aw queue` in a session.

#### Scenario: Two queued tasks
- **WHEN** a person runs `aw queue` while AW-3 and AW-4 wait for `claude@macbook-pro`
- **THEN** the output has "1st  AW-3" and "2nd  AW-4" with "2 sessions working"
