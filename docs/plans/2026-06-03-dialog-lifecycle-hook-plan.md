# Dialog Lifecycle Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a single `useDialogLifecycle` hook owning native `<dialog>` show/close sync, focus-on-open, Escape-to-close, and backdrop-click-to-close, then migrate all five dialogs onto it.

**Architecture:** One client hook (`packages/client/src/hooks/useDialogLifecycle.ts`) owns the lifecycle effects and returns `{ dialogRef, onBackdropClick }`. ARIA stays in each component's JSX. Escape is unified onto a document `keydown` listener (capture-phase + `stopImmediatePropagation` when `blockEscapePropagation`). Each dialog migration is its own commit; the hook + five migrations + the CLAUDE.md note are one PR.

**Tech Stack:** React 19, TypeScript, Vitest + @testing-library/react (jsdom), Tailwind.

**Design:** `docs/plans/2026-06-03-dialog-lifecycle-hook-design.md` (read it first — §Behavior contract, §Three rendering patterns, §Backdrop structure for ProjectSettingsDialog).

---

## File Structure

- Create: `packages/client/src/hooks/useDialogLifecycle.ts` — the hook (lifecycle effects + `onBackdropClick`).
- Create: `packages/client/src/hooks/useDialogLifecycle.test.ts` — hook unit tests (rendered via a harness component).
- Modify: `packages/client/src/components/ExportDialog.tsx` — migrate (Task 3).
- Modify: `packages/client/src/components/ConfirmDialog.tsx` — migrate (Task 4).
- Modify: `packages/client/src/components/NewProjectDialog.tsx` — migrate (Task 5).
- Modify: `packages/client/src/components/ShortcutHelpDialog.tsx` — migrate (Task 6).
- Create: `packages/client/src/__tests__/ShortcutHelpDialog.test.tsx` — new characterization tests (Task 6).
- Modify: `packages/client/src/components/ProjectSettingsDialog.tsx` — migrate + full-bleed wrapper + backdrop (Task 7).
- Modify: `packages/client/src/__tests__/ProjectSettingsDialog.test.tsx` — ADD a backdrop-dismiss test (Task 7).
- Modify: `CLAUDE.md` — §Key Architecture Decisions entry (Task 8).

**Regression net (do NOT modify these existing tests):** `ConfirmDialog.test.tsx`, `ExportDialog.test.tsx`, `NewProjectDialog.test.tsx`, and the *existing* cases in `ProjectSettingsDialog.test.tsx`. They must stay green unchanged. New test cases are additions only.

**Commit discipline:** one commit per task. Run `npm test -w packages/client` (or the targeted file) before each commit; never commit red.

---

## Task 1: Create the `useDialogLifecycle` hook (TDD)

**Files:**
- Create: `packages/client/src/hooks/useDialogLifecycle.test.ts`
- Create: `packages/client/src/hooks/useDialogLifecycle.ts`

- [ ] **Step 1: Write the failing test file**

Create `packages/client/src/hooks/useDialogLifecycle.test.ts`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { useRef } from "react";
import { useDialogLifecycle } from "./useDialogLifecycle";

afterEach(cleanup);

