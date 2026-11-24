## ADDED Requirements

### Requirement: Each desktop field in the phone New task
The phone New task SHALL have each field of the desktop New task: first message, title (blank: the first line of the first message), project, assignee and "Start the agent now" (the default agent of the project on its first device), test server, parent task (open tasks of the project), credentials (chips of the names that the tasks of the workspace use, and a field for another name), and the Session block (Project default and the 3 modes, agent teams, Works in, the absolute folder of the session device). It SHALL use the compact components and keep the pinned "Create task" bar.

#### Scenario: All fields
- **WHEN** the person writes "Add a CSV export", the title "CSV export", picks a parent task and the credentials staging-db and github-token, and taps "Create task"
- **THEN** `task.created` has the title "CSV export", the parent, both credential names and `session_options.permission_mode: skip`
