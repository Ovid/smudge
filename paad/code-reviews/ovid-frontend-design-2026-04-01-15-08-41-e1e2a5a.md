# Agentic Code Review: ovid/frontend-design

**Date:** 2026-04-01 15:08:41
**Branch:** ovid/frontend-design -> main
**Commit:** e1e2a5aefcd1f0e0cdf286975e63e35d8b183070
**Files changed:** 23 | **Lines changed:** +955 / -554
**Diff size category:** Large

## Executive Summary

This branch is a comprehensive frontend design overhaul -- new fonts, color palette, Logo component, toolbar extraction, layout restructuring. The visual design work is well-executed and closely follows the updated CLAUDE.md spec. However, the review found 4 Important issues: two WCAG accessibility violations (dialog focus trapping and toolbar contrast), a fragile toolbar rendering pattern using refs, and a z-index stacking concern. There are also 6 lower-severity suggestions around cleanup, duplication, and edge cases.

## Critical Issues

None found.

## Important Issues

### [I1] Shortcut help dialog uses `<dialog open>` instead of `showModal()` -- no focus trapping
- **File:** `packages/client/src/pages/EditorPage.tsx:679`
- **Bug:** The keyboard shortcuts dialog is opened via the `open` HTML attribute rather than `dialog.showModal()`. This means the browser does not create a top layer, does not trap focus, and does not provide an accessible backdrop. Keyboard users can Tab out of the dialog into the editor and sidebar behind it.
- **Impact:** WCAG 2.1 AA violation (focus management). CLAUDE.md states accessibility is "a first-class design constraint, not optional." Screen readers will not announce this as a modal dialog.
- **Suggested fix:** Use a `ref` on the `<dialog>` element and call `ref.current.showModal()` in an effect when `shortcutHelpOpen` becomes true, and `ref.current.close()` when it becomes false. This provides native focus trapping, Escape handling, and top-layer rendering.
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases

