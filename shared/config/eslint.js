// The ESLint preset of each TypeScript package. Each package has an eslint.config.js:
//   import { config } from "@aw/config/eslint";
//   export default config(import.meta.dirname);
// ESLint finds the config from the folder of each linted file, so one run from the repository
// root (the pre-commit hook) uses the config of each package.
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * The flat config of one package.
 * @param {string} rootDir The folder of the package, where its tsconfig.json is.
 */
export function config(rootDir) {
  return defineConfig(
    globalIgnores(["**/node_modules/", "**/dist/", "**/coverage/", "tmp/"]),
    js.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        globals: globals.node,
        parserOptions: {
          projectService: true,
          tsconfigRootDir: rootDir,
        },
      },
    },
  );
}
