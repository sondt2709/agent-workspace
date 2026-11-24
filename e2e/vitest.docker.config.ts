// task e2e: the Docker suite (e2e/compose.yaml). It builds the image and starts 2 devices.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.docker.test.ts"],
    testTimeout: 300_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
});
