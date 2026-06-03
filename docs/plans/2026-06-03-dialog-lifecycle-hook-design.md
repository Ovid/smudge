# Phase 4b.16: Dialog Lifecycle Hook — Design

**Date:** 2026-06-03
**Phase:** 4b.16 (roadmap)
**Author:** Ovid / Claude (collaborative)
**Type:** Refactor (one PR) + one deliberate, tested UX fix (see §Scope)

## Goal

Extract a single `useDialogLifecycle` hook capturing the show-on-mount /
focus-an-actionable-element / Escape-closes / backdrop-click-closes lifecycle
pattern that is currently reimplemented — inconsistently — across five dialogs
(`ConfirmDialog`, `ExportDialog`, `NewProjectDialog`, `ProjectSettingsDialog`,
`ShortcutHelpDialog`), then migrate each dialog onto it behind characterization
tests. The hook becomes the single owner of dialog lifecycle, parallel to
`useEditorMutation` / `useAbortableSequence` / `useInlineTitleEditing`.

## Why a design for an extraction

The five dialogs reimplement the same three affordances (show/close, focus,
Escape, backdrop) with arbitrary inclusions and exclusions. New dialogs copy
whichever neighbour they were spawned from rather than a single policy, so
accessibility variance, test-environment fragility, and silent drift in
keyboard semantics follow. The extraction only pays off if the genuine
differences are preserved as explicit opt-ins and the incidental asymmetries
are normalized — which requires deciding, up front, which is which.

## Current-state analysis

### The lifecycle the dialogs share

Every dialog: shows a native `<dialog>` when it should be visible, (sometimes)
moves focus into it, closes on Escape, and (sometimes) closes on backdrop
click. That is the machine to extract.

### Per-dialog variance (as of 2026-06-03)

| Dialog | Control | Escape | Backdrop | show/close guard | Focus | role |
|---|---|---|---|---|---|---|
| ConfirmDialog | mount/unmount (no `open` prop) | manual document `keydown`, **capture-phase** + `stopImmediatePropagation` | yes (→ `onCancel`) | none | `cancelRef` | `alertdialog` |
| ExportDialog | `open` prop | manual document `keydown`, bubble-phase | yes | `showModal` only | `cancelRef` | default |
| NewProjectDialog | `open` prop | native `<dialog onClose>` | no | none | native `autoFocus` | default |
| ShortcutHelpDialog | `open` prop | native `<dialog onClose>` | yes | none | none (native showModal focus) | default |
| ProjectSettingsDialog | `open` prop | native `<dialog onClose>` | no (slide-out) | `showModal` + `close` | none (native showModal focus) | default |

### Genuine, load-bearing differences (preserved as opt-ins)

1. **`blockEscapePropagation` (ConfirmDialog).** ConfirmDialog attaches a
   **capture-phase** document `keydown` listener that calls
   `stopImmediatePropagation()` so a single Escape cancels the dialog without
   the `FindReplacePanel`'s own document-level Escape listener also firing and
   wiping its query + results. This is real and must survive.
2. **`initialFocusRef` (ConfirmDialog, ExportDialog).** Both move focus to a
   specific element (the Cancel button) after `showModal()`, rather than
   letting the browser pick the first focusable. Preserved as an optional ref.
3. **`role="alertdialog"` (ConfirmDialog).** Stays in JSX (the hook does not
   own ARIA); listed here so the migration does not drop it.

### Incidental asymmetries (normalized)

- **Escape mechanism.** Three dialogs lean on the native `<dialog onClose>`
  event; ExportDialog hand-rolls a bubble-phase document `keydown` listener;
  ConfirmDialog hand-rolls a capture-phase one. This is exactly the drift the
  phase exists to kill. **Decision: unify onto one mechanism — a document-level
  `keydown` Escape listener owned by the hook** (`preventDefault()` + `onClose()`;
  capture-phase + `stopImmediatePropagation()` when `blockEscapePropagation`).
  The native-`cancel`-event alternative was rejected: the client test env is
  jsdom, whose `showModal`/`close` are polyfilled in `setup.ts` as dumb
  attribute toggles that never fire `cancel`/`close`, so a `cancel`-driven hook
  would not fire under test and would force rewrites of the existing
  keyboard-`{Escape}` tests. The `keydown` mechanism is what `ConfirmDialog` and
  `ExportDialog` already use and is already proven under jsdom.
