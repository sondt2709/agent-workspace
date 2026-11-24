## ADDED Requirements

### Requirement: Appearance
Settings SHALL have "Appearance" with System, Light and Dark. The choice SHALL be stored as `appearance` in `<userData>/aw-desktop.json` (default `system`; an unknown value counts as `system`). The main process SHALL set `nativeTheme.themeSource` to the choice at the start, before the first window, and after each change, so the renderer, the window background and the menus use that scheme.

#### Scenario: Choose Light
- **WHEN** the system scheme is dark and the person selects Light in Settings
- **THEN** the app sends `setAppearance` with `light`, `aw-desktop.json` has `"appearance": "light"`, and the page uses the light tokens

#### Scenario: Restart keeps the choice
- **WHEN** `aw-desktop.json` has `"appearance": "light"` and the app starts
- **THEN** the first window has the light `canvas` background and the page uses the light tokens

### Requirement: Loading rows
While the data of a screen loads, the screen SHALL show nothing for 300 ms, then skeleton rows of the size of its content, not a "Loading …" text line. This applies to Devices & sync, Knowledge, Files, the task detail, the Board and List, and the Inbox.

#### Scenario: Slow load
- **WHEN** the devices route has not replied after 300 ms
- **THEN** the Devices page shows skeleton rows and no text "Loading"

### Requirement: Settings sections
The Settings page SHALL show titled sections: Appearance, Startup ("Open at login"), Notifications, Sync across networks and Setup check. The recovery phrase reminder SHALL stay above them.

#### Scenario: Open at login has a title
- **WHEN** the person opens Settings
- **THEN** the "Open at login" switch is in a section with the title "Startup"
