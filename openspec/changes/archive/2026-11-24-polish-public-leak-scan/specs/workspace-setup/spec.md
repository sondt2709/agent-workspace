## MODIFIED Requirements

### Requirement: Add a project with its checkout
The desktop app SHALL add a project in one dialog: the checkout folder of this device from the native folder picker, the name (from the folder name by default) and the slug (from the name). "Add project" SHALL call `addProject` and then `editBindings` with the checkout of this device. When the binding fails, the dialog SHALL keep the project and SHALL offer to save the folder again, with no second `addProject`; "Close" SHALL then open the next screen of the added project. The dialog SHALL stay open while a call runs. The dialog SHALL refuse a folder inside the workspace folder, and SHALL warn when the folder is not a git repository. On a device that runs no agent, the dialog SHALL ask for no folder. The dialog SHALL open from the "+" of the Projects section in the navigation, the workspace switcher menu, the empty Inbox, and New task with no project, and a resize of the window SHALL not close it. After the add, the app SHALL open the Board of the project, or New task when the person came from New task.

#### Scenario: A checkout in a folder of the organization
- **WHEN** the person selects "Add a project" in the empty Inbox and picks the folder `~/dev/example-org/billing-api`
- **THEN** the name is `billing-api`, and "Add project" sends `addProject` with `slug: billing-api`, then `editBindings` with the checkout `billing-api` at that folder, and the app opens the Board of `billing-api`

#### Scenario: Folder in the workspace
- **WHEN** the person picks a folder inside the folder of the workspace
- **THEN** the dialog says that the devices sync that folder, and "Add project" is off

#### Scenario: Binding fails
- **WHEN** `addProject` succeeds and `editBindings` fails
- **THEN** the dialog shows the error and "Save the folder", which sends only `editBindings`

#### Scenario: Narrow window
- **WHEN** the Add a project dialog is open and the window becomes 400 px wide
- **THEN** the dialog stays open with its values
