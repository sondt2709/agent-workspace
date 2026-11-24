## ADDED Requirements

### Requirement: Learning step of a task
awd SHALL have one service method that records the learning step of a task (`docs/workflow.md` 4.10.2, decision D3). The input SHALL be either `nothing_new: true`, or a `title` and a `content` (with an optional `shared`); a mix or neither SHALL give `invalid_input` and write nothing. For a session caller, the task SHALL be the task of the session and the author SHALL be the agent of the session; else `refused`. For a learned item, the method SHALL write the knowledge file (or the suggestion) first. Then it SHALL write `task.learned` to the task log of this device with the author as `by`: `{nothing_new: true}`, or `{nothing_new: false, path, change, suggestion}`. The reply SHALL have the knowledge result and `task_event` (`{id, applied, reason}`). The local API route `POST /v1/workspaces/{ws}/knowledge/learn`, the `aw learn` command and the MCP tool `learn` SHALL call this method.

#### Scenario: Nothing new from the agent
- **WHEN** the agent of the session of AW-1 records "Nothing new"
- **THEN** the task log of the device has 1 `task.learned` `{nothing_new: true}` by `claude@<device>`, it is applied, and no knowledge file is written

#### Scenario: Learned item
- **WHEN** the agent of AW-1 learns "Use cents" with some Markdown
- **THEN** `projects/<project>/learned/<date>-use-cents.md` exists, and the task log has `task.learned` with `nothing_new: false`, that `path` and the change id

#### Scenario: Another task
- **WHEN** the session of AW-1 records "Nothing new" for AW-2
- **THEN** the reply is `refused`, and AW-2 has no new event

#### Scenario: Mixed input
- **WHEN** a caller sends `nothing_new: true` with a title
- **THEN** the reply is `invalid_input`, and nothing is written

### Requirement: Event task.learned
The data of `task.learned` SHALL have the required boolean `nothing_new` and the optional fields `path` (relative knowledge path), `change` and `suggestion` (UUIDv7 or null). Old events with only `nothing_new` SHALL stay valid. The merge SHALL keep the rule that `task.learned` counts only from the owner device.

#### Scenario: Old event
- **WHEN** a log has `task.learned` `{nothing_new: true}` with no other field
- **THEN** the event is valid, and the task view has `learned: true`

### Requirement: Done with no learning step
AW SHALL NOT block `done` when the task has no applied `task.learned`. The "Result approved" notice SHALL name `aw learn <key> --file <path> --title <title>` and `aw learn <key> --nothing-new`. The reply of `done` SHALL add a reminder to run `learn` before the turn ends when the task has no applied `task.learned`. At the Stop that ends the session of a done task, when the task still has no applied `task.learned`, awd SHALL write one `comment.added` by `aw@<device>` with the text "<key> is done with no learned item and no \"Nothing new\" (decision D3)."

#### Scenario: Done after nothing new
- **WHEN** the agent records "Nothing new", then the human approves the result, and the session ends at its Stop
- **THEN** the task is done, and the thread has no reminder comment

#### Scenario: Done with no learning step
- **WHEN** the human approves the result and the agent ends its turn with no `learn`
- **THEN** the task is done, and the thread has 1 comment "AW-1 is done with no learned item and no \"Nothing new\" (decision D3)." by `aw@<device>`
