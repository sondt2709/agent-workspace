## ADDED Requirements

### Requirement: Ask with details
The MCP tool `ask` SHALL accept `details` (Markdown, at most 262,144 characters) and `options` items as a string or as `{label, description}`. The server instructions SHALL tell the agent to put the full context of a decision in `details` and never to point at an earlier message.

#### Scenario: Details and descriptions
- **WHEN** the agent calls `ask` with `text: "Which queue library?"`, `details: "## Options\n…"` and `options: [{label: "Library A", description: "Same process"}, "Library B"]`
- **THEN** the gate has the title "Which queue library?", the details as its text, the options "Library A" and "Library B", and `questions` with the description of "Library A"
