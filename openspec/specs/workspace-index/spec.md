# workspace-index Specification

## Purpose
The `index` module of `shared/core`: a local SQLite index of the merged view, never synced, with MongoDB-style queries.

## Requirements
### Requirement: Local SQLite index
`@aw/core` SHALL keep the merged view in one SQLite file per workspace (`node:sqlite`) in the state folder of the device (`<state>/index/<workspace id>.sqlite`), never in the AW folder. It SHALL have tables for the files, the documents, the events (with the applied flag and the reason), the tasks, the projects, the devices, the queues, the slots, the credentials, the issues and the presence.

#### Scenario: Index outside the AW folder
- **WHEN** awd opens the index of a workspace with the state folder `~/.aw`
- **THEN** the file is `~/.aw/index/<workspace id>.sqlite`

### Requirement: Rebuild equals incremental
A full write of the index SHALL give the same rows as the incremental writes of the same files. After a failed write, the next write SHALL replace each table. `documents()` SHALL give the last valid value of each document for the merge engine of the next start.

#### Scenario: Same rows
- **WHEN** one index gets incremental writes after random appends, and another index gets a full write of the final files
- **THEN** each table has the same rows in both indexes, without the presence table

#### Scenario: Failed write
- **WHEN** a write fails after some statements, for example on a full disk
- **THEN** the transaction rolls back, and the next write gives the same rows as a rebuilt index

### Requirement: MongoDB-style queries
`find(collection, query, options)` SHALL accept the MongoDB query syntax. It SHALL move exact conditions on indexed columns to SQL, and SHALL check each row with `sift` against the full query. The result SHALL be the same as a filter of the view with the same conditions. A `limit` that is not an integer of 0 or more SHALL be refused on each path.

#### Scenario: Tasks by stage, assignee, project and needs-you
- **WHEN** a test queries the tasks by stage, by assignee, by project, by the "Needs you" lane and by a nested field such as `claim.device`
- **THEN** each result equals a plain filter of the tasks of the view

#### Scenario: Negative limit
- **WHEN** a query has `limit: -1`
- **THEN** `find()` throws a `RangeError`, for a query that goes to SQL and for one that `sift` checks

### Requirement: Speed
The merge and the index SHALL handle 10,000 events in less than 2 seconds on a developer computer.

#### Scenario: 10,000 events
- **WHEN** a test merges a workspace with 10,000 events and writes the index
- **THEN** the time is below 2 seconds, and the test prints the time
