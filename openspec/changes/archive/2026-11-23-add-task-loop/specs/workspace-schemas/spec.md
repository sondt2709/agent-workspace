## ADDED Requirements

### Requirement: Task loop fields
The schemas SHALL have: `vapid_public_key` (an uncompressed P-256 point, base64url with no padding, or null) in `bindings.v1`; the document `push.v1` (`kind: push`, `device`, `subscriptions` of `{computer, endpoint, p256dh, auth, vapid_public_key, distributor, updated}`); `gates` (gate ids, default empty) in `task.ready`; `decisions` (each `{question, options, recommended}`, default empty) in `gate.opened`; and the source `notice` in `message.human`. The generated JSON Schemas, samples and Kotlin classes SHALL include them.

#### Scenario: Push file
- **WHEN** a reader validates a `push.yaml` that the phone wrote
- **THEN** it passes `push.v1`, and a subscription with no `endpoint` fails