// Harness that always renders the <dialog> (toggle pattern) so close() can fire.
function Harness({
  open,
  onClose,
  withFocus = false,
  block = false,
}: {
  open: boolean;
  onClose: () => void;
  withFocus?: boolean;
  block?: boolean;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const { dialogRef, onBackdropClick } = useDialogLifecycle({
    open,
    onClose,
    initialFocusRef: withFocus ? btnRef : undefined,
    blockEscapePropagation: block,
  });
  return (
    <dialog ref={dialogRef} onClick={onBackdropClick} data-testid="dlg">
      <div data-testid="card">card</div>
      <button ref={btnRef}>focus-target</button>
    </dialog>
  );
}

// Harness that NEVER renders the <dialog> (null-ref case).
function NullHarness({ open, onClose }: { open: boolean; onClose: () => void }) {
  useDialogLifecycle({ open, onClose });
  return null;
}

describe("useDialogLifecycle", () => {
  it("calls showModal() when open goes false -> true", () => {
    const spy = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const { rerender } = render(<Harness open={false} onClose={vi.fn()} />);
    expect(spy).not.toHaveBeenCalled();
    rerender(<Harness open={true} onClose={vi.fn()} />);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("calls close() when open goes true -> false", () => {
    const spy = vi.spyOn(HTMLDialogElement.prototype, "close");
    const { rerender } = render(<Harness open={true} onClose={vi.fn()} />);
    rerender(<Harness open={false} onClose={vi.fn()} />);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("does not throw and does not call showModal when the dialog ref is null", () => {
    const spy = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    expect(() => render(<NullHarness open={true} onClose={vi.fn()} />)).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("focuses initialFocusRef on the open transition (including mount-with-open)", () => {
    const { getByText } = render(<Harness open={true} onClose={vi.fn()} withFocus />);
    expect(getByText("focus-target")).toHaveFocus();
  });

  it("does not move focus to the target when initialFocusRef is omitted", () => {
    const { getByText } = render(<Harness open={true} onClose={vi.fn()} />);
    expect(getByText("focus-target")).not.toHaveFocus();
  });

  it("Escape (default/bubble) calls onClose and preventDefaults", () => {
    const onClose = vi.fn();
    render(<Harness open={true} onClose={onClose} />);
    const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("default Escape does NOT stop other document keydown listeners", () => {
    const onClose = vi.fn();
    const sibling = vi.fn();
    document.addEventListener("keydown", sibling);
    render(<Harness open={true} onClose={onClose} />);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).toHaveBeenCalled();
    expect(sibling).toHaveBeenCalled();
    document.removeEventListener("keydown", sibling);
  });

  it("blockEscapePropagation stops other document keydown listeners (capture + stopImmediatePropagation)", () => {
    const onClose = vi.fn();
    const sibling = vi.fn();
    document.addEventListener("keydown", sibling); // bubble-phase sibling
    render(<Harness open={true} onClose={onClose} block />);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sibling).not.toHaveBeenCalled();
    document.removeEventListener("keydown", sibling);
  });

  it("removes the Escape listener when open goes false", () => {
    const onClose = vi.fn();
    const { rerender } = render(<Harness open={true} onClose={onClose} />);
    rerender(<Harness open={false} onClose={onClose} />);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("removes the Escape listener on unmount", () => {
    const onClose = vi.fn();
    const { unmount } = render(<Harness open={true} onClose={onClose} />);
    unmount();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("onBackdropClick calls onClose only when the target is the dialog itself", () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<Harness open={true} onClose={onClose} />);
    fireEvent.click(getByTestId("card")); // child -> ignored
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(getByTestId("dlg")); // dialog itself -> closes
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w packages/client -- useDialogLifecycle`
Expected: FAIL — `Failed to resolve import "./useDialogLifecycle"` (module does not exist yet).

- [ ] **Step 3: Implement the hook**

Create `packages/client/src/hooks/useDialogLifecycle.ts`:

```tsx
import { useEffect, useRef } from "react";

interface UseDialogLifecycleOptions {
  /** Whether the dialog should currently be shown. */
  open: boolean;
  /** Called when the dialog requests to close (Escape, backdrop). */
  onClose: () => void;
  /** Optional element to focus after showModal() on the open transition. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /**
   * When true, the Escape listener is registered in the capture phase and calls
   * stopImmediatePropagation() so other document-level keydown listeners (e.g.
   * the FindReplacePanel's) do not also fire. Used by ConfirmDialog.
   */
  blockEscapePropagation?: boolean;
}

interface DialogLifecycle {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  onBackdropClick: (e: React.MouseEvent) => void;
}

/**
 * Single owner of native <dialog> lifecycle: show/close sync, focus-on-open,
 * Escape-to-close, and an opt-in backdrop-click handler. See
 * docs/plans/2026-06-03-dialog-lifecycle-hook-design.md.
 */
export function useDialogLifecycle({
  open,
  onClose,
  initialFocusRef,
  blockEscapePropagation = false,
}: UseDialogLifecycleOptions): DialogLifecycle {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const prevOpenRef = useRef(false);

  // Keep the latest onClose in a ref so the Escape effect does not re-subscribe
  // every render when the caller passes an inline closure.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Show/close sync + focus on the false->true transition.
  useEffect(() => {
    const dialog = dialogRef.current;
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (!dialog) return;
    if (open && !dialog.open) {
      try {
        dialog.showModal();
      } catch {
        // Environments without full <dialog> support (jsdom test env).
      }
      if (!wasOpen) initialFocusRef?.current?.focus();
    } else if (!open && dialog.open) {
      try {
        dialog.close();
      } catch {
        // Environments without full <dialog> support (jsdom test env).
      }
    }
  }, [open, initialFocusRef]);

  // Escape-to-close. preventDefault() matches the existing ConfirmDialog/
  // ExportDialog implementations and suppresses default Escape side-effects; it
  // does NOT cancel the native dialog close — React drives the close.
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (blockEscapePropagation) e.stopImmediatePropagation();
      onCloseRef.current();
    }
    document.addEventListener("keydown", handleKeyDown, blockEscapePropagation);
    return () => document.removeEventListener("keydown", handleKeyDown, blockEscapePropagation);
  }, [open, blockEscapePropagation]);

  const onBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCloseRef.current();
  };

  return { dialogRef, onBackdropClick };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w packages/client -- useDialogLifecycle`
Expected: PASS — all 11 cases green.

- [ ] **Step 5: Lint + typecheck the new files**

Run: `npm run lint -w packages/client && npm run typecheck -w packages/client` (or `make lint` + `make typecheck` from repo root)
Expected: no errors, no warnings.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/hooks/useDialogLifecycle.ts packages/client/src/hooks/useDialogLifecycle.test.ts
git commit -m "feat(4b.16): add useDialogLifecycle hook"
```

---

## Task 2: Verify the regression net is green (baseline)

**Files:** none (read-only verification).

- [ ] **Step 1: Run all dialog tests against unmigrated components**

Run: `npm test -w packages/client -- ConfirmDialog ExportDialog NewProjectDialog ProjectSettingsDialog`
Expected: PASS. This is the baseline — these four files must stay green, unmodified, through Tasks 3–7. No commit (verification only).

---

## Task 3: Migrate ExportDialog

**Files:**
- Modify: `packages/client/src/components/ExportDialog.tsx`

- [ ] **Step 1: Replace the dialogRef + show/close effect + Escape effect with the hook**

In `ExportDialog.tsx`:

1. Add the import: `import { useDialogLifecycle } from "../hooks/useDialogLifecycle";`
2. Replace the two lines declaring `dialogRef` and `cancelRef`:

```tsx
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
```

with:

```tsx
  const cancelRef = useRef<HTMLButtonElement>(null);
  const { dialogRef, onBackdropClick } = useDialogLifecycle({
    open,
    onClose,
    initialFocusRef: cancelRef,
  });
```

3. Delete the entire `// Show/close modal` effect (the `useEffect` calling `showModal`/`close`/`cancelRef.current?.focus()`) and the entire `// Escape key handler` effect (the `useEffect` adding the `keydown` listener). The hook now owns both.
4. On the `<dialog>` element, replace the inline `onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}` with `onClick={onBackdropClick}`.

Leave untouched: the form-reset `prevOpenRef` effect, the cover-images effect, `handleExport`, `handleChapterToggle`, the `if (!open) return null` guard (return-null rendering pattern — preserved per design §Three rendering patterns), and all JSX/ARIA.

- [ ] **Step 2: Run ExportDialog tests (unmodified) to verify they still pass**

Run: `npm test -w packages/client -- ExportDialog`
Expected: PASS — including "calls onClose when Escape key is pressed", "calls onClose when clicking backdrop", "calls onClose when cancel is clicked", and the export-flow cases. No test edits.

- [ ] **Step 3: Lint + typecheck**

Run: `npm run lint -w packages/client && npm run typecheck -w packages/client`
Expected: clean. (Confirm `useEffect` is still imported only if still used; remove it from the import if no longer referenced.)

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/components/ExportDialog.tsx
git commit -m "refactor(4b.16): migrate ExportDialog to useDialogLifecycle"
```

---

## Task 4: Migrate ConfirmDialog

**Files:**
- Modify: `packages/client/src/components/ConfirmDialog.tsx`

- [ ] **Step 1: Replace both effects with the hook (open is the literal true)**

Rewrite the component body so it reads:

```tsx
import { useRef } from "react";
import { useDialogLifecycle } from "../hooks/useDialogLifecycle";

interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const { dialogRef, onBackdropClick } = useDialogLifecycle({
    open: true,
    onClose: onCancel,
    initialFocusRef: cancelRef,
    blockEscapePropagation: true,
  });

  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-label={title}
      aria-describedby="confirm-dialog-body"
      className="fixed inset-0 z-50 flex items-center justify-center bg-transparent m-0 p-0 w-full h-full border-none backdrop:bg-black/30"
      onClick={onBackdropClick}
    >
      <div className="rounded-xl bg-bg-primary p-8 shadow-xl max-w-sm w-full mx-auto mt-[20vh] border border-border/60">
        <p className="text-text-primary font-semibold text-base mb-2">{title}</p>
        <p id="confirm-dialog-body" className="text-text-secondary text-sm mb-6 leading-relaxed">
          {body}
        </p>
        <div className="flex justify-end gap-3">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="rounded-lg px-5 py-2.5 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover focus:outline-none focus:ring-2 focus:ring-focus-ring"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-status-error px-5 py-2.5 text-sm font-medium text-text-inverse hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-focus-ring shadow-sm"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
```

The `role="alertdialog"` and the `aria-*` attributes stay in JSX (the hook does not own ARIA). `open: true` reflects ConfirmDialog's mount-gated pattern (it only renders while shown). `blockEscapePropagation: true` preserves the capture-phase Escape + `stopImmediatePropagation` that shields the FindReplacePanel.

- [ ] **Step 2: Run ConfirmDialog tests (unmodified) to verify they still pass**

Run: `npm test -w packages/client -- ConfirmDialog`
Expected: PASS — "calls onCancel when Escape key is pressed", confirm/cancel button cases, and the render case. No test edits.

- [ ] **Step 3: Lint + typecheck**

Run: `npm run lint -w packages/client && npm run typecheck -w packages/client`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/components/ConfirmDialog.tsx
git commit -m "refactor(4b.16): migrate ConfirmDialog to useDialogLifecycle"
```

---

## Task 5: Migrate NewProjectDialog

**Files:**
- Modify: `packages/client/src/components/NewProjectDialog.tsx`

- [ ] **Step 1: Replace the show/close effect with the hook; remove the native onClose prop**

In `NewProjectDialog.tsx`:

1. Add the import: `import { useDialogLifecycle } from "../hooks/useDialogLifecycle";`
2. Replace `const dialogRef = useRef<HTMLDialogElement>(null);` with:

```tsx
  const { dialogRef } = useDialogLifecycle({ open, onClose });
```

3. Delete the entire show/close `useEffect`.
4. On the `<dialog>` element, remove the `onClose={onClose}` attribute (Escape now flows through the hook's `keydown` listener). Do **not** add `onClick`/`onBackdropClick` — NewProjectDialog deliberately has no backdrop-dismiss (data-loss footgun on the title field).
5. Keep `autoFocus` on the title `<input>` (no `initialFocusRef` is passed — native focus is preserved). Keep `handleSubmit`, `handleCancel`, the form reset, and the always-rendered pattern.
6. Fix the imports: drop `useEffect` (no longer used); keep `useRef`, `useState`.

- [ ] **Step 2: Run NewProjectDialog tests (unmodified) to verify they still pass**

Run: `npm test -w packages/client -- NewProjectDialog`
Expected: PASS — "calls showModal when opened" (the hook calls `dialog.showModal()`), "calls close when open changes to false" (the hook calls `dialog.close()`), "calls onClose and resets form on cancel", and the submit/validation cases. No test edits.

- [ ] **Step 3: Lint + typecheck**

Run: `npm run lint -w packages/client && npm run typecheck -w packages/client`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/components/NewProjectDialog.tsx
git commit -m "refactor(4b.16): migrate NewProjectDialog to useDialogLifecycle"
```

---

## Task 6: Migrate ShortcutHelpDialog (+ new characterization tests)

**Files:**
- Create: `packages/client/src/__tests__/ShortcutHelpDialog.test.tsx`
- Modify: `packages/client/src/components/ShortcutHelpDialog.tsx`

- [ ] **Step 1: Write the new characterization test file**

ShortcutHelpDialog has no test today. Create `packages/client/src/__tests__/ShortcutHelpDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ShortcutHelpDialog } from "../components/ShortcutHelpDialog";

afterEach(cleanup);

describe("ShortcutHelpDialog", () => {
  it("calls showModal when opened", () => {
    const spy = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    render(<ShortcutHelpDialog open={true} onClose={vi.fn()} />);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("calls close when open changes to false", () => {
    const spy = vi.spyOn(HTMLDialogElement.prototype, "close");
    const { rerender } = render(<ShortcutHelpDialog open={true} onClose={vi.fn()} />);
    rerender(<ShortcutHelpDialog open={false} onClose={vi.fn()} />);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("calls onClose when clicking the backdrop", () => {
    const onClose = vi.fn();
    render(<ShortcutHelpDialog open={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(<ShortcutHelpDialog open={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
```

Note `getByRole("dialog")` resolves the `<dialog aria-label=…>` element; clicking it directly hits the backdrop branch of `onBackdropClick`.

- [ ] **Step 2: Run the new tests against the CURRENT (unmigrated) component**

Run: `npm test -w packages/client -- ShortcutHelpDialog`
Expected: show/close and backdrop cases PASS (current code already does these); the **Escape** case FAILS — the current component relies on the native `<dialog onClose>` event, which the jsdom `showModal`/`close` polyfill (a dumb attribute toggle) never fires. This red case is what the migration turns green (it also makes Escape genuinely testable).

- [ ] **Step 3: Migrate the component**

In `ShortcutHelpDialog.tsx`:

1. Add the import: `import { useDialogLifecycle } from "../hooks/useDialogLifecycle";`
2. Replace `const dialogRef = useRef<HTMLDialogElement>(null);` with:

```tsx
  const { dialogRef, onBackdropClick } = useDialogLifecycle({ open, onClose });
```

3. Delete the show/close `useEffect`.
4. On the `<dialog>`, replace the inline `onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}` with `onClick={onBackdropClick}`, and remove the `onClose={onClose}` attribute.
5. Fix imports: drop `useEffect` (and `useRef` if no longer used — `dialogRef` now comes from the hook).

- [ ] **Step 4: Run the new tests against the migrated component**

Run: `npm test -w packages/client -- ShortcutHelpDialog`
Expected: PASS — all four cases, including Escape.

- [ ] **Step 5: Lint + typecheck**

Run: `npm run lint -w packages/client && npm run typecheck -w packages/client`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/components/ShortcutHelpDialog.tsx packages/client/src/__tests__/ShortcutHelpDialog.test.tsx
git commit -m "refactor(4b.16): migrate ShortcutHelpDialog to useDialogLifecycle"
```

---

## Task 7: Migrate ProjectSettingsDialog (+ full-bleed wrapper + backdrop test)

**Files:**
- Modify: `packages/client/src/components/ProjectSettingsDialog.tsx`
- Modify: `packages/client/src/__tests__/ProjectSettingsDialog.test.tsx` (ADD one test; do not touch existing cases)

- [ ] **Step 1: Add the new backdrop-dismiss test (red against current code)**

Append a new case to `ProjectSettingsDialog.test.tsx` (do not modify existing cases). Use the existing file's `project` fixture/props shape; a minimal standalone render is fine:

```tsx
  it("calls onClose when clicking the backdrop (4b.16)", () => {
    const onClose = vi.fn();
    render(
      <ProjectSettingsDialog
        open={true}
        project={{
          slug: "p",
          target_word_count: null,
          target_deadline: null,
          author_name: null,
        }}
        onClose={onClose}
        onUpdate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalled();
  });
```

`fireEvent` and `screen` are already imported in this file. If the dialog makes a settings GET on open, the existing tests already mock `api.settings.get`; reuse that mock setup (mirror the top-of-file `beforeEach`/mock in the existing suite so this case does not emit unhandled-rejection or console noise — recall raw `vi.spyOn(console,…)` is banned; if any console output appears, gate it with `expectConsole`).

- [ ] **Step 2: Run to verify the new test fails (and existing cases pass)**

Run: `npm test -w packages/client -- ProjectSettingsDialog`
Expected: the new backdrop case FAILS (current component has no backdrop handler — clicking the dialog does nothing). All existing cases PASS.

- [ ] **Step 3: Migrate the component + add the full-bleed inner wrapper**

In `ProjectSettingsDialog.tsx`:

1. Add the import: `import { useDialogLifecycle } from "../hooks/useDialogLifecycle";`
2. Replace `const dialogRef = useRef<HTMLDialogElement>(null);` with:

```tsx
  const { dialogRef, onBackdropClick } = useDialogLifecycle({ open, onClose });
```

3. Delete the show/close `useEffect` (the one calling `showModal`/`close` in try/catch). Leave the open-transition settings-fetch effect, `saveField`, `handleTimezoneChange`, and all other logic untouched.
4. Restructure the `<dialog>` so positioning/sizing stays on the element and a **full-bleed inner `<div>`** carries padding + background + scroll (pushback Finding 1 — so `onBackdropClick`'s `target === currentTarget` fires only on the `::backdrop`, never the panel's own padding):

```tsx
  return (
    <dialog
      ref={dialogRef}
      onClick={onBackdropClick}
      className="w-full max-w-sm rounded-none rounded-l-xl backdrop:bg-black/50 border-none m-0 p-0"
      style={{
        position: "fixed",
        right: "0",
        top: "0",
        left: "auto",
        margin: "0",
        height: "100vh",
        maxHeight: "100vh",
      }}
    >
      <div className="w-full h-full bg-bg-primary p-6 overflow-y-auto rounded-l-xl">
        {/* ... existing header, error banner, and all fields, unchanged ... */}
      </div>
    </dialog>
  );
```

Move `bg-bg-primary`, `p-6`, and `overflow-y-auto` off the `<dialog>` and onto the inner `<div>` (which is `w-full h-full`). Keep `max-w-sm` + the rounded-left corner + `backdrop:bg-black/50` + the inline positioning on the `<dialog>`; add `p-0 m-0 border-none` to the dialog so it has no clickable padding of its own. Remove the `onClose={onClose}` attribute. The entire existing inner content (the `<div className="flex items-center justify-between …">` header, the error `<p>`, and the `<div className="flex flex-col gap-4">` fields block) moves inside the new wrapper `<div>` verbatim.

5. Fix imports: drop `useEffect` only if no longer used (the settings-fetch effect still uses it — likely keep it); `useRef` is still used elsewhere (`confirmedFieldsRef`, etc.). `dialogRef` now comes from the hook.

- [ ] **Step 4: Run to verify the new backdrop test passes and existing cases still pass**

Run: `npm test -w packages/client -- ProjectSettingsDialog`
Expected: PASS — the new backdrop case is green; "calls onClose when close button is clicked", the blur-save cases, and the abort cases all still pass.

- [ ] **Step 5: Lint + typecheck**

Run: `npm run lint -w packages/client && npm run typecheck -w packages/client`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/components/ProjectSettingsDialog.tsx packages/client/src/__tests__/ProjectSettingsDialog.test.tsx
git commit -m "refactor(4b.16): migrate ProjectSettingsDialog to useDialogLifecycle; add backdrop-dismiss"
```

---

## Task 8: Add the CLAUDE.md §Key Architecture Decisions entry

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Insert the entry**

In `CLAUDE.md` §Key Architecture Decisions, add a new bolded entry (place it after the "Unified API error mapping" / "String externalization" cluster, alongside the other shared-primitive routing invariants):

```markdown
**Dialog lifecycle lives in one hook.** Native `<dialog>` show/close sync,
focus-on-open, Escape-to-close, and backdrop-click-to-close route through
`useDialogLifecycle` (`packages/client/src/hooks/useDialogLifecycle.ts`)
rather than per-dialog `useEffect`/listener reimplementations. Options:
`initialFocusRef` (focus a specific element after `showModal()`) and
`blockEscapePropagation` (capture-phase Escape + `stopImmediatePropagation`,
as `ConfirmDialog` uses to shield the FindReplacePanel's Escape listener). The
hook owns the lifecycle effects and returns an opt-in `onBackdropClick`; ARIA
(`role`, `aria-*`) stays in each component's JSX. New dialogs adopt the hook
rather than copying a neighbour.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(4b.16): document useDialogLifecycle in CLAUDE.md"
```

---

## Task 9: Full verification

**Files:** none (verification).

- [ ] **Step 1: Confirm the regression-net files were never modified**

Run: `git diff --stat main -- packages/client/src/__tests__/ConfirmDialog.test.tsx packages/client/src/__tests__/ExportDialog.test.tsx packages/client/src/__tests__/NewProjectDialog.test.tsx`
Expected: empty output (these three files are byte-for-byte unchanged from `main`). `ProjectSettingsDialog.test.tsx` shows only the appended backdrop case.

- [ ] **Step 2: Full client suite**

Run: `npm test -w packages/client`
Expected: PASS, zero `console.warn`/`console.error` leakage (the `assertConsoleExpectationsSettled` afterEach stays silent).

- [ ] **Step 3: Coverage**

Run: `make cover`
Expected: PASS — statements ≥95%, branches ≥85%, functions ≥90%, lines ≥95%. The new hook is small and fully exercised by Task 1's tests; confirm no regression below the floors.

- [ ] **Step 4: Full pass (lint, format, typecheck, coverage, e2e)**

Run: `make all`
Expected: green. The aXe-core e2e checks cover dialog focus/Escape/ARIA in real Chromium.

- [ ] **Step 5: No commit** — verification only. The PR is ready for review.

---

## Self-Review

**1. Spec coverage** (design → task):

- `useDialogLifecycle` hook with the §Behavior contract (show/close, focus-on-open, Escape default + `blockEscapePropagation`, `onBackdropClick`, always-on try/catch, listener cleanup) → Task 1 (hook) + its 11 unit tests.
- Escape unified onto a document `keydown` listener (capture + `stopImmediatePropagation` opt-in) → Task 1 hook + tests; preserved per-dialog in Tasks 3–7.
- `safeShowClose` dropped → always-on try/catch in the Task 1 hook (no option).
- `role` dropped from the signature; ARIA stays in JSX → Task 4 keeps `role="alertdialog"` in `ConfirmDialog`.
- ConfirmDialog `open={true}` (mount-gated) → Task 4.
- Migration order (Export+Confirm → NewProject+ShortcutHelp → ProjectSettings) → Tasks 3,4,5,6,7 in that order.
- Pushback F1 (full-bleed inner wrapper for ProjectSettings) → Task 7 Step 3.
- Pushback F2 (preserve the three rendering patterns) → Task 3 (return-null kept), Task 4 (mount-gated), Tasks 5/6 (always-rendered toggle), Task 7 (return-null kept). No normalization.
- Pushback F3 (keep `preventDefault`, correct rationale) → Task 1 hook comment + behavior.
- NewProject backdrop stays off → Task 5 Step 1 (no `onBackdropClick`).
- New characterization tests: `ShortcutHelpDialog.test.tsx` → Task 6; ProjectSettings backdrop case → Task 7.
- Existing tests green without modification → Task 2 (baseline) + Task 9 Step 1 (diff check).
- CLAUDE.md §Key Architecture Decisions entry → Task 8.
- Coverage floors / zero warnings / `make all` → Task 9.
- DoD amendment (only behavior change = ProjectSettings backdrop-dismiss) → Task 7 is the sole behavior change; Tasks 3–6 are pure refactors verified by unmodified tests.

**2. Placeholder scan:** No "TBD"/"TODO"/"add error handling"-style placeholders. Every code step shows complete code; every run step shows the command + expected result.

**3. Type consistency:** `useDialogLifecycle({ open, onClose, initialFocusRef?, blockEscapePropagation? })` returning `{ dialogRef, onBackdropClick }` is used identically in Task 1 (definition) and Tasks 3–7 (consumers). `initialFocusRef?: React.RefObject<HTMLElement | null>` accepts the components' `useRef<HTMLButtonElement>(null)` (TS treats object property types covariantly). `dialogRef: React.RefObject<HTMLDialogElement | null>` matches each `<dialog ref={dialogRef}>`. `onBackdropClick: (e: React.MouseEvent) => void` matches each `onClick={onBackdropClick}`. Consumers that omit `onBackdropClick` (NewProject) simply don't destructure it.
