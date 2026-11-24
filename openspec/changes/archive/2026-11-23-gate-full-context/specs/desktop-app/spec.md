## ADDED Requirements

### Requirement: Gate cards with the full context
A gate card SHALL show each decision of `gate.opened` `data.decisions` with its question, its options and the recommended option marked "Recommended". When `data.decisions` is not empty, the card SHALL cut the text at the last `\n\n## Decisions\n`. The card SHALL read `gate.opened` from the work events of the task (`types=gate.opened,approach.proposed,result.posted,artifact.added&newest=true`), not from the thread window. An "Approve result" card SHALL list the artifacts of its `result.posted` with name and size, each with "Open".

#### Scenario: Decisions with a recommendation
- **WHEN** the "Confirm approach" gate of AW-12 has 2 decisions, each with a recommended option
- **THEN** the card shows both questions, their options, "Recommended" next to the recommended options, and no "## Decisions" text block

#### Scenario: Result artifacts
- **WHEN** the result of AW-12 names `artifacts/ubuntu-01/shot.png` and `artifacts/ubuntu-01/report.xml`
- **THEN** the "Approve result" card lists both with their sizes and an "Open" button

### Requirement: Approach versions in the task detail
The Approach field SHALL list each version. A version SHALL open to the full text of `tasks/<task>/approach/v<n>.md`. The chip SHALL be "Confirmed" for the confirmed version, "Waits for you" for the latest version when no version is confirmed or the latest version is newer than the confirmed one, and "Replaced" for each other version.

#### Scenario: New version after a confirmed one
- **WHEN** v1 of AW-12 is confirmed and the agent proposes v2
- **THEN** v1 shows "Confirmed" and v2 shows "Waits for you"

#### Scenario: Full text
- **WHEN** the person opens v2
- **THEN** the field shows the full Markdown of `approach/v2.md`

### Requirement: Open a task artifact
The main call `openTaskArtifact {ws, task, path}` SHALL accept only a path that starts with `artifacts/`, is a file of the task files route, and whose real path stays in the task folder. It SHALL open the types `png jpg jpeg gif webp pdf txt md log json xml csv` in the default app, and SHALL show any other type in Finder. It SHALL never open another file.

#### Scenario: Image
- **WHEN** the person selects "Open" on `artifacts/ubuntu-01/shot.png`
- **THEN** main opens the file in the default app

#### Scenario: Program
- **WHEN** an artifact is `artifacts/ubuntu-01/run.command`
- **THEN** main shows it in Finder and does not open it

#### Scenario: Path outside the artifacts
- **WHEN** the renderer sends `log/ubuntu-01.jsonl` or `artifacts/../log/ubuntu-01.jsonl`
- **THEN** main refuses and opens nothing

### Requirement: Answer notices
After an answer, the card SHALL show: for the error `gate_not_open`, "Another answer resolved this gate first: “<answer>”. AW did not send your answer."; for `applied: false`, "AW did not use your answer: <reason>."; for an answer that the reply marks `use: comment`, "Your answer came after another answer. It is a comment now."

#### Scenario: Gate resolved first
- **WHEN** the person answers a gate that this device knows as resolved with "Approve"
- **THEN** the card shows "Another answer resolved this gate first: “Approve”. AW did not send your answer."

### Requirement: Thread window
The thread SHALL show the newest 500 events of the task. "Show older" SHALL add the 500 events before them. The window SHALL stay one list in merge order after each refresh.

#### Scenario: Long thread
- **WHEN** a task has 1,100 events
- **THEN** the thread shows the newest event and "Show older"; after "Show older" it shows 1,000 events
