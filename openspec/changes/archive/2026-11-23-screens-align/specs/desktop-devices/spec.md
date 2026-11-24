## MODIFIED Requirements

### Requirement: Devices and sync page
The Devices & sync page SHALL show the sync engine state and a card for each device of the workspace. Each card SHALL show the name, the role, "This device", the record state (valid, revoked, bad signature) and property rows: the presence ("Last heartbeat 12 s ago", or "Offline since 10:42"); for each other device the sync text of awd ("Synced 12 s ago", "3 changes not synced to ubuntu-01 (offline)"), the route and the state of each folder; for a computer the agent, the sessions ("1 working of 2 · queue 0"), the session hosts, "Use Orca" and the checkouts of its bindings with their host; for this device its test slots. The page SHALL use only the devices, presence, sync, queues, session-hosts and bindings routes.

#### Scenario: Offline peer
- **WHEN** `ubuntu-01` is offline and 3 items are not synced to it
- **THEN** its card shows "Offline since …" and "3 changes not synced to ubuntu-01 (offline)"

#### Scenario: Sessions of a computer
- **WHEN** the queues route gives `claude@mac-mini-lab` with `working: 1`, `max_working: 2` and 1 queued task
- **THEN** the card of `mac-mini-lab` shows the agent `claude@mac-mini-lab` and "1 working of 2 · queue 1"

### Requirement: Credentials page
The Credentials page SHALL list the credential names of the workspace with who added them and where they were imported. "Add" SHALL take a name and a value from a password field, send it once and clear the field; the app SHALL never read or show a value. "Remove" SHALL ask for a confirmation. With no credential, the page SHALL show "No credentials yet" and an "Add a credential" button.

#### Scenario: Add a credential
- **WHEN** the person adds `stripe-test` with a value
- **THEN** the app sends `addCredential`, the list shows `stripe-test`, and no screen shows the value

#### Scenario: Empty list
- **WHEN** the workspace has no credential
- **THEN** the page shows "No credentials yet" and "Add a credential", which opens the Add dialog
