// Calls one method of the awd client in this container and prints the reply as JSON, or the awd
// error as {"error": {code, message, details}} with exit code 2 (openspec gate-full-context).
// Usage: node client-call.ts <socket> <method> <JSON array of arguments>
import { AwApiError, AwClient } from "@aw/client";

const [socketPath, method, args] = process.argv.slice(2);
if (!socketPath || !method || !args) {
  throw new Error("Usage: client-call.ts <socket> <method> <JSON arguments>");
}
const client = new AwClient({ socketPath }) as unknown as Record<
  string,
  (...a: unknown[]) => Promise<unknown>
>;
const fn = client[method];
if (typeof fn !== "function") throw new Error(`No client method ${method}`);
try {
  const reply = await fn.apply(client, JSON.parse(args) as unknown[]);
  process.stdout.write(`${JSON.stringify(reply)}\n`);
} catch (error) {
  if (!(error instanceof AwApiError)) throw error;
  process.stdout.write(
    `${JSON.stringify({ error: { code: error.code, message: error.message, details: error.details } })}\n`,
  );
  process.exitCode = 2;
}
