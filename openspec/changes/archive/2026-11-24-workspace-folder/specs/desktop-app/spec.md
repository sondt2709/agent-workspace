## MODIFIED Requirements

### Requirement: Settings sections
The Settings page SHALL show titled sections: Appearance, Startup ("Open at login"), Notifications, Sync across networks, Workspaces on this computer and Setup check. "Workspaces on this computer" SHALL list each workspace of this device with its name and its folder, from the workspaces route. The recovery phrase reminder SHALL stay above them.

#### Scenario: Open at login has a title
- **WHEN** the person opens Settings
- **THEN** the "Open at login" switch is in a section with the title "Startup"

#### Scenario: Workspace folders
- **WHEN** this device has the workspaces Personal at `~/AW/Personal` and demo at `/srv/work/demo-aw1`
- **THEN** "Workspaces on this computer" shows both names with these folders
