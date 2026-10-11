---
status: accepted
---

# Enforce Effect contracts at domain service boundaries

## Context and Problem Statement

An architectural preference for Effect was insufficient when domain services could export Promise-based operations. Enforcement must distinguish those services from pure computations and integrations that require Promise APIs.

## Considered Options

- Rely on guidance to encourage Effect usage
- Require all exports to return Effect through Fallow
- Enforce domain service contracts through ESLint

## Decision Outcome

Chosen option: Enforce domain service contracts through ESLint, because enforcement needs to distinguish domain services from pure functions and platform adapters.

Registered domain services expose Effect contracts with explicit expected errors. Promise integration remains in adapters, and Effect execution stays at declared boundaries. Fallow handles code health; ESLint enforces these service contracts.

### Consequences

Domain service violations fail automated checks, while pure computations remain ordinary functions that can be verified independently. The tradeoff is maintaining the service registry and allowed execution boundaries as the project grows; unregistered modules cannot be assumed to have the same coverage.

## More Information

### References

- [Effect documentation](https://effect.website/docs/)
- [ESLint custom rules](https://eslint.org/docs/latest/extend/custom-rules)
