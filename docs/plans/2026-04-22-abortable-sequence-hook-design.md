# Phase 4b.2: Abortable Sequence Hook — Design

**Date:** 2026-04-22
**Phase:** 4b.2 (from `docs/roadmap.md`)
**Status:** Brainstormed, awaiting pushback review
**Author:** Ovid / Claude (collaborative)

---

## Goal

Replace the ad-hoc sequence refs scattered across the client (`saveSeqRef`, `selectChapterSeqRef`, `searchSeqRef`, `viewSeqRef`, `statusChangeSeqRef`, plus the chapter-seq in `SnapshotPanel`) with a single reusable primitive that makes the "discard stale response" contract explicit.

Each existing seq-ref is individually correct. Their interactions are not: staleness is implicit in a local `!==` comparison against a freestanding ref, reviewers must verify the ref is bumped before the request (CLAUDE.md §Save-Pipeline Invariants rule 4), and every new flow that needs staleness is one more variant of the same shape. This is how stale-closure bugs kept slipping through Phase 4b review. The primitive turns the invariant into code — callers receive a token whose `isStale()` cannot be wrong about *which* sequence it belongs to, and the primitive's tested contract covers the cases (new-start, bump-to-abort, capture-for-cross-axis, unmount) that hand-rolled refs have to re-derive each time.

This is a pure refactor: no user-visible behavior change.

## Non-goals

