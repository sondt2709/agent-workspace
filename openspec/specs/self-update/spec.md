# self-update Specification

## Purpose
An update of AW that never stops the sessions: a signed release in a versions folder, a current link, and a launcher that goes back to the previous version after 3 failed starts (add-continuity).
## Requirements
### Requirement: Versions folder and signature
An update SHALL check the Ed25519 signature of the release tarball (a detached base64 signature over the sha256 of the tarball) with the release public key before it unpacks anything, SHALL unpack the checked bytes (never the file a second time) to `~/.aw/versions/<version>/`, and SHALL switch the `current` link with an atomic rename. An install of the version that `current` names SHALL change nothing. It SHALL point the `previous` link at the version before, SHALL set `failed-starts` to 0, and SHALL NOT stop tmux or a session.

#### Scenario: Bad signature
- **WHEN** the signature does not match the tarball
- **THEN** the update fails, and `versions/` has no new folder and `current` is unchanged

### Requirement: Rollback after failed starts
Before each start the launcher SHALL read `failed-starts`: at 3 or more it SHALL switch `current` back to the previous version (and `previous` to the failed one) and start the count again; then it SHALL add 1 and run awd of `current`. awd SHALL set `failed-starts` to 0 after it was ready for 60 s.

#### Scenario: New version does not start
- **WHEN** the new version fails to start 3 times
- **THEN** the 4th start of the launcher runs the previous version
