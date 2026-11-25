# desktop-knowledge Specification

## Purpose
The desktop screens of knowledge and files: the knowledge trees, the file view, history with Undo, learned items, suggestions, the digest card, the read-only task folder and "Fix a file".
## Requirements
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

### Requirement: History with Undo
The History tab SHALL list each change, the newest first and marked "Current version", with its label, author, device and time, the diff when awd has it, and "Undo" when the base version is available. Undo SHALL call the undo route and show when the change waits for approval.

#### Scenario: Undo a change
- **WHEN** the person selects Undo on a change whose base is available
- **THEN** the app sends `kbUndo` with the change id and the history shows the new `undo` change after the refetch

### Requirement: Suggestions
The Knowledge page SHALL list the pending suggestions with the path, the author, the task key, the reasons and the content. Accept and Reject SHALL call their routes with an optional comment. An Accept that awd refuses with `conflict` SHALL offer "Accept anyway" (force).

#### Scenario: Accept a suggestion
- **WHEN** the person selects Accept on a pending suggestion
- **THEN** the app sends `kbAccept` with the suggestion id and the suggestion leaves the pending list after the refetch

### Requirement: Digest card in the Inbox
The Inbox SHALL show the daily digest of today when it has learned items, changes or pending suggestions: the counts, each learned item with Undo, and a link to the Knowledge page.

#### Scenario: Learned today
- **WHEN** the digest has 1 learned item and 1 pending suggestion
- **THEN** the Inbox card shows "1 learned · 1 waits for approval" and the learned item with Undo

### Requirement: Files view
The project Files page SHALL list the tasks of the project by key and title, with the stage as the meta line, and SHALL not show the task id. For the selected task it SHALL show the folder tree (`task.yaml`, `log/<device>.jsonl`, `proposal/v<n>.md`, `artifacts/…`) read-only, with the folder path on one line, and the text of the selected file. A file that awd does not return as text SHALL show the reason.

#### Scenario: Open a log file
- **WHEN** the person selects `log/macbook-pro.jsonl` of `AW-3`
- **THEN** the viewer shows its text and offers no edit

#### Scenario: Task rows
- **WHEN** the project has the task `AW-7` "Export invoices as CSV" in Review
- **THEN** its row shows "AW-7 · Export invoices as CSV" and "Review", and no UUID

### Requirement: Fix a file
The Inbox SHALL show a "Fix a file" card for each issue `bad_document`, with the path and the message, "Open file" (opens the file in the default app of the system) and "Restore last valid version". "Open file" SHALL open only a regular file with a text extension inside the workspace folder; it SHALL refuse a symbolic link and a path with a linked folder.

#### Scenario: Restore
- **WHEN** the person selects "Restore last valid version" for `projects/billing-api/project.yaml`
- **THEN** the app sends `restoreDocument` with that path and the card goes away after the refetch

#### Scenario: Synced link to a program
- **WHEN** `tasks/projects/x/project.yaml` is a symbolic link to `tasks/evil.command`, and the person selects "Open file"
- **THEN** the app refuses with "tasks/projects/x/project.yaml is a link, not a file" and opens nothing

