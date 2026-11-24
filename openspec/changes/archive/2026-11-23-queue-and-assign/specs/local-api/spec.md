## ADDED Requirements

### Requirement: Queues route
`GET /v1/workspaces/{ws}/queues` SHALL be a person route. It SHALL answer `{device, agents, unassigned}`: for each agent with a queued task, `{agent, device, max_working, working, tasks: [{task, key, title, position, text, cause: {code, text}}]}` by the queue rule, and for each active task with no assignee `{task, key, title, created_by, by_agent}`. `by_agent` SHALL be true when the `by` of `task.created` is set and does not start with `human@`.

#### Scenario: Queued tasks
- **WHEN** 2 sessions of `claude@macbook-pro` work and AW-3 and AW-4 wait
- **THEN** the reply lists AW-3 with position 1, the text "Queued · 1st for claude@macbook-pro" and the cause `max_working` "2 sessions working"

#### Scenario: Session caller
- **WHEN** a session caller sends `GET /v1/workspaces/-/queues`
- **THEN** awd answers 403 `refused`

#### Scenario: Agent subtask
- **WHEN** an agent created AW-5 with no assignee
- **THEN** `unassigned` lists AW-5 with `created_by: claude@macbook-pro` and `by_agent: true`