- **show/close try/catch.** Two dialogs wrap `showModal`/`close` in try/catch
  (legacy "happy-dom" comments — the env is now jsdom). No caller relies on the
  throw surfacing, and the hook already guards `if (!dialog.open)` /
  `if (dialog.open)`. **Decision: always-on guard.** The `safeShowClose` option
  is dropped; the hook always wraps. Stale "happy-dom" comments are removed.
- **Control model.** ConfirmDialog is mount-gated (no `open` prop); the other
  four are `open`-prop-gated. **Decision: ConfirmDialog passes `open={true}`**
  (it only renders while shown) rather than gaining a new prop. No parent
  changes; the false→true focus transition fires on mount.
- **`role` option.** Dropped from the signature — ARIA stays in JSX, keeping
  the a11y story legible where reviewers expect it.

## The shared hook

`packages/client/src/hooks/useDialogLifecycle.ts`:

```ts
function useDialogLifecycle(options: {
  open: boolean;
  onClose: () => void;
  initialFocusRef?: React.RefObject<HTMLElement>;
  blockEscapePropagation?: boolean; // default false
}): {
  dialogRef: React.RefObject<HTMLDialogElement>;
  onBackdropClick: (e: React.MouseEvent) => void;
};
```

### Behavior contract

1. **Show/close sync.** On `open` false→true, `if (!dialog.open) dialog.showModal()`;
   on true→false, `if (dialog.open) dialog.close()`. Both wrapped in try/catch
   (always-on). No-op when `dialogRef.current` is null.
2. **Focus-on-open.** When `open` transitions false→true (tracked via an
   internal `prevOpen` ref initialized to `false`, so a mount with `open===true`
   counts as a transition), focus `initialFocusRef.current` after `showModal()`.
   If `initialFocusRef` is omitted, the browser's native `showModal` focus
   applies — no override.
3. **Escape.** While `open`, a document `keydown` listener fires on `Escape`:
   `preventDefault()` then `onClose()`. When `blockEscapePropagation` is true,
   the listener is registered in the **capture phase** and additionally calls
   `stopImmediatePropagation()` before `onClose()`. The listener is removed when
   `open` goes false and on unmount. (No listener while closed — matches
   ExportDialog's `if (!open) return` guard.)

   **On `preventDefault()` (pushback Finding 3):** it is retained to match the
   two existing implementations (`ConfirmDialog`, `ExportDialog`) exactly and to
   suppress any default Escape side-effects — **not** to cancel the native
   dialog close. A `<dialog>` opened with `showModal()` closes on Escape via the
   browser's separate, cancelable `cancel` event; `preventDefault()` on a
   `keydown` does not cancel it. The actual close is driven by React
   (`onClose()` → `open=false` → the show/close effect calls `dialog.close()`,
   guarded by `if (dialog.open)`). If the browser also closes the dialog
   natively first, that is a harmless idempotent duplicate — nothing re-fires
   `onClose`, because the migration removes the native `onClose` props.
4. **Backdrop.** Returns a stable `onBackdropClick` =
   `(e) => { if (e.target === e.currentTarget) onClose(); }`. Opt-in: callers
   spread it onto `<dialog onClick={...}>` only if they want backdrop-dismiss.

The hook returns the `dialogRef` it creates; callers no longer declare their
own.

### What the hook does NOT own

ARIA attributes (`role`, `aria-label`, `aria-describedby`), the dialog's
className/positioning, form submission, and any data/save logic. Those remain
in each component.

### Three rendering patterns the hook supports (pushback Finding 2)

The dialogs render in three distinct ways, and each migration **preserves its
component's existing pattern** — they are intentional, not inconsistencies to
normalize:

1. **Mount-gated** (`ConfirmDialog`): the parent conditionally renders it;
   `open={true}` always while mounted. `showModal()` + focus fire on the
   mount (false→true) transition; closing happens by the parent unmounting it.
2. **`return null` when closed** (`ExportDialog`, `ProjectSettingsDialog`): the
   component instance stays mounted (so the hook's `prevOpen`/`dialogRef` refs
   persist), but renders `null` while closed. When `open` goes false the
   `<dialog>` unmounts, so the hook's `dialog.close()` is a **no-op** (ref is
   null) — closing happens by rendering `null`, which is expected, not a bug.
