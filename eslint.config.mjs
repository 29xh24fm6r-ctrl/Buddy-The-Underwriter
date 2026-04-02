import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import reactHooks from "eslint-plugin-react-hooks";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendor/third-party code:
    "public/pdfjs/**",
    "scripts/probes/**",
  ]),
  {
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      // Disable strict type checking rules for build
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-this-alias": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "prefer-const": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react/no-unescaped-entities": "off",
      "@next/next/no-html-link-for-pages": "warn",
    },
  },
  // No-explicit-any in core modules — prevent new unsafe typing
  {
    files: [
      "src/lib/contracts/**/*.ts",
      "src/lib/runtime/**/*.ts",
      "src/lib/trust/**/*.ts",
      "src/lib/decisioning/**/*.ts",
      "src/lib/scoring/**/*.ts",
      "src/lib/outcomes/**/*.ts",
      "src/lib/recommendations/**/*.ts",
      "src/lib/feedback/**/*.ts",
      "src/lib/tuning/**/*.ts",
      "src/lib/experiments/**/*.ts",
      "src/lib/monitoring/**/*.ts",
      "src/lib/borrowerInsights/**/*.ts",
      "src/lib/presentation/**/*.ts",
      "src/core/state/**/*.ts",
      "src/core/omega/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  // Ban LLM SDK imports in deterministic extractors
  {
    files: ["src/lib/financialSpreads/extractors/deterministic/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["@anthropic-ai/*"],
          message: "LLM imports are banned in deterministic extractors. Use regex/DocAI parsing instead.",
        }],
      }],
    },
  },
]);

export default eslintConfig;
