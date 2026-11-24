// pnpm test: the offline tests. The Docker suite runs only with "task e2e" (vitest.docker.config.ts).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { exclude: ["**/node_modules/**", "**/*.docker.test.ts"] },
});
