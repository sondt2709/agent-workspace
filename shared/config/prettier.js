// The Prettier config of each TypeScript package and of the repo-wide files.
// Prettier finds a plugin by name from the folder that it formats, and only shared/config has the
// plugin. Thus the config gives the plugin as an absolute path.
import { fileURLToPath } from "node:url";

/** @type {import("prettier").Config} */
export default {
  printWidth: 100,
  singleQuote: false,
  trailingComma: "all",
  plugins: [fileURLToPath(import.meta.resolve("prettier-plugin-organize-imports"))],
};
