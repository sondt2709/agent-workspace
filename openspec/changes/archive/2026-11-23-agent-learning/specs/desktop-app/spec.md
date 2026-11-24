## ADDED Requirements

### Requirement: Learning step in the thread
The thread of the task detail SHALL show `task.learned` as one line: "Nothing new learned by <by>" for `nothing_new: true`, and "Learned by <by>: <path>" for a learned item, with "waits for approval" for an item with a suggestion. A line with a change id SHALL have an Undo button that calls the knowledge Undo of that change and shows its result.

#### Scenario: Nothing new
- **WHEN** the thread has `task.learned` `{nothing_new: true}` by `claude@macbook-pro`
- **THEN** the line is "Nothing new learned by claude@macbook-pro"

#### Scenario: Learned item with Undo
- **WHEN** the thread has `task.learned` with `path: projects/billing-api/learned/2026-11-23-use-cents.md` and a change id
- **THEN** the line names the path and has an Undo button for that change
