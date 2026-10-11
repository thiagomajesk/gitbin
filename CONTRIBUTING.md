# Contributing

## Run locally

Requirements:

- Node.js 24+
- pnpm 11.19.0
- Obsidian 1.13.0+

```sh
pnpm install --frozen-lockfile
pnpm proof:setup
```

Open a test vault in Obsidian, then run `pnpm dev`. It watches source files and deploys to the most recently active open vault, which must use the standard `.obsidian` folder. Check the printed destination, enable Gitbin, and reload the plugin after changes. Use a disposable repository for sync and maintenance tests.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Watch and deploy to the open vault |
| `pnpm build` | Build into `dist/gitbin/` |
| `pnpm test` | Run tests |
| `pnpm format:fix` | Apply formatting |
| `pnpm proof:regen` | Regenerate proofs after verified logic changes |
| `pnpm quality` | Run all checks, proofs, tests, and the build |

## Conventions

- Keep changes focused and use Conventional Commits. Run `pnpm quality` before committing.
- Use Effect for domain services with explicit error types; keep Promise APIs in adapters. Register new services with the Effect ESLint rules.
- Test behavior and regressions. Use `@effect/vitest`, scoped fixtures, and `TestClock` for Effect-managed tests.
- Keep contracts beside supported production logic. Review regenerated proofs and coverage changes; never weaken checks to make them pass.
- Follow the existing formatting and quality rules for source and tests.
