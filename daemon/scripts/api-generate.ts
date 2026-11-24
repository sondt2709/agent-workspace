// Writes contracts/openapi.yaml from the zod schemas of the local API. Run: pnpm api:generate.
import { writeFile } from "node:fs/promises";
import { API_YAML_PATH, renderOpenApi } from "../src/api/openapi.ts";

const { text } = await renderOpenApi();
await writeFile(API_YAML_PATH, text);
process.stdout.write(`Wrote ${API_YAML_PATH}\n`);
