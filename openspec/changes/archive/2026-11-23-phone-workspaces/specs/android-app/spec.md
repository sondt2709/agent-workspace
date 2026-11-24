## MODIFIED Requirements

### Requirement: Push receiver
The app SHALL register one UnifiedPush instance per computer and joined workspace (instance name `<workspace id>/<computer>`) for each computer that publishes `vapid_public_key` in its `bindings.yaml`, through the embedded FCM distributor (or another UnifiedPush distributor, for example ntfy), and SHALL write the endpoints, the Web Push keys and the VAPID key of each computer to `tasks/devices/<phone>/push.yaml` of that workspace. The registration SHALL run for every joined workspace, not only the selected one, and SHALL run in the app process also when no screen is open. A new endpoint that arrives in a new app process SHALL use the VAPID key of the existing `push.yaml` entry of that computer, else the key of a reloaded snapshot; an endpoint with no key SHALL be logged as dropped. A failed registration SHALL show "Push is off: the registration failed" on Devices and SHALL NOT be sent again with the same key in the same process. A received push SHALL start the sync engine for a short sync and SHALL show a notification with the title "<task key> · <gate name>" and the preview line; a tap SHALL select the workspace of the instance and open the stack `[Inbox, Task(id)]`.

#### Scenario: New endpoint
- **WHEN** the distributor gives a new endpoint for the instance `<ws>/ubuntu-01`
- **THEN** `push.yaml` of that workspace has one subscription for `ubuntu-01` with the endpoint, `p256dh`, `auth` and the VAPID key, and the other subscriptions stay

#### Scenario: Each joined workspace
- **WHEN** the phone has joined Personal and Side projects, Personal is selected, and ubuntu-01 publishes a VAPID key in both
- **THEN** the phone registers `<Personal id>/ubuntu-01` and `<Side projects id>/ubuntu-01`, and each workspace gets its own `push.yaml`

#### Scenario: Endpoint in a new process
- **WHEN** the app process starts for a new endpoint of `<ws>/ubuntu-01` and the snapshot of the workspace is not loaded yet
- **THEN** the phone writes the new endpoint with the VAPID key of the existing `push.yaml` entry

#### Scenario: Failed registration
- **WHEN** the distributor reports a failed registration for `<ws>/ubuntu-01`
- **THEN** Devices shows "Push is off: the registration failed", and the next snapshot refresh does not register that instance again with the same key

#### Scenario: Gate push
- **WHEN** a push with the preview `{task, key: "AW-7", gate_kind: "question", text: "Which limit?"}` arrives
- **THEN** the phone shows the notification "AW-7 · Answer question" with "Which limit?", and the engine syncs

#### Scenario: Push of another workspace
- **WHEN** Personal is selected and the person taps the notification of a gate of Side projects
- **THEN** the app selects Side projects and opens the task in the Inbox stack
