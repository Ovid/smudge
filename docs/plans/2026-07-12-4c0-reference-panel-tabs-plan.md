# Reference Panel Multi-Tab Refactor (Phase 4c.0) Implementation Plan

**Goal:** Turn the hard-coded single-"Images" reference panel into a real
multi-tab panel driven by a `tabs` array, with active-tab persistence — a
**pure refactor with no user-visible behavior change** (Images stays the only
tab). This is the prerequisite that lets Phase 4c.1 (Inline Notes) add a
second tab by appending one array entry.

**Spec source:** `docs/plans/2026-07-12-notes-design.md` — Appendix "4c.0
Reference Panel Multi-Tab Refactor".

**Non-goals:** No Notes tab. No new strings beyond a tab structure. No editor
changes. Roving-tabindex/arrow-key tab navigation is **deliberately deferred**:
each tab is a native `<button role="tab">` (Tab-focusable, Enter/Space-
activatable), which satisfies WCAG 2.1.1 and passes aXe. The ARIA-APG arrow-key
roving pattern is an enhancement for whenever it's actually wanted.

**Repo constraints (CLAUDE.md):** TDD red-green-refactor; coverage floors
95/85/90/95; zero-warning test output (client console only via
`expectConsole()`); all UI strings in `strings.ts`; one refactor per PR.

**Existing behavior = regression net.** The current `ReferencePanel.test.tsx`
and `useReferencePanelState.test.ts` already assert the Images tab, the
tablist/tabpanel roles, resize, and persistence. They are updated to the new
API but must keep asserting the same observable behavior.

---

## Task 1: `useReferencePanelState` active-tab persistence

Add active-tab state + persistence to the hook, mirroring the existing
open/width persistence exactly.

**Files:**
- Modify: `packages/client/src/hooks/useReferencePanelState.ts`
- Modify: `packages/client/src/__tests__/useReferencePanelState.test.ts`

**Step 1 — Failing tests** (append to the existing suite):
- default `activeTabId` is `"images"`.
- `setActiveTab("images")` persists `smudge:ref-panel-active-tab` = `"images"`
  to localStorage and updates state.
- reads a saved `smudge:ref-panel-active-tab` on init.
- `setActiveTab` tolerates `localStorage.setItem` throwing (state still
  updates) — mirror the existing resize/toggle throw tests.

**Step 3 — Implement:** add
`const PANEL_ACTIVE_TAB_KEY = "smudge:ref-panel-active-tab";` and a
`getSavedActiveTab()` (default `"images"`, try/catch like the others), a
`[activeTabId, setActiveTabState]` `useState`, and a `setActiveTab(id: string)`
`useCallback` that setstates + try/catch-persists. Return `activeTabId` and
`setActiveTab` alongside the existing values.

**Step 5 — Commit:** `refactor(4c.0): persist reference-panel active tab`.

---

## Task 2: `ReferencePanel` tabs API

Replace the hard-coded Images button + `children` with a `tabs` array driving a
real tablist and the active tabpanel. Resize handle behavior is untouched.

**Files:**
- Modify: `packages/client/src/components/ReferencePanel.tsx`
- Modify: `packages/client/src/__tests__/ReferencePanel.test.tsx`

**New props:**
```ts
interface ReferencePanelTab { id: string; label: string; panel: React.ReactNode; }
interface ReferencePanelProps {
  width: number;
  onResize: (newWidth: number) => void;
  tabs: ReferencePanelTab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
}
```

**Step 1 — Failing/updated tests:** rewrite the fixture from `children` to a
`tabs` array. Assert:
- one `role="tab"` button per tab, labelled from `tab.label`.
- the active tab has `aria-selected="true"`; others `"false"`.
- the active tab's `panel` renders in the tabpanel; inactive panels do not.
- clicking a non-active tab calls `onSelectTab(thatId)` (drive with a 2-tab
  fixture so there is a non-active tab to click).
- `aria-controls`/`aria-labelledby` wire the active tab ↔ tabpanel.
- **all existing resize tests stay green unchanged** (separator ARIA, keyboard
  resize, mouse drag, cleanup, preventDefault).

**Step 3 — Implement:** render `tabs.map` of
`<button role="tab" id={`${t.id}-tab`} aria-selected={t.id===activeTabId}
aria-controls={`${t.id}-tabpanel`} onClick={() => onSelectTab(t.id)}>`; render a
single tabpanel `aria-labelledby={`${activeTabId}-tab`}
id={`${activeTabId}-tabpanel`}` containing `tabs.find(t => t.id===activeTabId)?.panel`.
Keep the `aside`/separator markup and classes as-is.
`// ponytail: native-button tabs, no roving-tabindex arrow nav until 2+ tabs need APG polish`

**Step 5 — Commit:** `refactor(4c.0): ReferencePanel tabs API`.

---

## Task 3: Wire the tabs array through EditorMainContent + EditorPage

Build the single-entry `tabs` array (Images → `ImageGallery`) and thread
`activeTabId`/`onSelectTab` from the hook.

**Files:**
- Modify: `packages/client/src/components/EditorMainContent.tsx` (build the
  `tabs` array from the existing `ImageGallery` render; add `activeTabId` +
  `onSelectTab` props; pass all three to `ReferencePanel`)
- Modify: `packages/client/src/pages/EditorPage.tsx` (pull `activeTabId` +
  `setActiveTab` from `useReferencePanelState`; pass down to
  `EditorMainContent` as `activeTabId` / `onSelectTab`)
- Modify: `packages/client/src/__tests__/editorEntryPointSurface.test.ts` (add
  `activeTabId` and `onSelectTab` to `EDITOR_MAIN_CONTENT_PROPS` — these are
  **non-mutating view props**: switching reference-panel tabs does not touch
  editor content, so no busy/lock guard is required; record them per the
  header's "view-only → no guard" branch)

**Step 1 — Failing test:** the surface test goes RED first once the two props
are added to EditorMainContent's JSX (or update the committed list first, watch
it fail, then wire — either order; the point is the list and the JSX must
agree). No new behavioral test is required beyond the existing
`EditorPageFeatures`/`ReferencePanel` coverage — Images remains the only tab,
so observable behavior is unchanged.

**Step 3 — Implement:** in `EditorMainContent`, replace the
`<ReferencePanel width onResize>{<ImageGallery .../>}</ReferencePanel>` block
with `tabs={[{ id: "images", label: STRINGS.referencePanel.imagesTab, panel:
<ImageGallery .../> }]}` plus `activeTabId={activeTabId}
onSelectTab={onSelectTab}`. Add the two props to `EditorMainContentProps`. In
`EditorPage`, destructure `activeTabId, setActiveTab` from the hook and pass
`activeTabId={activeTabId} onSelectTab={setActiveTab}`.

**Step 5 — Commit:** `refactor(4c.0): wire reference-panel tabs through EditorPage`.

---

## Final verification (before opening the PR)

- `make all` (lint + format + typecheck + coverage + e2e) is green.
- Coverage did not drop below the floors.
- Zero warnings in test output.
- Manual smoke (`make dev`): open the reference panel, confirm the Images tab
  renders the gallery exactly as before; reload and confirm the panel state
  (open/width/active tab) persists.
- PR description references **Phase 4c.0** and notes it unblocks 4c.1.
