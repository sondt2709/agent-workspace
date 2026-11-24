// The folder of the generated JSON Schemas. awd copies them to `tasks/schemas/` of each workspace
// (docs/phase-1.md 3.1).
import { fileURLToPath } from "node:url";

/** The absolute path of `contracts/schemas/` (the package is `shared/schema`). */
export const generatedSchemasDir = fileURLToPath(
  new URL("../../../contracts/schemas/", import.meta.url),
);
