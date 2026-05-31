# Phase 4b.10 — Shared TipTap Unsafe-Keys Set — Design

**Date:** 2026-05-31
**Author:** Ovid / Claude (collaborative)
**Roadmap phase:** 4b.10 — Shared TipTap Unsafe-Keys Set
**Status:** Design — approved, pending plan

---

## Goal

Eliminate the duplicate prototype-pollution strip-set that is declared
twice today:

- `packages/shared/src/tiptap-text.ts` — `CANONICAL_UNSAFE_KEYS`
  (`new Set(["__proto__", "prototype", "constructor"])`, line 496), used by
  `canonicalJSON()` to drop unsafe keys when comparing marks.
- `packages/server/src/snapshots/content-hash.ts` — `UNSAFE_KEYS`
  (byte-identical set, line 26), used by `canonicalize()` to drop unsafe keys
  before hashing snapshot content.

Both declarations describe the same defense against a crafted
`{"__proto__": {...}}` attrs value poisoning TipTap canonicalization. Nothing
enforces that they stay in agreement; a future change (e.g. adding
`__defineGetter__` to the set) would have to land in both files by hand. This
phase makes the set a single shared declaration that both consumers import.

Reference: `paad/duplicate-code-reports/ovid-experimental-dedup-2026-04-28-08-02-18-093074c.md`
finding I4.

## Why this phase is narrow

The two _canonicalization functions_ cannot be unified yet: `tiptap-text.ts`'s
`canonicalJSON()` returns a `string`, while `content-hash.ts`'s `canonicalize()`
returns an object. That return-type mismatch blocks a unified `canonicalize()`
helper and is explicitly **out of scope** here. Only the unsafe-key set — which
is trivially shareable — is consolidated in this phase.

## Decision: home for the shared constant

The constant lives in `packages/shared/src/`, in the existing zero-dependency
TipTap safety module, which is **renamed** to reflect its broadened contents:

- `git mv packages/shared/src/tiptap-depth.ts packages/shared/src/tiptap-safety.ts`

### Why this home (not a new `canonicalize.ts`, not `constants.ts`)

`tiptap-depth.ts` already holds the project's two adversarial-input guards for
TipTap JSON:

- `MAX_TIPTAP_DEPTH` — the recursion depth cap that protects every walker
  (`countWords`, `tiptap-text`, `canonicalize`, `validateTipTapDepth`) from a
  stack-overflow via pathologically nested `{ content: [ { content: [...] } ] }`.
- `validateTipTapDepth()` — the structural depth validator.

`CANONICAL_UNSAFE_KEYS` is the third member of that same family: a guard against
adversarial/malformed TipTap JSON (prototype-pollution keys rather than nesting
depth). Co-locating all three is the most discoverable home.

