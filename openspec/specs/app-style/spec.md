# app-style Specification

## Purpose
The one style of the desktop app and the phone: the palette of the prototype with its yellow accent, the question option buttons, the compact phone components and Markdown for Claude output.
## Requirements
### Requirement: One palette on desktop and phone
The desktop theme (`@aw/ui/tokens`) and the phone theme SHALL use the palette of the prototype. The accent (the primary button fill, links, the selected tab mark, the focus ring) SHALL be the prototype yellow: `#F0B429` with text `#1A1200` in the dark scheme, `#8F5200` with white text in the light scheme. No indigo or other accent SHALL show. The phone SHALL NOT use dynamic color.

#### Scenario: Primary button in the dark scheme
- **WHEN** the desktop shows a contained primary button in the dark scheme
- **THEN** its fill is `#F0B429` and its text is `#1A1200`

#### Scenario: Phone on Android 14
- **WHEN** the phone app starts on Android 14 with a blue wallpaper
- **THEN** its primary color is `#F0B429` in the dark scheme, not a wallpaper color

#### Scenario: Contrast
- **WHEN** the token test computes `accentText` on `surface` and `onAccent` on `accent` in each scheme
- **THEN** each value is at least 4.5

### Requirement: Question option buttons
A question gate with one single-choice question (desktop and phone) SHALL show one full-width button per option, stacked, with the description under the label. The recommended option SHALL be the filled accent button: the first option whose label contains "(Recommended)", any case, else the first option. The other options SHALL be outlined. A gate with 2 or more questions or a multiSelect question SHALL show each option as a full-width toggle and "Send answers".

#### Scenario: Recommended label
- **WHEN** the options are "Library A", "Library B (Recommended)" and "Library C"
- **THEN** "Library B (Recommended)" is the filled button and the other two are outlined, each the full width of the card

#### Scenario: No recommended label
- **WHEN** the options are "Yes" and "No"
- **THEN** "Yes" is the filled button

### Requirement: Compact phone components
The phone app SHALL use one control height of 48 dp for buttons, outlined and text buttons in a form or a card, option buttons, decision rows, one-line text fields and select fields. A text field SHALL show its label above the field and its placeholder inside, so the field is 48 dp high. Chips SHALL stay 32 dp high, with a touch target of 48 dp. The type scale SHALL keep 14 sp body text.

#### Scenario: Gate button
- **WHEN** the phone shows the option buttons of a gate
- **THEN** each button is 48 dp high

#### Scenario: Field and button in one row
- **WHEN** the phone shows the message box with its Send button
- **THEN** the field and the button are both 48 dp high, and the label "Message to the agent" is above the field

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

### Requirement: App icons from one mark
The desktop app and the phone app SHALL use icons made by `scripts/icons.ts` from the one source `shared/ui/icons/aw-mark.svg`: the macOS app icon (`desktop/resources/icon.png`, set as `mac.icon` of `electron-builder.yaml`), the menu bar template image, and the Android adaptive icon (foreground, background and monochrome layers). A test SHALL fail when a committed icon is not the output of the script for the current source.

#### Scenario: Changed mark
- **WHEN** a person changes `aw-mark.svg` and does not run `pnpm icons:generate`
- **THEN** the test of `@aw/scripts` fails and names the stale icon file

#### Scenario: Themed icon on Android 13
- **WHEN** the person turns on themed icons
- **THEN** the launcher shows the monochrome layer of the AW mark

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

