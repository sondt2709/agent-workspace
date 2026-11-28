# tasks-view Specification

## Purpose
TBD - created by archiving change nav-tasks-needs-you. Update Purpose after archive.
## Requirements
### Requirement: Tasks screen
The desktop app SHALL have the screen Tasks at `/w/<ws>/tasks` with the tabs "Needs you", "Working" and "All". The tab SHALL be in the route (`?tab=needs|working|all`, default `needs`). "Needs you" SHALL show the rows of the tasks in the "Needs you" lane (the reason, the title, the key and the project) and the files to fix, with the detail of the selected row: the title, the Activity row of each open gate, the Assign card or the pause, and "Open task". The person SHALL act on a gate in the detail. After the rows, "Needs you" SHALL show the section "Updates": the "Knowledge today" card and each device with changes of this workspace not synced. "Working" SHALL show the groups Working now, Paused and Queued. "All" SHALL show the List or the Board (`?view=list|board`, default `list`) of all tasks of the workspace that are not archived. Each row and card SHALL show the project. A tab SHALL show its count. With no project, the screen SHALL show "No projects yet" with "Add a project"; with a project and no active task, "No tasks yet" with "New task".

#### Scenario: Answer in place
- **WHEN** Tasks › Needs you shows the question gate of `AW-3` with the options `100/min` and `1000/min`, and the person selects `100/min`
- **THEN** the app sends `answerGate` with that answer and the gate version, and the card shows "Answer sent" until the gate resolves

#### Scenario: Working tab
- **WHEN** `AW-9` runs, `AW-4` is paused and `AW-14` is queued, and the person selects "Working"
- **THEN** the tab shows "Working now · 1", "Paused · 1" and "Queued · 1" with these tasks

#### Scenario: Updates section
- **WHEN** agents learned 2 items today
- **THEN** Tasks › Needs you shows the section "Updates" with the "Knowledge today" card

### Requirement: Project filter
Tasks and the Inbox SHALL have a project filter: a chip "Project" that opens a list with a search field and one check row for each project of the workspace. In the Inbox the list SHALL start with "No project". The person SHALL select 0, 1 or many rows. With no selection, the screen SHALL show the items of all projects. With a selection, it SHALL show only the items of the selected projects, and the items with no project only when "No project" is selected. The chip SHALL show the names of 1 or 2 selected projects, else "<n> projects", and a clear button. The selection SHALL be in the route (`?projects=<slug>,<slug>`, `none` for "No project"). The desktop and the phone SHALL use the rule `filterByProjects`, tested against `contracts/fixtures/filters/projects.json`.

#### Scenario: Two projects
- **WHEN** the person selects `demo-api` and `infra` in the filter of Tasks
- **THEN** each tab shows only the tasks of `demo-api` and `infra`, and the chip shows "Demo API, Infra"

#### Scenario: No project in the Inbox
- **WHEN** the person selects only "No project" in the filter of the Inbox
- **THEN** the Inbox shows only the cards with no project

#### Scenario: Search
- **WHEN** the person types "bil" in the search field of the filter
- **THEN** the list shows only the projects whose name contains "bil", ignoring case

### Requirement: Projects page
The desktop app SHALL have the page Projects at `/w/<ws>/projects`, opened from the sidebar. It SHALL list each project of the workspace with its name, its slug, its main repository, its implementing devices and its counts (tasks that need the person, working tasks), and the buttons "Knowledge", "Files" and "Settings" of the project. It SHALL have "Add a project". A click on a project row SHALL open Tasks › All with the filter of that project.

#### Scenario: Open the tasks of a project
- **WHEN** the person clicks the row of `billing-api` on the Projects page
- **THEN** the app opens `/w/<ws>/tasks?tab=all&projects=billing-api`

### Requirement: Phone Tasks
The phone Tasks screen SHALL have the same tabs "Needs you", "Working" and "All" and the same project filter (no "No project" row). "Needs you" SHALL be the rows of the rule `inboxItems` (tested against `contracts/fixtures/inbox/items.json`); a tap on a row SHALL open the item screen with the Activity row of each open gate, the Assign card or the pause, and "Open task". "All" SHALL group the tasks by stage.

#### Scenario: Phone needs you
- **WHEN** AW-12 has an open question and the person opens Tasks on the phone
- **THEN** the tab "Needs you" shows the row "Reply to a question · Rate limits for the public API · AW-12", and a tap shows the question with its option buttons