- Changes to abort-signal propagation on `fetch` calls. Staleness and network cancellation are different concerns. The primitive *discards* responses; it does not cancel the HTTP round-trip.
- Server-side sequencing.
- Extending `useEditorMutation`'s `inFlightRef` (a concurrency guard — "one mutation at a time"). Different semantics; no merger.
- A generic cancellable-promise primitive. No caller needs it.
- Raw-strings or other ESLint rules outside the sequence-ref pattern (Phase 4b.4's territory).

## Architecture overview

One new hook, `useAbortableSequence`, in `packages/client/src/hooks/useAbortableSequence.ts`. It owns a `useRef<number>(0)` internally and exposes three methods plus a token type:

```ts
export type SequenceToken = {
  isStale(): boolean;
};

export type AbortableSequence = {
  start(): SequenceToken;
  capture(): SequenceToken;
  abort(): void;
};

export function useAbortableSequence(): AbortableSequence;
```

**Semantics:**

- `start()` — bumps the internal counter, returns a token whose captured epoch equals the new counter value. Replaces the dominant pattern `const seq = ++seqRef.current; ... if (seq !== seqRef.current) return;`.
- `capture()` — reads the counter without bumping, returns a token bound to the current epoch. Enables cross-axis dependency checks (a snapshot *view* depends on the chapter epoch but must not invalidate it) without the ambiguity of "which ref does this local number belong to?"
- `abort()` — bumps the counter, returns `void`. All outstanding tokens become stale. Covers both the bump-to-cancel idiom (project change resetting search) and the explicit unmount-cleanup idiom (the `useProjectEditor` unmount effect).
- **Auto-abort on unmount.** The hook tracks mount state via an internal `mountedRef` flipped to `false` in the unmount cleanup effect, and `token.isStale()` returns `true` whenever the component is unmounted — regardless of whether the token was minted before or after unmount. This closes both the "forgot to bump on unmount" foot-gun (the class of bug that motivated `useProjectEditor.test.ts:1417-1422`) AND the post-unmount re-entry foot-gun (a handler that calls `start()` after an `await` whose component has since unmounted — any downstream `setState` gated on `!token.isStale()` becomes a no-op).

**Token identity is closure-based.** A token holds a reference to *its* counter ref and *its* captured epoch. There is no API by which a token from sequence A can be checked against sequence B, so no type branding is needed — the shape makes cross-sequence misuse unrepresentable.

**Return-value stability.** The returned `AbortableSequence` object is stable across renders — its `start`, `capture`, and `abort` methods have stable identities (internal `useCallback` over a ref-backed counter; the outer object `useMemo`-wrapped). Consumers can put `seq.abort` in a `useEffect` dependency array without provoking re-runs every render, and can wrap cancel helpers (`cancelInFlightSave`, `cancelInFlightSelect`) with `useCallback` that lists only the hook's return values without tripping `react-hooks/exhaustive-deps`. This matches the motivation already documented for the existing `cancelInFlightSelect` wrapper at `useProjectEditor.ts:105-113`.

Each `useAbortableSequence()` call is an independent axis. Nested sequences (e.g. snapshot's chapter + view) are modeled as two hook calls with two tokens per request.

## Consumer migration map

Four call sites, two patterns, one common cleanup path.

| File | Current seq-refs | Becomes |
|------|------------------|---------|
| `useFindReplaceState.ts` | `searchSeqRef` | `searchSeq = useAbortableSequence()` |
| `useSnapshotState.ts` | `chapterSeqRef`, `viewSeqRef` | `chapterSeq`, `viewSeq` |
| `useProjectEditor.ts` | `selectChapterSeqRef`, `saveSeqRef`, `statusChangeSeqRef` | three `useAbortableSequence()` |
| `SnapshotPanel.tsx` | `chapterSeqRef` | `chapterSeq` |

**Pattern translations:**

- **Single-axis flow** (search, status-change, snapshot count GET, panel chapter-change):
  ```ts
  const token = seq.start();
  await ...;
  if (token.isStale()) return;
  ```
- **Cross-axis flow** (snapshot *view* depends on chapter):
  ```ts
  const cToken = chapterSeq.capture();  // depend on current chapter epoch, don't bump
  const vToken = viewSeq.start();       // bump view epoch
  await ...;
  if (cToken.isStale() || vToken.isStale()) return;
  ```
- **External-trigger abort** (project change bumping `searchSeq`, chapter change bumping `chapterSeq`):
  ```ts
  useEffect(() => { seq.abort(); }, [externalKey]);
  ```
- **Cancel-API abort** (`cancelPendingSaves` in `useProjectEditor` bumped `saveSeqRef` internally): the method calls `saveSeq.abort()` internally; call sites are unchanged.

**What does NOT move:**

- The `{ ok: true, staleChapterSwitch: true }` return convention in `useSnapshotState` stays. It's a consumer-level contract; the primitive reports only whether a token is stale, not what the consumer reports upward.
- `useEditorMutation`'s `inFlightRef` stays as-is (concurrency guard, not staleness signal).
- The `useProjectEditor` unmount effect (`useProjectEditor.ts:122-127`) **stays**. It does more than bump sequence refs: `cancelInFlightSave()` also calls `saveAbortRef.current.abort()` on the live `AbortController` and resolves the backoff-sleep `setTimeout` — without either, a sleeping retry loop wakes on a gone component (the effect's original motivation; see the comment at `useProjectEditor.ts:115-119`). What changes: `cancelInFlightSelect()` — which does *only* a bump — becomes redundant under auto-abort and is removed from the effect. `cancelInFlightSave()`'s bump line (`++saveSeqRef.current`) is replaced by `saveSeq.abort()` and the rest of its body (controller abort, backoff clear) is untouched. The regression test at `useProjectEditor.test.ts:1417-1422` is updated so its assertion rides on the hook's auto-abort rather than the deleted `cancelInFlightSelect` line.

## Testing strategy

**Direct unit tests — `useAbortableSequence.test.ts`** (satisfies DoD "Tests cover the staleness contract directly"):

1. A fresh `start()` token is not stale.
2. A second `start()` invalidates the first token.
3. `capture()` does NOT invalidate prior tokens (the critical cross-axis property).
4. `abort()` invalidates all outstanding tokens, whether issued by `start()` or `capture()`.
5. A token from `capture()` called *after* `abort()` is fresh — the bump already happened.
6. A token from `capture()` called *after* `start()` is fresh (tracks current epoch).
7. **Unmount invalidates all outstanding tokens.** Render → `start()` → unmount → `token.isStale()` returns `true`.
8. Two `useAbortableSequence()` calls in the same component are independent. `seq1.abort()` does not affect `seq2`'s tokens.
9. `start()` after unmount is harmless. The counter still ticks; any setState that would follow on the returned token's use is stale anyway.

**Consumer integration tests — preserved unchanged.** The existing race tests already cover the real scenarios and should continue to pass:

- `useProjectEditor.test.ts:1417-1422` — unmount-clobber bug. Updated to reflect that auto-abort (not an explicit unmount-effect bump) is what prevents the clobber.
- `useFindReplaceState.test.ts:645` — project-change reset.
- `useSnapshotState.test.ts:293` — chapter-switch mid-flight.
- Any `SnapshotPanel` test covering chapter change during in-flight fetches.

**Type-level enforcement.** TypeScript verifies that every staleness check routes through `token.isStale()`. Raw-number comparisons (`seq !== seqRef.current`) won't compile against the new API.

**Zero-warnings rule (CLAUDE.md §Testing Philosophy).** The primitive must not log — its operations are infallible. No `console.warn`/`console.error` paths.

## ESLint enforcement

An ESLint `no-restricted-syntax` rule flags the anti-pattern shape so the primitive stays load-bearing:

- **Targets:** `BinaryExpression` with operator in `['!==', '===']`, right operand `<Identifier>.current`, left operand a locally-scoped `Identifier`. Both operators matter: `!==` expresses "am I stale" (`useProjectEditor.ts:212`, `useFindReplaceState.ts:218`) but `===` expresses the negation, "am I still fresh" (`useProjectEditor.ts:305`, `useSnapshotState.ts:142,286`, `useFindReplaceState.ts:257`). A rule that catches only `!==` leaves an obvious bypass: reintroducing the pattern via `if (seq === foo.current) commitResult()` would sail through CI. Widening covers both forms. False-positive risk remains low — common legitimate `.current` comparisons like `activeChapterRef.current?.id === savingChapterId` place the MemberExpression on the *left* and do not match this selector.
- **Message:** points reviewers at `useAbortableSequence` in the hooks directory and names the three API methods.
- **Fixture test.** A deliberately-violating fixture is linted as part of `make lint` CI so the rule's coverage can be asserted. If the rule stops firing on the fixture (e.g. someone relaxes it), CI fails.
- **Escape hatch.** `// eslint-disable-next-line no-restricted-syntax -- <reason>` is available for legitimate exceptions. I do not expect any. Reviewers who see an unexplained escape-hatch in a PR should push back.

This promotes "no free-standing `seqRef` patterns remain" from a grep-in-review discipline to a build-time failure — the same enforcement pattern Phase 4b.4 establishes for raw UI strings.

## CLAUDE.md updates

Two edits to `CLAUDE.md`, landing in the same PR as the implementation.

**Edit 1 — §Save-Pipeline Invariants rule 4** now names the primitive:

> 4. **Bump the sequence ref before the request, not after.** Any in-flight response for an older sequence is discarded on return. Bumping after creates a window where stale responses land. Use `useAbortableSequence` (`packages/client/src/hooks/useAbortableSequence.ts`): `start()` bumps and returns a token, `capture()` snapshots the current epoch for cross-axis checks, `abort()` invalidates outstanding tokens, and component unmount auto-aborts. Hand-rolled `useRef<number>` sequence counters are rejected by ESLint.

**Edit 2 — §Save-Pipeline Invariants closing paragraph.** The paragraph that points new editor-mutation flows at `useEditorMutation` gets a sibling sentence so the pair is discoverable together:

> For any client flow whose response must be discarded when superseded by a newer request or an external epoch change (chapter switch, project switch, unmount), route through `useAbortableSequence` — it encodes the "bump before, check after" contract as tokens, auto-aborts on unmount, and is enforced by ESLint.

Sections not updated: §Testing Philosophy, §API Design, §Data Model, §Accessibility, §Visual Design, §Target Project Structure, §Pull Request Scope. Explicit non-changes, not an oversight.

## PR scope & sequencing

Single refactor, single PR (§Pull Request Scope). All four call sites migrate together so the end state matches the DoD. Commit boundaries keep the diff reviewable; each commit keeps `make test` green:

1. Add `useAbortableSequence` + unit tests.
2. Add the `no-restricted-syntax` ESLint rule + fixture test.
3. Migrate `useFindReplaceState` (simplest).
4. Migrate `SnapshotPanel`.
5. Migrate `useSnapshotState` (chapter + view cross-axis).
6. Migrate `useProjectEditor` (three sequences; delete the explicit unmount-effect bump, update its regression test).
7. Update `CLAUDE.md` §Save-Pipeline Invariants (both edits).

After commit 6, `grep -rn 'SeqRef\|seqRef\|sequenceRef' packages/client/src/` should return no matches.

## Dependencies

- Phase 4b (merged 2026-04-19).
- Phase 4b.1 has shipped. Roadmap notes the two are independent; commit 6 touches the same file (`useProjectEditor.ts`) that feeds `useEditorMutation`, but the surfaces are orthogonal (4b.1 mutated flows; 4b.2 touches sequence counters). No coordination risk at the time of writing.

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Auto-abort on unmount interacts poorly with some existing flow | Preserve all consumer integration tests unchanged; any regression surfaces there before merge |
| ESLint rule false-positives on legitimate `local !== ref.current` comparisons | Tight selector (local Identifier on left, `.current` MemberExpression on right); reason-required escape hatch if needed; reviewed fixture asserts rule coverage |
| Nested-sequence migration (snapshot) changes semantics subtly | The `staleChapterSwitch: true` consumer contract is preserved literally; behavior is "same bits, new primitive" |
| Coverage regression on `useProjectEditor.ts` | §Testing Philosophy floors (95/85/90/95) enforced; `make cover` is run as an explicit commit boundary (see §Definition of Done). Any drop is closed by adding tests for the newly-uncovered branches, never by lowering thresholds |
| A hand-composed flow elsewhere starts a fresh `useRef<number>` after merge | ESLint rule catches at build time; CLAUDE.md rule 4 points the author at the primitive |

## Definition of Done

- `packages/client/src/hooks/useAbortableSequence.ts` exists with `start()` / `capture()` / `abort()` and auto-abort-on-unmount.
- Direct staleness-contract unit tests cover all nine cases in §Testing Strategy.
- `grep -rn 'SeqRef\|seqRef\|sequenceRef' packages/client/src/` returns no matches.
- The `no-restricted-syntax` ESLint rule fails `make lint` on the fixture and passes on the migrated code.
- Existing consumer integration tests (`useProjectEditor.test.ts`, `useFindReplaceState.test.ts`, `useSnapshotState.test.ts`, `SnapshotPanel` tests) pass without semantic change. The `useProjectEditor.test.ts:1417-1422` assertion is updated to ride on auto-abort.
- CLAUDE.md §Save-Pipeline Invariants carries both edits.
- `make cover` verified on `packages/client` after the migration commits and before the CLAUDE.md edit. Floors (95/85/90/95 statements/branches/functions/lines, per `vitest.config.ts` and CLAUDE.md §Testing Philosophy) met or exceeded. If any floor drops, fix by adding meaningful tests for the newly-uncovered branches — not by lowering the threshold.
- No user-visible behavior change.
