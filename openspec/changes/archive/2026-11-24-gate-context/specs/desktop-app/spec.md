## ADDED Requirements

### Requirement: Question details and context on gate cards
A gate card in the Inbox detail and in Activity SHALL show the gate text as Markdown above the choices when the gate has a body (the trimmed text is not empty and not the trimmed title). A body longer than 12 lines SHALL show its start and "Show more". A `question` or `reply` gate with no body SHALL show "Context": the `message.agent` texts after the last event by `human@…` before its `gate.opened`, oldest first, at most 5, each longer than 6 lines clamped with "Show more". With no such message, the card SHALL show no Context.

#### Scenario: Details
- **WHEN** the agent asks "Which queue library?" with details
- **THEN** the card shows the title, the details as Markdown, and then the option buttons

#### Scenario: Analysis before the question
- **WHEN** the agent writes its analysis with `aw message` and then asks "Which option? (see the gate message above)" in the same turn
- **THEN** the card shows the analysis under "Context" above the buttons a, b, c and d

### Requirement: Gate cards with questions
When `gate.opened` has `questions`, the card SHALL show each option description under its label. A gate with one single-choice question SHALL keep one button per option. A gate with 2 or more questions, or a multiSelect question, SHALL show each question with its header and its options as choices (one pick, or any picks for multiSelect), and "Send answers", which sends one answer: `"<question>"="<answer>"` for each question joined by `, `, multiSelect labels joined by `, `, and `(no option selected)` for a question with no pick.

#### Scenario: Two questions
- **WHEN** the person picks "Library B" for "Which queue library do we use?" and "Unit tests" and "Leak check" for "Which checks must run before the release?", and selects "Send answers"
- **THEN** the answer is `"Which queue library do we use?"="Library B", "Which checks must run before the release?"="Unit tests, Leak check"`
