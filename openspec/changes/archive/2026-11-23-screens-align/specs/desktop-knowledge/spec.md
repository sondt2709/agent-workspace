## MODIFIED Requirements

### Requirement: Knowledge trees and file view
The project Knowledge page SHALL show the files of the project and the shared files; the workspace Knowledge page SHALL show the shared files. Files SHALL be in one tree with the groups Rules, Knowledge and Learned; on the project page a shared file SHALL show the tag "shared". When the window is 840 px or wider and no file, view or pending suggestion is selected, the page SHALL open the first file of the tree. The file view SHALL show the Markdown body, the apply mode, the last change (author, device, time), a front matter error, and for a learned file "Learned by <author> on <task key>".

#### Scenario: Learned file
- **WHEN** the person opens a learned file whose change has the author `claude@ubuntu-01` and the task key `AW-7`
- **THEN** the view shows "Learned by claude@ubuntu-01 on AW-7"

#### Scenario: One tree on the project page
- **WHEN** the project `billing-api` has `notes.md` and the workspace has the shared file `rules.md`
- **THEN** the page shows one "Knowledge · 2" group with `notes.md` and `rules.md`, and `rules.md` has the tag "shared"

#### Scenario: First file opens
- **WHEN** the person opens the Knowledge page at 1280 px with no selection and no pending suggestion
- **THEN** the detail pane shows the first file of the tree

### Requirement: Files view
The project Files page SHALL list the tasks of the project by key and title, with the stage as the meta line, and SHALL not show the task id. For the selected task it SHALL show the folder tree (`task.yaml`, `log/<device>.jsonl`, `approach/v<n>.md`, `artifacts/…`) read-only, with the folder path on one line, and the text of the selected file. A file that awd does not return as text SHALL show the reason.

#### Scenario: Open a log file
- **WHEN** the person selects `log/macbook-pro.jsonl` of `AW-3`
- **THEN** the viewer shows its text and offers no edit

#### Scenario: Task rows
- **WHEN** the project has the task `AW-7` "Export invoices as CSV" in Review
- **THEN** its row shows "AW-7 · Export invoices as CSV" and "Review", and no UUID
