## 1. Schema and shared rules

- [x] 1.1 Add `gateQuestion` and `gate.opened.questions` to `shared/schema/src/events.ts`; run `pnpm schema:generate` (JSON Schemas, samples, Kotlin classes)
- [x] 1.2 Add `details` and option objects to `askBody` in `shared/client/src/session-schemas.ts`; run `pnpm api:generate`
- [x] 1.3 Add `gateHasBody`, `gateContext`, `gateQuestions` and `questionAnswer` to `shared/client/src/gates.ts`
- [x] 1.4 Write the fixtures `contracts/fixtures/gates/questions.json` and `context.json`, and the TS tests that read them

## 2. awd and the CLI

- [x] 2.1 `SessionManager.ask`: details as the text, the question as the title, the long-details file, `questions` for descriptions
- [x] 2.2 `aw ask --details`, `--details-file`, `--option` in `daemon/src/cli/agent.ts`, with the input checks
- [x] 2.3 MCP tool `ask`: `details`, option objects; the server instructions line
- [x] 2.4 Session context rule line in `daemon/src/sessions/context.ts`
- [x] 2.5 Daemon tests: CLI, file check, details, long details, redaction, MCP, push title
- [x] 2.6 `message` and `stage` drain the hook spool first, so the prompt of the turn sorts before the agent message

## 3. Claude plugin

- [x] 3.1 `toolGate`: `questions` with headers, multiSelect and descriptions; options for one single-choice question only
- [x] 3.2 Fake agent step `ask-tool-json <json>`
- [x] 3.3 Skill rule for the decision context (below 6,000 characters) and its contract test
- [x] 3.4 Plugin tests with the captured 2.1.330 payload and a 2-question payload

## 4. Desktop

- [x] 4.1 `useGateContext` query (thread `before` the gate)
- [x] 4.2 Gate card: details with "Show more", Context, option descriptions, question list with "Send answers"
- [x] 4.3 Desktop tests (card, notification title)

## 5. Phone

- [x] 5.1 Kotlin `GateTexts`: `hasBody`, `context`, `questions`, `answer`, with the shared fixtures
- [x] 5.2 `WorkspaceModel` reads the context events and the questions; `GateCard` gets `context` and `questions`
- [x] 5.3 `GateCardView`: plain-text body and Context with "Show more", descriptions, question list with "Send answers"
- [x] 5.4 Kotlin jvmTest of the card model

## 6. Docs

- [x] 6.1 `docs/workflow.md` 3 and 8, `docs/phase-1.md` (gate fields, `aw ask`), `docs/design.md` 8.7

## 7. Verification

- [x] 7.1 Break each new test once and see it fail
- [x] 7.2 Docker e2e: `aw ask --details-file` with long details on 2 devices
- [x] 7.3 Desktop journey off-screen (analysis before the question, details, 2 questions; dark, light, 400 px)
- [x] 7.4 Phone journey on the Linux test server
- [x] 7.5 One real Claude Code run (haiku) on the Linux test server with `aw ask --details-file`
- [x] 7.6 Root `task check`, `task leakcheck`, `openspec validate --strict` on the last commit
