## ADDED Requirements

### Requirement: Joined workspaces of the phone
The app SHALL treat each folder of `<files>/aw/` as a joined workspace. It SHALL show one selected workspace at a time and SHALL keep the selected workspace id in `<files>/selected-workspace`, so the selection stays after an app restart. With no stored selection, or a stored id that is not joined, the app SHALL show the first joined workspace by id and SHALL keep the file. A select of an id that is not joined SHALL be refused. After a join ends `done`, the app SHALL select the new workspace.

#### Scenario: Selection after a restart
- **WHEN** the phone has the workspaces Personal and Side projects, the person selects Side projects, and the app process restarts
- **THEN** the app shows Side projects

#### Scenario: Stored workspace is gone
- **WHEN** `<files>/selected-workspace` names a workspace that has no folder in `<files>/aw/`
- **THEN** the app shows the first joined workspace

#### Scenario: Join selects the new workspace
- **WHEN** the phone shows Personal and a join of Side projects ends `done`
- **THEN** the app shows Side projects, and the switcher lists both workspaces

### Requirement: Workspace switcher
The top bar SHALL show the name of the selected workspace (`name` of its `tasks/workspace.yaml`, else "Workspace" and the first 8 characters of its id) at each width class. A select of the name SHALL open a menu with each joined workspace, its "Needs you" count and a mark on the selected one, and the item "Join another workspace". A select of a workspace SHALL show its data and SHALL reset the back stack to the root of the open tab. The menu SHALL work with touch, a keyboard and a mouse.

#### Scenario: Switch
- **WHEN** the Tasks tab of Personal shows AW-1 and the person selects Side projects in the menu
- **THEN** the Tasks tab shows SP-1 and not AW-1, and the back stack is `[Tasks]`

#### Scenario: Needs you count
- **WHEN** Side projects has one task in the "Needs you" lane and Personal is selected
- **THEN** the menu shows Side projects with the count 1
