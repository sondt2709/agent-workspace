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
The phone app SHALL use small components: buttons at least 36 dp high, one-line text fields about 50 dp high (a 48 dp minimum in place of 56 dp), and a type scale with 14 sp body text. Each control SHALL keep a touch target of at least 48 dp.

#### Scenario: Gate button
- **WHEN** the phone shows the option buttons of a gate
- **THEN** each button is 36 dp high and its touch target is 48 dp high

### Requirement: Markdown for Claude output
Both apps SHALL render the text of Claude as Markdown in these places: the gate details, the Context of a gate, the agent messages in Activity, the approach versions and the first message. The Session view SHALL show the raw text. Markdown SHALL NOT run raw HTML or scripts and SHALL NOT load remote images. A link SHALL open in the system browser only when it starts with `https://`.

#### Scenario: Agent message with a list
- **WHEN** an agent message in Activity is "Plan:\n\n- Use **cents**"
- **THEN** the message shows a bullet with "Use cents" in bold, on desktop and phone

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

