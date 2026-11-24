## MODIFIED Requirements

### Requirement: Generated JSON Schemas
`pnpm schema:generate` SHALL write one JSON Schema 2020-12 file per schema name to `contracts/schemas/<type>.v<major>.schema.json`, from `z.toJSONSchema()`, formatted with the Prettier config of the repository. It SHALL also write the Kotlin data classes of each schema name to `android/shared/generated/kotlin/`, from the same JSON Schemas, and the valid and invalid schema samples of the TypeScript tests to `contracts/samples/schema-samples.json`. A check that a JSON Schema pattern cannot express (a real HLC date, a relative path with no `..`) SHALL be in the JSON Schema as the annotation `x-aw-check`, and the Kotlin classes SHALL run it. The generator SHALL have one list of targets. A test SHALL fail when a generated file is missing, extra or different from the current zod schemas.

#### Scenario: Schemas are current
- **WHEN** a contributor runs `pnpm schema:generate` on a clean tree
- **THEN** `git status --porcelain` is empty

#### Scenario: Schema change without a new generation
- **WHEN** a contributor changes a zod schema and does not run `pnpm schema:generate`
- **THEN** the drift test fails and names the stale JSON Schema and the stale Kotlin file

#### Scenario: Independent validator
- **WHEN** the fixture test validates each fixture document and each fixture log line with `@cfworker/json-schema` against the generated JSON Schema
- **THEN** each file is valid, and each invalid sample of the schema tests is invalid

#### Scenario: Refine annotation
- **WHEN** a reader opens `event.v1.schema.json`
- **THEN** each `hlc` field has `"x-aw-check": "hlc"` and each relative path field has `"x-aw-check": "relative-path"`
