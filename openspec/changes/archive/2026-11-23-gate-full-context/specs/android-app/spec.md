## ADDED Requirements

### Requirement: Phone gate cards with the full context
A gate card SHALL show each decision of `gate.opened` `data.decisions` with its question, its options and the recommended option marked "Recommended", and SHALL cut the text at the last `\n\n## Decisions\n` when `data.decisions` is not empty. The task detail SHALL have an Approach section with each version and its state ("Confirmed", "Waits for you", "Replaced", as on the desktop); a version SHALL open to the full text of its synced file. A resolved gate whose newest answer of this phone became a comment SHALL show a closed card in the task detail: "Your answer “X” came after the answer of <device>. It is a comment now."

#### Scenario: Decisions on the phone
- **WHEN** the "Confirm approach" card of AW-12 has 2 decisions
- **THEN** the card shows both with the recommended options marked, and no "## Decisions" text block

#### Scenario: Late answer
- **WHEN** the phone answered "Request changes" and ubuntu-01 resolved the gate with the answer "Confirm" of macbook-pro
- **THEN** the task detail shows "Your answer “Request changes” came after the answer of macbook-pro. It is a comment now."

### Requirement: Artifacts on request
The task detail SHALL have an Artifacts section with each `artifact.added` of the task, its size and its state: "Not on this phone" with "Download", "Downloading…", or "On this phone" with "Open". Download SHALL add the request to `<files>/artifact-requests/<workspace>.txt` and the ignore line of the engine. On a metered network with the switch "Use mobile data for artifacts" off (the default), Download SHALL refuse with "You are on mobile data. Connect to Wi-Fi, or turn on Use mobile data for artifacts." and SHALL add nothing. The switch SHALL be on the Devices screen. Open SHALL start `ACTION_VIEW` with a read-only content URI.

#### Scenario: Download on Wi-Fi
- **WHEN** the phone is on Wi-Fi and the person selects Download on `shot.png`
- **THEN** the file syncs to the phone and the row shows "On this phone" with "Open"

#### Scenario: Mobile data refused
- **WHEN** the phone is on mobile data with the switch off and the person selects Download
- **THEN** the phone shows the refusal and requests nothing

#### Scenario: Mobile data allowed
- **WHEN** the switch is on and the phone is on mobile data
- **THEN** Download requests the file

### Requirement: Phone thread window
The thread SHALL show the newest 500 events of the task. "Show older" SHALL add the 500 events before them.

#### Scenario: Long phone thread
- **WHEN** a task has 600 events
- **THEN** the thread shows events 101 to 600 and "Show older"

### Requirement: Push titles of finished and stopped work
The notification title SHALL come from the preview `kind`: the gate label for `gate`, "Done" for `done`, "Login expired" for `login_expired`, "Login ends soon" for `login_ends`, after the task key ("AW-12 · Done"). A push with no known kind and no gate kind SHALL show "A gate needs you".

#### Scenario: Done push
- **WHEN** a push with `{key: "AW-12", kind: "done", gate_kind: null, text: "Done: Add rate limits"}` arrives
- **THEN** the phone shows "AW-12 · Done" with "Done: Add rate limits"
