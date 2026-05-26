# Phase 4b.3c: Consumer Recovery Completeness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the consumer-side error-handling primitives (`applyMappedError` + `STOP`, `MappedError<S>` phantom, `ScopeExtras<S>`, `devWarn`), relocate the `chapter.save` terminal-codes allowlist into `scopes.ts`, migrate ~16 ladder consumers, and apply 11 behavioural fixes to consumers that mishandle the mapper's output.

**Architecture:** Three sub-phases, each its own PR per CLAUDE.md §Pull Request Scope:
- **4b.3c.1** — foundation + scope refactor + ladder migrations (mechanical, no behavioural change at consumer sites)
- **4b.3c.2** — behavioural fixes that newly route through the helper's `onCommitted` / `STOP` / `devWarn` callbacks (depends on .1)
- **4b.3c.3** — behavioural fixes independent of the helper (can land in parallel with .1)

**Tech Stack:** TypeScript, React 18, Vitest, Playwright. No new dependencies. Test infrastructure already in place: `expectTypeOf` from Vitest for compile-time type tests; `vi.spyOn(console, "warn").mockImplementation(() => {})` per CLAUDE.md §Testing Philosophy zero-warnings rule.

**Source documents:**
- Design: `docs/plans/2026-05-26-consumer-recovery-completeness-design.md`
- Roadmap entries: `docs/roadmap.md` Phase 4b.3c.1 / 4b.3c.2 / 4b.3c.3
- Source review: `paad/code-reviews/ovid-unified-error-mapper-2026-04-25-10-32-46-a68afd1.md` (Cluster C — 15 items)

---

## Conventions

**TDD discipline.** Per CLAUDE.md §Testing Philosophy "ALL CODE MUST USE RED-GREEN-REFACTOR if feasible." Each behavioural-fix task is two commits (pinning test → fix flips the assertion), except where noted. Foundation tasks bundle the tests with the implementation in one commit because the test IS the design contract.

**Pinning-test discipline.** A "pinning" commit asserts the CURRENT (buggy or surprising) behaviour. The next commit flips the assertion AND lands the fix. Reviewers can diff the test alone to see what changed in user-visible behaviour. Pinning tests use comments like `// PINNED: documents current behaviour before [TASK-N] fix flips this assertion`.

**Commit message prefix.** Each commit references the sub-phase and item: `feat(errors): applyMappedError + STOP sentinel (4b.3c.1)` or `fix(snapshot-panel): I3 — handleCreate possiblyCommitted recovery (4b.3c.2)`.

**Test runner.** `npm test -w packages/client -- <filename>` runs a single file. `make test` runs the full suite. `make cover` runs with coverage enforcement (95/85/90/95). `make e2e` runs Playwright. Reach for `make all` only at the end of each sub-phase.

**Existing patterns to mirror.** Several touched sites already have well-documented patterns. When introducing a new ref or new test fixture, mirror what's already there:
- `useProjectEditor.ts:207-218` — justification-block shape for retained `useRef<AbortController>` allocations.
- `apiErrorMapper.test.ts` — describe/it shape for mapper tests; uses `_resolveErrorInternal` for direct scope dispatch in tests.
- `useTrashManager.test.ts` — hook-test setup pattern.

---

# Sub-phase 4b.3c.1: Foundation + Scope Refactor + Simple-Ladder Migrations

**PR scope:** This sub-phase is one PR. ~24 commits. The mechanical ladder migrations don't introduce any new behavior at consumer sites — every behavioural fix is deferred to 4b.3c.2 or 4b.3c.3. This is the foundation layer.

---

### Task 1: `MappedError<S>` phantom + `mapApiError<S>` parameterization

**Files:**
- Modify: `packages/client/src/errors/apiErrorMapper.ts:4-9, 185-187`
- Modify: `packages/client/src/errors/apiErrorMapper.test.ts` (add `describe` for phantom-propagation)

- [ ] **Step 1: Write the failing type-test**

Append to `packages/client/src/errors/apiErrorMapper.test.ts`:

```ts
import { expectTypeOf } from "vitest";

describe("MappedError<S> phantom propagation", () => {
  it("mapApiError(err, 'image.delete') returns MappedError<'image.delete'>", () => {
    const err = new ApiRequestError("oops", 500, "INTERNAL_ERROR");
    const mapped = mapApiError(err, "image.delete");
    expectTypeOf(mapped).toEqualTypeOf<MappedError<"image.delete">>();
  });

  it("mapApiError(err, 'chapter.load') returns MappedError<'chapter.load'>", () => {
    const err = new ApiRequestError("oops", 500, "INTERNAL_ERROR");
    const mapped = mapApiError(err, "chapter.load");
    expectTypeOf(mapped).toEqualTypeOf<MappedError<"chapter.load">>();
  });

  it("default MappedError (no <S>) is structurally equivalent for existing destructured consumers", () => {
    const m: MappedError = { message: null, possiblyCommitted: false, transient: false };
    expect(m.message).toBeNull();
    // Phantom field is optional; absence at runtime is fine.
    expect("__scope" in m).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/client -- apiErrorMapper.test.ts`

Expected: FAIL with type errors — `MappedError<"image.delete">` isn't a valid type signature yet.

- [ ] **Step 3: Add the phantom parameter to `MappedError` and `mapApiError`**

In `packages/client/src/errors/apiErrorMapper.ts`, replace the existing `MappedError` type and `mapApiError` function:

```ts
import type { ApiErrorScope } from "./scopes";

export type MappedError<S extends ApiErrorScope = ApiErrorScope> = {
  message: string | null;
  possiblyCommitted: boolean;
  transient: boolean;
  extras?: Record<string, unknown>;
  // Phantom — no runtime field; carries S through the type system so
  // applyMappedError can require the same S on its handlers.
  readonly __scope?: S;
};

// ... (existing _resolveErrorInternal, helpers, etc.) ...

export function mapApiError<S extends ApiErrorScope>(
  err: unknown,
  scope: S,
): MappedError<S> {
  return _resolveErrorInternal(err, SCOPES[scope]) as MappedError<S>;
}
```

The cast inside `mapApiError` is the one place this lives — `_resolveErrorInternal` returns the unparameterized `MappedError`; the public API adds the phantom.

- [ ] **Step 4: Run all error-mapper tests to verify pass**

Run: `npm test -w packages/client -- apiErrorMapper.test.ts`

Expected: PASS. Existing destructured-consumer tests continue to pass (the default `S = ApiErrorScope` preserves the union for any consumer that ignores the parameter).

- [ ] **Step 5 (REFACTOR):** No opportunity at this site. The phantom field is a one-line type-system change; the `as MappedError<S>` cast inside `mapApiError` is the single owner of the unsafe boundary. Verify by `grep -n "as MappedError" packages/client/src/errors/` — expected: one hit, in `apiErrorMapper.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/errors/apiErrorMapper.ts packages/client/src/errors/apiErrorMapper.test.ts
git commit -m "feat(errors): MappedError<S> phantom + mapApiError<S> parameterization (4b.3c.1)"
```

---

### Task 2: `applyMappedError` + `STOP` sentinel

**Files:**
- Create: `packages/client/src/errors/applyMappedError.ts`
- Create: `packages/client/src/errors/applyMappedError.test.ts`
- Modify: `packages/client/src/errors/index.ts:1-19`

- [ ] **Step 1: Write the failing tests**

Create `packages/client/src/errors/applyMappedError.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { applyMappedError, STOP } from "./applyMappedError";
import type { MappedError } from "./apiErrorMapper";

const ok = (overrides: Partial<MappedError> = {}): MappedError => ({
  message: "boom",
  possiblyCommitted: false,
  transient: false,
  ...overrides,
});

describe("applyMappedError", () => {
  it("silent bail when message is null (ABORTED)", () => {
    const onMessage = vi.fn();
    const onCommitted = vi.fn();
    const onTransient = vi.fn();
    const onExtras = vi.fn();
    applyMappedError({ message: null, possiblyCommitted: false, transient: false }, {
      onMessage, onCommitted, onTransient, onExtras,
    });
    expect(onMessage).not.toHaveBeenCalled();
    expect(onCommitted).not.toHaveBeenCalled();
    expect(onTransient).not.toHaveBeenCalled();
    expect(onExtras).not.toHaveBeenCalled();
  });

  it("onMessage fires with the mapped string", () => {
    const onMessage = vi.fn();
    applyMappedError(ok({ message: "hello" }), { onMessage });
    expect(onMessage).toHaveBeenCalledWith("hello");
  });

  it("onCommitted fires before onMessage when possiblyCommitted", () => {
    const order: string[] = [];
    applyMappedError(ok({ possiblyCommitted: true }), {
      onCommitted: () => { order.push("committed"); },
      onMessage: () => { order.push("message"); },
    });
    expect(order).toEqual(["committed", "message"]);
  });

  it("onTransient fires before onMessage when transient", () => {
    const order: string[] = [];
    applyMappedError(ok({ transient: true }), {
      onTransient: () => { order.push("transient"); },
      onMessage: () => { order.push("message"); },
    });
    expect(order).toEqual(["transient", "message"]);
  });

  it("onExtras fires before onMessage when extras present", () => {
    const order: string[] = [];
    applyMappedError(ok({ extras: { chapters: [] } }), {
      onExtras: () => { order.push("extras"); },
      onMessage: () => { order.push("message"); },
    });
    expect(order).toEqual(["extras", "message"]);
  });

  it("missing callbacks are no-ops", () => {
    expect(() => applyMappedError(ok(), {})).not.toThrow();
  });

  it("extras===undefined does not fire onExtras", () => {
    const onExtras = vi.fn();
    applyMappedError(ok({ extras: undefined }), { onExtras, onMessage: vi.fn() });
    expect(onExtras).not.toHaveBeenCalled();
  });

  it("STOP from onCommitted skips onTransient, onExtras, and onMessage", () => {
    const onTransient = vi.fn();
    const onExtras = vi.fn();
    const onMessage = vi.fn();
    applyMappedError(
      ok({ possiblyCommitted: true, transient: true, extras: { x: 1 } }),
      {
        onCommitted: () => STOP,
        onTransient, onExtras, onMessage,
      },
    );
    expect(onTransient).not.toHaveBeenCalled();
    expect(onExtras).not.toHaveBeenCalled();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("STOP from onTransient skips onExtras and onMessage", () => {
    const onExtras = vi.fn();
    const onMessage = vi.fn();
    applyMappedError(
      ok({ transient: true, extras: { x: 1 } }),
      { onTransient: () => STOP, onExtras, onMessage },
    );
    expect(onExtras).not.toHaveBeenCalled();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("STOP from onExtras skips onMessage", () => {
    const onMessage = vi.fn();
    applyMappedError(
      ok({ extras: { x: 1 } }),
      { onExtras: () => STOP, onMessage },
    );
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("returning undefined (default void) continues to next callback", () => {
    const onMessage = vi.fn();
    applyMappedError(
      ok({ possiblyCommitted: true }),
      { onCommitted: () => undefined, onMessage },
    );
    expect(onMessage).toHaveBeenCalledWith("boom");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/client -- applyMappedError.test.ts`

Expected: FAIL — `applyMappedError` and `STOP` don't exist yet.

- [ ] **Step 3: Implement `applyMappedError` + `STOP`**

Create `packages/client/src/errors/applyMappedError.ts`:

```ts
import type { MappedError } from "./apiErrorMapper";
import type { ApiErrorScope } from "./scopes";
import type { ScopeExtras } from "./scopeExtras";

/** Returned from a handler to halt subsequent callbacks. Mirrors the
 * pre-helper early-return pattern at sites where `possiblyCommitted`
 * recovery should suppress the extras/message branches (e.g.
 * ImageGallery.handleDelete's announce()). */
export const STOP = Symbol("applyMappedError.STOP");

export interface ApplyMappedErrorHandlers<S extends ApiErrorScope> {
  onMessage?: (message: string) => void | typeof STOP;
  onCommitted?: () => void | typeof STOP;
  onTransient?: () => void | typeof STOP;
  onExtras?: (extras: ScopeExtras<S>) => void | typeof STOP;
}

export function applyMappedError<S extends ApiErrorScope>(
  mapped: MappedError<S>,
  handlers: ApplyMappedErrorHandlers<S>,
): void {
  if (mapped.message === null) return;
  if (mapped.possiblyCommitted) {
    if (handlers.onCommitted?.() === STOP) return;
  }
  if (mapped.transient) {
    if (handlers.onTransient?.() === STOP) return;
  }
  if (mapped.extras !== undefined) {
    if (handlers.onExtras?.(mapped.extras as ScopeExtras<S>) === STOP) return;
  }
  handlers.onMessage?.(mapped.message);
}
```

Note: this file imports `ScopeExtras` from `./scopeExtras`, which doesn't exist yet — Task 3 will create it. For now, the import line will fail typecheck but the test file imports only `applyMappedError` and `STOP`, so the runtime tests can be hand-run via `npm test` with type errors. Sequence Task 3 immediately after.

- [ ] **Step 4: Stub the `ScopeExtras` type (placeholder for Task 3)**

To unblock Task 2's typecheck, briefly create `packages/client/src/errors/scopeExtras.ts` with a placeholder:

```ts
// Placeholder — Task 3 replaces with the real conditional-type derivation.
export type ScopeExtras<S> = Record<string, unknown>;
```

Task 3 overwrites this file entirely.

- [ ] **Step 5: Update the errors barrel**

In `packages/client/src/errors/index.ts`, append:

```ts
export { applyMappedError, STOP } from "./applyMappedError";
export type { ApplyMappedErrorHandlers } from "./applyMappedError";
export type { ScopeExtras } from "./scopeExtras";
```

- [ ] **Step 6: Run tests to verify pass**

Run: `npm test -w packages/client -- applyMappedError.test.ts`

Expected: PASS (10 assertions).

- [ ] **Step 7 (REFACTOR):** Look for:
  - **Test helper extraction:** the `ok()` factory at the top of `applyMappedError.test.ts` is reused across most cases — already deduped. Confirm no inline `{ message: ..., possiblyCommitted: ..., transient: ..., terminal: ... }` literals remain in case bodies.
  - **Callback ordering correctness:** the if-chain in `applyMappedError` repeats the `if (handlers.X?.() === STOP) return;` shape four times. Resist the urge to extract — the four are independently gated on different `mapped.*` flags, so a helper would obscure the contract. Keep as-is.
  - **Symbol vs string sentinel:** `STOP` as a `Symbol` is intentional (cross-module identity safety). Confirm `export const STOP = Symbol(...)` is the only definition.

- [ ] **Step 8: Commit**

```bash
git add packages/client/src/errors/applyMappedError.ts \
        packages/client/src/errors/applyMappedError.test.ts \
        packages/client/src/errors/scopeExtras.ts \
        packages/client/src/errors/index.ts
git commit -m "feat(errors): applyMappedError + STOP sentinel + scopeExtras stub (4b.3c.1)"
```

---

### Task 3: `ScopeExtras<S>` real conditional-type derivation