### [I2] Toolbar at 45% opacity fails WCAG contrast requirements
- **File:** `packages/client/src/index.css:84-86` and `packages/client/src/components/EditorToolbar.tsx:13`
- **Bug:** The `.toolbar-breathe` class sets `opacity: 0.45` at rest. Toolbar buttons use `text-text-muted` (#8c7e72) which at 45% opacity on bg-primary (#f7f3ed) drops effective contrast to approximately 1.6:1 -- well below the WCAG AA minimum of 4.5:1 for small text (`text-xs`). The toolbar recovers to full opacity on hover/focus-within, and `prefers-reduced-motion` forces opacity to 1, but the default resting state fails for sighted users.
- **Impact:** WCAG 2.1 AA contrast violation. Users with low vision cannot read toolbar labels at rest. The visual appearance also suggests the toolbar is disabled/inactive, conflicting with the semantic `aria-pressed` state on buttons.
- **Suggested fix:** Raise resting opacity to at least 0.7-0.8, or use darker text colors that remain readable at reduced opacity. Verify contrast at the chosen opacity level.
- **Confidence:** High
- **Found by:** Logic & Correctness, Error Handling & Edge Cases

### [I3] EditorToolbar rendered from ref that doesn't trigger re-renders
- **File:** `packages/client/src/pages/EditorPage.tsx:467`
- **Bug:** The toolbar conditional `{viewMode === "editor" && editorRef.current?.editor && <EditorToolbar editor={editorRef.current.editor} />}` reads a React ref during render. The `Editor` component sets `editorRef.current` in a `useEffect` (post-render), but ref mutations don't trigger parent re-renders. The toolbar only becomes visible when an unrelated state change forces a re-render. During chapter switches, there is also a window where the ref points to a destroyed editor instance.
- **Impact:** Toolbar may be invisible on initial page load until the user interacts. During chapter transitions, there is a brief window where toolbar buttons could operate on a destroyed editor.
- **Suggested fix:** Lift the editor instance into React state via a callback (e.g., `onEditorReady(editor)` prop) so the toolbar conditional is driven by state, not a ref. Null out the editor state on chapter switch to prevent stale references.
- **Confidence:** High
- **Found by:** Logic & Correctness, Contract & Integration, Concurrency & State

### [I4] `body::before` pseudo-element at z-index 9999 overlays all dialogs
- **File:** `packages/client/src/index.css:46-56`
- **Bug:** The paper grain texture pseudo-element has `z-index: 9999` and `position: fixed` covering the viewport. Dialogs use `z-50` (Tailwind = z-index 50). The grain renders on top of all dialog backdrops and content. Mitigated by `pointer-events: none` and near-zero `opacity: 0.025`, but the stacking is technically incorrect.
- **Impact:** Subtle visual artifacts -- the paper grain texture overlays modal dialogs and their backdrops. At 0.025 opacity this is nearly invisible but could appear on high-contrast dialog content.
- **Suggested fix:** Lower z-index to `1` (only needs to be above the body background, below interactive content), or apply the grain as a `background-image` on `body` using `background-blend-mode`.
- **Confidence:** Medium
- **Found by:** Logic & Correctness, Error Handling & Edge Cases

## Suggestions

- **[S1] Orphaned `smudge-logo.png` asset** (`packages/client/src/assets/smudge-logo.png`): No longer imported anywhere. Delete to avoid repo bloat. (Found by: Contract & Integration, Confidence: 95%)

- **[S2] Stale `EditorHandle` type in test mock** (`packages/client/src/__tests__/ChapterTitle.test.tsx:25`): Mock uses old inline type `{ flushSave: () => void }` instead of the exported `EditorHandle` type with `editor` property. Import and use `EditorHandle` for type accuracy. (Found by: Contract & Integration, Confidence: 75%)

- **[S3] `handleSave` depends on full `[activeChapter]` instead of ref** (`packages/client/src/hooks/useProjectEditor.ts:121`): The callback only needs `activeChapter.id` but depends on the full object, causing unnecessary recreation on every save cycle. Use `activeChapterRef.current` instead. (Found by: Concurrency & State, Confidence: 75%)

- **[S4] Unmount save may call `getJSON()` on destroyed editor** (`packages/client/src/components/Editor.tsx:63-76`): TipTap's `useEditor` destroys the editor on unmount; cleanup effect order is unpredictable. The `.catch(() => {})` silently swallows the error. Guard with `!editor.isDestroyed` check. (Found by: Error Handling & Edge Cases, Confidence: 72%)

- **[S5] Global `transition: all` on buttons/anchors/inputs** (`packages/client/src/index.css:77-81`): Animates all CSS properties including width, height, padding. Replace with explicit properties: `transition: color 0.2s, background-color 0.2s, border-color 0.2s, box-shadow 0.2s, opacity 0.2s`. (Found by: Logic & Correctness, Error Handling & Edge Cases, Confidence: 70%)

- **[S6] Duplicate SVG filter `id="smudge"` in Logo** (`packages/client/src/components/Logo.tsx:13`): Hardcoded filter ID is fragile if Logo is ever rendered twice simultaneously. Use `React.useId()` for uniqueness. (Found by: Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Confidence: 60%)

## Plan Alignment

- **Implemented:** Colors (#F7F3ED, #1C1917, #8B5E2F) match CLAUDE.md exactly. Fonts (DM Sans UI, Cormorant Garamond manuscript) correctly set up via @fontsource. Serif/sans-serif boundary faithfully follows the rule (serif = manuscript, sans-serif = tool). Layout dimensions (720px editor, 680px preview, 260px sidebar) match spec. Accessibility features preserved (ARIA, focus rings, reduced-motion, semantic HTML). Self-hosted fonts for offline reliability.
- **Not yet implemented:** Toolbar content/completeness flagged as TODO in `docs/TODO.md`. Overall the implementation is thorough and well-aligned.
- **Deviations:** Dashboard heading dropped serif font (defensible -- it is UI chrome). No other contradictions with plan.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** 23 changed files + adjacent callers/tests
- **Raw findings:** 25 (before verification)
- **Verified findings:** 10 (after verification)
- **Filtered out:** 15
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** docs/plans/mvp.md
