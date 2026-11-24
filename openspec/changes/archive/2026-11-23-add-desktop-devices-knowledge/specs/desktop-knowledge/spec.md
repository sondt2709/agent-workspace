## ADDED Requirements

### Requirement: Knowledge trees and file view
The project Knowledge page SHALL show the files of the project and the shared files; the workspace Knowledge page SHALL show the shared files. Files SHALL be in the groups Rules, Knowledge and Learned. The file view SHALL show the Markdown body, the apply mode, a front matter error, and for a learned file "Learned by <author> on <task key>".

#### Scenario: Learned file
- **WHEN** the person opens a learned file whose change has the author `claude@ubuntu-01` and the task key `AW-7`
- **THEN** the view shows "Learned by claude@ubuntu-01 on AW-7"

### Requirement: History with Undo
The History tab SHALL list each change with its label, author, device and time, the diff when awd has it, and "Undo" when the base version is available. Undo SHALL call the undo route and show when the change waits for approval.

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
The project Files page SHALL list the tasks of the project; for the selected task it SHALL show the folder tree (`task.yaml`, `log/<device>.jsonl`, `approach/v<n>.md`, `artifacts/…`) read-only, and the text of the selected file. A file that awd does not return as text SHALL show the reason.

#### Scenario: Open a log file
- **WHEN** the person selects `log/macbook-pro.jsonl` of `AW-3`
- **THEN** the viewer shows its text and offers no edit

### Requirement: Fix a file
The Inbox SHALL show a "Fix a file" card for each issue `bad_document`, with the path and the message, "Open file" (opens the file in the default app of the system) and "Restore last valid version".

#### Scenario: Restore
- **WHEN** the person selects "Restore last valid version" for `projects/billing-api/project.yaml`
- **THEN** the app sends `restoreDocument` with that path and the card goes away after the refetch
