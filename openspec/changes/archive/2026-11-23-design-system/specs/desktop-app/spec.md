## ADDED Requirements

### Requirement: Design system
The desktop app SHALL follow `docs/design.md`. The color tokens SHALL live in `@aw/ui/tokens` for the dark and the light scheme, and `createAppTheme()` SHALL take each color, type size, radius and component default from them. Each text token and each status color SHALL have a contrast of at least 4.5:1 on the surfaces of `docs/design.md` 2.2 and 2.3, and `onAccent` on `accent` and `onYou` on `you` SHALL too. The app SHALL bundle its fonts (Inter Variable, Geist Mono Variable) and load no font from the network. Keyboard focus SHALL show a 2 px ring in the `focus` color on `:focus-visible`, and no ripple. Dialogs, menus and popovers SHALL use the `overlay` surface with no elevation gradient. The window SHALL have the `canvas` color of the system scheme as its background; on macOS it SHALL use the hidden inset title bar, with the traffic lights in a 44 px row of the sidebar and the top rows as drag regions.

#### Scenario: Token contrast
- **WHEN** the test computes the WCAG contrast of `text3` on `surface` in the light scheme
- **THEN** the value is at least 4.5

#### Scenario: Keyboard focus
- **WHEN** the person moves the focus to a sidebar item with Tab
- **THEN** the item shows a 2 px ring in the `focus` color, and its fill does not change to the accent

#### Scenario: Fonts offline
- **WHEN** the app starts with no network
- **THEN** the page text uses "Inter Variable", loaded from an `app://` file

#### Scenario: macOS window
- **WHEN** the app opens its window on macOS in the dark scheme
- **THEN** the window options have `titleBarStyle: "hiddenInset"` and the background `#08090A`, and the sidebar starts with a 44 px drag row
