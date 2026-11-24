// A child process for the crash test of atomic.test.ts. Node runs it with type stripping.
// It writes the temp file, then kills itself with SIGKILL before the rename.
import { writeFileAtomic } from "../atomic.ts";

const [target, content] = process.argv.slice(2);
if (target === undefined || content === undefined)
  throw new Error("Usage: crash-writer <target> <content>");
await writeFileAtomic(target, content, {
  beforeRename: () => {
    process.kill(process.pid, "SIGKILL");
  },
});