- A **new `canonicalize.ts`** (the roadmap's original suggestion) was rejected
  as premature: it would be a whole file for one 3-element `Set`, and its
  justification — "a home for the eventual unified canonicalizer" — is for code
  that does not exist yet and is explicitly out of scope (YAGNI).
- **`constants.ts`** was rejected because it is a cross-package grab-bag
  (`UNTITLED_CHAPTER`, retention windows, error-code sets); the
  canonicalization-safety intent would be less discoverable there.

### Why the rename to `tiptap-safety.ts`

The current name (`tiptap-depth`) describes only one of the file's concerns. The
unifying theme across all three members is "structural-safety limits for
adversarial/malformed TipTap JSON," so `tiptap-safety.ts` fits all three.
`tiptap-canonicalize-safety.ts` was considered and rejected: `validateTipTapDepth`
is a write-path/schema guard, not a canonicalization concern, so a
"canonicalize-safety" label would mis-describe it.

The module **stays deliberately zero-dependency** — a `Set` literal pulls in no
Zod — preserving the property that the `countWords` import path does not drag in
the schema graph. The file header comment is updated from "the TipTap depth cap
and its structural validator" to describe the broader "TipTap structural-safety
limits."

## The shared constant

```ts
/**
 * Keys that would mutate an object's prototype chain when assigned via
 * bracket access. TipTapDocSchema uses .passthrough(), so content read from
 * the DB can legitimately carry any key — canonicalization paths strip these
 * so a crafted `{"__proto__": {...}}` attrs value cannot poison the result.
 *
 * Shared by tiptap-text.ts (canonicalJSON, marks comparison) and
 * content-hash.ts (canonicalize, snapshot hashing) so the two defenses
 * cannot drift apart.
 */
export const CANONICAL_UNSAFE_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);
```

Typed `ReadonlySet<string>`: a runtime-free, compile-time hardening that matters
specifically because a single `Set` instance is now imported by two modules. It
forbids `.add`/`.delete` so one consumer cannot mutate the set out from under the
other. Both call sites use only `.has()`, which `ReadonlySet` permits.

The explanatory doc-comment currently sitting above `content-hash.ts`'s
`UNSAFE_KEYS` is consolidated onto this shared declaration (above text is the
merged version of both files' rationale).

## Consumer migration

### `packages/shared/src/index.ts` (barrel)

Add a **direct** export of `CANONICAL_UNSAFE_KEYS` from `./tiptap-safety`:

```ts
export { CANONICAL_UNSAFE_KEYS } from "./tiptap-safety";
```

`MAX_TIPTAP_DEPTH` and `validateTipTapDepth` currently flow out via the
`./schemas` re-export; the new constant is **not** routed through `./schemas`.
`schemas.ts` has no reason to consume `CANONICAL_UNSAFE_KEYS`, and re-exporting it
there would couple the lean, zero-dependency constant to the Zod module's
re-export surface — partly defeating the reason the safety module is kept
Zod-free. The constant's public path therefore sits with its real source. This
leaves `index.ts` feeding TipTap-safety symbols from two sources (`./schemas` for
the depth pair, `./tiptap-safety` for the key set); moving the depth pair's barrel
export to match is deliberately **out of scope** (it would touch a working export
path for a cosmetic win).

### `packages/shared/src/tiptap-text.ts`

- Update the import path `./tiptap-depth` → `./tiptap-safety` (the existing
  `import { MAX_TIPTAP_DEPTH as MAX_WALK_DEPTH }`).
- Add `CANONICAL_UNSAFE_KEYS` to that import.
- Delete the local `const CANONICAL_UNSAFE_KEYS = new Set([...])` (line 496).
- `canonicalJSON()` is otherwise unchanged — the name it references is identical.

### `packages/server/src/snapshots/content-hash.ts`

- Add `CANONICAL_UNSAFE_KEYS` to the existing `@smudge/shared` import.
- Delete the local `const UNSAFE_KEYS = new Set([...])` (line 26).
- Update the single `.filter(([k]) => !UNSAFE_KEYS.has(k))` use (line 33) to
  `CANONICAL_UNSAFE_KEYS`.
- The standalone rationale doc-comment that was above `UNSAFE_KEYS` is removed
  here (it now lives on the shared declaration). The `canonicalize()` function
  docstring is unaffected.

### `packages/shared/src/schemas.ts` and `packages/shared/src/wordcount.ts`

- Update the relative import path `./tiptap-depth` → `./tiptap-safety`. No other
  change (these import `MAX_TIPTAP_DEPTH` / `validateTipTapDepth` only).

### Rename blast radius (verified)

Only three relative importers reference the file (`schemas.ts`, `tiptap-text.ts`,
`wordcount.ts`); all external consumers reach `MAX_TIPTAP_DEPTH` /
`validateTipTapDepth` through the `@smudge/shared` barrel, so the rename does not
touch server or client code. There is no `tiptap-depth.test.ts` to rename (the
module's coverage rides through `schemas.test.ts`, `wordcount.test.ts`, and
`tiptap-text.test.ts`). `dist/` artifacts regenerate on build.

## Testing — red / green / refactor

The unsafe-key stripping behavior — the prototype-pollution defense this phase
exists to consolidate — is currently **untested** in both consumers: a grep for
`__proto__`/`prototype`/`poison` finds nothing in `tiptap-text.test.ts` or
`content-hash.test.ts`. Rather than ship a tautological constant-mirror test
(which CLAUDE.md's testing philosophy warns against), this phase closes that gap
with a behavioral test on the code it already touches.

**RED — two tests:**

1. **Export wiring (minimal), shared.** Add
   `packages/shared/src/__tests__/tiptap-safety.test.ts` (mirroring the
   `constants.test.ts` convention) asserting `CANONICAL_UNSAFE_KEYS` is importable
   from the `@smudge/shared` barrel and carries the three expected keys. This is a
   deliberately small wiring/contract anchor, not the primary value — it proves
   the new barrel export exists and fails before the constant is added.
2. **Behavioral (primary), server.** Add a case to
   `packages/server/src/__tests__/content-hash.test.ts` asserting that
   `canonicalContentHash` strips unsafe keys: a TipTap doc whose marks/attrs
   carry a crafted `__proto__` (and `constructor`) entry must hash **identically**
   to the same doc without those entries — proving the key does not contribute to
   the hash and cannot poison the scratch object. This exercises the real defense
   and fails today only in the sense that it locks behavior the refactor must
   preserve; it is written against the existing `canonicalize` path so it is green
   on current code and stays green after the migration (guarding against a
   regression in the strip).

**GREEN.** Create the constant in the renamed module and add the direct barrel
export so test (1) passes.

**REFACTOR.** Migrate both consumers to import the shared constant and delete the
two local declarations. Behavior is unchanged, so the existing consumer tests —
plus the new behavioral test — remain the regression net:

- `packages/shared/src/tiptap-text.test.ts` — exercises `canonicalJSON` / marks
  comparison (the `tiptap-text.ts` strip is reached only through the internal
  `canonicalJSON`; its existing tests stay green, and the server-side behavioral
  test above directly covers the equivalent strip on the canonicalize path).
- `packages/server/src/__tests__/content-hash.test.ts` and
  `snapshots.repository.test.ts` — exercise `canonicalContentHash` (and through it
  `canonicalize` / the unsafe-key strip).

The structural guarantee that the two defenses cannot drift is provided by the
fact that both now import the **same symbol** — a compile-time invariant stronger
than any runtime cross-check.

## Definition of Done

- One declaration of the unsafe-key set, in `packages/shared/src/tiptap-safety.ts`.
- Both `tiptap-text.ts` and `content-hash.ts` import it; no local copies remain.
- `CANONICAL_UNSAFE_KEYS` exported **directly** from the `@smudge/shared` barrel
  (via `./tiptap-safety`, not `./schemas`), with a minimal export-wiring test.
- A behavioral test in `content-hash.test.ts` proving `canonicalContentHash`
  strips unsafe keys (closes the previously-untested prototype-pollution defense).
- The three relative importers point at `./tiptap-safety`.
- Existing tests in `tiptap-text.test.ts` and `content-hash.test.ts` (via
  `snapshots.repository.test.ts`) still green.
- `make all` green at PR close.
- No behavior change visible to the user.

## Out of Scope

- Extracting a unified `canonicalize()` function (blocked by the string-vs-object
  return-type mismatch; future work).
- Changing the membership of the unsafe-key set itself.
- Any production-code change to the depth guard or the depth-guarded walkers
  (Phase 4b.13 is the test-only phase that adds a regression test against the
  existing walkers; it does not own the guard).

## CLAUDE.md impact

None required. The change introduces no new invariant, endpoint, error code,
table, test layer, or top-level folder. The renamed module and shared constant
are internal to `packages/shared/` and below the altitude CLAUDE.md documents.
(See the CLAUDE.md review step in the /roadmap run for the explicit check.)

## Dependencies

None. Independently shippable.
