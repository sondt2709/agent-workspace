## ADDED Requirements

### Requirement: Project setup fields
`project.yaml` (projectV1) SHALL have `archived` (boolean, default false) and `main_repo` (a link text or null, default null). A reader of an older file SHALL get the defaults. The generated JSON Schema and the Kotlin classes SHALL have the 2 fields.

#### Scenario: Older file
- **WHEN** a reader parses a `project.yaml` with no `archived` and no `main_repo`
- **THEN** the value has `archived: false` and `main_repo: null`
