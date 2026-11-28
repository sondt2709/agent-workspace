## ADDED Requirements

### Requirement: Inbox event types
`shared/schema` SHALL define the event types `source.configured`, `inbox.run_requested`, `inbox.card_added`, `inbox.card_updated`, `inbox.card_set`, `inbox.card_project`, `inbox.ask`, `inbox.answer`, `inbox.reply_requested`, `inbox.reply_result` and `inbox.task_created` in the workspace log, and the optional `inbox` part of device health (the source, the last read, the last batch, the triage state `running`, `waiting`, `paused` or `stopped`, and the last error). `pnpm schema:generate` SHALL write their JSON Schemas, samples and Kotlin classes. An older AW SHALL keep these lines as `unknown_type` and stop on none of them.

#### Scenario: Sample round trip
- **WHEN** the schema tests parse the generated sample of `inbox.card_added`
- **THEN** the TypeScript and the Kotlin readers accept it
