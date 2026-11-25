## MODIFIED Requirements

### Requirement: Markdown for Claude output
Both apps SHALL render as Markdown: the gate details, the Context of a gate, each message row in Activity (an agent message, a subagent report, a question, a person message typed in the terminal, a message sent from an app, a comment, an answer), the proposal versions and the first message. The Session view SHALL show the raw text. A Markdown text SHALL have its full height when it first shows, so a list does not move when a row scrolls into view. Markdown SHALL NOT run raw HTML or scripts and SHALL NOT load remote images. A link SHALL open in the system browser only when it starts with `https://`.

#### Scenario: Agent message with a list
- **WHEN** an agent message in Activity is "Plan:\n\n- Use **cents**"
- **THEN** the message shows a bullet with "Use cents" in bold, on desktop and phone

#### Scenario: Person message with a table
- **WHEN** a typed person message in Activity has a Markdown table with 2 rows
- **THEN** the message shows a table with 2 rows, on desktop and phone

#### Scenario: Comment and sent message
- **WHEN** a person sends "Use **cents**" from the app, and a comment "See `money.ts`"
- **THEN** Activity shows "cents" in bold and `money.ts` as code, on desktop and phone

#### Scenario: Scroll up in Activity
- **WHEN** the person scrolls up in Activity of the phone and a long agent message comes into view
- **THEN** the rows below it do not move

#### Scenario: Script tag
- **WHEN** an agent message contains `<script>alert(1)</script>`
- **THEN** no script runs

#### Scenario: Link
- **WHEN** the person taps a link `http://example.com` in a gate body
- **THEN** no browser opens

## ADDED Requirements

### Requirement: Three row styles in Activity
Activity on the desktop and the phone SHALL have 3 row styles only: a message (a 2 px or 2 dp edge in the colour of the author: the info colour for an agent, the outline colour for a person; the same text sizes for each author), the proposal card (a surface with a 1 px border and `r-lg`), and a task line (one muted line, 13 px on the desktop, `label-md` on the phone). A gate card of another kind SHALL use the card style of the gate cards.

#### Scenario: Styles of a Discuss stage
- **WHEN** Activity of AW-12 has an agent message, a question, an answer, a replaced proposal and the newest proposal
- **THEN** it shows 3 messages with the same text size, one task line and one proposal card

### Requirement: Fallback font for box drawing characters
Both apps SHALL bundle JetBrains Mono 2.304 (the release file, SIL Open Font License 1.1, with its notice in `THIRD_PARTY_NOTICES`). The desktop SHALL list it after Inter in the sans stack and after Geist Mono in the mono stack; the phone SHALL use it as its monospace font. Each box drawing character from U+2500 to U+257F SHALL then show with a glyph, in a code block, a terminal snapshot and a message. The app SHALL load no font from the network.

#### Scenario: Tree in a code block
- **WHEN** an agent message has a code block with `├── src` and `└── tests`
- **THEN** each line shows the box drawing characters, with the same character width as the letters
