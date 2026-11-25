## MODIFIED Requirements

### Requirement: Gate answers
Any device SHALL be able to answer a gate. Only the owner SHALL open or resolve a gate, for each gate kind. The owner's `gate.resolved` SHALL decide the used answer. Each other answer to that gate, an answer to an older version and an answer after the resolution SHALL become a comment. A resolved `approve_proposal` gate (or `confirm_approach` from before the rename) SHALL approve a proposal version only when the `gate.resolved` answer starts with `approve` or `confirm`, in any letter case (the answer text of the "Approve" option, or "Confirm" of an old gate); it SHALL approve the version of the gate file `proposal/v<n>.md` or `approach/v<n>.md`, or the latest proposed version when the gate has no such file. Both ports SHALL use this exact rule.

#### Scenario: Gate answered twice
- **WHEN** `macbook-pro` and `pixel-9` answer the same gate, and the session device resolves it with the answer of `pixel-9`
- **THEN** the gate is resolved with the answer of `pixel-9`, and the answer of `macbook-pro` is a comment, also when its HLC is earlier

#### Scenario: Answer to an old version
- **WHEN** a device answers version 1 of a gate after version 2 opened
- **THEN** the answer is a comment and the gate stays open

#### Scenario: Approve and the old Confirm
- **WHEN** the owner resolves an `approve_proposal` gate of `proposal/v6.md` with "Approve", and a `confirm_approach` gate of `approach/v2.md` of another task with "Confirm"
- **THEN** the first task has the approved version 6 and the second task the approved version 2

#### Scenario: Gate of another device
- **WHEN** a device that is not the owner opens a gate, and a human answers it
- **THEN** the `gate.opened` is ignored with the reason `not_owner`, and the answer is a comment with the reason `gate_unknown`
