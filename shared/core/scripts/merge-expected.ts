// Writes `expected.json` of each merge case in contracts/fixtures/merge/ from the current
// merge. Run it with `node shared/core/scripts/merge-expected.ts` after a change of a case or of
// a merge rule, then read each diff before a commit: the file is a contract for the Kotlin port.
import { expectedPath, mergeCases } from "@aw/schema/testing";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import { expectedOf, runMergeCase } from "../src/merge/testing.ts";

for (const item of mergeCases()) {
  const run = await runMergeCase(item);
  try {
    const path = expectedPath(item.name);
    const text = JSON.stringify(expectedOf(run.update), null, 2);
    const config = fileURLToPath(import.meta.resolve("@aw/config/prettier"));
    const options = (await resolveConfig(path, { config })) ?? {};
    await writeFile(path, await format(text, { ...options, filepath: path }));
    console.log(
      `${item.name}: ${run.update.view.tasks.length} tasks, ${run.update.view.issues.length} issues`,
    );
  } finally {
    await run.cleanup();
  }
}
