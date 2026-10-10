// Targeted regressions complement the default-result mutation for every proved function.
export const decisionMutations = [
  ["ignore remote identity", "    left.remote !== right.remote ||", "    false ||"],
  [
    "ignore content hash",
    "return left.path === right.path && left.hash === right.hash;",
    "return left.path === right.path;",
  ],
  [
    "mislabel incoming changes",
    'return incomingChanged ? "incoming" : "local";',
    'return "local";',
  ],
  [
    "omit unknown live files",
    "if (!known && result.path === null) return null;",
    "if (!known) return null;",
  ],
  [
    "accept out-of-order migrations",
    'if (applied[index] !== expected[index]) return "invalid";',
    'if (applied[index] !== expected[index]) return "supported";',
  ],
  [
    "miss ancestor collisions",
    'existing === key || existing.startsWith(key + "/") || key.startsWith(existing + "/"),',
    'existing === key || existing.startsWith(key + "/"),',
  ],
];
