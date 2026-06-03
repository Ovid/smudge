---
date: 2026-06-03
phase: "Phase 4b.16: Dialog Lifecycle Hook"
model: claude-opus-4-8
design_file: docs/plans/2026-06-03-dialog-lifecycle-hook-design.md
plan_file: docs/plans/2026-06-03-dialog-lifecycle-hook-plan.md
pushback:
  total: 3
  critical: 0
  important: 1
  minor: 2
alignment:
  total: 1
  critical: 0
  important: 0
  minor: 1
---

# Phase 4b.16: Dialog Lifecycle Hook — Decision Log

## Pushback Findings

### [1] Shared backdrop handler closes ProjectSettings on panel-padding clicks
- **Severity:** Important
- **Category:** Feasibility
- **Summary:** The shared `onBackdropClick` uses `target === currentTarget`,
  which works for the four full-screen dialogs because their visible card is an
  inner `<div>` inside a viewport-filling `<dialog>`. ProjectSettingsDialog is a
  narrow slide-out whose `<dialog>` *is* the panel, with `p-6` and content
  placed directly on the dialog element. Adding backdrop-dismiss naively would
  fire `onClose` not only on `::backdrop` clicks (intended) but also on clicks
  in the panel's own 24px padding — a surprising "clicked inside, it closed"
  wart in the very behavior being added.
- **Resolution:** fixed-in-design — added a "Backdrop structure for
  ProjectSettingsDialog" subsection requiring the content to be wrapped in a
  full-bleed inner `<div>` (carrying `p-6` + background; positioning stays on
  the `<dialog>`), so the dialog element's only directly-clicked surface is the
  `::backdrop`. The shared handler then stays correct without per-dialog
  special-casing.

### [2] Show/close-sync contract glosses over three distinct rendering patterns
- **Severity:** Minor
- **Category:** Ambiguity
- **Summary:** The dialogs render three ways — mount-gated (ConfirmDialog),
  `return null` when closed (ExportDialog, ProjectSettingsDialog), and
  always-rendered toggle (NewProjectDialog, ShortcutHelpDialog). The hook's
  `close()` effect is a no-op for the `return null` ones (their `<dialog>`
  unmounts). The design presented one uniform "show/close sync" contract, so a
  plan author could read the variation as inconsistency and "normalize" it
  (churn) or assume `close()` always fires (wrong).
- **Resolution:** fixed-in-design — added a "Three rendering patterns the hook
  supports" subsection naming each pattern, stating they are preserved as-is,
  and noting the `close()` no-op for pattern 2 is expected.

### [3] "preventDefault keeps React in control" rationale is technically wrong
- **Severity:** Minor
- **Category:** Contradiction
- **Summary:** A `<dialog>` opened via `showModal()` closes on Escape through
  the browser's separate, cancelable `cancel` event; calling `preventDefault()`
  on the `keydown` does not cancel it. The stated reason for keeping
  `preventDefault()` ("suppress native close to keep React in control") was
  therefore inaccurate, even though the end state is correct and idempotent.
  Wrong reasoning in a load-bearing spec invites a future "cleanup" that breaks
  something.
- **Resolution:** fixed-in-design — kept `preventDefault()` (it matches the two
  existing implementations and suppresses default Escape side-effects) and
  corrected the rationale in the §Behavior contract: React drives the close via
  `onClose` → `open=false` → guarded `dialog.close()`; any native close is a
  harmless idempotent duplicate (no double `onClose`, since the native
  `onClose` props are removed).

## Alignment Findings

### [1] The three pure-refactor tasks have no RED step
- **Severity:** Minor
- **Category:** tdd-format
- **Summary:** Tasks 3–5 (ExportDialog, ConfirmDialog, NewProjectDialog) are
  behavior-preserving refactors guarded by the existing, unmodified test files —
  green-before / green-after, so there is no new failing test to write first.
  They occupy the REFACTOR phase of TDD rather than RED→GREEN. The alignment
  skill's default is to rewrite every task in explicit red/green/refactor.
- **Resolution:** accepted-as-is — kept the current format. Inventing a failing
  test for a no-behavior-change migration would be theatrical; the format
  matches the repo precedent (the 4b.15 inline-title plan), and the "existing
  tests stay green without modification" requirement *is* the test contract,
  actively enforced by a mandatory test run as Step 2 of each refactor task and
  the Task 9 diff check.

## Summary

- Pushback raised 3 issues; all 3 resulted in design changes (1 Important
  feasibility fix to the ProjectSettings backdrop structure, 2 Minor
  documentation/rationale fixes). None dismissed.
- Alignment raised 1 issue (Minor, tdd-format); 0 resulted in document changes
  — the plan was already test-driven, and the refactor-under-green format was
  accepted as correct for behavior-preserving migrations.
- Requirements coverage and scope compliance were both complete: every design
  requirement traces to a task, and no task is out of scope.
