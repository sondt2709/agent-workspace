## MODIFIED Requirements

### Requirement: Devices and sync page
The Devices & sync page SHALL show the sync engine state and a card for each device of the workspace. Each card SHALL show the name, the role, "This device", the record state (valid, revoked, bad signature) and property rows: the presence ("Last heartbeat 12 s ago", or "Offline since 10:42"); for this device the workspace folder of the current workspace ("Workspace folder"); for each other device the sync text of awd ("Synced 12 s ago", "3 changes not synced to ubuntu-01 (offline)"), the route and the state of each folder; for a computer the agent, the sessions ("1 working of 2 · queue 0"), the session hosts, "Use Orca" and the checkouts of its bindings with their host; for this device its test slots. Other device cards SHALL NOT show a workspace folder: awd does not sync it. The page SHALL use only the devices, presence, sync, queues, session-hosts, bindings and workspaces routes.

#### Scenario: Offline peer
- **WHEN** `ubuntu-01` is offline and 3 items are not synced to it
- **THEN** its card shows "Offline since …" and "3 changes not synced to ubuntu-01 (offline)"

#### Scenario: Sessions of a computer
- **WHEN** the queues route gives `claude@mac-mini-lab` with `working: 1`, `max_working: 2` and 1 queued task
- **THEN** the card of `mac-mini-lab` shows the agent `claude@mac-mini-lab` and "1 working of 2 · queue 1"

#### Scenario: Folder on the card of this device
- **WHEN** the current workspace demo is at `/Users/example/Work/demo-aw1` on this device
- **THEN** the card of this device shows "Workspace folder" with `/Users/example/Work/demo-aw1`, and the other cards show no folder