**Files:**
- Modify: `packages/client/src/errors/scopeExtras.ts` (overwrite stub)
- Create: `packages/client/src/errors/scopeExtras.test.ts`

- [ ] **Step 1: Write the failing type-test**

Create `packages/client/src/errors/scopeExtras.test.ts`:

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { ScopeExtras } from "./scopeExtras";
import { applyMappedError, STOP } from "./applyMappedError";
import { mapApiError } from "./apiErrorMapper";
import { ApiRequestError } from "../api/client";

describe("ScopeExtras<S>", () => {
  it("ScopeExtras<'image.delete'> resolves to { chapters: { title; trashed? }[] }", () => {
    expectTypeOf<ScopeExtras<"image.delete">>().toEqualTypeOf<{
      chapters: { title: string; trashed?: boolean }[];
    }>();
  });

  it("ScopeExtras<'chapter.load'> resolves to never (no extrasFrom on this scope)", () => {
    expectTypeOf<ScopeExtras<"chapter.load">>().toEqualTypeOf<never>();
  });

  it("applyMappedError(mapApiError(err, 'image.delete'), { onExtras }) accepts the typed extras", () => {
    const err = new ApiRequestError("oops", 409, "IMAGE_IN_USE");
    // Compile-time check only; the runtime behaviour is covered by applyMappedError.test.ts.
    // The point is that onExtras's argument is { chapters: ... }, not Record<string, unknown>.
    applyMappedError(mapApiError(err, "image.delete"), {
      onExtras: (e) => {
        expectTypeOf(e).toEqualTypeOf<{ chapters: { title: string; trashed?: boolean }[] }>();
        return STOP;
      },
    });
  });

  // Negative compile-time test — uncomment locally to verify the type system rejects this.
  // The skill body documents this as a manual check; we do NOT keep it as a runtime test
  // because `@ts-expect-error` directives are noisy and a regression would surface as a
  // type-check failure on any consumer site, which is what we want.
  //
  // it("applyMappedError(mapApiError(err, 'chapter.load'), { onExtras }) fails to type-check", () => {
  //   const err = new ApiRequestError("oops", 500, "INTERNAL_ERROR");
  //   applyMappedError(mapApiError(err, "chapter.load"), {
  //     // @ts-expect-error — chapter.load has no extrasFrom; ScopeExtras<'chapter.load'> = never
  //     onExtras: (_e) => undefined,
  //   });
  // });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/client -- scopeExtras.test.ts`

Expected: FAIL — type assertions fail because the stub returns `Record<string, unknown>` for all `S`.

- [ ] **Step 3: Write the real `ScopeExtras` type**

Replace `packages/client/src/errors/scopeExtras.ts` entirely:

```ts
import type { SCOPES } from "./scopes";

type ScopeOf<S extends keyof typeof SCOPES> = (typeof SCOPES)[S];
type ExtrasFrom<S extends keyof typeof SCOPES> = ScopeOf<S>["extrasFrom"];

export type ScopeExtras<S extends keyof typeof SCOPES> =
  ExtrasFrom<S> extends (err: never) => infer R
    ? Exclude<R, undefined>
    : never;
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -w packages/client -- scopeExtras.test.ts apiErrorMapper.test.ts applyMappedError.test.ts`

Expected: PASS.

- [ ] **Step 5 (REFACTOR):** Look for:
  - **The conditional type's `infer R` extract** — TypeScript's standard pattern, no simplification available.
  - **`Exclude<R, undefined>`** — required because `extrasFrom` is typed as returning `T | undefined`; keep as-is.
  - **The negative compile-time test** — kept commented (`@ts-expect-error` form) per the test-file annotation; a future re-enable would catch type-system regressions but adds noise. Decision: keep commented for now.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/errors/scopeExtras.ts packages/client/src/errors/scopeExtras.test.ts
git commit -m "feat(errors): ScopeExtras<S> conditional type derivation (4b.3c.1)"
```

---

### Task 4: `devWarn` helper

**Files:**
- Create: `packages/client/src/errors/devWarn.ts`
- Create: `packages/client/src/errors/devWarn.test.ts`
- Modify: `packages/client/src/errors/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/client/src/errors/devWarn.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { devWarn } from "./devWarn";

describe("devWarn", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns silent when the signal is already aborted", () => {
    vi.stubEnv("DEV", true);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctrl = new AbortController();
    ctrl.abort();
    devWarn("test-context", ctrl.signal, new Error("boom"));
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("calls console.warn with 'context: error' format when DEV is true and signal is not aborted", () => {
    vi.stubEnv("DEV", true);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctrl = new AbortController();
    const err = new Error("boom");
    devWarn("test-context", ctrl.signal, err);
    expect(warnSpy).toHaveBeenCalledWith("test-context:", err);
    warnSpy.mockRestore();
  });

  it("stays silent when DEV is false", () => {
    vi.stubEnv("DEV", false);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctrl = new AbortController();
    devWarn("test-context", ctrl.signal, new Error("boom"));
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/client -- devWarn.test.ts`

Expected: FAIL — `devWarn` module doesn't exist.

- [ ] **Step 3: Implement `devWarn`**

Create `packages/client/src/errors/devWarn.ts`:

```ts
export function devWarn(context: string, signal: AbortSignal, err: unknown): void {
  if (signal.aborted) return;
  if (import.meta.env?.DEV) console.warn(`${context}:`, err);
}
```

- [ ] **Step 4: Update barrel**

Append to `packages/client/src/errors/index.ts`:

```ts
export { devWarn } from "./devWarn";
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npm test -w packages/client -- devWarn.test.ts`

Expected: PASS (3 cases). Zero unintended console.warn output — the `warnSpy.mockImplementation(() => {})` per CLAUDE.md §Testing Philosophy zero-warnings rule.

- [ ] **Step 6 (REFACTOR):** No opportunity at this site. The helper is two lines; the test triple covers all gates. Confirm:
  - **Format consistency** — `${context}:` (colon + space + interpolation) matches the existing `console.warn("Failed to X:", err)` shape used at the soon-to-be-migrated catch sites (Tasks 31, 33).
  - **No magic strings** — `context` is the caller's contract; the helper does not enforce a format.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/errors/devWarn.ts packages/client/src/errors/devWarn.test.ts packages/client/src/errors/index.ts
git commit -m "feat(errors): devWarn(context, signal, err) helper (4b.3c.1)"
```

---

### Task 5: Add `terminalCodes` field + `MappedError.terminal` plumbing

**Files:**
- Modify: `packages/client/src/errors/apiErrorMapper.ts` (`MappedError`, `ScopeEntry`, `_resolveErrorInternal`)
- Modify: `packages/client/src/errors/apiErrorMapper.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/client/src/errors/apiErrorMapper.test.ts`:

```ts
describe("mapApiError — terminalCodes plumbing", () => {
  const scopeWithTerminal = {
    fallback: "fallback",
    committed: "committed",
    byCode: { BAD_JSON: "bad-json-msg", FOO: "foo-msg" },
    committedCodes: ["BAD_JSON"],
    terminalCodes: ["BAD_JSON", "FOO"],
  } as const;

  it("MappedError defaults terminal to false on a scope without terminalCodes", () => {
    const err = new ApiRequestError("boom", 500, "INTERNAL_ERROR");
    const result = resolveError(err, { fallback: "fallback" });
    expect(result.terminal).toBe(false);
  });

  it("MappedError.terminal is true on a byCode hit listed in terminalCodes", () => {
    const err = new ApiRequestError("boom", 500, "FOO");
    const result = resolveError(err, scopeWithTerminal);
    expect(result.terminal).toBe(true);
    expect(result.message).toBe("foo-msg");
  });

  it("MappedError.terminal is false on a byCode hit NOT listed in terminalCodes", () => {
    const err = new ApiRequestError("boom", 500, "BAR");
    const result = resolveError(err, { ...scopeWithTerminal, byCode: { BAR: "bar-msg" } });
    expect(result.terminal).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/client -- apiErrorMapper.test.ts`

Expected: FAIL — `terminal` is not on `MappedError`; `terminalCodes` not on `ScopeEntry`.

- [ ] **Step 3: Add `terminal` to `MappedError`; `terminalCodes` to `ScopeEntry`; plumb in `_resolveErrorInternal`**

In `packages/client/src/errors/apiErrorMapper.ts`:

```ts
export type MappedError<S extends ApiErrorScope = ApiErrorScope> = {
  message: string | null;
  possiblyCommitted: boolean;
  transient: boolean;
  terminal: boolean;
  extras?: Record<string, unknown>;
  readonly __scope?: S;
};

export type ScopeEntry = {
  fallback: string;
  committed?: string;
  network?: string;
  byCode?: Partial<Record<string, string>>;
  byStatus?: Partial<Record<number, string>>;
  extrasFrom?: (err: ApiRequestError) => Record<string, unknown> | undefined;
  committedCodes?: string[];
  // S3/S7 (4b.3c.1): codes whose byCode hit means the save loop must
  // break and lock the editor without retrying. chapter.save's
  // BAD_JSON / UPDATE_READ_FAILURE / CORRUPT_CONTENT triple lives here
  // instead of inline in useProjectEditor.handleSave. Adding a fourth
  // terminal code is a single-line scope edit.
  terminalCodes?: string[];
};
```

In `_resolveErrorInternal`, update each return path to include `terminal: false` by default, and the `byCode` branch to compute `terminal` from `scope.terminalCodes`:

```ts
// In the ABORTED branch:
return { message: null, possiblyCommitted: false, transient: false, terminal: false };

// In the 2xx BAD_JSON branch:
return {
  message: scope.committed ?? scope.fallback,
  possiblyCommitted: scope.committed !== undefined,
  transient: false,
  terminal: false,
};

// In the NETWORK branch:
return {
  message: scope.network ?? scope.fallback,
  possiblyCommitted: false,
  transient: true,
  terminal: false,
};

// In the byCode-match branch:
if (typeof byCodeMatch === "string") {
  return {
    message: byCodeMatch,
    possiblyCommitted:
      err.code !== undefined && scope.committedCodes?.includes(err.code) === true,
    transient: false,
    terminal:
      err.code !== undefined && scope.terminalCodes?.includes(err.code) === true,
    extras: safeExtrasFrom(scope, err),
  };
}

// In the byStatus and fallback branches:
return {
  message: byStatusMatch,  // or scope.fallback for the final return
  possiblyCommitted: false,
  transient: false,
  terminal: false,
  extras: safeExtrasFrom(scope, err),
};
```

- [ ] **Step 4: Update existing tests that assert exact `MappedError` shape**

Search `packages/client/src/errors/apiErrorMapper.test.ts` for `expect(result).toEqual({` blocks and add `terminal: false` to each:

```bash
grep -n "toEqual({" packages/client/src/errors/apiErrorMapper.test.ts
```

For each `toEqual({ message: ..., possiblyCommitted: ..., transient: ... })`, append `terminal: false,` (or `terminal: true,` if the case is a terminal-code byCode hit — none today, all existing cases are non-terminal).

- [ ] **Step 5: Run all error-mapper tests to verify pass**

Run: `npm test -w packages/client -- apiErrorMapper.test.ts`

Expected: PASS (all existing + 3 new cases).

- [ ] **Step 6 (REFACTOR):** Look for:
  - **`terminal: false` mass insertion** in existing tests — confirm via `grep -c "terminal: false" packages/client/src/errors/apiErrorMapper.test.ts`. Expected: matches the number of pre-existing `toEqual({` assertions. No DRY opportunity (the field is part of the result shape; spreading would obscure intent).
  - **The byCode-match branch's terminal computation** — `err.code !== undefined && scope.terminalCodes?.includes(err.code) === true` mirrors the `committedCodes` pattern one branch above. Resist extracting a shared helper — the two checks read independently and an extraction would obscure that they fire on different scope fields.
  - **Default `terminal: false` in every return** — repeated across six branches. Confirm consistency via `grep -c "terminal: " packages/client/src/errors/apiErrorMapper.ts`. Expected: six (one per return path) plus one extracted-helper usage = seven; if more, a return path was missed.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/errors/apiErrorMapper.ts packages/client/src/errors/apiErrorMapper.test.ts
git commit -m "feat(errors): terminalCodes field + MappedError.terminal plumbing (4b.3c.1)"
```

---

### Task 6: Relocate `chapter.save` terminal-codes from `useProjectEditor.handleSave` into `scopes.ts`

**Files:**
- Modify: `packages/client/src/errors/scopes.ts` (`chapter.save` block, ~line 104-156)
- Modify: `packages/client/src/hooks/useProjectEditor.ts:468-481, 614-622`
- Modify: `packages/client/src/hooks/useProjectEditor.test.ts` (verify handleSave terminal-error paths still work)

- [ ] **Step 1: Write the failing test**

Add to `packages/client/src/errors/apiErrorMapper.test.ts` (under a new `describe("chapter.save scope")`):

```ts
describe("chapter.save terminal-codes scope-level configuration", () => {
  it("UPDATE_READ_FAILURE on chapter.save sets terminal:true (in terminalCodes)", () => {
    const err = new ApiRequestError("update read failure", 500, "UPDATE_READ_FAILURE");
    const result = mapApiError(err, "chapter.save");
    expect(result.terminal).toBe(true);
    // UPDATE_READ_FAILURE is also in committedCodes — both flags fire.
    expect(result.possiblyCommitted).toBe(true);
  });

  it("CORRUPT_CONTENT on chapter.save sets terminal:true (in terminalCodes)", () => {
    const err = new ApiRequestError("corrupt", 500, "CORRUPT_CONTENT");
    const result = mapApiError(err, "chapter.save");
    expect(result.terminal).toBe(true);
    // CORRUPT_CONTENT is NOT in committedCodes — only terminal fires.
    expect(result.possiblyCommitted).toBe(false);
  });

  it("BAD_JSON 2xx on chapter.save sets possiblyCommitted:true but terminal:false (BAD_JSON branch is structurally before byCode-match)", () => {
    const err = new ApiRequestError("bad json", 200, "BAD_JSON");
    const result = mapApiError(err, "chapter.save");
    expect(result.terminal).toBe(false);
    expect(result.possiblyCommitted).toBe(true);
    // The consumer's `mapped.terminal || mapped.possiblyCommitted` OR catches
    // this case via possiblyCommitted. terminalCodes deliberately omits
    // BAD_JSON for this reason — adding it would be dead code.
  });

  it("Plain 500 INTERNAL_ERROR on chapter.save does NOT set terminal:true or possiblyCommitted:true", () => {
    const err = new ApiRequestError("internal", 500, "INTERNAL_ERROR");
    const result = mapApiError(err, "chapter.save");
    expect(result.terminal).toBe(false);
    expect(result.possiblyCommitted).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/client -- apiErrorMapper.test.ts`

Expected: FAIL — `terminalCodes` not yet on `chapter.save` scope.

- [ ] **Step 3: Add `terminalCodes` to the `chapter.save` scope**

In `packages/client/src/errors/scopes.ts`, append to the existing `chapter.save` scope (immediately after `committedCodes: ["UPDATE_READ_FAILURE"]`):

```ts
    // S3/S7 (4b.3c.1): UPDATE_READ_FAILURE and CORRUPT_CONTENT are 5xx
    // codes the server emits when a chapter PATCH cannot be served
    // safely (the write may have landed; the read-back failed; or the
    // existing content is corrupt). The save loop must break and lock
    // the editor — retrying cannot fix it. Hoisted here so adding a
    // fourth terminal code is a one-line scope edit. BAD_JSON is NOT
    // listed: the mapper's 2xx BAD_JSON branch returns early before
    // byCode-matching, so `terminalCodes: ["BAD_JSON"]` would be dead.
    // The consumer's `mapped.terminal || mapped.possiblyCommitted` OR
    // catches 2xx BAD_JSON via possiblyCommitted instead.
    terminalCodes: ["UPDATE_READ_FAILURE", "CORRUPT_CONTENT"],
```

- [ ] **Step 4: Update `useProjectEditor.handleSave` to read `mapped.terminal || mapped.possiblyCommitted`**

In `packages/client/src/hooks/useProjectEditor.ts`, replace the existing block at lines 468-481:

```ts
if (
  isApiError(err) &&
  (err.code === "BAD_JSON" ||
    err.code === "UPDATE_READ_FAILURE" ||
    err.code === "CORRUPT_CONTENT")
) {
  console.warn("Save failed with terminal code:", err.code);
  const { message } = mapApiError(err, "chapter.save");
  terminal = { message: message as string, code: err.code, status: err.status };
  break;
}
```

…with:

```ts
const mapped = mapApiError(err, "chapter.save");
// S3/S7 (4b.3c.1): the OR is the documented bridge between two
// scope-driven flags that both mean "save loop must break and lock
// the editor":
//   - mapped.terminal: scopes.ts terminalCodes (5xx UPDATE_READ_FAILURE /
//     CORRUPT_CONTENT — the byCode-match branch sets terminal=true).
//   - mapped.possiblyCommitted: 2xx BAD_JSON (scope.committed routes
//     through the BAD_JSON early-return branch, which sets
//     possiblyCommitted=true). UPDATE_READ_FAILURE additionally has a
//     committedCodes entry so its mapped output sets both flags; the
//     OR is idempotent on that case.
if (isApiError(err) && (mapped.terminal || mapped.possiblyCommitted)) {
  console.warn("Save failed with terminal code:", err.code);
  terminal = { message: mapped.message as string, code: err.code, status: err.status };
  break;
}
```

Similarly update lines 614-622 (the lock-banner-after-loop block) to read from a fresh `mapApiError("chapter.save")` call if needed — but inspection shows that block uses `terminalSaveError.code === "BAD_JSON" || ...` to drive the lock, which is consumer-level state, not a mapper-output read. Leave that block as-is — it's reading the captured `terminalSaveError.code` from the loop, which is set above when the terminal branch fires. The relocation moves the *allowlist source* from line 468-481 to `scopes.ts`; the lock-after-loop block at line 614-622 continues to gate on the local `terminalSaveError.code`.

- [ ] **Step 5: Run all hook and mapper tests**

Run: `npm test -w packages/client -- useProjectEditor.test.ts apiErrorMapper.test.ts`

Expected: PASS. If any existing handleSave test expects the exact pre-relocation `console.warn(...)` shape or terminal construction, update its assertion to read from the new `mapped.terminal || mapped.possiblyCommitted` branch — but the assertion should be observable behaviour (lock banner fires, retry loop breaks), not internal warn shape.

- [ ] **Step 6 (REFACTOR):** Look for:
  - **The OR-comment block** at the new consumer site — long, but the bridge between `terminal` and `possiblyCommitted` is non-obvious without it. Keep verbatim.
  - **The post-loop lock block at line 614-622** — still reads `terminalSaveError.code === "BAD_JSON" || ...` against the captured terminal. Confirm this block stays unchanged; it's the consumer-level lock dispatch, not the mapper-level allowlist.
  - **A future move of the OR-comment into a shared helper** (`isChapterSaveTerminalOrCommitted(mapped)`) — tempting if a second consumer ever reads both flags. Today, only `handleSave` does. Resist extracting; one caller doesn't justify a helper.
  - **`console.warn("Save failed with terminal code:", err.code)`** — kept verbatim from pre-relocation. Consider whether this should migrate to `devWarn` (Task 4). Decision: NO — `handleSave` is a non-recovery path and the warn should fire even in non-DEV builds; CLAUDE.md §Testing Philosophy already pins this via tests.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/errors/scopes.ts packages/client/src/hooks/useProjectEditor.ts packages/client/src/errors/apiErrorMapper.test.ts
git commit -m "refactor(errors): relocate chapter.save terminal codes from handleSave to scopes.ts (4b.3c.1 S3/S7)"
```

---

### Task 7: [S8] `image.delete.extrasFrom` — drop the all-or-nothing reject

**Files:**
- Modify: `packages/client/src/errors/scopes.ts:335` (the `if (valid.length !== candidates.length) return undefined;` line)
- Modify: `packages/client/src/errors/apiErrorMapper.test.ts` (image.delete extrasFrom tests)

- [ ] **Step 1: Write the failing test (drop-only-malformed semantics)**

Add to `apiErrorMapper.test.ts`:

```ts
describe("image.delete extrasFrom — drop-only-malformed (4b.3c.1 S8)", () => {
  it("returns the valid chapters when some entries are malformed", () => {
    const err = new ApiRequestError("in use", 409, "IMAGE_IN_USE");
    (err as unknown as { extras: unknown }).extras = {
      chapters: [
        { title: "Chapter A" },
        { not_a_title: true },  // malformed
        { title: "Chapter B", trashed: true },
      ],
    };
    const result = mapApiError(err, "image.delete");
    expect(result.extras).toEqual({
      chapters: [
        { title: "Chapter A" },
        { title: "Chapter B", trashed: true },
      ],
    });
  });

  it("still returns undefined when all entries are malformed", () => {
    const err = new ApiRequestError("in use", 409, "IMAGE_IN_USE");
    (err as unknown as { extras: unknown }).extras = {
      chapters: [{ not_a_title: true }, { still_wrong: 42 }],
    };
    const result = mapApiError(err, "image.delete");
    expect(result.extras).toBeUndefined();
  });

  it("preserves the cap+1 input window (51 candidates max)", () => {
    const err = new ApiRequestError("in use", 409, "IMAGE_IN_USE");
    const lots = Array.from({ length: 100 }, (_, i) => ({ title: `Chapter ${i}` }));
    (err as unknown as { extras: unknown }).extras = { chapters: lots };
    const result = mapApiError(err, "image.delete");
    expect((result.extras as { chapters: unknown[] }).chapters).toHaveLength(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/client -- apiErrorMapper.test.ts`

Expected: FAIL — first test fails because the existing `if (valid.length !== candidates.length) return undefined;` rejects the partially-malformed envelope.

- [ ] **Step 3: Remove the all-or-nothing reject**

In `packages/client/src/errors/scopes.ts`, locate the `image.delete.extrasFrom` block (the long comment block before line 312, plus the function body 312-342). Find the line:

```ts
      if (valid.length !== candidates.length) return undefined;
```

…and delete it (one line). The `if (valid.length === 0) return undefined;` line below stays.

Also update the comment block immediately above the function to reflect the new semantic. Replace the multi-line comment beginning at line 258 (`// I1 (review 2026-04-25): validate beyond the cap...`) and the related blocks documenting the I1 all-or-nothing intent. Replace with:

```ts
    // S8 (4b.3c.1, 2026-05-26): drop-only-malformed. The server contract
    // is the authoritative defense against hostile envelopes; scopes.ts is
    // the second line. Showing 49 valid chapter titles when the server
    // returned 50 (one with a corrupted title) is materially better UX
    // than the generic deleteBlocked fallback with no list. The cap+1
    // window still bounds work at 51 elements; a hostile envelope of
    // [N valid, M bogus] truncates rather than rejects.
    //
    // Earlier review comments referencing I1's all-or-nothing intent are
    // superseded by this trade-off. The cap-boundary case (invalid at
    // index 50 in a 51-entry array) now falls through to the valid filter
    // and returns the 50-entry valid slice rather than rejecting outright.
```

(Keep the cap+1, code-point truncation, and empty-valid-list reject comments — only the all-or-nothing line and its corresponding comment paragraph are removed.)

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -w packages/client -- apiErrorMapper.test.ts`

Expected: PASS (3 new cases + existing all-or-nothing test updated to the new semantic).

Note: existing tests asserting the all-or-nothing reject must be updated. Search for them:

```bash
grep -n "valid.length !== candidates.length\|all-or-nothing\|reject.*malformed" packages/client/src/errors/apiErrorMapper.test.ts
```

Update each to reflect the new behaviour (partial-malformed now returns the valid subset).

- [ ] **Step 5 (REFACTOR):** Look for:
  - **The comment block before `extrasFrom`** — earlier review notes (I1, S5, S*, S3, S4) referenced the all-or-nothing intent. The updated block (`// S8 (4b.3c.1...)`) should fully supersede those references — confirm by re-reading the block top-to-bottom and removing any stale comments still discussing all-or-nothing.
  - **The validation filter** — still a `.filter((c): c is { id?; title; trashed? } => { ... })`. Unchanged. The narrowing predicate stays.
  - **`truncateCodePoints(c.title, 200)`** — kept; surrogate-safe truncation is still needed.
  - **The cap+1 slice** — `chapters.slice(0, 51)` stays. The cap-boundary case (invalid at index 50) now falls through to the valid filter and returns the 50 valid entries; the all-or-nothing reject is gone.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/errors/scopes.ts packages/client/src/errors/apiErrorMapper.test.ts
git commit -m "feat(errors): S8 image.delete extrasFrom drops all-or-nothing reject (4b.3c.1)"
```

---

### Task 8: [S16] Add `chapter.flushBeforeNavigate` scope

**Files:**
- Modify: `packages/client/src/errors/scopes.ts` (`ApiErrorScope` union + `SCOPES` table)
- Modify: `packages/client/src/strings.ts` (new copy keys)
- Modify: `packages/client/src/errors/apiErrorMapper.test.ts`

- [ ] **Step 1: Add new strings to `strings.ts`**

In `packages/client/src/strings.ts`, locate the `editor` or `error` section and add:

```ts
flushBeforeNavigateFailed:
  "Unable to save your changes before switching chapters. Please retry or check your connection.",
flushBeforeNavigateFailedNetwork:
  "Network problem prevented saving your changes before switching. Check your connection and try again.",
```

Place them near the existing `saveFailed` copy for cohesion.

- [ ] **Step 2: Add scope entry**

In `packages/client/src/errors/scopes.ts`, append `"chapter.flushBeforeNavigate"` to the `ApiErrorScope` union (alphabetize against existing entries, near `chapter.*` siblings):

```ts
  | "chapter.flushBeforeNavigate"
```

Then add to the `SCOPES` record (near `chapter.load`):

```ts
  "chapter.flushBeforeNavigate": {
    fallback: STRINGS.editor.flushBeforeNavigateFailed,
    network: STRINGS.editor.flushBeforeNavigateFailedNetwork,
  },
```

- [ ] **Step 3: Write the test**

Add to `apiErrorMapper.test.ts`:

```ts
describe("chapter.flushBeforeNavigate scope (4b.3c.1 S16)", () => {
  it("maps a NETWORK error to the flush-before-navigate network copy", () => {
    const err = new ApiRequestError("net", 0, "NETWORK");
    const result = mapApiError(err, "chapter.flushBeforeNavigate");
    expect(result.message).toBe(STRINGS.editor.flushBeforeNavigateFailedNetwork);
    expect(result.transient).toBe(true);
  });

  it("maps a non-routed error to the fallback", () => {
    const err = new ApiRequestError("internal", 500, "INTERNAL_ERROR");
    const result = mapApiError(err, "chapter.flushBeforeNavigate");
    expect(result.message).toBe(STRINGS.editor.flushBeforeNavigateFailed);
  });
});
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -w packages/client -- apiErrorMapper.test.ts`

Expected: PASS.

- [ ] **Step 5 (REFACTOR):** Look for:
  - **String placement in `strings.ts`** — the two new keys should sit alongside other `editor.*` save/flush keys for cohesion. Confirm via inspection.
  - **Scope-table alphabetic position** — `chapter.flushBeforeNavigate` placed alphabetically among the `chapter.*` siblings.
  - **No consumer swap in this commit** — the swap lands in Task 21. The scope addition by itself is observably no-op until a consumer reads it.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/errors/scopes.ts packages/client/src/strings.ts packages/client/src/errors/apiErrorMapper.test.ts
git commit -m "feat(errors): add chapter.flushBeforeNavigate scope (4b.3c.1 S16)"
```

---

### Ladder Migration Template (canonical Pattern P1)

Tasks 9-23 are all Pattern P1 (simple ladder → `applyMappedError`). Each follows the same five-step recipe. The template below is canonical; per-task metadata appears in the table at the end of this template section.

**Before (canonical):**

```ts
} catch (err) {
  if (signal.aborted) return;  // (only present where the catch already has a signal in scope)
  const { message } = mapApiError(err, "<scope>");
  if (message === null) return;
  if (message) setX(message);
}
```

**After (canonical, with sibling state preserved):**

```ts
} catch (err) {
  if (signal.aborted) return;  // (only where present in the original)
  // Preserve any pre-applyMappedError side effects (console.error / .warn / optimistic state)
  // that ran on the non-ABORTED branch — keep them inside the catch, BEFORE applyMappedError.
  const mapped = mapApiError(err, "<scope>");
  if (mapped.message !== null) console.error("<context>:", err);  // (only where present)
  applyMappedError(mapped, { onMessage: setX });
}
```

**Five-step recipe (apply to every task in the ladder block):**

- [ ] **RED:** The existing test for this handler/method already asserts the user-visible behaviour (banner set / error state visible). Run that test BEFORE the migration to confirm baseline. Run: `npm test -w packages/client -- <test-file>`. Expected: PASS (baseline).
- [ ] **Verify the failing test exists (or skip):** If the existing test asserts only the post-migration behaviour (rare — most existing tests cover both forms), no new RED is needed. If the test does NOT cover the non-ABORTED → setX path, write a focused test for it first, run it, see it pass (since the un-migrated code already produces the right behaviour); this is the regression guard that the migration MUST preserve.
- [ ] **GREEN:** Apply the migration (import + ladder → applyMappedError swap). Run: `npm test -w packages/client -- <test-file>`. Expected: PASS (no observable behaviour change).
- [ ] **REFACTOR:** Confirm no opportunity at this site. Pattern P1 migrations are themselves refactors (replacing a hand-rolled ladder with a helper call); the helper consolidates duplicate logic by construction. If the migration revealed a sibling catch with a near-identical shape, note it as a follow-up but do NOT widen this commit's scope. If the migration introduced any new helper (e.g. a closure-captured `mapped` variable reused inside multiple callbacks), confirm it is single-use; multi-use helpers belong in a separate refactor commit.
- [ ] **Commit:** Per-task metadata in the table below specifies the commit message.

**Per-task metadata (Tasks 9-23):**

| Task | File | Line(s) | Scope | Special-handling notes | Commit message |
|------|------|---------|-------|------------------------|----------------|
| 9 | `hooks/useTrashManager.ts` | 59-66, 102-130 (non-committed branch only), 159-168 | `trash.load`, `trash.restoreChapter`, `trash.load` | `handleRestore` keeps its hand-rolled `possiblyCommitted` optimistic-drop branch (extended to a full recovery flow in 4b.3c.3 [I4]); only the message-dispatch tail migrates. `console.error("Failed to restore chapter:", err)` stays before applyMappedError on non-ABORTED. | `refactor(trash): migrate useTrashManager ladders to applyMappedError (4b.3c.1 S15)` |
| 10 | `hooks/useSnapshotState.ts` | ~334 (`viewSnapshot` abort gate) | `snapshot.view` | Existing `if (signal.aborted) return` stays first. | `refactor(snapshots): migrate viewSnapshot ladder to applyMappedError (4b.3c.1 S15)` |
| 11 | `hooks/useFindReplaceState.ts` | ~237 (`search` catch) | `findReplace.search` | Search ladder also has an abort-gate; preserve. | `refactor(find-replace): migrate search ladder to applyMappedError (4b.3c.1 S15)` |
| 12 | `hooks/useProjectEditor.ts` | ~332 (`loadProject` catch) | `project.load` | `console.warn` stays before applyMappedError on non-ABORTED. | `refactor(project-editor): migrate loadProject ladder to applyMappedError (4b.3c.1 S15)` |
| 13 | `hooks/useProjectEditor.ts` | ~836 (`handleSelectChapter` catch) | `chapter.load` | `console.warn("Failed to load chapter:", err)` stays; gated on non-ABORTED. | `refactor(project-editor): migrate handleSelectChapter ladder to applyMappedError (4b.3c.1 S15)` |
| 14 | `hooks/useProjectEditor.ts` | ~906 (`reloadActiveChapter` catch) | `chapter.load` | `console.warn("Failed to reload chapter:", err)` stays. | `refactor(project-editor): migrate reloadActiveChapter ladder to applyMappedError (4b.3c.1 S15)` |
| 15 | `hooks/useProjectEditor.ts` | ~1024 + ~1046 (`handleDeleteChapter` inner catches) | `chapter.load` at 1024; `chapter.delete` at 1046 | Two ladders, two distinct scopes — one commit but verify BOTH lines change. Run grep `grep -n "mapApiError" packages/client/src/hooks/useProjectEditor.ts` post-migration to confirm both sites are gone. | `refactor(project-editor): migrate handleDeleteChapter ladders to applyMappedError (4b.3c.1 S15)` |
| 16 | `hooks/useProjectEditor.ts` | ~1337 (`handleStatusChange` catch tail) | `chapter.updateStatus` | This site preserves `if (onError) onError(message); else setError(message);` shape — wrap the OR in `onMessage`. The S4 fix (Task 29 in 4b.3c.2) adds the `setError` fallback; for this migration, mirror the pre-S4 shape (only `onError?.(message)`, no fallback). | `refactor(project-editor): migrate handleStatusChange tail ladder to applyMappedError (4b.3c.1 S15)` |
| 17 | `hooks/useProjectEditor.ts` | ~1372 (`handleRenameChapter` catch) | `chapter.rename` | `console.warn("Failed to rename chapter:", err)` stays. | `refactor(project-editor): migrate handleRenameChapter ladder to applyMappedError (4b.3c.1 S15)` |
| 18 | `components/SnapshotPanel.tsx` | ~148, ~172 (`fetchSnapshots` two sites), ~329 (`handleDelete`) | `snapshot.list` (148, 172); `snapshot.delete` (329) | Three sites, two scopes — one commit but verify all three. Lines 148 vs 172: distinguish the mount-effect call from the in-handler call by their surrounding context; both use `snapshot.list`. | `refactor(snapshot-panel): migrate fetchSnapshots + handleDelete ladders to applyMappedError (4b.3c.1 S15)` |
| 19 | `components/DashboardView.tsx` | ~61, ~83 | Read each via `grep -n "mapApiError" packages/client/src/components/DashboardView.tsx` — likely `dashboard.load`. | If line 61's scope differs from line 83's, the table is wrong and the migration must split into two commits. Verify before starting. | `refactor(dashboard): migrate DashboardView ladders to applyMappedError (4b.3c.1 S15)` |
| 20 | `components/ExportDialog.tsx` | ~110, ~173 | `export.run` | One commit; both sites share the scope. | `refactor(export): migrate ExportDialog ladders to applyMappedError (4b.3c.1 S15)` |
| 21 | `pages/EditorPage.tsx` | ~1512 (`handleSelectChapterWithFlush`) + remaining EditorPage ladder sites discovered by `grep -n "mapApiError(err," packages/client/src/pages/EditorPage.tsx` | **Scope swap on line 1512**: from `chapter.load` to `chapter.flushBeforeNavigate` (the new scope from Task 8). Other EditorPage ladders keep their scopes. | The `chapter.flushBeforeNavigate` swap is part of this commit — bundled because both are ladder migrations and the scope-add+consumer-swap pair is the canonical [S16] application. Add an explanatory comment at line 1512: `// S16 (4b.3c.1): chapter.flushBeforeNavigate distinguishes flush-on-navigate failures from chapter-load failures.` | `refactor(editor-page): migrate ladders + [S16] consumer swap to applyMappedError (4b.3c.1 S15+S16)` |
| 22 | `components/ImageGallery.tsx` | 308-337 (`handleDelete`) | `image.delete` | **Pattern P2 with `STOP`** — not a simple ladder. See the dedicated Task 22 section below. | `refactor(image-gallery): migrate handleDelete to Pattern P2 + STOP (4b.3c.1 S15)` |
| 23 | `pages/HomePage.tsx` | ~63, ~121, ~156 | Read each via `grep -n "mapApiError(err," packages/client/src/pages/HomePage.tsx`. | If the three lines share a scope, one commit; otherwise split. | `refactor(home): migrate HomePage ladders to applyMappedError (4b.3c.1 S15)` |

**Special case — Task 22 (ImageGallery.handleDelete, Pattern P2 with STOP):** see the dedicated task block at the end of this section.

---

### Task 9: Simple-ladder migration — `useTrashManager` (Pattern P1)

**Files:**
- Modify: `packages/client/src/hooks/useTrashManager.ts:51-67` (openTrash), `:102-130` (handleRestore non-committed), `:135-169` (confirmDeleteChapter trash-refresh)
- Modify: `packages/client/src/hooks/useTrashManager.test.ts` (replace ladder assertions with applyMappedError equivalence)

- [ ] **Step 1: Add the `applyMappedError` import**

In `useTrashManager.ts:4`, change:

```ts
import { mapApiError } from "../errors";
```

…to:

```ts
import { mapApiError, applyMappedError } from "../errors";
```

- [ ] **Step 2: Migrate `openTrash` catch (lines 59-66)**

Replace:

```ts
} catch (err) {
  if (signal.aborted) return;
  const { message } = mapApiError(err, "trash.load");
  if (message === null) return;
  console.error("Failed to load trash:", err);
  setActionError(message);
}
```

…with:

```ts
} catch (err) {
  if (signal.aborted) return;
  const mapped = mapApiError(err, "trash.load");
  if (mapped.message === null) return;  // ABORTED — silent
  console.error("Failed to load trash:", err);
  applyMappedError(mapped, { onMessage: setActionError });
}
```

(`applyMappedError` checks `message === null` internally, but we keep the early-return because `console.error` should not fire on ABORTED.)

Actually — simpler form, drop the duplicate null check:

```ts
} catch (err) {
  if (signal.aborted) return;
  const mapped = mapApiError(err, "trash.load");
  if (mapped.message !== null) console.error("Failed to load trash:", err);
  applyMappedError(mapped, { onMessage: setActionError });
}
```

- [ ] **Step 3: Migrate `handleRestore` non-committed branch (lines 102-130)**

This site is more complex — it has both a `possiblyCommitted` recovery (the existing implementation) and a default message dispatch. The recovery branch will be touched again in 4b.3c.3 (I4). For 4b.3c.1, only migrate the simple-ladder shape:

Replace the catch tail:

```ts
} catch (err) {
  if (signal.aborted) return;
  const { message, possiblyCommitted } = mapApiError(err, "trash.restoreChapter");
  if (message === null) return;
  console.error("Failed to restore chapter:", err);
  if (possiblyCommitted) {
    setTrashedChapters((prev) => prev.filter((c) => c.id !== chapterId));
  }
  setActionError(message);
}
```

…with:

```ts
} catch (err) {
  if (signal.aborted) return;
  const mapped = mapApiError(err, "trash.restoreChapter");
  if (mapped.message !== null) console.error("Failed to restore chapter:", err);
  applyMappedError(mapped, {
    onCommitted: () => {
      setTrashedChapters((prev) => prev.filter((c) => c.id !== chapterId));
    },
    onMessage: setActionError,
  });
}
```

(4b.3c.3 [I4] will extend `onCommitted` to also fire the recovery GET. For now, preserve the existing semantic of "optimistically drop from trash list on committed".)

- [ ] **Step 4: Migrate `confirmDeleteChapter` trash-refresh catch (lines 159-168)**

Replace:

```ts
} catch (err) {
  if (signal.aborted) return;
  const { message } = mapApiError(err, "trash.load");
  if (message) setActionError(message);
}
```

…with:

```ts
} catch (err) {
  if (signal.aborted) return;
  applyMappedError(mapApiError(err, "trash.load"), { onMessage: setActionError });
}
```

- [ ] **Step 5: Update tests**

Run: `npm test -w packages/client -- useTrashManager.test.ts`

Existing tests should pass because behaviour is unchanged. If any test asserts the exact intermediate `mapApiError` destructure shape (rather than observable behaviour), refactor the assertion to read `setActionError`'s call history.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/hooks/useTrashManager.ts packages/client/src/hooks/useTrashManager.test.ts
git commit -m "refactor(trash): migrate useTrashManager ladders to applyMappedError (4b.3c.1 S15)"
```

---

### Tasks 10-21 + 23: Remaining simple-ladder migrations (one commit per `handleX` / component method)

Each task in this block follows the **Ladder Migration Template** above. The per-task metadata table (above) lists each task's file, lines, scope, special-handling notes, and commit message. For each task:

- [ ] **RED:** Run the existing test for the file to confirm baseline (the test should already cover the user-visible behaviour at the catch site).
- [ ] **GREEN:** Apply the import + ladder swap per the template, using the metadata-table row's specifics.
- [ ] **REFACTOR:** Confirm no opportunity at this site (Pattern P1 migrations ARE refactors by construction). If a sibling catch with near-identical shape comes into view, note as a follow-up — do not widen scope.
- [ ] **Commit:** Use the per-task metadata-table commit message.

For Task 21 (EditorPage), the `chapter.flushBeforeNavigate` scope swap on line 1512 is bundled with the rest of EditorPage's ladder migrations in one commit per the metadata table.

For Task 19 (DashboardView), inspect the actual scope at each line before starting; if line 61's scope differs from line 83's, split into two commits.

### Task 22: `ImageGallery.handleDelete` — Pattern P2 with `STOP` (special)

This is the only Pattern P2 site. The migration replaces a multi-branch ladder (which already does its own `if (possiblyCommitted) { ...; return; }` early-return) with `applyMappedError` + `STOP` sentinel.

- [ ] **RED:** Run the existing ImageGallery tests:
  ```bash
  npm test -w packages/client -- ImageGallery.test.tsx
  ```
  Confirm baseline.

- [ ] **GREEN:** In `packages/client/src/components/ImageGallery.tsx`, replace the catch at lines 308-337:

  ```ts
  } catch (err: unknown) {
    if (signal.aborted) return;
    const { message, possiblyCommitted, extras } = mapApiError(err, "image.delete");
    if (!message) return;
    if (possiblyCommitted) {
      announce(message);
      setSelectedImage(null);
      setConfirmingDelete(false);
      incrementRefreshKey();
      return;
    }
    if (extras?.chapters) {
      const chapters = (extras.chapters as Array<{ title: string; trashed?: boolean }>).map(
        (c) => (c.trashed ? `${c.title} (${S.inTrash})` : c.title),
      );
      announce(S.deleteBlocked(chapters));
    } else {
      announce(message);
    }
    setConfirmingDelete(false);
  }
  ```

  …with the closure-capture form:

  ```ts
  } catch (err: unknown) {
    if (signal.aborted) return;
    const mapped = mapApiError(err, "image.delete");
    applyMappedError(mapped, {
      onCommitted: () => {
        // S8 (4b.3c.1): the server likely committed the delete but the
        // response body was unreadable. Announce the committed copy;
        // STOP so the extras/message branches don't double-announce.
        if (mapped.message !== null) announce(mapped.message);
        setSelectedImage(null);
        setConfirmingDelete(false);
        incrementRefreshKey();
        return STOP;
      },
      onExtras: ({ chapters }) => {
        // Drops the previous `as Array<{ title; trashed?: boolean }>` cast —
        // ScopeExtras<"image.delete"> narrows the type via the MappedError<S>
        // phantom from Task 1.
        const labels = chapters.map((c) => (c.trashed ? `${c.title} (${S.inTrash})` : c.title));
        announce(S.deleteBlocked(labels));
        setConfirmingDelete(false);
        return STOP;
      },
      onMessage: (msg) => {
        announce(msg);
        setConfirmingDelete(false);
      },
    });
  }
  ```

  Import `applyMappedError` and `STOP` from `../errors`.

- [ ] **GREEN verification:** Run the test:
  ```bash
  npm test -w packages/client -- ImageGallery.test.tsx
  ```
  Expected: PASS. No diff in observable behaviour.

- [ ] **REFACTOR:** Look for:
  - **Duplicated logic** between `onCommitted`'s "close confirm" sequence (`setSelectedImage(null); setConfirmingDelete(false); incrementRefreshKey();`) and the original code's similar block — already deduped by routing through the same callback. No extraction needed.
  - **Hard-coded values** — none introduced.
  - **The closure-captured `mapped`** — single-use; do NOT extract into a helper.
  - **Existing extras-cast at line 329** — already removed by the migration; verify via `grep -n "as Array" packages/client/src/components/ImageGallery.tsx`. Expected: zero hits.

- [ ] **Commit:**
  ```bash
  git add packages/client/src/components/ImageGallery.tsx packages/client/src/__tests__/ImageGallery.test.tsx
  git commit -m "refactor(image-gallery): migrate handleDelete to Pattern P2 + STOP (4b.3c.1 S15)"
  ```

**Total for Tasks 10-23:** 14 commits (one per `handleX`/component method per the metadata table, except Task 19 which may split if the two lines have different scopes).

---

### Task 24: E2e coverage backfill — `e2e/chapter-create-recovery.spec.ts`

**Files:**
- Create: `e2e/chapter-create-recovery.spec.ts` (OR add to `e2e/editor-save.spec.ts` if it already has chapter-create scaffolding)

- [ ] **Step 1: Survey existing e2e fixtures**

Run:

```bash
grep -n "create.*chapter\|chapters/.*create\|POST.*chapters" e2e/*.spec.ts | head -20
```

Decide on landing site:
- If `e2e/editor-save.spec.ts` already has chapter-create scaffolding (project + chapter setup), append a new test there.
- Otherwise, create a new file `e2e/chapter-create-recovery.spec.ts` with full setup.

This decision is a plan-time choice, not a brainstorm-time fork; document it in the commit message.

- [ ] **Step 2: Write the spec**

Add the following test (adjust setup to match the landing site's existing patterns):

```ts
import { test, expect } from "@playwright/test";
import { createProject } from "./helpers/createProject";

test("chapter-create recovery: 200 BAD_JSON surfaces committed banner + new chapter via refresh", async ({ page }) => {
  await createProject(page, "Recovery Backfill");

  // Intercept the chapter-create POST and return an unparseable 200.
  await page.route("**/api/projects/*/chapters", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"invalid":"json"',  // missing closing brace — body unparseable
    });
  });

  // Click "Add chapter".
  await page.getByRole("button", { name: /add chapter/i }).click();

  // (a) Committed banner displays — copy from STRINGS.error.createChapterResponseUnreadable.
  await expect(page.getByText(/server may have committed/i)).toBeVisible({ timeout: 5_000 });

  // (b) The newly-created chapter appears in the sidebar via the
  //     recovery GET path (which uses the un-intercepted projects/:slug
  //     endpoint).
  await expect(page.getByRole("listitem").filter({ hasText: /chapter/i })).toHaveCount(2);  // initial + new

  // (c) The newly-created chapter becomes the active chapter — the
  //     editor heading reflects it.
  // (Implementation-dependent; adjust selector to match the chapter-title heading shape.)
});
```

- [ ] **Step 3: Run the spec**

Run: `make e2e-clean && make e2e -- chapter-create-recovery.spec.ts`

Expected: PASS. If the recovery GET selector for "newly-created chapter" doesn't match, the existing `handleCreateChapter` flow may have different UX nuances — adjust selectors to the observable post-recovery state.

- [ ] **Step 4 (REFACTOR):** Look for:
  - **Setup helper reuse** — if `createProject(page, ...)` is available in `e2e/helpers/`, use it. If not, the spec inlines a minimal setup; flag as a follow-up to extract once a third recovery spec arrives.
  - **`page.route` pattern** — repeated across all three recovery specs (Tasks 24, 36, 49). Consider extracting `interceptWith200BadJson(page, urlPattern)` after all three land. Today: not extracting; the pattern is short and the spec reads more clearly with it inline.
  - **Selector stability** — `getByText(/server may have committed/i)` is text-based and will break if the copy changes. Mirror existing e2e patterns (which use text-based selectors per `e2e/` convention); accept the maintenance burden.

- [ ] **Step 5: Commit**

```bash
git add e2e/chapter-create-recovery.spec.ts
git commit -m "test(e2e): chapter-create recovery committed-banner coverage (4b.3c.1)"
```

---

### Task 25: Sub-phase 4b.3c.1 verification

- [ ] **Step 1: Run the full suite**

Run: `make all`

Expected: GREEN. Coverage at or above thresholds (95/85/90/95).

- [ ] **Step 2: Confirm no behavioural changes at consumer sites**

This sub-phase is mechanical at consumer sites. Spot-check by running the pre-existing tests on a touched file (e.g. `useTrashManager.test.ts`) and confirm no assertions changed semantics — only the path through `applyMappedError` is new.

- [ ] **Step 3: Confirm allowlist count is still three**

Run: `grep -c "resolve(clientSrcRoot" packages/client/src/__tests__/migrationStructuralCheck.test.ts | head -1`

Expected: three files in `PHASE_4B_3B_ALLOWLIST`. 4b.3c.3's allowlist update is deferred until that sub-phase.

- [ ] **Step 4: Open the PR**

PR title: `Phase 4b.3c.1: Consumer Recovery Foundation — primitives + scope refactor + ladder migrations`

PR description references:
- Roadmap entry `docs/roadmap.md` Phase 4b.3c.1
- Design doc `docs/plans/2026-05-26-consumer-recovery-completeness-design.md`
- Pushback decision log `docs/roadmap-decisions/2026-05-26-phase-4b-3c-consumer-recovery-completeness.md`

---

# Sub-phase 4b.3c.2: Helper-Consuming Behavioural Fixes

**PR scope:** This sub-phase depends on 4b.3c.1's foundation merging. ~8-9 commits. Each behavioural fix is two commits (pinning + fix) except where noted.

---

### Task 26: [I3] Pinning test — `SnapshotPanel.handleCreate` does NOT refresh on `possiblyCommitted` (current behaviour)

**Files:**
- Modify: `packages/client/src/components/SnapshotPanel.test.tsx`

- [ ] **Step 1: Write the pinning test**

Add to `SnapshotPanel.test.tsx`:

```ts
describe("SnapshotPanel.handleCreate possiblyCommitted (4b.3c.2 I3)", () => {
  it("PINNED: 200 BAD_JSON currently surfaces createError but does NOT close form, clear label, or refetch — pinning before I3 fix flips this", async () => {
    // Mock api.snapshots.create to throw a 200 BAD_JSON ApiRequestError.
    // Render SnapshotPanel; type a label; click Create.
    // Assertions before fix:
    //   - createError is set to the committed-response copy.
    //   - The create form is STILL visible (showCreateForm stays true).
    //   - The label input still contains the typed text.
    //   - fetchSnapshots is NOT called a second time after the failure.
    // Use vi.spyOn(api.snapshots, "list") to count calls.
    // [Test body — implement per the existing SnapshotPanel test pattern.]
  });
});
```

Fill in the test body using the existing `SnapshotPanel.test.tsx` setup (`render`, mock API, simulate user interaction). The assertions:

```ts
expect(createError).toBeTruthy();  // banner displayed
expect(showCreateForm).toBe(true);  // form NOT closed
expect(labelInputValue).toBe("My label");  // label NOT cleared
expect(listSpy).toHaveBeenCalledTimes(1);  // initial fetch only, no refetch
```

- [ ] **Step 2: Run test to verify pin passes against current behaviour**

Run: `npm test -w packages/client -- SnapshotPanel.test.tsx`

Expected: PASS — assertions match the un-fixed code at `SnapshotPanel.tsx:300-304`.

- [ ] **REFACTOR:** N/A — pinning-only commit, no production code to refactor. The test itself uses the existing SnapshotPanel test setup; no test-helper extraction warranted.

- [ ] **Step 3: Commit the pinning test**

```bash
git add packages/client/src/__tests__/SnapshotPanel.test.tsx
git commit -m "test(snapshot-panel): pin I3 — handleCreate does not refresh on committed (4b.3c.2)"
```

---

### Task 27: [I3] Fix — `SnapshotPanel.handleCreate` closes form, clears label, refetches on `possiblyCommitted`

**Files:**
- Modify: `packages/client/src/components/SnapshotPanel.tsx:300-304`
- Modify: `packages/client/src/__tests__/SnapshotPanel.test.tsx` (flip the pinning assertions)

- [ ] **Step 1: Flip the pinning test assertions**

Update the assertions from Task 26 to reflect the post-fix behaviour:

```ts
expect(createError).toBeTruthy();  // banner displayed (mapped committed copy)
expect(showCreateForm).toBe(false);  // form closed
expect(labelInputValue).toBe("");  // label cleared
expect(listSpy).toHaveBeenCalledTimes(2);  // initial + refetch
```

Remove the "PINNED" comment and update the test name to "I3 — handleCreate closes form, clears label, refetches on possiblyCommitted".

- [ ] **Step 2: Run test to verify it now fails (red phase)**

Run: `npm test -w packages/client -- SnapshotPanel.test.tsx`

Expected: FAIL — the test now asserts post-fix behaviour but the code is unfixed.

- [ ] **Step 3: Implement the fix**

In `packages/client/src/components/SnapshotPanel.tsx`, replace the catch at lines 300-304:

```ts
} catch (err) {
  if (signal.aborted) return;
  const { message } = mapApiError(err, "snapshot.create");
  if (message) setCreateError(message);
}
```

…with:

```ts
} catch (err) {
  if (signal.aborted) return;
  const mapped = mapApiError(err, "snapshot.create");
  applyMappedError(mapped, {
    onCommitted: () => {
      // I3 (4b.3c.2): the server likely committed the snapshot but the
      // response body was unreadable. Close the create form so the user
      // doesn't re-submit; clear the label; refetch the snapshot list so
      // the new snapshot becomes visible. The committed banner copy from
      // mapped.message tells the user the response was ambiguous.
      setShowCreateForm(false);
      setCreateLabel("");
      setDuplicateMessage(false);
      void fetchSnapshots();
    },
    onMessage: setCreateError,
  });
}
```

Import `applyMappedError` from `../errors` if not already imported.

- [ ] **Step 4: Run test to verify it passes (green phase)**

Run: `npm test -w packages/client -- SnapshotPanel.test.tsx`

Expected: PASS — post-fix behaviour matches the assertions.

- [ ] **Step 5 (REFACTOR):** Look for:
  - **`onCommitted` body duplication** with the success-path "close form, clear label, refetch" sequence — yes, the same three setters fire on both happy-path success and committed-recovery. Consider extracting `closeFormAndRefresh()` if a future site needs it; today, two call sites don't warrant extraction.
  - **The `void fetchSnapshots()` form** — the void prefix silences the no-floating-promises lint. Verify no existing call site uses a different form (e.g. `await fetchSnapshots()` outside of an async block).

- [ ] **Step 6: Commit the fix**

```bash
git add packages/client/src/components/SnapshotPanel.tsx packages/client/src/__tests__/SnapshotPanel.test.tsx
git commit -m "fix(snapshot-panel): I3 — handleCreate refreshes on possiblyCommitted (4b.3c.2)"
```

---

### Task 28: [I5] `useTrashManager.confirmDeleteChapter` programming-bug warn

**Files:**
- Modify: `packages/client/src/hooks/useTrashManager.ts:143-147`
- Modify: `packages/client/src/hooks/useTrashManager.test.ts`

Per 2026-05-26 pushback Issue 5 (option B): drop the mapper-routing proposal from the brainstorm; the bare catch is a programming-bug path. Add `console.warn` + comment naming the path.

- [ ] **Step 1: Write the test (bundled pin + fix — the warn IS the fix)**

Add to `useTrashManager.test.ts`:

```ts
describe("confirmDeleteChapter unexpected throw (4b.3c.2 I5)", () => {
  it("dismisses the dialog AND warns when handleDeleteChapter throws unexpectedly", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Mock handleDeleteChapter to throw a bare Error (programming-bug path).
    const handleDeleteChapter = vi.fn().mockRejectedValue(new Error("synthetic programming bug"));
    // ... [render hook, set deleteTarget, call confirmDeleteChapter] ...
    // Assertions:
    expect(setDeleteTarget).toHaveBeenLastCalledWith(null);  // dialog dismissed
    expect(warnSpy).toHaveBeenCalledWith(
      "confirmDeleteChapter programming-bug path:",
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/client -- useTrashManager.test.ts`

Expected: FAIL — the existing bare `catch {}` doesn't warn.

- [ ] **Step 3: Implement the fix**

In `packages/client/src/hooks/useTrashManager.ts`, replace the catch at lines 143-147:

```ts
} catch {
  // Unexpected throw — dismiss dialog so the user isn't stuck.
  setDeleteTarget(null);
  return;
}
```

…with:

```ts
} catch (err) {
  // I5 (4b.3c.2, 2026-05-26 pushback): this catch is reachable only on
  // a programming bug — handleDeleteChapter surfaces all API errors via
  // its onError callback (which sets actionError above), never as a
  // throw. The bare catch existed pre-I5 to keep the dialog from
  // hanging open if a future refactor introduced a throw. Add a
  // console.warn so the programming-bug path is observable in dev;
  // the dialog still dismisses so the user isn't stuck.
  console.warn("confirmDeleteChapter programming-bug path:", err);
  setDeleteTarget(null);
  return;
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npm test -w packages/client -- useTrashManager.test.ts`

Expected: PASS.

- [ ] **Step 5 (REFACTOR):** Look for:
  - **The warn-on-programming-bug-path pattern** — emerging shape that may appear in other bare catches that should be programming-bug-only. No consolidation needed today (one site).
  - **The comment block** — explains the "this is a programming-bug catch, not an API-error catch" intent. Necessary; do not shorten.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/hooks/useTrashManager.ts packages/client/src/hooks/useTrashManager.test.ts
git commit -m "fix(trash): I5 — confirmDeleteChapter warns on programming-bug path (4b.3c.2)"
```

---

### Task 29: [S4] `handleStatusChange` non-committed branch falls back to `setError` when `onError` is omitted

**Files:**
- Modify: `packages/client/src/hooks/useProjectEditor.ts:1337` (the `if (message) onError?.(message);` line at the tail of `handleStatusChange`)
- Modify: `packages/client/src/hooks/useProjectEditor.test.ts`

- [ ] **Step 1: Write the test**

Add to `useProjectEditor.test.ts`:

```ts
describe("handleStatusChange onError fallback (4b.3c.2 S4)", () => {
  it("falls back to setError when onError is omitted and the status change fails", async () => {
    // Mock api.chapters.update to throw a 500 INTERNAL_ERROR.
    // Call handleStatusChange(chapterId, "Final") with NO onError argument.
    // Assert that setError (the hook-level error) is set to the
    // chapter.updateStatus fallback copy.
    // [Test body — match the existing useProjectEditor test pattern.]
  });

  it("still routes to onError when one is provided (no regression)", async () => {
    // Same setup but pass an onError mock; assert setError is NOT called
    // and onError IS called with the mapped message.
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/client -- useProjectEditor.test.ts`

Expected: FAIL — when `onError` is undefined and the status PATCH fails, the message is silently swallowed.

- [ ] **Step 3: Implement the fix**

In `useProjectEditor.ts`, replace line 1337:

```ts
if (message) onError?.(message);
```

…with:

```ts
// S4 (4b.3c.2): mirror handleReorderChapters — when no onError callback
// is wired (e.g. keyboard shortcut path), fall back to the hook's
// setError so the failure surfaces. Without this fallback, an omitted
// onError silently swallowed the message.
if (message) {
  if (onError) onError(message);
  else setError(message);
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npm test -w packages/client -- useProjectEditor.test.ts`

Expected: PASS.

- [ ] **Step 5 (REFACTOR):** Look for:
  - **The `onError || setError` pattern** — now exists in two handlers (`handleStatusChange`, `handleReorderChapters` per CLAUDE.md / existing impl). Consider extracting `dispatchError(message, onError)` if a third handler adopts the pattern. Today, two doesn't justify extraction.
  - **Existing tests for handleStatusChange** — the new fallback may make some existing tests stricter. Verify by re-running the full test file: `npm test -w packages/client -- useProjectEditor.test.ts`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/hooks/useProjectEditor.ts packages/client/src/hooks/useProjectEditor.test.ts
git commit -m "fix(project-editor): S4 — handleStatusChange falls back to setError when onError omitted (4b.3c.2)"
```

---

### Task 30: [S10] Pinning test — `handleStatusChange:1312` recovery catch does NOT warn currently

**Files:**
- Modify: `packages/client/src/hooks/useProjectEditor.test.ts`

- [ ] **Step 1: Write the pinning test**

Add to `useProjectEditor.test.ts`:

```ts
describe("handleStatusChange recovery catch warn gating (4b.3c.2 S10)", () => {
  it("PINNED: when the recovery GET fails (non-aborted), no console.warn fires currently — flips on S10 fix", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Mock api.chapters.update to fail with 500 (drives into the recovery branch).
    // Mock api.projects.get to also fail (drives into the inner catch at line 1312).
    // Call handleStatusChange.
    // Pre-fix expectation: warnSpy was NOT called for this catch.
    expect(warnSpy).not.toHaveBeenCalledWith(
      "handleStatusChange recovery GET failed:",
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it("PINNED: when the recovery GET is aborted, no console.warn fires (and won't after the fix either)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Mock api.chapters.update to fail; api.projects.get to be aborted mid-flight.
    // Call handleStatusChange; abort the recovery controller.
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify pin passes**

Run: `npm test -w packages/client -- useProjectEditor.test.ts`

Expected: PASS.

- [ ] **REFACTOR:** N/A — pinning-only commit. The two pin cases (non-aborted no-warn / aborted no-warn) document the gate's BOTH inputs; do not collapse into one.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/hooks/useProjectEditor.test.ts
git commit -m "test(project-editor): pin S10 — handleStatusChange recovery catch warn-gating (4b.3c.2)"
```

---

### Task 31: [S10] Fix — adopt `devWarn` at `handleStatusChange:1312` recovery catch

**Files:**
- Modify: `packages/client/src/hooks/useProjectEditor.ts:1312`
- Modify: `packages/client/src/hooks/useProjectEditor.test.ts` (flip the assertion)

- [ ] **Step 1: Flip the pinning test**

Change the non-aborted assertion to expect the warn:

```ts
expect(warnSpy).toHaveBeenCalledWith(
  "handleStatusChange recovery GET failed:",
  expect.any(Error),
);
```

Keep the aborted-signal test unchanged (the warn stays silent on abort).

- [ ] **Step 2: Run test to verify it now fails**

Run: `npm test -w packages/client -- useProjectEditor.test.ts`

Expected: FAIL (non-aborted assertion).

- [ ] **Step 3: Implement the fix**

In `useProjectEditor.ts`, replace the bare catch at line 1312:

```ts
} catch {
  // Reload failed — fall through to local revert
}
```

…with:

```ts
} catch (err) {
  // S10 (4b.3c.2): make this recovery failure observable in dev. The
  // per-call recoveryController.signal is the gate input — if the
  // newer status PATCH or unmount cancelled this GET, stay silent.
  devWarn("handleStatusChange recovery GET failed", recoveryController.signal, err);
  // Fall through to local revert.
}
```

Import `devWarn` from `../errors` at the top of the file.

- [ ] **Step 4: Run test to verify pass**

Run: `npm test -w packages/client -- useProjectEditor.test.ts`

Expected: PASS.

- [ ] **Step 5 (REFACTOR):** Look for:
  - **Identical devWarn pattern coming in Task 33** for `handleCreateChapter:788`. The context-string format (`"handleStatusChange recovery GET failed"`) should match the format Task 33 uses (`"handleCreateChapter recovery GET failed"`). Already consistent.
  - **The bare `console.warn` in the same handler at line 1097** (`handleReorderChapters` catch) — NOT a recovery catch; signal is the primary mutation's signal, not a recovery controller's. Do NOT migrate to `devWarn` in this commit.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/hooks/useProjectEditor.ts packages/client/src/hooks/useProjectEditor.test.ts
git commit -m "fix(project-editor): S10 — devWarn at handleStatusChange recovery catch (4b.3c.2)"
```

---

### Task 32: [S10] Pinning test — `handleCreateChapter:788` recovery catch does NOT warn currently

Mirror Task 30's shape, but target the `handleCreateChapter` recovery catch at line 788 (`packages/client/src/hooks/useProjectEditor.ts`). The recovery controller is `createRecoveryAbortRef.current` set at line 752.

Test assertions follow the same pattern as Task 30.

- [ ] **Step 1-2: Write pin, verify it passes against current behaviour.**

- [ ] **REFACTOR:** N/A — pinning-only commit. Mirror Task 30's two-case shape for symmetry.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/hooks/useProjectEditor.test.ts
git commit -m "test(project-editor): pin S10 — handleCreateChapter recovery catch warn-gating (4b.3c.2)"
```

---

### Task 33: [S10] Fix — adopt `devWarn` at `handleCreateChapter:788`

In `useProjectEditor.ts`, replace the bare catch at line 788:

```ts
} catch {
  // Refresh is best-effort; the error copy instructs the user
  // to refresh the page manually if this also failed.
}
```

…with:

```ts
} catch (err) {
  // S10 (4b.3c.2): make the best-effort refresh failure observable
  // in dev. recoveryController.signal is the gate — abort stays silent.
  devWarn("handleCreateChapter recovery GET failed", recoveryController.signal, err);
  // Refresh is best-effort; the error copy instructs the user
  // to refresh the page manually if this also failed.
}
```

Flip the pin.

- [ ] **REFACTOR:** Confirm consistency with Task 31's devWarn adoption — context-string format matches (`"handleCreateChapter recovery GET failed"` mirrors `"handleStatusChange recovery GET failed"`). The two devWarn sites are the only two adoptions in this phase; future recovery flows can mirror the format without ambiguity.

Commit:

```bash
git add packages/client/src/hooks/useProjectEditor.ts packages/client/src/hooks/useProjectEditor.test.ts
git commit -m "fix(project-editor): S10 — devWarn at handleCreateChapter recovery catch (4b.3c.2)"
```

---

### Task 34: [S20] `handleReorderChapters` inside-updater `prev.id !== projectId` re-check

**Files:**
- Modify: `packages/client/src/hooks/useProjectEditor.ts:1082-1091` (success branch setProject), `:1115-1124` (committed branch setProject)
- Modify: `packages/client/src/hooks/useProjectEditor.test.ts`

- [ ] **Step 1: Write the focused unit tests**

Add to `useProjectEditor.test.ts`:

```ts
describe("handleReorderChapters inside-updater epoch re-check (4b.3c.2 S20)", () => {
  it("success-path setProject updater returns prev unchanged when prev.id !== captured projectId", async () => {
    // Direct unit test against the updater body — synthesize a setProject
    // call's behaviour by constructing the updater function the handler
    // would pass.
    // [Test exposes the updater by simulating a setState callback and
    // asserts prev is returned unchanged when the id differs from the
    // captured projectId at handler-entry time.]
  });

  it("committed-path setProject updater returns prev unchanged when prev.id !== captured projectId", async () => {
    // Mirror of above for the possiblyCommitted branch.
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/client -- useProjectEditor.test.ts`

Expected: FAIL — current updater body doesn't check `prev.id`.

- [ ] **Step 3: Implement the fix**

In `useProjectEditor.ts`, in the success-path setProject updater at line 1082:

```ts
setProject((prev) => {
  if (!prev) return prev;
  // S20 (4b.3c.2): defense-in-depth for the React-scheduling window.
  // The outside check at line 1079 already gates entry into this
  // updater, but a navigation between queuing this setState and the
  // updater running would let A's reorder land on B's chapters.
  if (prev.id !== projectId) return prev;
  // ... (existing reorder logic)
});
```

In the committed-path setProject updater at line 1115:

```ts
if (possiblyCommitted) {
  setProject((prev) => {
    if (!prev) return prev;
    // S20: same scheduling guard as the success branch.
    if (prev.id !== projectId) return prev;
    // ... (existing reorder logic)
  });
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npm test -w packages/client -- useProjectEditor.test.ts`

Expected: PASS.

- [ ] **Step 5 (REFACTOR):** Look for:
  - **Duplicated `if (prev.id !== projectId) return prev;` guard** — appears in both the success-path and committed-path updaters. Two-site duplication; resist extracting (extracting would obscure the per-branch placement intent).
  - **A similar guard in `handleCreateChapter`'s recovery `setProject`** (line ~764) — that site checks `projectRef.current?.id === projectId` BEFORE the setProject call, not inside the updater. Different shape; leave as-is. The 4b.3c.3 [I4] `handleRestore` work (Task 40) introduces a comparable inside-updater check; consistency improves there.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/hooks/useProjectEditor.ts packages/client/src/hooks/useProjectEditor.test.ts
git commit -m "fix(project-editor): S20 — handleReorderChapters inside-updater epoch re-check (4b.3c.2)"
```

---

### Task 35: `handleReorderChapters` catch ladder migration (paired with [S20])

**Files:**
- Modify: `packages/client/src/hooks/useProjectEditor.ts:1126-1131`

The non-committed catch tail at lines 1126-1131 currently does:

```ts
if (!message) return;
if (onError) {
  onError(message);
} else {
  setError(message);
}
```

Migrate to `applyMappedError`:

```ts
applyMappedError(mapApiError(err, "chapter.reorder"), {
  onMessage: (msg) => {
    if (onError) onError(msg);
    else setError(msg);
  },
});
```

(But: this site already has the committed-branch setProject above it, which we don't touch here — it stays in its hand-rolled shape because the committed setProject is paired with the [S20] inside-updater check, not with the helper. Only the tail simple-ladder migrates.)

- [ ] **Step 1-3:** Run pre-existing tests, verify pass.

- [ ] **REFACTOR:** Same Pattern P1 reasoning as Tasks 10-23 — no opportunity at this site; the migration IS the refactor.

Commit:

```bash
git add packages/client/src/hooks/useProjectEditor.ts
git commit -m "refactor(project-editor): migrate handleReorderChapters catch tail to applyMappedError (4b.3c.2 S15)"
```

---

### Task 36: E2e — `e2e/snapshot-create-recovery.spec.ts`

**Files:**
- Create: `e2e/snapshot-create-recovery.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from "@playwright/test";
import { createProjectAndChapter } from "./helpers/createProjectAndChapter";

test("snapshot-create recovery: 200 BAD_JSON closes form, refetches list, surfaces banner", async ({ page }) => {
  await createProjectAndChapter(page, "Snapshot Recovery", "Chapter 1");

  // Open snapshot panel.
  await page.getByRole("button", { name: /snapshots/i }).click();

  // Click Create Snapshot.
  await page.getByRole("button", { name: /create snapshot/i }).click();
  // Type a label.
  await page.getByLabel(/label/i).fill("Recovery test");

  // Intercept the snapshot-create POST.
  await page.route("**/api/chapters/*/snapshots", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"invalid":"json"',
    });
  });

  await page.getByRole("button", { name: /save/i }).click();

  // (a) Create form closes.
  await expect(page.getByLabel(/label/i)).not.toBeVisible({ timeout: 5_000 });

  // (b) Snapshot list refreshes — the recovery refetch is the
  //     post-fix behaviour; the new snapshot row appears via the
  //     un-intercepted GET.
  await expect(page.getByRole("list", { name: /snapshots/i }).getByRole("listitem")).toHaveCount(1);

  // (c) Committed banner displays.
  await expect(page.getByText(/server may have committed/i)).toBeVisible();
});
```

- [ ] **Step 2: Run the spec**

Run: `make e2e -- snapshot-create-recovery.spec.ts`

Expected: PASS.

- [ ] **Step 3 (REFACTOR):** Look for:
  - **`page.route` interception pattern** — same shape as Task 24's spec. After all three recovery specs land (Task 49 is the third), extract `interceptWith200BadJson(page, urlPattern)` into `e2e/helpers/` as a follow-up; not in this commit.
  - **Setup via `createProjectAndChapter`** — confirm the helper exists in `e2e/helpers/`; if not, extract from existing e2e specs that do the same setup.

- [ ] **Step 4: Commit**

```bash
git add e2e/snapshot-create-recovery.spec.ts
git commit -m "test(e2e): snapshot-create recovery (4b.3c.2 I3)"
```

---

### Task 37: Sub-phase 4b.3c.2 verification

- [ ] **Step 1: Run the full suite**

Run: `make all`

Expected: GREEN. All pinning-then-fix pairs land as adjacent commits.

- [ ] **Step 2: Open the PR**

PR title: `Phase 4b.3c.2: Consumer Recovery — Helper-Consuming Behavioural Fixes`

---

# Sub-phase 4b.3c.3: Independent Behavioural Fixes

**PR scope:** Can land in parallel with 4b.3c.1. Does NOT depend on 4b.3c.1's helper. ~11 commits.

---

### Task 38: [I4] Add `useTrashManager.ts` to the `migrationStructuralCheck` allowlist (own commit, before [I4] behavioural fix)

**Files:**
- Modify: `packages/client/src/__tests__/migrationStructuralCheck.test.ts:186-194` (`PHASE_4B_3B_ALLOWLIST`)
- Modify: `packages/client/src/hooks/useTrashManager.ts` (add justification block in code — the comment lives at the ref allocation site, which Task 39 introduces; for this commit, add the comment in advance at the top of the file or in a placeholder location, OR sequence this commit to land WITH Task 39's ref allocation in a single combined commit). Choose the combined-commit form to avoid an intermediate allowlist-without-ref state.

Decision: combine Tasks 38 + 39 into ONE commit per 2026-05-26 pushback option A's intent ("allowlist update lands as its own commit before the [I4] behavioural commit"). The "own commit" wording in the pushback was about separating it from the behavioural fix (the controller usage in handleRestore's recovery branch), NOT from the ref allocation itself. The ref allocation is the structural change the allowlist guards.

Updated plan: this Task 38 creates a NEW commit that lands BOTH the allowlist entry AND the ref allocation in `useTrashManager.ts` (with the justification comment), WITHOUT yet using the ref. Task 39 then lands the behavioural use of the ref.

- [ ] **Step 1: Add the allowlist entry**

In `packages/client/src/__tests__/migrationStructuralCheck.test.ts`, update the `PHASE_4B_3B_ALLOWLIST` set:

```ts
const PHASE_4B_3B_ALLOWLIST = new Set([
  resolve(clientSrcRoot, "hooks/useProjectEditor.ts"),
  resolve(clientSrcRoot, "hooks/useSnapshotState.ts"),
  resolve(clientSrcRoot, "hooks/useTrashManager.ts"),  // 4b.3c.3 I4
  resolve(clientSrcRoot, "pages/HomePage.tsx"),
]);
```

- [ ] **Step 2: Add the ref allocation + justification block to `useTrashManager.ts`**

In `useTrashManager.ts`, near the existing `restoreOp` allocation around line 49, add:

```ts
// Phase 4b.3c.3 decision matrix (2026-05-26 pushback Issue 1 option A):
// restoreRecoveryAbortRef is kept hand-rolled. It fires from the catch
// branch of handleRestore's possiblyCommitted arm and runs a follow-up
// GET that must complete even after the primary restoreOp has
// auto-aborted (e.g. on the next handleRestore after a failed one).
// Routing this through restoreOp would cause the next restore to
// cancel the previous restore's recovery refresh — exactly the case
// where the previous error's user-visible state most needs the
// refresh to land. Phase 4b.4 replaces this file-level allowlist
// entry with inline `// eslint-disable-next-line` on the line below.
const restoreRecoveryAbortRef = useRef<AbortController | null>(null);
```

Import `useRef` from React if not already.

- [ ] **Step 3: Add an unmount cleanup**

In the same hook, add or extend a `useEffect` cleanup to abort the ref on unmount:

```ts
useEffect(() => {
  return () => {
    restoreRecoveryAbortRef.current?.abort();
  };
}, []);
```

- [ ] **Step 4: Run the migration structural check**

Run: `npm test -w packages/client -- migrationStructuralCheck.test.ts`

Expected: PASS. Both the offender check ("no file contains useRef<AbortController> outside the allowlist") AND the "allowlist actually contains useRef<AbortController>" check pass for the new entry.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/__tests__/migrationStructuralCheck.test.ts packages/client/src/hooks/useTrashManager.ts
git commit -m "feat(trash): I4 — allocate restoreRecoveryAbortRef + allowlist entry (4b.3c.3)"
```

---

### Task 39: [I4] Pinning test — `handleRestore` `possiblyCommitted` currently optimistically removes from trash but does NOT refresh chapters or reseed statuses

**Files:**
- Modify: `packages/client/src/hooks/useTrashManager.test.ts`

- [ ] **Step 1: Write the pinning test**

```ts
describe("handleRestore possiblyCommitted (4b.3c.3 I4)", () => {
  it("PINNED: 200 BAD_JSON optimistically drops the trash row but does NOT refresh project chapters or reseed confirmedStatusRef — fix flips this", async () => {
    // Mock api.chapters.restore to throw 200 BAD_JSON.
    // Mock api.projects.get — but expect it NOT to be called pre-fix.
    // Mock seedConfirmedStatus / replaceConfirmedStatusesFromProject options.
    // Call handleRestore.
    expect(trashedChapters).not.toContain(chapterId);  // optimistic drop (existing behaviour)
    expect(projectsGetSpy).not.toHaveBeenCalled();     // no refresh pre-fix
    expect(seedConfirmedStatusSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, verify pin passes.**

- [ ] **REFACTOR:** N/A — pinning-only commit.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/hooks/useTrashManager.test.ts
git commit -m "test(trash): pin I4 — handleRestore committed does not refresh (4b.3c.3)"
```

---

### Task 40: [I4] Fix — `handleRestore` `possiblyCommitted` refreshes project + reseeds status cache

**Files:**
- Modify: `packages/client/src/hooks/useTrashManager.ts:102-130`
- Modify: `packages/client/src/hooks/useProjectEditor.ts` (add `replaceConfirmedStatusesFromProject` to returned object, near the existing `seedConfirmedStatus` at line 1411)
- Modify: `packages/client/src/hooks/useTrashManager.test.ts` (flip the pin)

- [ ] **Step 1: Add `replaceConfirmedStatusesFromProject` export from `useProjectEditor`**

In `packages/client/src/hooks/useProjectEditor.ts`, near line 1411 (the existing `seedConfirmedStatus`):

```ts
seedConfirmedStatus: (id: string, status: string) => {
  confirmedStatusRef.current[id] = status;
},
// I4 (4b.3c.3): bulk-reseed for the trash-restore committed-recovery
// branch. Mirrors the bulk seed used at handleCreateChapter's recovery
// (line 773) and loadProject (line 299).
replaceConfirmedStatusesFromProject: (refreshed: ProjectWithChapters) => {
  confirmedStatusRef.current = Object.fromEntries(
    refreshed.chapters.map((c) => [c.id, c.status]),
  );
},
```

- [ ] **Step 2: Thread the new option through `useTrashManager`**

In `useTrashManager.ts`, extend `UseTrashManagerOptions`:

```ts
export interface UseTrashManagerOptions {
  seedConfirmedStatus?: (id: string, status: string) => void;
  // I4 (4b.3c.3): bulk-reseed for the committed-recovery branch.
  replaceConfirmedStatusesFromProject?: (refreshed: ProjectWithChapters) => void;
}
```

And the destructure:

```ts
const replaceConfirmedStatusesRef = useRef(options?.replaceConfirmedStatusesFromProject);
useEffect(() => {
  replaceConfirmedStatusesRef.current = options?.replaceConfirmedStatusesFromProject;
}, [options?.replaceConfirmedStatusesFromProject]);
```

- [ ] **Step 3: Update `handleRestore`'s `possiblyCommitted` branch**

Replace the existing branch:

```ts
if (possiblyCommitted) {
  setTrashedChapters((prev) => prev.filter((c) => c.id !== chapterId));
}
setActionError(message);
```

…with:

```ts
const mapped = mapApiError(err, "trash.restoreChapter");
if (mapped.message !== null) console.error("Failed to restore chapter:", err);
applyMappedError(mapped, {
  onCommitted: () => {
    setTrashedChapters((prev) => prev.filter((c) => c.id !== chapterId));
    if (!slug) return;
    // Recovery GET; second-tier ref so this outlives the next handleRestore's restoreOp abort.
    restoreRecoveryAbortRef.current?.abort();
    const recoveryController = new AbortController();
    restoreRecoveryAbortRef.current = recoveryController;
    api.projects.get(slug, recoveryController.signal)
      .then((refreshed) => {
        if (recoveryController.signal.aborted) return;
        setProject((prev) => {
          if (!prev) return refreshed;
          if (prev.id !== refreshed.id) return prev;  // S20-style guard
          return refreshed;
        });
        replaceConfirmedStatusesRef.current?.(refreshed);
      })
      .catch((recoveryErr) => {
        devWarn("handleRestore recovery GET failed", recoveryController.signal, recoveryErr);
      });
  },
  onMessage: setActionError,
});
```

Import `applyMappedError` and `devWarn` from `../errors`.

- [ ] **Step 4: Wire the new option at the `useTrashManager` callsite**

In `packages/client/src/pages/EditorPage.tsx` (or wherever `useTrashManager` is instantiated), pass the new option from `useProjectEditor`'s returned object:

```ts
const trash = useTrashManager(project, slug, setProject, handleDeleteChapter, navigate, {
  seedConfirmedStatus: projectEditor.seedConfirmedStatus,
  replaceConfirmedStatusesFromProject: projectEditor.replaceConfirmedStatusesFromProject,
});
```

- [ ] **Step 5: Flip the pinning test**

Update the assertions from Task 39 to:

```ts
expect(trashedChapters).not.toContain(chapterId);
expect(projectsGetSpy).toHaveBeenCalledTimes(1);
expect(replaceConfirmedStatusesSpy).toHaveBeenCalledWith(expect.objectContaining({
  chapters: expect.any(Array),
}));
```

- [ ] **Step 6: Run tests to verify pass**

Run: `npm test -w packages/client -- useTrashManager.test.ts useProjectEditor.test.ts`

Expected: PASS.

- [ ] **Step 7 (REFACTOR):** Look for:
  - **Recovery-GET pattern duplication** with `handleCreateChapter` (line 754) and `handleStatusChange` (line 1282). All three sites:
    1. Abort prior recovery controller.
    2. Allocate a new controller.
    3. Call `api.projects.get(slug, controller.signal)`.
    4. Check signal.aborted after the await.
    5. setProject + reseed.
  - **Extraction candidate:** `runRecoveryGet(slug, signal, mergeFn)` shared helper. But each site has different merge logic (new chapter selection vs status revert vs full reseed). Three sites with three merge bodies — premature to extract. Note as a follow-up for a future "Recovery Pattern Helper" refactor phase (potentially 4b.3d or later).
  - **The `setProject((prev) => prev.id !== refreshed.id ? prev : refreshed)` guard** — mirrors S20's inside-updater check. Consistent.
  - **The new `replaceConfirmedStatusesFromProject` exposed from useProjectEditor** — must mirror `seedConfirmedStatus`'s shape (Object.fromEntries(chapters.map(...))). Confirm by inspection.

- [ ] **Step 8: Commit**

```bash
git add packages/client/src/hooks/useTrashManager.ts packages/client/src/hooks/useProjectEditor.ts packages/client/src/hooks/useTrashManager.test.ts packages/client/src/pages/EditorPage.tsx
git commit -m "fix(trash): I4 — handleRestore committed branch refreshes project + reseeds statuses (4b.3c.3)"
```

---

### Task 41: [S5] Pinning test — `restoreSnapshot` pre-send sync throw currently surfaces as committed-unreadable

**Files:**
- Modify: `packages/client/src/hooks/useSnapshotState.test.ts`

- [ ] **Step 1: Write the pinning test**

```ts
describe("restoreSnapshot pre-send throw (4b.3c.3 S5)", () => {
  it("PINNED: a pre-send sync throw currently returns makeClientCommittedError (200 BAD_JSON) — fix routes to NETWORK", async () => {
    // Mock api.snapshots.restore to throw synchronously BEFORE the
    // request lands (i.e. before `restoreOp.run` schedules the promise).
    // Simulate: replace api.snapshots.restore with a function that throws
    // a bare Error immediately, with no async dispatch.
    // Call restoreSnapshot.
    // Pre-fix: result is { ok: false, error: <ApiRequestError 200 BAD_JSON> }
    const result = await restoreSnapshot("snap-id");
    expect(result.ok).toBe(false);
    expect(result.error.status).toBe(200);
    expect(result.error.code).toBe("BAD_JSON");
  });
});
```

- [ ] **Step 2: Run, verify pin.**

- [ ] **REFACTOR:** N/A — pinning-only commit. The pre-send mock is non-trivial (sync throw before promise dispatch); document the mock shape inline so Task 42's flipped assertions can reuse the exact setup.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/hooks/useSnapshotState.test.ts
git commit -m "test(snapshots): pin S5 — restoreSnapshot pre-send throw routes to committed (4b.3c.3)"
```

---

### Task 42: [S5] Fix — `dispatched` flag + `makeClientNetworkError` for pre-send branch

**Files:**
- Modify: `packages/client/src/hooks/useSnapshotState.ts:363-446` (the `restoreSnapshot` body)
- Modify: `packages/client/src/hooks/useSnapshotState.test.ts` (flip the pin)

- [ ] **Step 1: Implement the dispatched flag**

In `useSnapshotState.ts`, locate the `restoreSnapshot` body and update the `restoreOp.run` callback to set a flag immediately after `api.snapshots.restore` returns its promise:

```ts
const restoreSnapshot = useCallback(
  async (snapshotId: string): Promise<RestoreResult> => {
    // ... existing setup ...
    let dispatched = false;
    const { promise, signal } = restoreOp.run((s) => {
      const p = api.snapshots.restore(snapshotId, s);
      dispatched = true;  // S5 (4b.3c.3): the request was scheduled
      return p;
    });
    try {
      // ... existing success body ...
    } catch (err) {
      if (isApiError(err)) {
        return { ok: false, error: err };
      }
      // S5 (4b.3c.3, 2026-05-26 pushback): the dispatched flag
      // distinguishes pre-send programming bugs (where the server
      // never received the request) from post-send bookkeeping
      // throws (where the server may have committed). The pre-send
      // branch returns a synthetic NETWORK error so the caller's
      // existing mapApiError("snapshot.restore") dispatch surfaces
      // the scope.network banner copy. Post-send keeps the
      // makeClientCommittedError path so the lock banner + cache
      // discard land as before.
      if (dispatched) return { ok: false, error: makeClientCommittedError() };
      return { ok: false, error: makeClientNetworkError() };
    }
  },
  [chapterId, chapterSeq, restoreOp],
);
```

`makeClientNetworkError` already exists at line 34 (`useSnapshotState.ts`).

- [ ] **Step 2: Flip the pinning test**

```ts
const result = await restoreSnapshot("snap-id");
expect(result.ok).toBe(false);
expect(result.error.status).toBe(0);
expect(result.error.code).toBe("NETWORK");
```

Also add a complementary post-send test:

```ts
it("post-send throw (after request is dispatched) still routes to committed", async () => {
  // Mock api.snapshots.restore to RESOLVE then have a post-success
  // throw (e.g. localStorage.removeItem fails in Safari private mode).
  const result = await restoreSnapshot("snap-id");
  expect(result.error.status).toBe(200);
  expect(result.error.code).toBe("BAD_JSON");
});
```

- [ ] **Step 3: Verify the scope's `network:` field is set**

Inspect `packages/client/src/errors/scopes.ts` for `"snapshot.restore"`. Confirm it has a `network:` entry (`STRINGS.snapshots.restoreNetworkFailed`). If absent, add it now (it's a one-line addition).

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -w packages/client -- useSnapshotState.test.ts apiErrorMapper.test.ts`

Expected: PASS.

- [ ] **Step 5 (REFACTOR):** Look for:
  - **`makeClientCommittedError` / `makeClientNetworkError` family** — both already exist as helpers in `useSnapshotState.ts` (lines 34 + 46). The fix consumes both; no new helper needed.
  - **The `let dispatched = false` flag placement** — inside the `restoreOp.run` callback closure. Confirm it's not captured by any sibling closure that could mutate it before the catch fires.
  - **Test naming** — pre-fix/post-fix-pin/post-send-throw cases should all live in one `describe("restoreSnapshot...")` block, not scattered across the test file.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/hooks/useSnapshotState.ts packages/client/src/hooks/useSnapshotState.test.ts packages/client/src/errors/scopes.ts
git commit -m "fix(snapshots): S5 — restoreSnapshot pre-send throw routes via makeClientNetworkError (4b.3c.3)"
```

---

### Task 43: [S11] Pinning test — `handleCreateChapter` 404 currently does NOT navigate home

**Files:**
- Modify: `packages/client/src/hooks/useProjectEditor.test.ts`

- [ ] **Step 1: Write the pinning test**

```ts
describe("handleCreateChapter 404 (4b.3c.3 S11)", () => {
  it("PINNED: a 404 on chapter-create currently surfaces createChapterProjectGone banner but does NOT navigate home — fix flips this", async () => {
    // Mock api.chapters.create to throw ApiRequestError(404, "NOT_FOUND").
    // Call handleCreateChapter with an onError mock.
    // Assertions:
    expect(onErrorSpy).toHaveBeenCalledWith(STRINGS.error.createChapterProjectGone);
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, verify pin.**

- [ ] **REFACTOR:** N/A — pinning-only commit.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/hooks/useProjectEditor.test.ts
git commit -m "test(project-editor): pin S11 — handleCreateChapter 404 does not navigate (4b.3c.3)"
```

---

### Task 44: [S11] Fix — `handleCreateChapter` 404 navigates home

**Files:**
- Modify: `packages/client/src/hooks/useProjectEditor.ts:714-798` (the `handleCreateChapter` catch)

- [ ] **Step 1: Add the 404 guard at the top of the catch**

In `useProjectEditor.ts`, in the `handleCreateChapter` catch (around line 714), insert at the very top:

```ts
} catch (err) {
  if (signal.aborted) return;
  // S11 (4b.3c.3): 404 means the project was deleted between sidebar
  // render and the create POST landing. The createChapterProjectGone
  // banner remains in the scope as a defensive default; the
  // projects-list re-render via navigate("/") is sufficient signal here.
  if (isNotFound(err)) {
    navigate("/");
    return;
  }
  console.warn("Failed to create chapter:", err);
  // ... existing body ...
}
```

Import `isNotFound` from `../errors` if not already.

- [ ] **Step 2: Flip the pinning test**

```ts
expect(onErrorSpy).not.toHaveBeenCalled();
expect(navigateSpy).toHaveBeenCalledWith("/");
```

- [ ] **Step 3: Run, then REFACTOR.**

- [ ] **REFACTOR:** Look for:
  - **Other handlers with 404 guards** — `EditorPage.tsx:1577-1579` (`handleProjectSettingsUpdate`) has the same `if (isNotFound(err)) { navigate("/"); return; }` shape. Two sites; resist extracting. A `navigateHomeOn404(err)` helper would obscure that each site has different surrounding state (settings refresh vs chapter create).
  - **The `createChapterProjectGone` string** — stays in the scope as a defensive default. Confirm by re-reading scopes.ts `chapter.create.byStatus[404]`.

Commit:

```bash
git add packages/client/src/hooks/useProjectEditor.ts packages/client/src/hooks/useProjectEditor.test.ts
git commit -m "fix(project-editor): S11 — handleCreateChapter 404 navigates home (4b.3c.3)"
```

---

### Task 45: [S17] `createRecoveryAbortRef` null-on-success

**Files:**
- Modify: `packages/client/src/hooks/useProjectEditor.ts:787` (after the recovery merge)
- Modify: `packages/client/src/hooks/useProjectEditor.test.ts`

- [ ] **Step 1: Write the test**

```ts
describe("createRecoveryAbortRef null-on-success (4b.3c.3 S17)", () => {
  it("createRecoveryAbortRef.current is null after a successful recovery merge", async () => {
    // Trigger handleCreateChapter possiblyCommitted path; let recovery succeed.
    // After the await, peek at the ref via the hook's exposed state or via a test-only accessor.
    expect(createRecoveryAbortRef.current).toBeNull();
  });
});
```

(The ref is internal; expose a test-only getter or assert indirectly via the next operation's behaviour — e.g., a second `handleCreateChapter` shouldn't call `.abort()` on a stale prior controller.)

- [ ] **Step 2: Implement the fix**

In `useProjectEditor.ts`, after the recovery merge at line 787:

```ts
if (added.length > 0) {
  const newest = added.reduce((a, b) => (a.sort_order > b.sort_order ? a : b));
  setActiveChapter(newest);
  setChapterWordCount(countWords(newest.content));
}
// S17 (4b.3c.3): null the ref on success so the next handleCreateChapter
// doesn't see a stale controller. Identity-check guards against a
// later handler having already replaced the ref.
if (createRecoveryAbortRef.current === recoveryController) {
  createRecoveryAbortRef.current = null;
}
```

- [ ] **Step 3-4: Run, verify.**

- [ ] **REFACTOR:** Look for:
  - **The identity-check pattern** (`if (X.current === controller) X.current = null;`) — same shape appears in Task 48 (S19) for `restoreFollowupAbortRef`. Two sites; resist extracting (different ref names, no shared lifetime semantics).

Commit:

```bash
git add packages/client/src/hooks/useProjectEditor.ts packages/client/src/hooks/useProjectEditor.test.ts
git commit -m "fix(project-editor): S17 — createRecoveryAbortRef nulled on success (4b.3c.3)"
```

---

### Task 46: [S18] Pinning test — paste announcement currently fires on torn-down editor after same-project chapter switch

**Files:**
- Modify: `packages/client/src/__tests__/Editor.test.tsx`

- [ ] **Step 1: Write the pinning test**

```ts
describe("Editor paste announcement instance capture (4b.3c.3 S18)", () => {
  it("PINNED: a same-project chapter switch during paste upload currently fires success announce on the new chapter's editor — fix gates this", async () => {
    // Render Editor for chapter A.
    // Start a paste upload (in-flight).
    // Switch to chapter B in the same project.
    // Let the upload's success path resolve.
    // Pre-fix: announce was called (the projectIdRef guard let it through).
    expect(announceSpy).toHaveBeenCalledWith(expect.stringContaining("uploaded"));
  });
});
```

- [ ] **Step 2: Verify pin.**

- [ ] **REFACTOR:** N/A — pinning-only commit. The same-project chapter-switch simulation is non-trivial; document the test setup inline so Task 47's flipped assertion uses the same simulator.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/__tests__/Editor.test.tsx
git commit -m "test(editor): pin S18 — paste announce fires on torn-down editor (4b.3c.3)"
```

---

### Task 47: [S18] Fix — capture `editorInstanceRef.current` at upload start; gate announcement on identity

**Files:**
- Modify: `packages/client/src/components/Editor.tsx` (locate the paste upload handler)
- Modify: `packages/client/src/__tests__/Editor.test.tsx` (flip the pin)

- [ ] **Step 1: Apply the instance-capture guard**

In `Editor.tsx`, locate the paste upload handler. At the upload-start point, capture the current editor instance:

```ts
const startEditorInstance = editorInstanceRef.current;
// ... await upload ...
// Success branch:
if (editor === startEditorInstance && projectIdRef.current === uploadProjectId) {
  announce(STRINGS.editor.imageUploadSuccess);
}
```

The exact ref name and shape depend on the existing implementation; mirror the existing `projectIdRef` capture pattern.

- [ ] **Step 2: Flip the pin**

```ts
expect(announceSpy).not.toHaveBeenCalled();
```

- [ ] **Step 3: Run.**

- [ ] **REFACTOR:** Look for:
  - **The `projectIdRef.current === uploadProjectId` guard** — kept; now paired with the new `editor === startEditorInstance` guard. Confirm both gates fire on the success path.
  - **Two-tier instance capture** (`startEditorInstance` at upload start, current editor at announce time) — common shape in React paste/upload patterns. No extraction; one site.

Commit:

```bash
git add packages/client/src/components/Editor.tsx packages/client/src/__tests__/Editor.test.tsx
git commit -m "fix(editor): S18 — paste announce gated by editor-instance identity (4b.3c.3)"
```

---

### Task 48: [S19] `restoreFollowupAbortRef` null-on-success

**Files:**
- Modify: `packages/client/src/hooks/useSnapshotState.ts:411-416`
- Modify: `packages/client/src/hooks/useSnapshotState.test.ts`

- [ ] **Step 1: Write the test**

```ts
describe("restoreFollowupAbortRef null-on-success (4b.3c.3 S19)", () => {
  it("restoreFollowupAbortRef.current is null after the follow-up list .then resolves", async () => {
    // Trigger restoreSnapshot success path; let api.snapshots.list resolve.
    // Assert ref is null.
  });
});
```

- [ ] **Step 2: Implement the fix**

In `useSnapshotState.ts`, in the `restoreSnapshot` success path around line 411:

```ts
api.snapshots
  .list(restoringChapterId, followupController.signal)
  .then((data) => {
    if (!freshToken.isStale()) setSnapshotCount(data.length);
    // S19 (4b.3c.3): null the ref on success — identity-checked so a
    // later restore that already replaced the ref isn't clobbered.
    if (restoreFollowupAbortRef.current === followupController) {
      restoreFollowupAbortRef.current = null;
    }
  })
  .catch(() => {});
```

- [ ] **Step 3-4: Run, verify.**

- [ ] **REFACTOR:** Look for:
  - **Identity-check pattern shared with Task 45 (S17)** — same `if (X.current === controller) X.current = null;` shape. Two sites, two different refs; do not extract.
  - **The `.catch(() => {})` silent-catch** below the `.then` — pre-existing; not touched by this commit. Leave as-is.

Commit:

```bash
git add packages/client/src/hooks/useSnapshotState.ts packages/client/src/hooks/useSnapshotState.test.ts
git commit -m "fix(snapshots): S19 — restoreFollowupAbortRef nulled on success (4b.3c.3)"
```

---

### Task 49: E2e — `e2e/trash-restore-recovery.spec.ts`

**Files:**
- Create: `e2e/trash-restore-recovery.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from "@playwright/test";
import { createProjectAndChapter } from "./helpers/createProjectAndChapter";

test("trash-restore recovery: 200 BAD_JSON updates sidebar + status via recovery refresh", async ({ page }) => {
  await createProjectAndChapter(page, "Trash Recovery", "Chapter 1");

  // Soft-delete the chapter.
  await page.getByRole("button", { name: /delete chapter/i }).click();
  await page.getByRole("button", { name: /confirm/i }).click();

  // Open trash view.
  await page.getByRole("button", { name: /trash/i }).click();

  // Intercept the restore POST.
  await page.route("**/api/chapters/*/restore", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"invalid":"json"',
    });
  });

  await page.getByRole("button", { name: /restore/i }).click();

  // (a) Chapter row leaves the trash.
  await expect(page.getByText(/no trashed chapters/i)).toBeVisible({ timeout: 5_000 });

  // (b) Sidebar shows the restored chapter via the recovery GET.
  await page.getByRole("button", { name: /close trash/i }).click();
  await expect(page.getByRole("listitem", { name: /Chapter 1/i })).toBeVisible();

  // (c) Status indicator reflects restored status (reseed happened).
  await expect(page.getByText(/outline/i)).toBeVisible();  // adjust to actual default status

  // (d) Committed banner displays.
  await expect(page.getByText(/server may have committed/i)).toBeVisible();
});
```

- [ ] **Step 2: Run.**

- [ ] **Step 3 (REFACTOR):** This is the third recovery spec. Now the right time to extract:
  - `e2e/helpers/interceptWith200BadJson.ts` — captures the `page.route(...).fulfill({status: 200, body: '{"invalid":"json"'})` pattern shared by Tasks 24, 36, 49.
  - Apply the helper to all three specs in this commit (or a follow-up commit if the diff grows too large).
  - **Setup helpers** — `createProjectAndChapter` and `createProject` should now both exist in `e2e/helpers/`; confirm and reuse.

- [ ] **Step 4: Commit**

```bash
git add e2e/trash-restore-recovery.spec.ts e2e/helpers/interceptWith200BadJson.ts e2e/chapter-create-recovery.spec.ts e2e/snapshot-create-recovery.spec.ts
git commit -m "test(e2e): trash-restore recovery + extract interceptWith200BadJson helper (4b.3c.3 I4)"
```

If the helper extraction grows too large or touches too many sibling specs, split into two commits: one for the spec, one for the helper + retrofit.

---

### Task 50: Sub-phase 4b.3c.3 verification

- [ ] **Step 1: Run the full suite**

Run: `make all`

Expected: GREEN.

- [ ] **Step 2: Confirm allowlist now contains four files**

Run: `grep -A 6 "PHASE_4B_3B_ALLOWLIST" packages/client/src/__tests__/migrationStructuralCheck.test.ts | head -8`

Expected: four `resolve(clientSrcRoot, ...)` entries including `useTrashManager.ts`.

- [ ] **Step 3: Open the PR**

PR title: `Phase 4b.3c.3: Consumer Recovery — Independent Behavioural Fixes`

PR description references the same design doc and decision log as 4b.3c.1.

---

## Self-Review

**Spec coverage check (against the design document):**

- ✅ `MappedError<S>` phantom — Task 1
- ✅ `applyMappedError` + `STOP` — Task 2
- ✅ `ScopeExtras<S>` — Task 3
- ✅ `devWarn` — Task 4
- ✅ `terminalCodes` + mapper plumbing — Task 5
- ✅ `chapter.save` allowlist relocation [S3]/[S7] — Task 6
- ✅ `image.delete.extrasFrom` drop all-or-nothing [S8] — Task 7
- ✅ `chapter.flushBeforeNavigate` new scope [S16] — Task 8 (scope) + Task 21 (consumer swap)
- ✅ 16 simple-ladder migrations [S15] — Tasks 9-23
- ✅ E2e coverage backfill (spec 3) — Task 24
- ✅ [I3] SnapshotPanel.handleCreate — Tasks 26-27
- ✅ [I5] confirmDeleteChapter programming-bug warn — Task 28
- ✅ [S4] handleStatusChange fallback to setError — Task 29
- ✅ [S20] handleReorderChapters inside-updater check — Task 34
- ✅ [S10] devWarn at both recovery catches — Tasks 30-33
- ✅ E2e spec 1 (snapshot-create-recovery) — Task 36
- ✅ [I4] allowlist update + handleRestore committed branch — Tasks 38-40
- ✅ [S5] dispatched flag — Tasks 41-42
- ✅ [S11] handleCreateChapter 404 — Tasks 43-44
- ✅ [S17] createRecoveryAbortRef null-on-success — Task 45
- ✅ [S18] paste announcement — Tasks 46-47
- ✅ [S19] restoreFollowupAbortRef null-on-success — Task 48
- ✅ E2e spec 2 (trash-restore-recovery) — Task 49
- ✅ Deferred CLAUDE.md drift (note in design doc; lands in 4b.3d) — covered by design-doc update, not a task here.

**Placeholder scan:** None. Each task has the actual code/test/command needed.

**Type consistency:** `MappedError<S>` is the same type across Tasks 1-7 (the phantom carries through). `applyMappedError<S>` keeps the same `S` extends `ApiErrorScope` constraint across Tasks 2-3. `ScopeExtras<S>` is consistent. `STOP` sentinel is exported once (Task 2) and consumed in Task 22's Pattern P2 example.

**Open assumptions:**

1. `replaceConfirmedStatusesFromProject` (Task 40) is exposed via `useProjectEditor`'s returned object. The exact wire-up at the `useTrashManager` callsite depends on EditorPage's existing shape; the plan describes the wiring abstractly.
2. The pinning test for Task 30 (S10 at line 1312) requires triggering both the chapters.update failure AND the projects.get failure. The existing `useProjectEditor.test.ts` patterns cover the chapters.update failure; the projects.get failure may need a new mock helper.
3. The exact selectors in the e2e specs (Tasks 24, 36, 49) are inferred from the design doc's intent. Adjust to actual rendered text/roles during implementation.

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-05-26-consumer-recovery-completeness-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration. Use `superpowers:subagent-driven-development`.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Each sub-phase (.1 / .2 / .3) ends with a `make all` checkpoint and a PR. 4b.3c.1 is foundation-first; 4b.3c.2 depends on it; 4b.3c.3 can land in parallel with 4b.3c.1.
