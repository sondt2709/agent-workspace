// Writes <count> title edits of a task through the local API of this container, one at a time:
// each edit is one line in the log of this device (test plan 1 of sync-syncthing).
// Usage: node bulk-edit.ts <socket> <task> <count>
import { AwClient } from "@aw/client";

const [socketPath, task, count] = process.argv.slice(2);
if (!socketPath || !task || !count) throw new Error("Usage: bulk-edit.ts <socket> <task> <count>");
const client = new AwClient({ socketPath });
const status = await client.status();
for (let i = 0; i < Number(count); i += 1) {
  await client.editTask("-", task, { title: `Edit ${i} from ${status.device.slug}` });
}
process.stdout.write(`${count}\n`);
