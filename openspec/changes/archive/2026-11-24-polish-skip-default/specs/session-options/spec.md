## ADDED Requirements

### Requirement: Skip permissions preselected in New task
New task on the desktop and on the phone SHALL preselect "Skip permissions" (owner decision 38). The person SHALL be able to select "Project default · <mode>", "Default" or "Accept edits" instead. "Project default" SHALL send no session options. A task that an agent creates SHALL never get `skip` from this preselect or from a project default.

#### Scenario: Open New task
- **WHEN** a person opens New task for billing-api
- **THEN** Permissions shows "Skip permissions" and the skip warning

#### Scenario: Project default
- **WHEN** the person selects "Project default" and creates the task
- **THEN** `task.created` has no `session_options`
