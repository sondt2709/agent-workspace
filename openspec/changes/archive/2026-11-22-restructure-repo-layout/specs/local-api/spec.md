## MODIFIED Requirements

### Requirement: OpenAPI file
`contracts/openapi.yaml` SHALL be OpenAPI 3.1, generated from the zod schemas of the routes by `pnpm api:generate`. A test SHALL fail when the file differs from the generated text, and when a route is not in the file or a path of the file is not a route.

#### Scenario: Drift
- **WHEN** a route schema changes and `contracts/openapi.yaml` is not generated again
- **THEN** `pnpm test` fails and names `contracts/openapi.yaml`

#### Scenario: Generator output folder
- **WHEN** a contributor runs `pnpm api:generate` on a clean tree
- **THEN** the command writes `contracts/openapi.yaml`, and `git status --porcelain` is empty
