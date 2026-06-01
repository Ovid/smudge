# Phase 4b.13 — TipTap Depth-Guard Regression Test (Design)

**Date:** 2026-06-01
**Phase:** 4b.13 (roadmap `docs/roadmap.md`)
**Author:** Ovid / Claude (collaborative)
**Status:** Design approved; pending implementation plan
**Type:** Test-only. No production-code change.

## Goal

Add **one consolidated regression test** that pins the cross-cutting contract:
every consumer of TipTap JSON honors `MAX_TIPTAP_DEPTH = 64` and bails safely on
an over-depth structure. The constant is shared (`packages/shared/src/tiptap-safety.ts`),
but each walker implements its own depth-counted recursion, and there is no single
test that exercises all of them together. This phase adds that test.

The six walkers (verified against HEAD):

| # | Walker | Source file | Exported? |
|---|--------|-------------|-----------|
| 1 | `validateTipTapDepth` | `packages/shared/src/tiptap-safety.ts` | **yes** (public) |
| 2 | `extractText` | `packages/shared/src/wordcount.ts` | no (private) |
| 3 | `canonicalize` | `packages/server/src/snapshots/content-hash.ts` | no (private) |
| 4 | `walk` | `packages/server/src/images/images.references.ts` | no (nested fn) |
| 5 | `collectLeafBlocks` | `packages/shared/src/tiptap-text.ts` | no (private) |
| 6 | `canonicalJSON` | `packages/shared/src/tiptap-text.ts` | no (private) |

> **Spec correction:** roadmap §4b.13 says `validateTipTapDepth` lives in
> `tiptap-depth.ts`. The actual source is `tiptap-safety.ts`; `dist/tiptap-depth.d.ts`
> is stale build output. The test imports from `@smudge/shared` (which re-exports it),
> so this does not affect the test, but the design records the correct location.

## Key decisions

### Decision 1 — Reach private walkers through public entry points (no production change)

Five of the six walkers are private. Rather than add test-only exports (a
production-file change, even if precedented by `__resetWarnedFallbackDigestsForTests`),
the test drives each walker through its **public entry point**. This honors the DoD's
"No production-code change" and tests the contract that actually ships.

Trade-off accepted: the test asserts *publicly observable* behavior, which is
sometimes a transformed version of the walker's internal bail (e.g. `canonicalize`
throws internally but the wrapper catches it). A refactor that preserved public
behavior while breaking an internal cap could in principle slip through; this is an
accepted weakness of the public-entry approach. It is mitigated by choosing each
walker's assertion to be **discriminating** — to flip when that walker's depth bail is
removed (see the assertions table and the "if cap removed" negative controls).

### Decision 2 — Single test file in `packages/server`

`packages/shared` must not import `packages/server` (dependency direction + the client
also imports shared). Four public entries live in shared, two in server. Only the
server package can see all six, so the consolidated test lives at:

```
packages/server/src/__tests__/tiptap-depth-walkers.test.ts
```

Trade-off accepted: the server suite tests four functions that live in shared (mild
layering oddity), and those four are not covered by `npm test -w packages/shared`
(`make test` runs everything). This is the cost of the phase's explicit goal — ONE
contract test with ONE walker-registration header.

### Decision 3 — Boundary (cap-activation) cases only; no pathologically-deep case

At depth 65, nothing stack-overflows (65 frames is trivial). What an over-cap fixture
actually tests is that the cap **activates at the documented boundary** — the bail
behavior is what flips if a future edit removes a walker's `if (depth > MAX_TIPTAP_DEPTH)`
line. That deletion *is* the regression we want to catch, and the boundary assertions
catch it directly.

A pathologically-deep "true overflow" case (an earlier draft proposed ~20,000 levels)
was **rejected during pushback** as not cleanly realizable through the public entries:

- V8's `JSON.parse`/`JSON.stringify` are themselves recursive and overflow at roughly
  the same depth an *uncapped* walker would, so there is no window where "uncapped walker
  overflows but the test's own JSON ops survive."
- `canonicalContentHash` wraps `JSON.parse` + `canonicalize` in a single bare `catch`,
  so on a very deep input `JSON.parse` overflows first → caught → raw-bytes fallback
  with `reason:"parse"`; canonicalize's cap never runs and the function does not throw
  either way. The capped/uncapped difference is invisible for that walker.

So the deep case mostly exercises `JSON.parse`, not the walkers, and is murkiest for the
one walker whose wrapper hides it. We drop it.

To avoid implying that only the single boundary node is covered, the tree fixtures nest
**modestly past the cap** (depth ~100), which is trivially safe for JSON ops while still
firmly exceeding every tree walker's depth-64 limit.

## Fixtures (defined in the test file)

1. **`deepDoc(depth, payload?, containerType?)`** — a linear TipTap tree nested `depth`
   content-levels, with an optional `payload` placed at the deepest level (a `text`
   node, or an `image` node with `attrs.src = "/api/images/<uuid>"`) so the over-depth
   bail visibly drops it.
   - **Container-type constraint (pushback Issue 3):** `collectLeafBlocks` returns
     `[node]` the moment it hits a node in `LEAF_BLOCKS = {paragraph, heading,
     codeBlock}` — *before* recursing. So for the `searchInDoc`/`collectLeafBlocks`
     case the nesting levels must use **container** (non-leaf) node types (e.g.
     `blockquote`, `listItem`/`bulletList`), with the single matchable `paragraph`
     placed only at the deepest level — otherwise the walker returns a shallow leaf and
     never reaches the cap. Exact container types are verified against the TipTap schema
     in the RED phase. (For the other tree walkers the intermediate node type is
     immaterial, but using a container type uniformly keeps one builder.)
