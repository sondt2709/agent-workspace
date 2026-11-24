## MODIFIED Requirements

### Requirement: Navigation and layout
The window SHALL have a sidebar with the Inbox, Devices & sync, the shared Knowledge, Credentials and Settings, each workspace and its projects, and for each project Board, List, Knowledge and Files. The layout SHALL work from a 400 × 480 window to a wide screen: a temporary drawer below 600 px, an icon rail up to 1200 px, a 240 px drawer above; below 840 px a selected task, knowledge file, device or task folder replaces the list; from 840 px list and detail show side by side.

#### Scenario: Narrow window
- **WHEN** the window is 400 px wide and the person selects a task in the List
- **THEN** the task detail replaces the list, and Back returns to the list

#### Scenario: Knowledge in a narrow window
- **WHEN** the window is 400 px wide and the person selects a knowledge file
- **THEN** the file view replaces the tree, and Back returns to the tree
