## MODIFIED Requirements

### Requirement: Phone task activity
The Activity tab of the phone SHALL show the open gate cards, the late answers and the Assign card first; then the first message once as the description, as its raw text; then the activity rows in merge order. The phone SHALL use the Activity rule of the desktop ("Task activity" of desktop-app): one table with an entry for each event type of the contract, tested against the shared fixture `contracts/fixtures/activity/cases.json`, with the same `message.human` rule, the same `message.agent` source rule, the same nudge rule and the same `session.ended` lines. `task.created` SHALL show as "Created by <by>". An agent message longer than 6 lines SHALL show its first 6 lines and "Show more".

#### Scenario: Activity of a task with a session
- **WHEN** the thread of AW-1 has `task.created`, `task.claimed`, `session.started`, a `message.human` with source `first`, a `message.agent`, a `gate.opened` and a `gate.answered`
- **THEN** Activity shows the description once, "Created by human@macbook-pro", the agent message, the gate and the answer, and no claim, session or input row

#### Scenario: Stopped session on the phone
- **WHEN** the person stops the session of AW-1 on ubuntu-01
- **THEN** the phone Activity shows "Session stopped on ubuntu-01: a person stopped it or ended the agent. AW starts no new session until a person starts one."

#### Scenario: Long agent message
- **WHEN** an agent message has 9 lines
- **THEN** Activity shows its first 6 lines and "Show more", and "Show more" shows the 9 lines

#### Scenario: Turn text on the phone
- **WHEN** the thread has `message.agent` with the source `turn` and `message.agent` "Tests pass" with the source `tool`
- **THEN** the phone Activity shows "Tests pass" only, and the Session view shows both

## ADDED Requirements

### Requirement: Session link in the phone summary
The session summary of the phone Session view SHALL show the session id, the session name, the terminal and the pid as the desktop ("Session link in the summary" of desktop-app), from the session view of the Kotlin merge.

#### Scenario: Link on the phone
- **WHEN** `session.started` of AW-7 has the name `AW-7`, the window `aw-01a2`, the pane `%12` and the pid 4242
- **THEN** the phone session summary has the rows "Name" `AW-7`, "Terminal" "tmux window aw-01a2 · pane %12" and "Pid" 4242
