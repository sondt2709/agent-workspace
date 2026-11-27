## MODIFIED Requirements

### Requirement: Phone screens
The Android app SHALL have the screens Home, Inbox, Tasks, Task detail, New task and Devices, from the phone's own Room index. Home SHALL show "Needs you" first, then the devices with their sync state and a "Sync now" button, then the working and paused tasks. Inbox SHALL show the cards of the incoming messages ("Phone Inbox" of inbox-cards). Tasks SHALL have the tabs "Needs you", "Working" and "All" and the project filter ("Phone Tasks" and "Project filter" of tasks-view): "Needs you" SHALL show the rows of the rule `inboxItems` tested against `contracts/fixtures/inbox/items.json`, and a tap on a row SHALL open the item screen: the title, the Activity row of each open gate (the question message with its option buttons and a reply field, the proposal card, or the gate card), the Assign card or the pause, and "Open task". "All" SHALL group the tasks by stage (Backlog, Discuss, Ready, Implement, Review, Done) and SHALL show a "Paused" chip with the cause on a paused task and on a task whose session device is offline.

Task detail SHALL be the task page of the desktop ("Task detail" of desktop-app) with the same parts in the same order: a header with Back, the key, the project, the state chips, the need-you navigation ("<i> of <n> need you" with Previous and Next, in the Inbox order), "Show list" (only when the task page is 700 dp or wider), the actions menu, the title, and a stage progress bar of 6 segments with the stage name; then the tabs Activity (default), Session, Terminal and Properties. Activity has the gate cards, the description and the key activity. Session has the session summary and the raw thread. Terminal has the newest terminal snapshot. Properties has the fields, the proposal versions and the artifacts. From 1,000 dp of task page width, Properties SHALL show in a right panel of 280 dp and the tab row SHALL NOT have the Properties tab. The content of the tabs and the message box SHALL have a maximum width of 840 dp and SHALL be centred. The message box SHALL be below the Activity and Session tabs, with its label above the field and a Send button. The header SHALL scroll with the list, and the tab row SHALL stay at the top of the list, so a short window keeps the list. Each tab SHALL open at its top. Devices SHALL show each device with its role, its presence ("Last heartbeat 8 s ago", offline after 90 s), the sync state of its peer and, for this phone, the engine state and the battery warning for the mode "Restricted" with a link to the setting.

#### Scenario: Needs you row and item
- **WHEN** AW-12 has an open question with the options "100/min" and "1000/min", and AW-9 is working
- **THEN** Tasks › Needs you shows the row "Reply to a question · Rate limits for the public API · AW-12", and Tasks › Working shows the group "Working now · 1"; a tap on the row shows the question message with the 2 buttons, a reply field and "Open task"

#### Scenario: Offline device
- **WHEN** the session device of a running task has no heartbeat for more than 90 s
- **THEN** Tasks shows the task with the chip "Paused: <device> offline", and its task detail has the action "Assign to another device…"

#### Scenario: Battery restricted
- **WHEN** the battery mode of the app is "Restricted"
- **THEN** Home and Devices show the warning and a button that opens the app settings

#### Scenario: A gate does not hide behind a tab
- **WHEN** AW-1 has an open gate and the person selects the Session, Terminal or Properties tab
- **THEN** the tab shows "1 item needs you" with "Show in Activity", and "Show in Activity" selects the Activity tab and shows the row of the gate

#### Scenario: An answered gate waits for the owner
- **WHEN** the person answered the open gate of AW-1 on the phone and the owner device did not resolve it yet
- **THEN** the Session, Terminal and Properties tabs show no "items need you" line for that gate

#### Scenario: Another task opens on Activity
- **WHEN** the person selected the Session tab of AW-1 and opens AW-2
- **THEN** the task detail of AW-2 shows the Activity tab

#### Scenario: Same header as the desktop
- **WHEN** AW-1 and AW-4 need the person and the person opens AW-1 on a 412 dp phone
- **THEN** the header shows Back, "AW-1", the project, the state chip, "1 of 2 need you" with Previous and Next, the title and the stage bar, and no "Show list"

#### Scenario: Properties panel on a wide window
- **WHEN** the task page is 1220 dp wide on a DeX window
- **THEN** the properties show in a right panel, the tab row is Activity, Session and Terminal, and the Activity content is 840 dp wide and centred
