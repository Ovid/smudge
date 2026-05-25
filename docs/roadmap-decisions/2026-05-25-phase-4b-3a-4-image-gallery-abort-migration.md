---
date: 2026-05-25
phase: "Phase 4b.3a.4: Image Gallery Abort Migration"
model: claude-opus-4-7
design_file: docs/plans/2026-05-25-image-gallery-abort-migration-design.md
plan_file: docs/plans/2026-05-25-image-gallery-abort-migration-plan.md
pushback:
  total: 4
  critical: 0
  important: 1
  minor: 3
alignment:
  total: 0
---

# Phase 4b.3a.4: Image Gallery Abort Migration — Decision Log

## Pushback Findings

### [1] Tests #2 (`handleSave`) and #3 (`handleInsert` inner branch) cannot pin the `abort-prior` axis via the DOM
- **Severity:** Important
- **Category:** Feasibility
- **Summary:** The original design promised three-axis characterization tests (abort-prior + signal-threading + abort-on-unmount) for each of the five operations. Re-reading the actual source revealed that the Save button (`ImageGallery.tsx:514`) and Insert button (`:522`) are disabled while `saveStatus === "saving"`, and the only public DOM path that touches `saveStatus` (`updateField`, line 348) only flips `"saved" → "idle"` — it cannot return `"saving"` to a non-`"saving"` value during the in-flight `pendingUntilAbort`. The `abort-prior` axis is therefore unreachable for those two handlers via the public UI. An implementer following the design literally would either write a test that silently passes for the wrong reason, force-fire clicks past React's disabled handling (production-impossible state), or extract handlers to a custom hook (scope creep). The contract IS still pinned by test #7 (any other `mutationOp` handler fired while one of these is in flight aborts the prior — shared-instance behaviour), so the coverage gap is illusory; the design just over-promised.
- **Resolution:** `fixed-in-design` — Dropped the `abort-prior` axis from tests #2 and #3 (each becomes 2-axis: signal-threading + abort-on-unmount). Added explicit prose to each test description noting the disabled-while-saving constraint and pointing to test #7 as the implicit covering test. Three alternative options were rejected: (b) extract handlers to a custom hook (multi-feature PR, out per one-feature rule); (c) add internal handles for testing only (compromises production code); (d) force-fire via `dispatchEvent` past React's disabled handling (exercises a production-impossible state).

### [2] Tests #5 and #6 mocking `api.images.references` will capture detail-references useEffect signals alongside `refsOp` signals
- **Severity:** Minor
- **Category:** Omission
- **Summary:** The detail-references `useEffect` at lines 145–170 also calls `api.images.references` on every `selectedImageId` change. A `mockImplementation` that pushes signals to an array captures both `useEffect`-triggered and `refsOp`-triggered signals interleaved. A test that asserts `capturedSignals[0].aborted === true` (intending the first `refsOp` signal) would actually assert on the useEffect's signal — which IS aborted by `backToGrid`'s cleanup, but for a different reason than the test claims to pin. The test would silently pass while measuring the wrong thing. The implementer would likely catch this when the test behaves oddly, but the spec is the right place to surface the testing-mechanics constraint so the plan author isn't surprised.
- **Resolution:** `fixed-in-design` — Added a "Important capture-pattern note" to §Test plan prescribing the drain-and-clear pattern: `await waitFor(() => expect(api.images.references).toHaveBeenCalledTimes(1))` after `openDetail` to drain the useEffect's pending call, then `vi.mocked(api.images.references).mockClear()`, then re-install the capture mock for the `refsOp` interactions only. Plan tests #5 and #6 now use this pattern explicitly. Tests #1, #2, #3, #4, #7 are unaffected (different API surfaces, no `useEffect` competitor).

