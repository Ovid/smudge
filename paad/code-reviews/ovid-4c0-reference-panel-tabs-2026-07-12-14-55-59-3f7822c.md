# Agentic Code Review: ovid/4c0-reference-panel-tabs

**Date:** 2026-07-12 14:55:59
**Branch:** ovid/4c0-reference-panel-tabs -> main
**Commit:** 3f7822cde2a5dffd2ba63943ab3504d7d31f238a
**Files changed:** 9 | **Lines changed:** +517 / -71
**Diff size category:** Medium (real logic delta is small; bulk is test fixtures, a plan doc, and a Prettier prop-list reflow)

## Executive Summary

Clean, well-tested pure refactor: the hard-coded single-"Images" `ReferencePanel`
becomes a `tabs`-array-driven multi-tab panel with active-tab persistence, as a
prerequisite for Phase 4c.1 (Inline Notes). Four independent specialists
converged on a **single** real defect — an unvalidated persisted `activeTabId`
renders a broken, empty, ARIA-invalid panel when it matches no tab. It is
**latent today** (single tab, default matches) but becomes reachable the moment
4c.1 adds a second tab that can later be renamed/removed. One well-placed line
fixes it. Everything else — contract wiring, forcing-pause surface test,
localStorage try/catch coverage, keyboard/a11y of the tabs — verified clean.

## Critical Issues

None found.

## Important Issues

### [I1] Unvalidated persisted `activeTabId` → empty panel, dangling `aria-labelledby`, tablist with no selected tab
- **File:** `packages/client/src/components/ReferencePanel.tsx:29,113,115` (root cause `packages/client/src/hooks/useReferencePanelState.ts:36-44`)
- **Bug:** `getSavedActiveTab()` returns any non-null localStorage value verbatim, with no check that it matches a rendered tab — unlike its siblings `getSavedPanelWidth` (clamps to range) and `getSavedPanelOpen` (strict `=== "true"`). `ReferencePanel` then trusts the prop in three places. When `activeTabId` matches no `tab.id`:
  - `activePanel = tabs.find(...)?.panel ?? null` → **empty tabpanel** (the ImageGallery does not render at all — a regression vs. the old always-rendered gallery).
  - Every button gets `aria-selected={false}` → a `role="tablist"` with **no selected tab** (invalid ARIA tab pattern).
  - The tabpanel emits `aria-labelledby="${stale}-tab"` referencing a `<button>` id that was never rendered → **dangling IDREF** (WCAG 1.3.1 / 4.1.2; aXe flags the broken `aria-labelledby`).
- **Impact:** Not reachable by a normal user *today* (only `"images"` exists and it is the default, and `onSelectTab` only ever writes real tab ids). Reachable via (a) manual/corrupted localStorage now, or (b) the exact future this refactor exists for — a 4c.1 tab persisted as active, then renamed/removed in a later build, leaving a stale id in a user's storage. On next load: broken, empty, a11y-violating panel until the user clicks a valid tab. It breaks the plan's "pure refactor, no user-visible change" invariant under stale storage, and holds the tab read to a weaker standard than the width/open reads it sits beside (a direct contradiction of CLAUDE.md's "parses persisted/external values with loose matching → wrong default" guidance).
- **Suggested fix:** Resolve an effective active tab once in the component and key content, tabpanel `id`, `aria-labelledby`, and the `selected` comparison off it:
  ```ts
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  // activePanel = activeTab?.panel ?? null
  // selected = tab.id === activeTab?.id
  // tabpanel: id={`${activeTab?.id}-tabpanel`} aria-labelledby={`${activeTab?.id}-tab`}
  ```
  This degrades a stale/garbage id to the first tab (valid selection, valid labelledby, non-empty panel) — matching the clamp/fall-back discipline of the other two reads. Validating in the hook is worse: the hook does not know the tab set; the component does. Add a test with `activeTabId` set to an id absent from `tabs`, asserting the first tab renders and is selected.
- **Confidence:** High (all 4 specialists independently reported it; the code path is verified by direct read). Severity Important rather than Critical only because current-user reachability is gated behind storage tampering or a future tab change.
- **Found by:** Logic & Correctness, Error Handling & Edge Cases, Accessibility & State (Contract & Integration flagged the same at ~40 as a latent note)

## Suggestions

- `ReferencePanel.tsx` — while adding the `tabs[0]` fallback, guard `activeTab?.id` for the (currently unreachable) empty-`tabs` array so it cannot throw. (Error Handling, conf 62)
- `useReferencePanelState.ts` / `useSidebarState.ts` — `getSavedActiveTab` is now the **third** hand-rolled `getSaved* + try/catch` localStorage reader (width, open, tab), with `useSidebarState` a fourth independent copy. No shared persistence util exists; a `getSavedString(key, default)` / `usePersistedState` helper would dedup all four. Real cleanup but cross-file and out of scope for this one-refactor PR — track separately.

## Plan Alignment

Plan doc: `docs/plans/2026-07-12-4c0-reference-panel-tabs-plan.md` (Phase 4c.0).

- **Implemented:** All three tasks (hook active-tab persistence with the exact `smudge:ref-panel-active-tab` key; `ReferencePanel` tabs API matching the prescribed signature; wiring through `EditorMainContent` + `EditorPage`; surface-test props added). Each task ships its prescribed tests, including a superset for the hook (added a "getItem throws → falls back to images" case) and a 2-tab fixture for the component.
- **Non-goal holds:** "No user-visible change, Images stays the only tab" — confirmed; `notes` appears only in test fixtures, never in product wiring. No `strings.ts` change.
- **Deviations (all minor, none contradict the plan):**
  - Tasks 2 + 3 landed in one commit (`081d97b`) rather than the planned two; still one refactor, convention honored.
  - The `// ponytail:` comment was reworded/expanded from the plan text (same meaning, arguably clearer).
  - `editorEntryPointSurface.test.ts` got a wholesale Prettier one-per-line reflow beyond the two added props — diff noise, no behavior change.
- **Not statically verifiable:** the "Final verification" checklist (`make all` green, coverage floors 95/85/90/95, zero-warning output, manual `make dev` smoke, PR references Phase 4c.0) — process items with no artifact in the diff.

## Review Metadata

- **Agents dispatched:** Logic & Correctness; Error Handling & Edge Cases; Contract & Integration; Accessibility & Component State; Plan Alignment. (Security and Concurrency deliberately folded in rather than run standalone — the change is a client-only localStorage tab toggle with no injection/auth boundary and no shared mutable state; both were checked in passing and found empty.)
- **Scope:** `ReferencePanel.tsx`, `useReferencePanelState.ts`, `EditorMainContent.tsx`, `EditorPage.tsx` + their three test files; adjacent `strings.ts` and the `ImageGallery` consumer.
- **Raw findings:** 4 (one defect, reported by 4 agents) + 2 sub-threshold notes
- **Verified findings:** 1 Important + 2 Suggestions
- **Filtered out:** 0 false positives (strong cross-specialist agreement; confirmed by direct code read)
- **Steering files consulted:** CLAUDE.md (no contradictions except I1's read-validation asymmetry, which CLAUDE.md's own guidance flags)
- **Plan/design docs consulted:** `docs/plans/2026-07-12-4c0-reference-panel-tabs-plan.md`
