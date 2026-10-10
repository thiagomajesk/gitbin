import obsidianmd from "eslint-plugin-obsidianmd";
import effectRules from "./tooling/effect-rules.mjs";

export default [
  { plugins: { gitbin: effectRules } },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "gitbin/function-size": ["error", 60],
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
      "src/core/selective-*.ts",
      "src/core/activity.ts",
      "src/maintenance/engine.ts",
      "src/maintenance/*-references.ts",
      "src/maintenance/unified-metadata.ts",
      "src/maintenance/vault-storage.ts",
      "src/maintenance/content-inventory.ts",
      "src/git/remote.ts",
      "src/git/catalog.ts",
      "src/git/selective.ts",
      "src/git/consolidation.ts",
      "src/git/maintenance-snapshot.ts",
      "src/platform/consolidation.ts",
      "src/platform/retry.ts",
    ],
    rules: {
      "gitbin/effect-exports": [
        "error",
        {
          allow: [
            "checkRemote",
            "sanitizeActivity",
            "activityFailure",
            "retryDelay",
            "contentLimit",
            "inventorySnapshots",
            "createSelectiveEngine.history",
            "createSelectiveEngine.status",
            "createSelectiveEngine.details",
            "createSelectiveEngine.close",
            "createSelectiveContext.limits",
            "createSelectiveContext.local.active",
            "createSelectiveContext.local.changed",
          ],
        },
      ],
    },
  },
  {
    files: ["tests/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      ...Object.fromEntries(
        Object.keys(obsidianmd.rules).map((name) => ["obsidianmd/" + name, "off"]),
      ),
      // Node and jsdom fixtures intentionally exercise native APIs, not Obsidian extensions.
      "no-restricted-globals": "off",
      // Assertions inspect mock methods without invoking them unbound.
      "@typescript-eslint/unbound-method": "off",
      "gitbin/function-size": ["error", 60],
    },
  },
];
