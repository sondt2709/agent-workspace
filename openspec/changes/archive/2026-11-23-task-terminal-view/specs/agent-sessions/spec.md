## ADDED Requirements

### Requirement: Redaction before a cut
Each writer that shortens agent text or screen text SHALL redact the full text with the redaction of the files layer first, then cut it. This SHALL cover the preview of a long message (2,000 characters), the gate title (500 characters) and the gate text (16 KiB) of `approach`, `gate` and `result`, the title of `ask`, of a "Reply" gate and of a missing item of `ready`, the text of a knowledge change gate (16,000 characters), the summary of a permission gate (300 characters), and the "Last terminal line" of the watchdog (300 characters).

#### Scenario: Value across the preview cut
- **WHEN** a reply of 40 KiB has the value `stg_live_9f8e7d6c5b4a` at character 1,990
- **THEN** the `message.agent` event has `[redacted:staging-api-key]` and no prefix of the value

#### Scenario: Value across a gate title cut
- **WHEN** the first line of an approach is 520 characters long and has the value at character 495
- **THEN** the title of "Confirm approach" has no prefix of the value

#### Scenario: Long Bash command
- **WHEN** a permission request has a Bash command of 400 characters with the value at character 295
- **THEN** the title and the text of "Approve command" have no prefix of the value
