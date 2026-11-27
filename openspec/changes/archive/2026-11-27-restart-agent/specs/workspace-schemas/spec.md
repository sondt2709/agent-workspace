## ADDED Requirements

### Requirement: Kind of a comment
`comment.added` SHALL have an optional `kind`. The only value SHALL be `start_failed`: the comment of awd when the session of the task did not start on its device. A comment with no `kind` SHALL stay valid, and a reader SHALL show the text of each comment as before.

#### Scenario: Start failure comment
- **WHEN** awd writes `comment.added {text: "The session did not start on macbook-pro: …", kind: "start_failed"}`
- **THEN** the event is valid

#### Scenario: Unknown kind
- **WHEN** a `comment.added` has `kind: "note"`
- **THEN** the schema refuses it at `data.kind`
