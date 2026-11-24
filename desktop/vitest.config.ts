// Unit tests: main, preload and the contract run in Node; renderer components run in jsdom.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: [
            "src/main/**/*.test.ts",
            "src/preload/**/*.test.ts",
            "src/shared/**/*.test.ts",
            "scripts/**/*.test.ts",
          ],
          environment: "node",
        },
      },
      {
        plugins: [react()],
        test: {
          name: "renderer",
          include: ["src/renderer/**/*.test.{ts,tsx}"],
          environment: "jsdom",
        },
      },
    ],
  },
});
