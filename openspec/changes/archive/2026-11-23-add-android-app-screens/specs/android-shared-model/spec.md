## ADDED Requirements

### Requirement: Kotlin event writer
`shared` SHALL have one event writer for the phone's own logs. It SHALL build the envelope (a new UUIDv7 id, the next HLC of the phone clock, `dev` = the phone slug, `by` = `human@<phone>`), encode it with the snake_case JSON of the generated classes, validate the line again with the log reader, and append it with a newline. It SHALL refuse, and write nothing, when the path is not a log of the phone, when the event type does not belong in the log kind of the path, when the event names another task than the folder, or when the line is longer than 64 KiB. When the file does not end with a newline (a cut line), it SHALL first write a newline.

#### Scenario: Gate answer line
- **WHEN** the phone `pixel-9` writes `gate.answered` to `tasks/<task>/log/pixel-9.jsonl`
- **THEN** the file has one more line, the log reader reads it as a valid event of `pixel-9` with `by: human@pixel-9`, and its HLC is greater than each HLC that the clock saw

#### Scenario: Log of another device
- **WHEN** the phone writes an event to `tasks/<task>/log/ubuntu-01.jsonl`
- **THEN** the writer refuses and the file does not change

#### Scenario: Cut last line
- **WHEN** the last line of the log has no newline
- **THEN** the writer writes a newline first, so the cut line stays a separate bad line and the new line is valid

### Requirement: Index queries of the phone screens
`WorkspaceIndex` SHALL also return all tasks, the projects, the devices by priority, the presence of each device, the issues and the value of one document by path.

#### Scenario: Devices by priority
- **WHEN** the index holds the base case
- **THEN** the devices query returns each device of the view in priority order, and the presence query one row per device
