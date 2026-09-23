import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

// Determinism (docs/testing.md): only src/deps.ts may read the real clock or randomness.
const nonDeterministic = [
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: "Use deps.clock.",
  },
  { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: "Use deps.clock." },
  {
    selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
    message: "Use deps.random.",
  },
  { selector: "CallExpression[callee.property.name='randomUUID']", message: "Use deps.ids." },
  {
    selector: "CallExpression[callee.property.name='getRandomValues']",
    message: "Use deps.random.",
  },
];

export default defineConfig(
  {
    ignores: [
      "node_modules/",
      "**/.wrangler/",
      "coverage/",
      "playwright-report/",
      "test-results/",
      "public/",
      "test/stubs/dist/",
      "worker-configuration.d.ts",
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json", "./tsconfig.node.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    ignores: ["src/deps.ts"],
    rules: { "no-restricted-syntax": ["error", ...nonDeterministic] },
  },
  prettier,
);
