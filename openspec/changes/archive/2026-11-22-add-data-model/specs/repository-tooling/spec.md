## ADDED Requirements

### Requirement: Generated schemas stay current in CI
The CI job `node` SHALL run `pnpm schema:generate`, then fail when `git status --porcelain` shows a change, so that the generated JSON Schemas in `packages/schema/generated/schemas/` always match the zod schemas.

#### Scenario: Stale generated file
- **WHEN** a pull request changes a zod schema and does not commit the new generated file
- **THEN** the CI step "Generated schemas are current" fails and prints the changed file