2. **`paragraphWithTwoMarksDifferingBelowCap(depth)`** (pushback Issue 1) — a paragraph
   containing **two adjacent** text nodes `"a"`, `"a"`, each carrying a mark whose
   `attrs` are **identical for levels 1–64 but differ at level `depth` (65+)**.
   `canonicalJSON`'s depth axis is mark-attribute nesting (it only ever receives a
   `Mark[]`), **not** the document tree, so a doc-only fixture can never reach it.
   Driven via `replaceInDoc(…, "a", "b")` → `cleanupTextNodes` → `marksEqual` →
   `canonicalJSON`. A *single uniform* mark would merge whether or not the cap exists
   (non-discriminating); two marks that diverge only below the cap give a signal that
   flips when the cap is removed (see assertions).

Exact boundary depths are re-verified per walker during the RED phase, because the
walkers count differently (pushback Issue 4): the tree walkers increment once per
content-nesting level; `canonicalize` increments on **both** object and array levels
(~2× per visual level, capping at ~32 visual levels); `canonicalJSON` counts
mark-attribute nesting. A shared visual depth of ~100 sits **past** every tree walker's
boundary (activating all their caps); each walker's discriminating signal is asserted
through its own entry point.

## Walker-by-walker assertions (boundary / cap-activation)

Each assertion is chosen to **flip if that walker's depth bail is removed** (the
regression). The "if cap removed" column documents the negative control.

| Walker | Public entry | Assertion (cap present) | If cap removed |
|--------|--------------|-------------------------|----------------|
| `validateTipTapDepth` | `validateTipTapDepth(deepDoc)` | `=== false` | `=== true` |
| `extractText` | `countWords(deepDoc(text-at-leaf))` | `=== 0` (deep text dropped) | `>= 1` |
| `walk` | `extractImageIds(deepDoc(image-at-leaf))` | `=== []` (deep image dropped) | `[<uuid>]` |
| `canonicalize` | `canonicalContentHash(deepJsonString)` | returns 64-char hex **and** emits the `reason:"depth"` fallback warn (hash equals raw-bytes digest) | no warn; canonical hash |
| `collectLeafBlocks` | `searchInDoc(deepDoc(container-nested, matchable paragraph at leaf), "x")` | `=== []` (deep leaf block dropped) | `[<match>]` |
| `canonicalJSON` | `replaceInDoc(paragraphWithTwoMarksDifferingBelowCap, "a", "b")` | the two replacement nodes **merge** → output paragraph has **one** text node `"bb"` | marks differ below cap → no merge → **two** text nodes |

For the `canonicalize` deep JSON string: build it by **string concatenation** (not
`JSON.stringify` of a deep object) so the test setup cannot itself overflow, and keep
the depth comfortably below `JSON.parse`'s limit (so `JSON.parse` succeeds and
`canonicalize` — not the parser — is what bails).

## Handling the `canonicalContentHash` warning

The depth fallback path in `canonicalContentHash` calls `logger.warn` (pino) with
`reason: "depth"`. The test:

- spies on the server `logger` to assert the `depth`-reason warn fired (positive
  evidence the cap activated) and to keep suite output clean;
- calls `__resetWarnedFallbackDigestsForTests()` (already exported from
  `content-hash.ts`) in setup so the once-per-digest dedupe cannot suppress the
  assertion across tests.

## Test-file header (the registration discipline)

A header comment in the test states, in substance:

> Any new TipTap-JSON walker must (1) import `MAX_TIPTAP_DEPTH` from `@smudge/shared`
> and implement a `depth > MAX_TIPTAP_DEPTH` bail, and (2) be added to this regression
> via its public entry point. A **seventh** walker triggers the
> extract-a-generic-walker re-evaluation deferred in dedup report I5
> (`paad/duplicate-code-reports/ovid-experimental-dedup-2026-04-28-08-02-18-093074c.md`).

## Out of scope

- Extracting a generic walker (deferred until a seventh consumer appears).
- Changing any of the six walkers' implementations or bail behaviors.
- Lint/automation enforcing the header discipline (consider only if a seventh walker
  arrives without joining the test).

## Definition of Done

- A test at `packages/server/src/__tests__/tiptap-depth-walkers.test.ts` that fails if
  any of the six walkers fails to bail at the over-cap boundary — i.e. the test flips to
  red if any walker's `if (depth > MAX_TIPTAP_DEPTH)` line is removed or broken.
- One discriminating cap-activation assertion per walker, per the table above (each with
  a documented negative control — the "if cap removed" behavior).
- No pathologically-deep fixture (rejected in pushback — see Decision 3).
- Test-file header documents the "new walker → add here" rule.
- `make all` green at PR close.
- No production-code change (no new exports, no walker edits).

## Dependencies

None. Test-only. May land in any order relative to other 4b.x phases.

## CLAUDE.md impact

None. Test-only phase; introduces no new invariant, API surface, data-model change,
or top-level structure. The walker-registration discipline is documented in the test
header by design, not at the repository-root level.
