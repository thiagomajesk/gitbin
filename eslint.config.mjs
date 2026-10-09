import obsidianmd from "eslint-plugin-obsidianmd";
import effectRules from "./tooling/effect-rules.mjs";

/** @type {import("eslint").Linter.Config[]} */
const config = [
  { plugins: { gitbin: effectRules } },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "obsidianmd/ui/sentence-case": ["warn", { brands: ["Gitbin"], acronyms: ["QR"] }],
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: [
      "src/core/engine.ts",
      "src/maintenance/engine.ts",
      "src/maintenance/*-references.ts",
      "src/maintenance/unified-metadata.ts",
      "src/maintenance/vault-storage.ts",
      "src/git/remote.ts",
      "src/git/consolidation.ts",
      "src/platform/consolidation.ts",
      "src/platform/retry.ts",
    ],
    rules: {
      "gitbin/effect-exports": [
        "error",
        {
          allow: [
            "checkRemote",
            "retryDelay",
            "createSyncEngine.history",
            "createSyncEngine.close",
          ],
        },
      ],
    },
  },
];

export default config;
