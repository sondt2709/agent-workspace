## ADDED Requirements

### Requirement: Rekey plan
Each engine SHALL give the same rekey plan for a device: one item `{task, from, to}` for each task with `key_state: duplicate` and `rekey_by` equal to that device, in the order of the `task.created` events. The first `to` SHALL be the next free key of the view, and each next item SHALL add 1. The TypeScript and the Kotlin plans SHALL equal `contracts/fixtures/merge/task-key-collision/rekeys.json`.

#### Scenario: Plan of the device of a duplicate
- **WHEN** the merged view of the case `task-key-collision` has the `AW-8` task of `pixel-9` as a duplicate
- **THEN** the plan of `pixel-9` has 1 item from `AW-8` to the next free key, and the plans of `macbook-pro` and `ubuntu-01` are empty

#### Scenario: 2 own duplicates
- **WHEN** a device has 2 duplicate tasks
- **THEN** its plan gives them 2 different keys, each above each key of the view

### Requirement: awd writes the rekey
After each merge, awd SHALL write `task.rekeyed` (by `aw@<device>`) to its own log of the task for each item of the plan of its device, and then merge again. awd SHALL write nothing for a task whose log already has a `task.rekeyed` of this device from the current key. A failed write SHALL not fail the merge.

#### Scenario: The device of the duplicate rekeys
- **WHEN** `macbook-pro` and `ubuntu-01` both created `AW-1` offline and the logs merge on `ubuntu-01`
- **THEN** `ubuntu-01` writes 1 `task.rekeyed` from `AW-1` to `AW-2` for its task, and both devices then show `AW-1` and `AW-2` with the key state `ok`

#### Scenario: The device that keeps the key writes nothing
- **WHEN** the same logs merge on `macbook-pro`
- **THEN** `macbook-pro` writes no `task.rekeyed`

#### Scenario: Restart
- **WHEN** awd of `ubuntu-01` restarts after its rekey, or merges again
- **THEN** the task logs have exactly 1 `task.rekeyed`

#### Scenario: Duplicate found at the open
- **WHEN** the 2 logs with the same key are on disk before awd starts
- **THEN** awd writes 1 `task.rekeyed` during the open of the workspace

### Requirement: The phone writes the rekey
The phone SHALL write `task.rekeyed` for each item of its own plan after an index refresh, once per task and old key in a process, and SHALL then refresh the index.

#### Scenario: Phone duplicate
- **WHEN** the phone index shows a task of the phone as a duplicate with `rekey_by` equal to the phone
- **THEN** the phone writes 1 `task.rekeyed` from the key to the next free key, and a second call writes nothing

### Requirement: Thread shows the key change
The thread line of an applied `task.rekeyed` SHALL be `<from> is now <to>`, for example "AW-7 is now AW-9", on the desktop, on the phone and in the text output of `aw thread`.

#### Scenario: Thread line
- **WHEN** a person reads the thread of a rekeyed task
- **THEN** the thread shows "AW-1 is now AW-2"
