## MODIFIED Requirements

### Requirement: Files view
The project Files page SHALL list the tasks of the project by key and title, with the stage as the meta line, and SHALL not show the task id. For the selected task it SHALL show the folder tree (`task.yaml`, `log/<device>.jsonl`, `proposal/v<n>.md`, `artifacts/…`) read-only, with the folder path on one line, and the text of the selected file. A file that awd does not return as text SHALL show the reason.

#### Scenario: Open a log file
- **WHEN** the person selects `log/macbook-pro.jsonl` of `AW-3`
- **THEN** the viewer shows its text and offers no edit

#### Scenario: Task rows
- **WHEN** the project has the task `AW-7` "Export invoices as CSV" in Review
- **THEN** its row shows "AW-7 · Export invoices as CSV" and "Review", and no UUID
