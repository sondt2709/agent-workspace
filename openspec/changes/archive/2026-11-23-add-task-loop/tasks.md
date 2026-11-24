## 1. Schemas and merge

- [x] 1.1 `bindings.v1` `vapid_public_key`, document `push.v1`, `task.ready.gates`, `gate.opened.decisions`, `message.human` source `notice`; samples; registry
- [x] 1.2 Merge: the project switch sets only the first assignment (TypeScript and Kotlin); merge case `task-rules`
- [x] 1.3 `pnpm schema:generate`; Kotlin `DocumentReader` knows `push`; sample count

## 2. Push sender

- [x] 2.1 `@aw/push-webpush`: VAPID keys and JWT, RFC 8291 encryption, send with a replaceable fetch
- [x] 2.2 Tests: RFC 8291 appendix A vector, JWT signature check, headers of a send

## 3. Loop in awd

- [x] 3.1 `daemon/src/loop/`: ready checks, gate push rules, push service, credential provider, `TaskLoop`
- [x] 3.2 Manager hooks: stage at the first claim, dependencies, resolution effects, notices, Done at Stop, parent notice and new session, credentials at window open
- [x] 3.3 Agent methods: approach, ready, task_create, gate, result, done
- [x] 3.4 Knowledge gates

## 4. Interfaces

- [x] 4.1 Client schemas and methods, session routes, OpenAPI
- [x] 4.2 MCP tools (only slot tools stay `not_available`)
- [x] 4.3 CLI agent commands, `aw task create` in a session, allow rules, skill text

## 5. Tests, docs, check

- [x] 5.1 Unit tests of the loop functions; an e2e of the full loop with the fake agent
- [x] 5.2 Docs: workflow.md, phase-1.md, AGENTS.md
- [x] 5.3 `task check` green