### [3] "All 53 existing tests" count was wrong (actual: 51)
- **Severity:** Minor
- **Category:** Ambiguity
- **Summary:** The design referenced "All 53 existing tests" in §Test plan and §Definition of Done. Verified with `grep -cE "^\s*it\(" packages/client/src/__tests__/ImageGallery.test.tsx`: actual count is 51. The number was inferred from an earlier grep that visibly listed ~53 items. Trivial drift, but the spec is the place to either get the count right or remove it.
- **Resolution:** `fixed-in-design` — Replaced "All 53 existing tests" with "all existing tests" (or just removed the count where it was incidental) in all three places it appeared (§Test plan, §Migration order Commit 3, §Definition of Done). The substitution is resilient to future drift if anyone touches the file. Two alternative options were considered: (a) substitute the exact count "51" — more precise but the count will rot the moment anyone adds or removes a test; (c) leave as-is — sloppy, would be caught on first test run but signals carelessness in spec-writing.

### [4] Test #4 parenthetical about `handleDelete`'s `confirmingDelete` lifecycle was technically wrong
- **Severity:** Minor
- **Category:** Ambiguity
- **Summary:** The original test #4 description said "the confirm button stays rendered while delete is in flight; `handleDelete` only flips `confirmingDelete` on the catch path". In fact `handleDelete`'s success path (lines 309–313) also flips `confirmingDelete` (via both `setSelectedImage(null)` exiting the detail view entirely AND explicit `setConfirmingDelete(false)`). The parenthetical implied success leaves it alone — wrong. For the test's actual `pendingUntilAbort` scenario the test mechanism still works (neither success nor catch resolves until the second click's abort; the catch's `signal.aborted` gate then returns before the `setConfirmingDelete(false)` line), but the rationale in the parenthetical misled.
- **Resolution:** `fixed-in-design` — Rewrote the parenthetical to pinpoint the actual mechanism: "the confirm button stays rendered because the first call is held by `pendingUntilAbort` — neither success nor catch resolves until the second click's `mutationOp.run` aborts the first signal, at which point the first call's `.catch` runs but the `if (signal.aborted) return` gate at the top of the catch returns before reaching the `setConfirmingDelete(false)` line". The parenthetical is genuinely load-bearing for understanding *why* the test setup keeps the button rendered for the second click; keeping it but fixing its accuracy was the right move over deleting it entirely.

## Alignment Findings

Alignment raised no issues.

## Summary

- **Pushback raised 4 issues, all `fixed-in-design`.** One Important Feasibility issue (tests #2/#3 over-promised three-axis tests when only two axes are DOM-reachable due to disabled-while-saving UI guards) and three Minor issues (drain-and-clear pattern omission for `api.images.references` mocking, wrong existing-test count, misleading parenthetical about `handleDelete`'s confirmingDelete lifecycle). The Important finding was the substantive catch — without it the plan author would have written tests that either pass silently for the wrong reason or attempted to force production-impossible state. The contract IS still pinned by test #7 (shared-instance behaviour across `mutationOp` handlers), so the test plan's coverage is intact post-fix; the design just had to acknowledge what's reachable through the UI and what isn't.
- **Alignment raised 0 issues.** The plan faithfully implements the post-pushback design: every behaviour-mapping row has matching plan steps, every test has matching plan code, and every DoD bullet has matching verification. The plan's Plan-vs-Design Notes section (N1, N2, N3) proactively surfaced three plan-level decisions for alignment confirmation; N1 and N2 are restatements of post-pushback design intent (not divergences), and N3 (inline `openDetail` pattern rather than refactoring `renderAndOpenDetail`) is a defensible one-feature-rule plan-level discipline matching prior-phase precedent. The clean alignment is itself evidence — pushback caught everything that needed catching, and the plan was written carefully enough that no further misalignment slipped in.
- **The pushback-then-alignment sequence held up.** Unlike 4b.3a.3 (where alignment caught a contradiction the pushback fix had just settled an hour earlier), 4b.3a.4's plan author internalized the pushback resolutions cleanly. The 4b.3a.3 lesson — that the same author who agreed with a pushback fix can drift back to the rejected behaviour an hour later under cognitive load — was reflected in the plan's explicit Plan-vs-Design Notes section flagging the three judgment calls upfront. A clean alignment is not luck; it's evidence that the plan author was actively cross-checking against the just-finalized design.
