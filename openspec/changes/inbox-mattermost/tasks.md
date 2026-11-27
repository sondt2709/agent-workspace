## 1. Contract

- [x] 1.1 `shared/schema`: the event types `source.configured`, `inbox.*` and the `inbox` part of health; tests
- [x] 1.2 `shared/core` merge: the fold of sources and cards in `foldWorkspace`, the view fields `sources` and `cards`; `contracts/fixtures/inbox/cards.json` and tests
- [x] 1.3 `shared/client`: `cardRows`, sort, counts and the hostile-text rule `fenceText`; tests on the fixture
- [x] 1.4 Regenerate `contracts/schemas`, `contracts/samples` and the Kotlin classes
- [x] 1.5 `android/shared`: the same fold in Kotlin, tested with the same fixture

## 2. Source plugin

- [x] 2.1 `shared/plugin-api/src/source.ts`: the `Source` interface
- [x] 2.2 `plugins/source-mattermost`: the `Client4` adapter, read levels, mentions, cursors, post with `pending_post_id`, `findPending`; fixtures captured from Mattermost 12.1 in Docker with the date
- [x] 2.3 Tests of the adapter against the fixtures, and one test against the real container (opt-in, `AW_E2E_MATTERMOST`)

## 3. awd

- [x] 3.1 `daemon/src/inbox/service.ts`: config, cards, person actions, task from a card, reply request, ask, run request
- [x] 3.2 `daemon/src/inbox/collector.ts`: the loop of the collecting device, the pending file, the cursors, the replies and their dedupe, the health part, the push of high cards
- [x] 3.3 `daemon/src/inbox/triage.ts`: the triage session in tmux, the triage token, the item queue, timeouts and resume
- [x] 3.4 MCP: the triage tools and the token kind; the server instructions of the triage session
- [x] 3.5 Local API routes and `contracts/openapi.yaml`; the CLI commands `aw inbox` and `aw source`
- [x] 3.6 The fake agent: the triage batch and the ask inputs
- [x] 3.7 Daemon tests: fold to service, collector with a fake source, triage with the fake agent, reply dedupe, token scope

## 4. Desktop

- [x] 4.1 The bridge calls and queries of cards and sources
- [x] 4.2 `Inbox.tsx` (list and filter bar) and `CardDialog.tsx` (dialog, keys, task form, reply, ask)
- [x] 4.3 `Sources.tsx`: Mattermost box, triage box, conversations table
- [x] 4.4 Desktop tests for each rule

## 5. Android

- [x] 5.1 `control`: `InboxCards` from the shared fixture, the card actions as phone events; tests
- [x] 5.2 `app`: the Inbox list with the filter, the card screen, the Sources screen (read-only)

## 6. Docs and verify

- [x] 6.1 `docs/prd.md` (SIG rows to phase 1 for Mattermost, INB-01), `docs/architecture.md` 6.2, `docs/phase-1.md`, `README.md` Status, `THIRD_PARTY_NOTICES` if needed
- [x] 6.2 `task check` and `task leakcheck`
- [x] 6.3 E2E: Mattermost in Docker, awd with the fake agent: collect, triage, card, ask, reply (read the post count from Mattermost), retry, a task from a card
- [x] 6.4 One real Claude Code (Haiku) triage run on synthetic messages
- [x] 6.5 Screenshots: desktop Inbox, dialog per category, Sources; phone Inbox and card

## 7. Review of PR #8

- [x] 7.1 Merge: `inbox.card_project` (the project is its own event), the category and the project of a person win over a later agent update, awd card events only from the collecting device (`not_collector`); TypeScript, Kotlin and `contracts/fixtures/merge/inbox-cards`
- [x] 7.2 Service and phone: one task for a card (also by the task link), one reply of a card at a time; a new collecting device looks for the post of each waiting reply first
- [x] 7.3 Triage launch as untrusted input: no user settings, no AW plugin, AW MCP server only, Read, Glob and Grep in the knowledge folder, `dontAsk`
- [x] 7.4 Desktop card dialog: no draft of the last card, menu keys stay in the menu, the card id in each write, Previous and Next keep the list order, Done goes on, the project menu, "<key> created"
- [x] 7.5 Desktop: Run now on ⇧⌘R, the Inbox refreshes no Mattermost call on each workspace event, the saves of the Sources page run one after another on the newest configuration, Connect waits for the collecting device
- [x] 7.6 Phone: the Inbox badge counts unread cards and Tasks counts the tasks that need you, the project menu, one create at a time, a rotation does not mark a card read again; the project filter sorts the same on both apps
- [x] 7.7 One real Claude Code (Haiku) triage run with the untrusted launch
