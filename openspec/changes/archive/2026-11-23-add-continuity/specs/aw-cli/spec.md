## ADDED Requirements

### Requirement: Slot commands
Inside a session, the CLI SHALL have `aw slot acquire <resource>` (prints the slot, the fencing token and the expiry, or the queue position with exit code 1) and `aw slot release <resource>`, which call the session routes. Both SHALL be in the allow rules of the session (`Bash(aw slot acquire *)`, `Bash(aw slot release *)`).

#### Scenario: Acquire from the CLI
- **WHEN** the agent runs `aw slot acquire k3d` on the device that has a free `k3d` slot
- **THEN** the CLI prints the slot and the fencing token, with exit code 0
