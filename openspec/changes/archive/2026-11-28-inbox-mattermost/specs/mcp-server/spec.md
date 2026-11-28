## ADDED Requirements

### Requirement: Triage token and tools
awd SHALL mint one MCP token for the triage session of a workspace (kind `triage`). A request with this token SHALL see only the tools `inbox_batch`, `card_add`, `card_update`, `inbox_answer` and `inbox_done`. A request with a task session token SHALL NOT see them. `card_add` and `card_update` SHALL refuse a card of another workspace, a project that does not exist and a message id that the batch did not give. The tools SHALL call the same inbox service code as the local API.

#### Scenario: Task token
- **WHEN** a task session calls `card_add`
- **THEN** the MCP server answers that the tool does not exist

#### Scenario: Unknown project
- **WHEN** the triage session calls `card_add` with the project `nope`
- **THEN** the result is an error `invalid_input` with "No project nope", and no event is written
