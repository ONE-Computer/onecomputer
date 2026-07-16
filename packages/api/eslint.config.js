import { config } from "@onecli/eslint-config/base";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...config,
  {
    files: ["scripts/**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        __dirname: "readonly",
        console: "readonly",
        process: "readonly",
        require: "readonly",
        structuredClone: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];
