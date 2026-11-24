## MODIFIED Requirements

### Requirement: Task activity
The Activity tab SHALL show the open gate cards, the Assign card and a pause first; then the first message once as the description, as Markdown with raw HTML off, with a "Show raw" switch that shows the exact text; then the activity rows in merge order. One table SHALL decide for each event type if it shows in Activity, with an entry for each type of the contract. The table and the rule SHALL agree with the shared fixture `contracts/fixtures/activity/cases.json`, which the phone tests too. Activity SHALL show `task.created` (as "Created by <by>", without the text), `task.assigned`, `task.rekeyed`, `task.edited`, `task.stage_changed`, `task.paused`, `task.resumed`, `task.done`, `task.archived`, `task.learned`, `message.agent` (only with the source `tool` or with no source), `message.sent` (not with `kind: nudge`), `comment.added`, `gate.opened`, `gate.answered`, `approach.proposed`, `result.posted` and `artifact.added`. It SHALL show a `message.human` only with the source `typed` or `phone` and no `delivery_id` (text that the person typed in the terminal). It SHALL show a `session.ended` only with the reason `stopped` or `crashed`, as a line with the cause and the next step (principle 2): "Session stopped on <device>: a person stopped it or ended the agent. AW starts no new session until a person starts one." or "Session crashed on <device>: the agent process ended and AW did not restart it. AW starts no new session until a person starts one." It SHALL NOT show the other types, a `message.agent` with the source `turn` (the text of an agent turn), a nudge notice, a `message.human` that repeats a message, an answer, a notice or the first message, a `session.ended` with another reason, or an unknown type: these show in the Session tab. An agent message longer than 6 lines SHALL show its first 6 lines and "Show more".

#### Scenario: First message once
- **WHEN** the person opens a task whose thread has `task.created`, `task.claimed`, `session.started` and a `message.human` with source `first`
- **THEN** Activity shows the first message once as the description, the line "Created by human@macbook-pro", and no claim, session or input row

#### Scenario: Message from the terminal
- **WHEN** the thread has a `message.human` with source `typed` and no `delivery_id`
- **THEN** Activity shows its raw text as a message of the person

#### Scenario: Show raw
- **WHEN** the first message is "# Plan\n\nUse **cents**." and the person turns on "Show raw"
- **THEN** the description shows the exact text "# Plan\n\nUse **cents**."

#### Scenario: Stopped session
- **WHEN** the person stops the session of AW-1 on ubuntu-01 and the thread gets `session.ended` with the reason `stopped`
- **THEN** Activity shows "Session stopped on ubuntu-01: a person stopped it or ended the agent. AW starts no new session until a person starts one."

#### Scenario: Moved session
- **WHEN** the thread has `session.ended` with the reason `moved`
- **THEN** Activity shows no line for it, and the Session tab shows "Session ended (moved)"

#### Scenario: Turn text stays in Session
- **WHEN** the thread has `message.agent` "Plan: …" with the source `turn` and `message.agent` "Tests pass" with the source `tool`
- **THEN** Activity shows "Tests pass" only, and the Session tab shows both texts

#### Scenario: Old agent message
- **WHEN** the thread has `message.agent` with no source
- **THEN** Activity shows it

#### Scenario: Nudge notice
- **WHEN** the thread has `message.sent` with `kind: nudge` by `aw@ubuntu-01`
- **THEN** Activity shows no row for it, and the Session tab shows it

## ADDED Requirements

### Requirement: Session link in the summary
The session summary of the Session tab SHALL show the full session id (the Claude session id), the session name, the terminal (`tmux window <window> · pane <pane>` or `Orca terminal <pane>`) and the pid, when `session.started` has them. The merge SHALL copy `name`, `terminal` and the pane pid into the session view. A `session.resumed` of the same session SHALL keep the name, and SHALL replace the terminal and the pid when it has them.

#### Scenario: Link of a tmux session
- **WHEN** `session.started` of AW-7 has the name `AW-7`, the window `aw-01a2`, the pane `%12` and the pid 4242
- **THEN** the session summary shows the full session id, "AW-7", "tmux window aw-01a2 · pane %12" and "pid 4242"
