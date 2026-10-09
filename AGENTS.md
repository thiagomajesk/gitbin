- Commit using the Conventional Commits specification.
- Run the full quality gate before committing any changes.
- Prefer the simplest solutions that could reasonably work.
- Prefer declarative over imperative code whenever possible.
- Define tests and success criteria before implementing non-trivial logic.
- All domain code that can reasonably use EffectTS should use its features.
- A test must protect observable behavior, a credible regression, an invariant, or an independent contract against a plausible failure.

Effect contracts:
- Exported service operations return Effect.Effect with explicit expected error types. Service factories may return objects whose operations obey that contract; pure transformations, schemas, and UI rendering remain ordinary TypeScript.
- Register new service modules in the gitbin/effect-exports ESLint scope. The rule checks inferred return types, including factory methods; do not silence it with casts, any, or blanket exclusions.
- Keep external Promise APIs inside adapters. Compose application operations with Effects rather than executing an Effect inside a Promise workflow.
- Execute Effects only at declared application boundaries (the plugin entry point and the setup modal's UI event adapter). Fallow enforces this boundary. New boundaries require a documented reason.
- The sync engine's synchronous history read and CRDT disposer are explicit existing contract exceptions; the latter is owned by its Effect service scope.
- Effect tests should use @effect/vitest, scoped fixtures and TestClock for Effect-managed time. React/browser tests and raw external adapter tests can use ordinary Vitest.

Quality limits:
- Source functions must stay within cyclomatic complexity 10, cognitive complexity 15, and 60 token-bearing lines per function (nested function bodies are counted separately). CRAP is capped at 30 using Fallow's estimate, not measured test coverage.