3. **Always-rendered toggle** (`NewProjectDialog`, `ShortcutHelpDialog`): the
   `<dialog>` is always in the DOM; `showModal()` / `close()` do the real
   show/hide work.

The hook handles all three. A plan author should not "unify" them onto one
render style, and should not assume `close()` always fires (it does not for
pattern 2).

## Per-dialog migration

| Dialog | `open` | `initialFocusRef` | `blockEscapePropagation` | spread `onBackdropClick` | Notes |
|---|---|---|---|---|---|
| ConfirmDialog | `true` (literal) | `cancelRef` | **true** | yes (`onClose: onCancel`) | keeps `role="alertdialog"`, `aria-*` in JSX; removes its hand-rolled capture listener + mount effect |
| ExportDialog | prop | `cancelRef` | false | yes | removes bespoke bubble `keydown` listener + show/close effect; export/abort logic untouched |
| NewProjectDialog | prop | — (keeps native `autoFocus`) | false | **no** | removes native `onClose` prop; backdrop stays **off** (data-loss footgun on the title field) |
| ShortcutHelpDialog | prop | — (native focus) | false | yes | removes native `onClose` prop |
| ProjectSettingsDialog | prop | — (native focus) | false | **yes (NEW)** | **gains backdrop-dismiss** (see §Scope and §Backdrop structure); slide-out inline-style CSS untouched; ✕ close button kept; field/timezone save logic untouched |

### Backdrop structure for ProjectSettingsDialog (pushback Finding 1)

The shared `onBackdropClick` uses the standard `if (e.target === e.currentTarget)`
check. This is correct for the four full-screen dialogs because their `<dialog>`
fills the viewport and the visible card is an **inner `<div>`**, so the dialog
element is the directly-clicked target only on the dimmed area outside the card.

ProjectSettingsDialog is different: its `<dialog>` **is** the narrow right-hand
panel, with `p-6` and content placed directly on the dialog element. Without a
change, the `target === currentTarget` check would fire not only on the
`::backdrop` (intended) but also when the user clicks the panel's own 24px
padding border (surprising — that is *inside* the visible panel).

**Therefore, as part of adding backdrop-dismiss, wrap ProjectSettings' content
in a full-bleed inner `<div>`** (`w-full h-full`, carrying the `p-6` padding and
the panel background), mirroring the other dialogs' `<dialog>` + inner-card
structure. Positioning/sizing (`position:fixed; right:0; height:100vh; max-w-sm`)
stays on the `<dialog>`. After this, the dialog element's only directly-clicked
surface is the `::backdrop`, so the shared handler fires only on the dimmed area
— consistent with the other four and without per-dialog special-casing.

ProjectSettingsDialog **migrates** (it was flagged in the roadmap as
"migrate or document opt-out"): its lifecycle — `showModal`/`close` with the
always-on guard — factors through the hook cleanly, and the slide-out is pure
CSS (JSX inline style), not lifecycle. We are also adding backdrop-dismiss to
it, which requires touching it regardless.

**Migration order** (per roadmap, to control risk): `ExportDialog` +
`ConfirmDialog` first (vanilla + the two opt-ins), then `NewProjectDialog` +
`ShortcutHelpDialog` (vanilla), then `ProjectSettingsDialog` last. Each dialog
is its own commit; the hook + all five migrations are one PR per the
one-feature rule.

## Testing

**Hook unit tests** (`packages/client/src/hooks/useDialogLifecycle.test.ts`,
new):

- `showModal()` called on false→true; `close()` called on true→false; no-op
  on null ref; no throw when the env's `showModal` is absent (always-on guard).
- `initialFocusRef` focused after open; mount-with-`open===true` focuses;
  omitted ref leaves native focus alone.
- Escape default path: bubble `keydown` Escape → `preventDefault` + `onClose`.
- Escape with `blockEscapePropagation`: capture phase + `stopImmediatePropagation`
  + `onClose`; a sibling document `keydown` listener does **not** fire.
- Listener removed on close and on unmount (no leak; no fire after unmount).
- `onBackdropClick` calls `onClose` only when `target === currentTarget`.

