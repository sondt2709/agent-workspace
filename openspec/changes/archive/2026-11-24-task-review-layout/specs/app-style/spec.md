## MODIFIED Requirements

### Requirement: Compact phone components
The phone app SHALL use one control height of 48 dp for buttons, outlined and text buttons in a form or a card, option buttons, decision rows, one-line text fields and select fields. A text field SHALL show its label above the field and its placeholder inside, so the field is 48 dp high. Chips SHALL stay 32 dp high, with a touch target of 48 dp. The type scale SHALL keep 14 sp body text.

#### Scenario: Gate button
- **WHEN** the phone shows the option buttons of a gate
- **THEN** each button is 48 dp high

#### Scenario: Field and button in one row
- **WHEN** the phone shows the message box with its Send button
- **THEN** the field and the button are both 48 dp high, and the label "Message to the agent" is above the field

### Requirement: Markdown for Claude output
Both apps SHALL render as Markdown: the gate details, the Context of a gate, each message row in Activity (an agent message, a subagent report, a person message typed in the terminal, a message sent from an app, a comment, the comment of an answer, and on the phone a gate row), the approach versions and the first message. The Session view SHALL show the raw text. A Markdown text SHALL have its full height when it first shows, so a list does not move when a row scrolls into view. Markdown SHALL NOT run raw HTML or scripts and SHALL NOT load remote images. A link SHALL open in the system browser only when it starts with `https://`.

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
