import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-useless-escape": "warn",
      "no-control-regex": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
  },
  {
    ignores: ["node_modules/", ".next/", "dist/", "*.config.*"],
  },
];
