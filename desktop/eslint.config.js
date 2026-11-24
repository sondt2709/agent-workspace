import { config } from "@aw/config/eslint";
import pluginQuery from "@tanstack/eslint-plugin-query";
import globals from "globals";

export default [
  ...config(import.meta.dirname),
  { ignores: ["out/", "dist/"] },
  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
  },
  ...pluginQuery.configs["flat/recommended"],
];
