## MODIFIED Requirements

### Requirement: Phone screens
The Android app SHALL have the screens Home, Inbox, Tasks, Task detail, New task and Devices, from the phone's own Room index. Home SHALL show "Needs you" first, then the devices with their sync state and a "Sync now" button, then the working and paused tasks. Inbox SHALL list each task in the "Needs you" lane with its gate cards, which the human answers in place. Tasks SHALL group the tasks by stage (Backlog, Discuss, Ready, Implement, Review, Done) and SHALL show a "Paused" chip with the cause on a paused task and on a task whose session device is offline. Task detail SHALL show the header and the tabs Activity (default), Session, Terminal and Properties: Activity has the gate cards, the description and the key activity; Session has the session summary and the raw thread; Terminal has the newest terminal snapshot; Properties has the fields, the approach versions and the artifacts. The message box SHALL be below the Activity and Session tabs. Devices SHALL show each device with its role, its presence ("Last heartbeat 8 s ago", offline after 90 s), the sync state of its peer and, for this phone, the engine state and the battery warning for the mode "Restricted" with a link to the setting.

#### Scenario: Gate card in the Inbox
- **WHEN** a task has an open "Answer question" gate with the options "100/min" and "1000/min"
- **THEN** the Inbox shows the task with one button per option and a free-text answer

#### Scenario: Offline device
- **WHEN** the session device of a running task has no heartbeat for more than 90 s
- **THEN** Tasks shows the task with the chip "Paused: <device> offline", and its task detail has the action "Assign to another device…"

#### Scenario: Battery restricted
- **WHEN** the battery mode of the app is "Restricted"
- **THEN** Home and Devices show the warning and a button that opens the app settings

#### Scenario: A gate does not hide behind a tab
- **WHEN** AW-1 has an open gate and the person selects the Session, Terminal or Properties tab
- **THEN** the tab shows "1 item needs you" with "Show in Activity", and "Show in Activity" selects the Activity tab with the gate card

#### Scenario: Another task opens on Activity
- **WHEN** the person selected the Session tab of AW-1 and opens AW-2
- **THEN** the task detail of AW-2 shows the Activity tab

### Requirement: Adaptive layout
The app SHALL select the layout from the window width class only: compact (< 600 dp) a bottom bar and 1 pane, the detail replaces the list; medium (600 to 839 dp) a rail and 2 panes for Inbox and Tasks; expanded (840 to 1199 dp) a rail with list and detail; large (1200 dp and more) a navigation drawer with list and detail, and for a task a third pane with the Session view (the session summary and the raw thread). While the third pane shows the Session view, the tab row of the task detail SHALL NOT have the Session tab. AW SHALL own one back stack, so a fold, an unfold or a resize keeps the open item. The manifest SHALL set no orientation, keep `resizeableActivity` at its default, declare the touch screen as not required and set the `configChanges` of `docs/phase-1.md` 10.9.

#### Scenario: Unfold keeps the task
- **WHEN** a task is open on a 360 dp window and the window becomes 840 dp
- **THEN** the same task shows in the detail pane next to the task list

#### Scenario: Width classes
- **WHEN** the window is 599, 600, 839, 840, 1199 or 1200 dp wide
- **THEN** the width class is compact, medium, medium, expanded, expanded or large

#### Scenario: Session in the third pane
- **WHEN** a task is open on a 1280 dp window
- **THEN** the third pane shows the session summary and the raw thread, and the task tabs are Activity, Terminal and Properties

### Requirement: Phone thread window
The Session view SHALL show the newest 500 events of the task, each as a raw row (principle 8): a row for each event type of the contract, and the type name for an unknown type. "Show older" SHALL add the 500 events before them. The Activity tab SHALL use the same window and SHALL say "No activity in the newest <n> events. "Show older" loads more." when the window has events but no Activity row and older events exist.

#### Scenario: Long phone thread
- **WHEN** a task has 600 events
- **THEN** the Session view shows events 101 to 600 and "Show older"

#### Scenario: No event type is dropped
- **WHEN** the thread has one event of each contract event type and one unknown type
- **THEN** the Session view has one row for each of them

## ADDED Requirements

### Requirement: Phone task activity
The Activity tab of the phone SHALL show the open gate cards, the late answers and the Assign card first; then the first message once as the description, as its raw text; then the activity rows in merge order. The phone SHALL use the Activity rule of the desktop ("Task activity" of desktop-app): one table with an entry for each event type of the contract, tested against the shared fixture `contracts/fixtures/activity/cases.json`, with the same `message.human` rule and the same `session.ended` lines. `task.created` SHALL show as "Created by <by>". An agent message longer than 6 lines SHALL show its first 6 lines and "Show more".

#### Scenario: Activity of a task with a session
- **WHEN** the thread of AW-1 has `task.created`, `task.claimed`, `session.started`, a `message.human` with source `first`, a `message.agent`, a `gate.opened` and a `gate.answered`
- **THEN** Activity shows the description once, "Created by human@macbook-pro", the agent message, the gate and the answer, and no claim, session or input row

#### Scenario: Stopped session on the phone
- **WHEN** the person stops the session of AW-1 on ubuntu-01
- **THEN** the phone Activity shows "Session stopped on ubuntu-01: a person stopped it or ended the agent. AW starts no new session until a person starts one."

#### Scenario: Long agent message
- **WHEN** an agent message has 9 lines
- **THEN** Activity shows its first 6 lines and "Show more", and "Show more" shows the 9 lines
