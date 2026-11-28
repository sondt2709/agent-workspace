## ADDED Requirements

### Requirement: Cards
A card SHALL have an id, the source, the conversation (id, name, kind), the thread, a project or none, a category (`action`, `question`, `info`), an urgency (`high`, `normal`, `low`), a title, a summary, the original messages word for word (author, time, text, link, quoted text), and a suggestion: a task (title, project, first message) for an action, an answer (text and its source) for a question. One thread SHALL be one card: the triage session SHALL update the card of a thread with `card_update`. A new message in the card SHALL mark it unread and not done. The merge in TypeScript and in Kotlin SHALL give the same cards for the cases of `contracts/fixtures/inbox/cards.json`.

#### Scenario: New message in a done thread
- **WHEN** the card "Invoice CSV export fails" is done and read, and a new message comes in its thread
- **THEN** the card has the new message, is unread and is not done

#### Scenario: Person event from an agent
- **WHEN** a line `inbox.card_set` has `by: claude@ubuntu-01`
- **THEN** the merge does not apply it (`not_human`)

#### Scenario: Card of a computer that does not collect
- **WHEN** the source names ubuntu-01 as the collecting device, and `inbox.card_updated` comes from mac-mini-lab
- **THEN** the merge does not apply it (`not_collector`)

#### Scenario: The person decides the category
- **WHEN** the person changes a card from Question to Action, and later the triage agent updates the card with category Info
- **THEN** the card stays Action, and the other fields of the update apply

### Requirement: Card actions
A person SHALL mark a card read or unread and done or not done, change its category and its project, create its suggested task, send a reply and ask the agent, on the desktop and the phone. Opening a card SHALL mark it read. A project change SHALL write `inbox.card_project` (also for no project); a read, a done or a category SHALL write `inbox.card_set` with no project. Each action SHALL write one person event; the card SHALL show "Not synced" until the collecting device has it, for a reply and an ask.

#### Scenario: Read on the phone keeps the project
- **WHEN** the desktop sets the project Billing API, and the phone marks the card read before it has that event
- **THEN** each device shows the card read, with the project Billing API

#### Scenario: Change the category
- **WHEN** the person changes the card from Info to Action
- **THEN** the card shows the Action icon on each device, and the suggestion box shows "Create task…" with the title of the card

### Requirement: Create a task from a card
"Create task…" SHALL open a form with the title, the project, the assignee and the first message of the suggestion. The project SHALL be required: a card with no project SHALL show "Choose a project" and SHALL NOT create the task without one. The task SHALL have the link `inbox:<card id>` and the first message SHALL quote the source messages. The card SHALL show "<key> created" and "Open task". A card SHALL give one task: a second "Create task" SHALL be refused ("This card already has a task").

#### Scenario: Card with no project
- **WHEN** the person opens "Create task…" on a card with no project and selects Create task with no project
- **THEN** the form shows "Choose a project" and creates no task

### Requirement: Reply to the source
"Reply…" on a question card SHALL show the suggested answer in a text field, the author `@<username>`, the conversation and "in the thread". "Send" SHALL write `inbox.reply_requested`. The collecting awd SHALL post it once, with the reply id as `pending_post_id`, and SHALL write `inbox.reply_result` with the post link, or with the error. A retry after an error or a restart SHALL post nothing when the post exists. A second reply of a card SHALL be refused while the first one is not sent.

#### Scenario: Reply sent
- **WHEN** the person sends "Staging runs Node 26." on the card of `Lan, Minh, Alex`
- **THEN** Mattermost has one post with that text in the thread, and the card shows "Sent 10:47"

#### Scenario: Retry after a restart
- **WHEN** awd stops after the post and before `inbox.reply_result`, and starts again
- **THEN** awd finds the post by its `pending_post_id`, writes `inbox.reply_result` with it, and Mattermost still has one post

### Requirement: Desktop Inbox
The desktop Inbox SHALL show one list of cards: an unread dot, the category icon in a box of 24 × 24 px (so each title starts at the same place), the title, the project and the conversation, the urgency as 3 bars and the time. The filter bar SHALL have the category chips All, Action, Question and Info with counts, the project filter (with "No project"), Unread, Done and the sort (urgency or newest). The top bar SHALL show the source state ("Mattermost · 1 min ago") and "Run now" (⇧⌘R; ⌘R stays "Sync now"). Previous and Next SHALL keep the order of the list when the open card leaves it (Done, or read with Unread on); Done SHALL go on to the next card. A key that a menu of the dialog handles SHALL not change the card. A card SHALL open in a dialog with the category icon, the title, Previous, Next, Close, the category menu, the urgency, the project, the conversation, the time, the summary, the suggestion box, the messages, "Ask the agent", and Done, Mark unread and "Open in Mattermost" in the footer. The keys SHALL be ↑ ↓ j k (previous, next), r (reply), t (ask), d (done), u (unread) and Esc (close). With no source, the Inbox SHALL show "No source yet" with "Add a source".

#### Scenario: Open and move
- **WHEN** the person opens the first card and presses j
- **THEN** the dialog shows the second card, and both cards are read

#### Scenario: No source
- **WHEN** the workspace has no source
- **THEN** the Inbox shows "No source yet" and "Add a source", which opens Sources

### Requirement: Phone Inbox
The phone Inbox SHALL show the same rows, filter and sort as the desktop, from the rule `cardRows` tested against `contracts/fixtures/inbox/cards.json`. A tap SHALL open the card as its own screen with the same parts and actions as the desktop dialog. The bottom bar badge SHALL show the number of unread open cards.

#### Scenario: Reply from the phone
- **WHEN** the person taps "Reply…" and "Send" on a question card on the Pixel 9 while the laptop is closed and ubuntu-01 collects
- **THEN** ubuntu-01 posts the reply, and the phone shows "Sent" after the next sync

### Requirement: Push of high urgency cards
The collecting awd SHALL send a push for a new card with urgency `high`, and for an update that raises a card to `high`, with the title "Inbox · <category>" and the card title. Other cards SHALL send no push.

#### Scenario: Normal card
- **WHEN** the triage session adds a card with urgency `normal`
- **THEN** no push is sent
