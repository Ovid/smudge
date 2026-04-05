---
name: writing-tests
description: Use when writing, modifying, or reviewing any test code — unit, integration, or e2e. ALWAYS invoke this skill before writing tests.
---

# Writing Tests

## Overview

Write tests using red-green-refactor (when appropriate) and avoid the specific flaky-test patterns that have burned this project. When writing tests to boost coverage, keep going until coverage is as complete as is reasonable — don't stop at the threshold floor.

## Red-Green-Refactor

When implementing features or fixing bugs, follow this cycle:

1. **RED:** Write a failing test that captures the desired behavior
2. **GREEN:** Write the minimum code to make it pass
3. **REFACTOR:** Clean up while keeping tests green

Skip RGR when it doesn't fit (e.g., adding coverage-only tests for existing code, exploratory debugging). Use your judgment.

## Flaky Test Patterns to Avoid

These patterns have all caused real CI failures in this project. Every rule below comes from a fix commit.

### 1. Never use `mockResolvedValueOnce` chains

`vi.clearAllMocks()` calls `mockClear()` which does **NOT** clear `onceImplementations`. Unconsumed once-values leak between tests and desync the mock chain.

```typescript
// BAD — fragile, order-dependent, leaks between tests
vi.mocked(api.chapters.get)
  .mockResolvedValueOnce(chapters[0]!)
  .mockResolvedValueOnce(chapters[1]!);

// GOOD — deterministic, ID-routed
const byId = Object.fromEntries(chapters.map(c => [c.id, c]));
vi.mocked(api.chapters.get).mockImplementation(
  async (id: string) => byId[id]!
);
```

### 2. Always use `{ timeout: 3000 }` on `waitFor`

The default 1000ms is insufficient under CI coverage load. Every `waitFor` call must specify a timeout.

```typescript
// BAD
await waitFor(() => {
  expect(screen.getByText("Saved")).toBeInTheDocument();
});

// GOOD
await waitFor(
  () => { expect(screen.getByText("Saved")).toBeInTheDocument(); },
  { timeout: 3000 },
);
```

### 3. Wrap async state updates in `act()`

When a handler triggers async work (e.g., `flushSave().then(setState)`), the microtask-chained state update can miss the `waitFor` polling window. Wrap in `act(async ...)`.

```typescript
// BAD — state update races with waitFor
fireEvent.keyDown(document, { key: "P", ctrlKey: true, shiftKey: true });

// GOOD — flushes microtask + state update
await act(async () => {
  fireEvent.keyDown(document, { key: "P", ctrlKey: true, shiftKey: true });
  await Promise.resolve();
});
```

This also applies to calling captured callbacks (like `capturedOnSave`) that trigger async state setters.

### 4. Reuse a single HTTP server in server tests

Creating a new Express app per request causes Supertest to spin up/tear down ephemeral servers, leading to ECONNRESET from socket cleanup races. Use the `setupTestDb()` helper which creates one persistent `http.Server` per test file.

### 5. Add deterministic tiebreakers to sorted queries

When sorting by timestamp (e.g., `updated_at DESC`), records created in the same millisecond have non-deterministic order. Add `rowid DESC` (or another monotonic column) as tiebreaker.

### 6. Use valid enum values in test mocks

Mock data must match production schemas. If a field is an enum (`outline|rough_draft|revised|edited|final`), don't use arbitrary values like `"100"`. Invalid mock data causes tests to pass in isolation but fail when validation is tightened.

### 7. Assert (not just silence) expected console errors

When testing error paths, spy on `console.error`, **assert it was called**, then restore. Don't just suppress — if you only suppress, the spy becomes dead code when the error path changes and nobody notices.

```typescript
const spy = vi.spyOn(console, "error").mockImplementation(() => {});
// ... test error path ...
expect(spy).toHaveBeenCalledOnce();
spy.mockRestore();
```

This keeps output clean AND ensures the error path is actually exercised.

### 8. Mock environment-dependent modules

If a module touches `localStorage`, `Intl.DateTimeFormat`, or other browser APIs that behave differently in jsdom/happy-dom, mock it in tests that render components using it. Don't rely on the test environment providing the same behavior as production.

### 9. Read state from refs in event handlers, not closures

When testing keyboard handlers or effects that re-register listeners, be aware that stale closures capture old state. Production code should use refs for handler state; tests should verify the handler sees current values, not values from initial render.

## Coverage

Coverage thresholds are enforced (95% statements, 85% branches, 90% functions, 95% lines). When writing tests to improve coverage:

- **Push coverage as high as is reasonable** — don't stop at the threshold floor
- Write meaningful tests that exercise real behavior, not trivial tests to bump numbers
- Cover edge cases: non-Error thrown values, invalid inputs, fallback paths
- Never lower thresholds to make CI pass

## Quick Reference

| Problem | Fix |
|---------|-----|
| Mock chain leaks between tests | Use `mockImplementation` with ID routing |
| `waitFor` times out in CI | Add `{ timeout: 3000 }` |
| State update missed by assertion | Wrap trigger in `act(async ...)` |
| ECONNRESET in server tests | Reuse single `http.Server` via `setupTestDb()` |
| Non-deterministic sort order | Add monotonic tiebreaker column |
| Console noise from error paths | Spy, assert called, then `mockRestore()` |
| Mock data doesn't match schema | Use valid enum values from production types |
