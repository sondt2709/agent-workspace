## MODIFIED Requirements

### Requirement: One palette on desktop and phone
The desktop theme (`@aw/ui/tokens`) and the phone theme SHALL use the palette of the prototype. The accent (the primary button fill, links, the selected tab mark, the focus ring) SHALL be the prototype yellow: `#F0B429` with text `#1A1200` in the dark scheme, `#8F5200` with white text in the light scheme. No indigo or other accent SHALL show. The phone SHALL NOT use dynamic color. The phone colors and radii SHALL come from `AwTokens.kt`, which `pnpm --filter @aw/scripts tokens` generates from `@aw/ui/tokens`; a test of `@aw/scripts` SHALL fail when the file differs from the output of the script.

#### Scenario: Primary button in the dark scheme
- **WHEN** the desktop shows a contained primary button in the dark scheme
- **THEN** its fill is `#F0B429` and its text is `#1A1200`

#### Scenario: Phone on Android 14
- **WHEN** the phone app starts on Android 14 with a blue wallpaper
- **THEN** its primary color is `#F0B429` in the dark scheme, not a wallpaper color

#### Scenario: Contrast
- **WHEN** the token test computes `accentText` on `surface` and `onAccent` on `accent` in each scheme
- **THEN** each value is at least 4.5

#### Scenario: Token drift
- **WHEN** a person changes `text3` of `tokens.dark` and does not run the token script
- **THEN** `pnpm --filter @aw/scripts test` fails and names `AwTokens.kt`

### Requirement: Compact phone components
The phone app SHALL use one visible control height of 36 dp for buttons (filled, outlined and text buttons), one-line text fields and select fields, the same as the desktop. Each of these controls SHALL keep a touch target of at least 48 dp. A question option button SHALL be at least 48 dp high and as high as its label and description. A text field SHALL show its label above the field and its placeholder inside. Chips SHALL stay 32 dp high, with a touch target of 48 dp. The screens SHALL use the buttons of `Compact.kt` and SHALL NOT import the Material 3 buttons directly. The type scale SHALL keep 14 sp body text.

#### Scenario: Button next to a chip
- **WHEN** the phone shows "New task" in the title line of the Tasks list
- **THEN** the button is 36 dp high and its touch target is 48 dp high

#### Scenario: Gate button
- **WHEN** the phone shows the option buttons of a question with a label and a description
- **THEN** each option button is at least 48 dp high and shows both lines

#### Scenario: Field and button in one row
- **WHEN** the phone shows a one-line text field and a button in one row of a form
- **THEN** the field and the button are both 36 dp high, and the label of the field is above it

#### Scenario: Direct Material 3 button
- **WHEN** a screen of `android/app` imports `androidx.compose.material3.Button`
- **THEN** `task android:check` fails with the detekt rule `ForbiddenImport`

## ADDED Requirements

### Requirement: Phone type
The phone SHALL use Inter (the variable font of the `rsms/inter` release 4.1, bundled, SIL Open Font License 1.1 with its notice in `THIRD_PARTY_NOTICES`) for all text except code, with the features `cv11` and `ss01`. The phone SHALL map the desktop type roles: `title-lg` 22/30 sp weight 590 for the task title, `title` 18/26 sp weight 590 for a page title, `title-sm` 14/20 sp weight 590, `body-strong` 14/20 sp weight 510 for a row title and a button label, `body` 14/21 sp weight 400, `meta` 12/16 sp weight 400 and `label` 12/16 sp weight 510 in `text3`. The phone SHALL load no font from the network.

#### Scenario: Task title
- **WHEN** the phone shows the task page of AW-1
- **THEN** the title uses Inter at 22 sp with the weight 590, and the key "AW-1" uses the monospace font

#### Scenario: Offline font
- **WHEN** the phone has no network and starts the app the first time
- **THEN** all text shows in Inter
