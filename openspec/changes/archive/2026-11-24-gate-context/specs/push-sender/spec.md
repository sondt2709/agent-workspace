## ADDED Requirements

### Requirement: Question push keeps the question line
The push preview and the desktop notification of a question gate SHALL use the gate title (the question), and SHALL NOT have the details.

#### Scenario: Question with details
- **WHEN** the agent asks "Which queue library?" with 2 KiB of details
- **THEN** the push text is "Which queue library?" and has no line of the details
