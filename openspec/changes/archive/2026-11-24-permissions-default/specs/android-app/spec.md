## ADDED Requirements

### Requirement: Pinned action bar of the phone New task
The phone New task SHALL have a bottom action bar with "Create task" and "Cancel" that stays visible while the form scrolls, above the navigation bar and the keyboard. "Create task" SHALL be enabled only with a project, a first message that is not blank, and no create in progress.

#### Scenario: A tall form on a 1080x2220 screen
- **WHEN** the person opens New task on a 1080x2220 phone
- **THEN** "Create task" shows with no scroll

#### Scenario: Blank first message
- **WHEN** the first message is only spaces
- **THEN** "Create task" is disabled

### Requirement: New task button of the task list
The header of the phone task list SHALL show the "New task" button outside the scrolling row of project chips, at the end of the header, at each window size.

#### Scenario: Many projects on a 2560x1600 tablet
- **WHEN** the workspace has more project chips than the header width holds
- **THEN** the chips scroll, and the full "New task" button stays visible
