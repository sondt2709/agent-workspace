## ADDED Requirements

### Requirement: Local SQLite index
`@aw/core` SHALL keep the merged view in one SQLite file per workspace (`node:sqlite`) in the state folder of the device (`<state>/index/<workspace id>.sqlite`), never in the AW folder. It SHALL have tables for the files, the documents, the events (with the applied flag and the reason), the tasks, the projects, the devices, the queues, the slots, the credentials, the issues and the presence.

#### Scenario: Index outside the AW folder
- **WHEN** awd opens the index of a workspace with the state folder `~/.aw`
- **THEN** the file is `~/.aw/index/<workspace id>.sqlite`

### Requirement: Rebuild equals incremental
A full write of the index SHALL give the same rows as the incremental writes of the same files.

#### Scenario: Same rows
- **WHEN** one index gets incremental writes after random appends, and another index gets a full write of the final files
- **THEN** each table has the same rows in both indexes, without the presence table

### Requirement: MongoDB-style queries
`find(collection, query, options)` SHALL accept the MongoDB query syntax. It SHALL move exact conditions on indexed columns to SQL, and SHALL check each row with `sift` against the full query. The result SHALL be the same as a filter of the view with the same conditions.

#### Scenario: Tasks by stage, assignee, project and needs-you
- **WHEN** a test queries the tasks by stage, by assignee, by project, by the "Needs you" lane and by a nested field such as `claim.device`
- **THEN** each result equals a plain filter of the tasks of the view

### Requirement: Speed
The merge and the index SHALL handle 10,000 events in less than 2 seconds on a developer computer.

#### Scenario: 10,000 events
- **WHEN** a test merges a workspace with 10,000 events and writes the index
- **THEN** the time is below 2 seconds, and the test prints the time