**Existing dialog component tests pass unmodified** — they are the regression
net. Verified against current assertions: `ConfirmDialog` (keyboard `{Escape}`
→ onCancel, cancel button), `ExportDialog` (keyboard `{Escape}` → onClose,
backdrop click, cancel button, export flow), `NewProjectDialog`
(`showModal`/`close` called, cancel button, submit/reset), `ProjectSettingsDialog`
(close button, blur-save, abort behaviors). The hook still calls
`showModal`/`close` and still closes on keyboard Escape, so these continue to
pass without edits.

**New characterization tests** (additions, not modifications):

- `ShortcutHelpDialog.test.tsx` — none exists today; add show/close, Escape,
  and backdrop characterization before migrating it.
- `ProjectSettingsDialog` — a new test asserting backdrop click closes the
  dialog (the new behavior).

aXe-core e2e checks and `make all` green at PR close. Coverage stays at/above
the enforced floors (95/85/90/95); the new hook and its tests add covered
lines.

## Scope: the one deliberate behavior change

This is a refactor, but it exposed a real inconsistency in a dialog it is
migrating, and we are fixing it:

- **ProjectSettingsDialog gains backdrop-click-to-close.** It auto-saves every
  field on blur/change and has an explicit ✕ close button, so a scrim-click
  loses no data — its lack of backdrop-dismiss was incidental drift, not a
  principled choice. **NewProjectDialog stays off**: it is a creation form with
  a required title input, where accidental backdrop-dismiss is a data-loss
  footgun (a deliberate, defensible omission).
- Because this is a user-visible change, the roadmap phase's Definition of Done
  line "No behavior change visible to the user" is **amended** (see below), and
  the bundled fix is recorded under the **one-feature-rule exception** in the
  Phase 4b.16 decision log (a fix to the inconsistency exposed in the very
  dialog being migrated — the "bug fix alongside the feature it affects is
  fine" carve-out, made explicit per CLAUDE.md §Pull Request Scope).

## CLAUDE.md review (step 7) — DECIDED

**Add** a §Key Architecture Decisions entry (an explicit plan deliverable that
lands as part of this PR). Other CLAUDE.md sections show no drift: no new API
endpoints/codes, data-model changes, top-level folders, or test layers; the
bundled backdrop fix is covered by the existing §Pull Request Scope one-feature
*exception* mechanism + the decision log, not a new codified hazard.

Exact wording to add under §Key Architecture Decisions:

> **Dialog lifecycle lives in one hook.** Native `<dialog>` show/close sync,
> focus-on-open, Escape-to-close, and backdrop-click-to-close route through
> `useDialogLifecycle` (`packages/client/src/hooks/useDialogLifecycle.ts`)
> rather than per-dialog `useEffect`/listener reimplementations. Options:
> `initialFocusRef` (focus a specific element after `showModal()`) and
> `blockEscapePropagation` (capture-phase Escape + `stopImmediatePropagation`,
> as `ConfirmDialog` uses to shield the FindReplacePanel's Escape listener). The
> hook owns the lifecycle effects and returns an opt-in `onBackdropClick`; ARIA
> (`role`, `aria-*`) stays in each component's JSX. New dialogs adopt the hook
> rather than copying a neighbour.

## Out of scope

- Replacing the native `<dialog>` element with a custom modal primitive.
- Changing visual design, animation, or `prefers-reduced-motion` handling.
- Adding backdrop-dismiss to NewProjectDialog (deliberately off).
- Migrating any non-dialog component, or bundling Phase 4b.15 (title hooks)
  or 4b.17 (AbortController ESLint rule) into this PR.

## Definition of Done (amended)

- One canonical `useDialogLifecycle` hook with unit tests.
- All five dialogs migrated (`ProjectSettingsDialog` included).
- Existing dialog component tests green **without modification**; new
  characterization tests added for `ShortcutHelpDialog` and the
  `ProjectSettingsDialog` backdrop behavior.
- aXe-core e2e checks green.
- `make all` green at PR close.
- **Behavior change is limited to the single, intentional, tested addition of
  backdrop-dismiss to `ProjectSettingsDialog`** (this supersedes the original
  "no behavior change visible to the user" line); recorded under the
  one-feature-rule exception in the decision log.

## Dependencies

- Independent of other 4b.X phases. Touches only client dialog components and a
  new client hook.
