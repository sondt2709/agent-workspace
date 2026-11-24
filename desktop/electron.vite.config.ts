// electron-vite builds main, preload and the renderer into out/ (docs/tech-stack.md 1.4 "Build").
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    // The workspace packages are TypeScript sources: bundle them. Node packages stay external.
    build: { externalizeDeps: { exclude: ["@aw/client", "@aw/core", "@aw/ui"] } },
  },
  preload: {
    // A sandboxed preload runs as CommonJS and can require only "electron": bundle everything.
    build: {
      externalizeDeps: false,
      rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, "src/renderer"),
    plugins: [react()],
    build: { rollupOptions: { input: resolve(import.meta.dirname, "src/renderer/index.html") } },
  },
});
