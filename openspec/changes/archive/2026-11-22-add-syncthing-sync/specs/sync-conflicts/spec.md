## ADDED Requirements

### Requirement: Write journal
awd SHALL record the sha256 of each own write of a file in the AW folder in `<AW_HOME>/journal/<workspace id>.jsonl`: the bytes of each files-layer write, and the content of each file for which the engine reports a local change (a human edit). It SHALL keep at least the last 16 hashes per path after a restart.

#### Scenario: Human edit
- **WHEN** a person saves `knowledge/shared/testing.md` in an editor
- **THEN** the journal has the sha256 of that content for the path

### Requirement: Priority rule for shared files
For a conflict copy of a shared file, the resolver SHALL find the copy author from the journal (the copy hash is an own write) or the original author from the journal (the original hash is an own write), or, with exactly 2 devices, the copy author as the device that is not the winner in the copy name. It SHALL take the original author from the engine (`modifiedBy`). It SHALL keep the version of the author with the higher priority: `local`, then `remote` in the device order of `workspace.yaml`, then `mobile`. It SHALL write that version over the original when it is the copy, remove the copy, and store the other version in `<AW_HOME>/history/<workspace>/<sha256>`. When no author is found, it SHALL keep the engine winner and remove the copy. No conflict copy of a shared file SHALL stay.

#### Scenario: Local edit is older
- **WHEN** the local device and a remote device change the same knowledge file between 2 syncs, and the remote edit is newer
- **THEN** the knowledge file on both devices has the local content, and no conflict copy is left

#### Scenario: Local edit is newer
- **WHEN** the same happens and the local edit is newer
- **THEN** the knowledge file on both devices has the local content, and no conflict copy is left

### Requirement: Resolver election
Only the device with the highest priority among this device and the connected peers SHALL resolve a conflict copy of a shared file. Another device SHALL leave the copy. The priority SHALL be one total order that is the same on each device: the role, then the device order of `workspace.yaml`, then the slug (the order of the merge).

#### Scenario: Remote device with the local device online
- **WHEN** a remote device sees a conflict copy of a knowledge file and the local device is connected
- **THEN** the remote device does not change or remove the copy

### Requirement: Copies of device-owned files
A conflict copy of a log of this device SHALL be merged by its owner: awd appends each line of the copy whose event id the log does not have, then removes the copy (the duplicate-id rule). A conflict copy of a snapshot or another file that this device owns SHALL be resolved by its owner: the owner SHALL keep the version that its write journal has (the copy when only the copy is in the journal, else the original), remove the copy and store the other version in the history store. A conflict copy of a file that another device owns SHALL stay for its owner.

#### Scenario: Log copy
- **WHEN** a conflict copy of `tasks/<id>/log/macbook-pro.jsonl` has one event that the log does not have
- **THEN** macbook-pro appends that line, removes the copy, and the merged view has the event once
