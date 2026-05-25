# Phase 4b.3a.4: Image Gallery Abort Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `ImageGallery` from two hand-rolled `useRef<AbortController>` refs (`mutateAbortRef`, `refsAbortRef`) + a combined unmount cleanup effect to two side-by-side `useAbortableAsyncOperation` instances (`mutationOp`, `refsOp`), extract the inline JSX delete-button `onClick` arrow to a named `handleOpenDeleteConfirm`, collapse the structural-check ban globally, and tighten one sentence of CLAUDE.md prose — all with no user-visible behaviour change.

**Architecture:** `ImageGallery` allocates `mutationOp = useAbortableAsyncOperation()` (shared by `handleFileSelect`, `handleSave`, `handleInsert` inner branch, and `handleDelete`) and `refsOp = useAbortableAsyncOperation()` (owned by the extracted `handleOpenDeleteConfirm`). The combined unmount cleanup `useEffect` at lines 74–80 is removed; both hook instances handle their own auto-abort. The list-load `useEffect` (lines 98–127) and detail-references `useEffect` (lines 145–170) are **untouched** — their lifecycle is "controller-per-effect, cleanup-on-dep-change," different from this hook's contract. The structural-check tests in `migrationStructuralCheck.test.ts` collapse two per-file abort-migration assertions into one global `useRef<AbortController>` ban, since 4b.3a.4 is the last consumer migration.

**Tech Stack:** TypeScript, React 18, Vitest + `@testing-library/react` + `@testing-library/user-event`, vi mocks. Component lives in `packages/client/src/components/`; tests in `packages/client/src/__tests__/`. The `pendingUntilAbort` helper in `packages/client/src/__tests__/helpers/abortableMocks.ts` and the I9 idiom for signal capture are already in use by existing tests (lines 737, 810).

**Source design:** `docs/plans/2026-05-25-image-gallery-abort-migration-design.md`

**Working branch:** `image-gallery-abort-migration` (already created off `main`).

---

## File Structure

Files modified by this plan:

- `packages/client/src/components/ImageGallery.tsx` — handler extraction + abort-primitive migration (Task 3)
- `packages/client/src/__tests__/ImageGallery.test.tsx` — extended with seven new characterization tests (Tasks 1, 2)
- `packages/client/src/__tests__/migrationStructuralCheck.test.ts` — two per-file abort-migration tests collapsed into one global ban (Task 4)
- `CLAUDE.md` — one sentence under §Save-pipeline invariants rule 4 tightened to reflect the new enforcement layer (Task 4)

Files NOT modified (referenced for shape/import only):

- `packages/client/src/hooks/useAbortableAsyncOperation.ts` — the hook to migrate to; shipped in Phase 4b.3a.1. Internally uses `useRef<AbortController>` itself, so it must be excluded from the global ban introduced in Task 4.
- `packages/client/src/hooks/useFindReplaceState.ts` — first migrated consumer (4b.3a.2); confirmed clean of `useRef<AbortController>` by the structural check today.
- `packages/client/src/hooks/useTrashManager.ts` — second migrated consumer (4b.3a.3); same.
- `packages/client/src/__tests__/helpers/abortableMocks.ts` — `pendingUntilAbort` helper; already imported by the test file (line 8).
- `packages/client/src/api/client.ts` — `api.images.upload(projectId, file, signal)`, `api.images.update(id, data, signal)`, `api.images.delete(id, signal)`, `api.images.references(id, signal)`. The signal is the LAST positional arg in each case.

---

## Plan-vs-Design Notes

Three small clarifications surfaced during plan-writing. Each is here for the alignment review to confirm.

**[N1] Tests #2 and #3 are 2-axis, not 3-axis.** Per the post-pushback design, tests #2 (`handleSave`) and #3 (`handleInsert` inner branch) pin `signal-threading` and `abort-on-unmount` only. The `abort-prior` axis is not DOM-testable because the Save (`ImageGallery.tsx:514`) and Insert (`:522`) buttons are disabled while `saveStatus === "saving"`, and no public DOM path can transition `saveStatus` back to a non-`"saving"` value during the `pendingUntilAbort` first call. `abort-prior` for those handlers is implicitly pinned by test #7 (any other `mutationOp` handler fired while one of them is in flight aborts the prior — shared-instance behaviour). The plan implements the 2-axis form as specified.

**[N2] Tests #5 and #6 must drain the `useEffect`'s `api.images.references` call before exercising `refsOp`.** The detail-references `useEffect` at lines 145–170 also calls `api.images.references` on every `selectedImageId` change. A `mockImplementation` that pushes signals to an array will capture both `useEffect`-triggered and `refsOp`-triggered signals interleaved. Both tests use the drain-and-clear pattern from the design's §Test plan: `await waitFor(() => expect(api.images.references).toHaveBeenCalledTimes(1))` after `openDetail`, then `vi.mocked(api.images.references).mockClear()`, then re-install the capture mock for the `refsOp` interactions. Tests #1, #2, #3, #4, #7 are unaffected (different API surfaces, no `useEffect` competitor).

**[N3] New tests inline the `openDetail`+`unmount` pattern rather than refactoring the existing `renderAndOpenDetail` helper.** The existing `renderAndOpenDetail` helper at lines 57–69 of `ImageGallery.test.tsx` does not return the `render()` result, so callers cannot access `unmount`. Refactoring it to return `{ unmount }` would be an adjacent, low-risk change but would touch every existing test that already uses the helper. To keep this PR strictly additive in the test file, each new test that needs `unmount` inlines the five-line `openDetail` pattern (`render` + `waitFor` + `user.click(getByRole("button", { name: imageButtonName(image) }))`) instead of using the helper. A future PR may refactor.

---

## Task 1: Commit 1 — Characterization tests for `mutationOp` handlers

**Files:**

- Modify: `packages/client/src/__tests__/ImageGallery.test.tsx`

This task adds four new tests pinning behaviours of the four `mutationOp` handlers (`handleFileSelect`, `handleSave`, `handleInsert` inner branch, `handleDelete`) at the consumer's API surface. All four pass green against the current (pre-migration) source — these are characterization tests pinning behaviour the migration must preserve. The pre-migration source provides each assertion via `mutateAbortRef.current?.abort()` + per-call controllers + the combined unmount cleanup effect; post-migration the same assertions are provided by `mutationOp.run()`'s abort-prior and the hook's auto-abort. The tests are unchanged across the two phases — that's what makes them characterization tests.

**Design references:** §Test plan (tests #1–#4), Plan-vs-Design Note [N1] (2-axis form for tests #2 and #3), [N3] (inline `openDetail` pattern).

- [ ] **Step 1: Add new test #1 — `handleFileSelect aborts prior, threads signal, aborts on unmount`**

Open `packages/client/src/__tests__/ImageGallery.test.tsx`. Locate the last `it(...)` test in the `describe("ImageGallery", ...)` block (the closing `});` of the describe is at the end of the file). Insert this test inside the `describe` block, just before its closing `});`:

```ts
it("handleFileSelect aborts prior, threads signal, aborts on unmount", async () => {
  // Pin 3 axes (abort-prior + signal-threading + abort-on-unmount) for
  // handleFileSelect on mutationOp. Pre-migration: mutateAbortRef.current
  // ?.abort() at line 184 + unmount cleanup useEffect at lines 74–80.
  // Post-migration: mutationOp.run() aborts the prior controller and the
  // hook auto-aborts on unmount.
  const user = userEvent.setup();
  const capturedSignals: AbortSignal[] = [];
  vi.mocked(api.images.upload).mockImplementation((_projectId, _file, signal) => {
    if (signal) capturedSignals.push(signal);
    return pendingUntilAbort(signal);
  });

  const { unmount } = render(<ImageGallery {...defaultProps} />);
  await waitFor(() => expect(api.images.list).toHaveBeenCalled());

  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file1 = new File(["a"], "a.png", { type: "image/png" });
  await user.upload(fileInput, file1);
  await waitFor(() => expect(capturedSignals.length).toBe(1));
  expect(capturedSignals[0].aborted).toBe(false);

  // handleFileSelect resets fileInput.value = "" (line 177) so the same
  // input can be re-used for the second upload.
  const file2 = new File(["b"], "b.png", { type: "image/png" });
  await user.upload(fileInput, file2);
  await waitFor(() => expect(capturedSignals.length).toBe(2));
  expect(capturedSignals[0].aborted).toBe(true);
  expect(capturedSignals[1].aborted).toBe(false);

  unmount();
  expect(capturedSignals[1].aborted).toBe(true);
});
```

- [ ] **Step 2: Run new test #1 in isolation**

Run: `npm test -w packages/client -- ImageGallery.test.tsx -t "handleFileSelect aborts prior"`

Expected: PASS. The current code's `mutateAbortRef.current?.abort()` at line 184 + the unmount cleanup at lines 74–80 already provide this behaviour; the new test pins it.

- [ ] **Step 3: Add new test #2 — `handleSave threads signal, aborts on unmount` (2-axis per [N1])**

Append this test inside the `describe` block, after test #1:

```ts
it("handleSave threads signal, aborts on unmount", async () => {
  // Pin 2 axes (signal-threading + abort-on-unmount) for handleSave on
  // mutationOp. Per Plan-vs-Design Note [N1], the abort-prior axis is
  // not DOM-testable: the Save button (ImageGallery.tsx:514) is
  // disabled while saveStatus === "saving" and no public DOM path can
  // transition saveStatus back during the in-flight pendingUntilAbort.
  // abort-prior is implicitly pinned by test #7 (cross-handler within
  // shared mutationOp).
  const user = userEvent.setup();
  const image = makeImage();
  let capturedSignal: AbortSignal | undefined;
  vi.mocked(api.images.update).mockImplementation((_id, _data, signal) => {
    capturedSignal = signal;
    return pendingUntilAbort(signal);
  });

  // Inline openDetail pattern per [N3].
  vi.mocked(api.images.list).mockResolvedValue([image]);
  const { unmount } = render(<ImageGallery {...defaultProps} />);
  await waitFor(() => {
    expect(screen.getByRole("button", { name: imageButtonName(image) })).toBeInTheDocument();
  });
  await user.click(screen.getByRole("button", { name: imageButtonName(image) }));

  // openDetail sets saveStatus="saved" (line 219). Editing a field
  // flips to "idle" via updateField (line 348), re-enabling Save.
  await user.type(screen.getByLabelText(S.altTextLabel), "x");
  await user.click(screen.getByText(S.saveButton));

  await waitFor(() => expect(api.images.update).toHaveBeenCalled());
  expect(capturedSignal).toBeDefined();
  expect(capturedSignal?.aborted).toBe(false);

  unmount();
  expect(capturedSignal?.aborted).toBe(true);
});
```

- [ ] **Step 4: Run new test #2 in isolation**

Run: `npm test -w packages/client -- ImageGallery.test.tsx -t "handleSave threads signal"`

Expected: PASS. The current code threads `controller.signal` into `api.images.update` (line 238) and the unmount cleanup aborts it.

- [ ] **Step 5: Add new test #3 — `handleInsert auto-save inner branch threads signal, aborts on unmount` (2-axis per [N1])**

Append this test inside the `describe` block, after test #2:

```ts
it("handleInsert auto-save inner branch threads signal, aborts on unmount", async () => {
  // Pin 2 axes (signal-threading + abort-on-unmount) for handleInsert's
  // auto-save inner branch (lines 268–296), which calls api.images.update
  // when saveStatus !== "saved". Per Plan-vs-Design Note [N1], abort-
  // prior is not DOM-testable here either (Insert button is disabled
  // while saveStatus === "saving"; the inner branch itself sets
  // saveStatus = "saving"). abort-prior is implicitly pinned by test #7.
  // The mandatory toHaveBeenCalledTimes(1) assertion catches a setup
  // mistake that would leave saveStatus === "saved" and silently skip
  // the inner branch entirely.
  const user = userEvent.setup();
  const image = makeImage();
  let capturedSignal: AbortSignal | undefined;
  vi.mocked(api.images.update).mockImplementation((_id, _data, signal) => {
    capturedSignal = signal;
    return pendingUntilAbort(signal);
  });

  // Inline openDetail pattern per [N3].
  vi.mocked(api.images.list).mockResolvedValue([image]);
  const { unmount } = render(<ImageGallery {...defaultProps} />);
  await waitFor(() => {
    expect(screen.getByRole("button", { name: imageButtonName(image) })).toBeInTheDocument();
  });
  await user.click(screen.getByRole("button", { name: imageButtonName(image) }));

  // Edit a field so saveStatus moves from "saved" (post-openDetail) to
  // "idle". handleInsert's inner branch only fires when saveStatus !==
  // "saved" (line 268).
  await user.type(screen.getByLabelText(S.altTextLabel), "x");
  await user.click(screen.getByText(S.insertButton));

  // Mandatory per design: assert the inner branch actually fired.
  // Without this, a setup mistake that leaves saveStatus === "saved"
  // would skip the inner branch and pass the test silently.
  await waitFor(() => expect(api.images.update).toHaveBeenCalledTimes(1));
  expect(capturedSignal).toBeDefined();
  expect(capturedSignal?.aborted).toBe(false);

  unmount();
  expect(capturedSignal?.aborted).toBe(true);
});
```

- [ ] **Step 6: Run new test #3 in isolation**

Run: `npm test -w packages/client -- ImageGallery.test.tsx -t "handleInsert auto-save inner branch"`

Expected: PASS. The current code threads `controller.signal` into the inner-branch `api.images.update` call (line 274) and the unmount cleanup aborts it.

- [ ] **Step 7: Add new test #4 — `handleDelete aborts prior, threads signal, aborts on unmount` (3-axis)**

Append this test inside the `describe` block, after test #3:

```ts
it("handleDelete aborts prior, threads signal, aborts on unmount", async () => {
  // Pin 3 axes (abort-prior + signal-threading + abort-on-unmount) for
  // handleDelete on mutationOp. The confirm Delete button is NOT
  // disabled while delete is in flight (no `disabled` prop), so rapid
  // re-click works. Pre-migration: mutateAbortRef.current?.abort() at
  // line 304 + unmount cleanup. Post-migration: mutationOp.run() and
  // hook auto-abort.
  const user = userEvent.setup();
  const image = makeImage({ reference_count: 0 }); // unused, so confirm-Delete branch renders
  const capturedSignals: AbortSignal[] = [];
  vi.mocked(api.images.delete).mockImplementation((_id, signal) => {
    if (signal) capturedSignals.push(signal);
    return pendingUntilAbort(signal);
  });

  // Inline openDetail pattern per [N3].
  vi.mocked(api.images.list).mockResolvedValue([image]);
  const { unmount } = render(<ImageGallery {...defaultProps} />);
  await waitFor(() => {
    expect(screen.getByRole("button", { name: imageButtonName(image) })).toBeInTheDocument();
  });
  await user.click(screen.getByRole("button", { name: imageButtonName(image) }));

  // Click first Delete (link-style) to open confirm UI; references
  // refresh fires too (via refsOp) but we don't capture that mock here.
  await user.click(screen.getByText(S.deleteButton));
  // After click, confirmingDelete=true. For an unused image, the
  // confirm Delete button is rendered (not the "loading" / "in use"
  // branch). The button label is still S.deleteButton.
  await waitFor(() => expect(screen.getByText(S.deleteConfirm)).toBeInTheDocument());

  // First confirm-Delete click.
  await user.click(screen.getByText(S.deleteButton));
  await waitFor(() => expect(capturedSignals.length).toBe(1));
  expect(capturedSignals[0].aborted).toBe(false);

  // Second confirm-Delete click. The first call is held by
  // pendingUntilAbort — neither success nor catch resolves until the
  // second click's mutationOp.run aborts it. The first call's catch
  // then runs but its `if (signal.aborted) return` gate (line 315 pre-
  // migration) returns before reaching setConfirmingDelete(false), so
  // the confirm button stays rendered for the second click.
  await user.click(screen.getByText(S.deleteButton));
  await waitFor(() => expect(capturedSignals.length).toBe(2));
  expect(capturedSignals[0].aborted).toBe(true);
  expect(capturedSignals[1].aborted).toBe(false);

  unmount();
  expect(capturedSignals[1].aborted).toBe(true);
});
```

- [ ] **Step 8: Run new test #4 in isolation**

Run: `npm test -w packages/client -- ImageGallery.test.tsx -t "handleDelete aborts prior"`

Expected: PASS. Pre-migration the shared `mutateAbortRef` is reused; the confirm button stays clickable, and the second click's abort-prior cancels the first signal.

- [ ] **Step 9: Run all four new tests together**

Run: `npm test -w packages/client -- ImageGallery.test.tsx -t "handleFileSelect aborts prior|handleSave threads signal|handleInsert auto-save inner branch|handleDelete aborts prior"`

Expected: PASS (4 tests).

- [ ] **Step 10: Commit**

```bash
git add packages/client/src/__tests__/ImageGallery.test.tsx
git commit -m "$(cat <<'EOF'
test(image-gallery): characterization tests for mutationOp handlers (4b.3a.4)

Adds four new characterization tests pinning behaviours of the four
mutationOp handlers at the consumer's API surface:

- handleFileSelect aborts prior, threads signal, aborts on unmount (3-axis)
- handleSave threads signal, aborts on unmount (2-axis per N1)
- handleInsert auto-save inner branch threads signal, aborts on unmount (2-axis per N1)
- handleDelete aborts prior, threads signal, aborts on unmount (3-axis)

Tests #2 and #3 are 2-axis because the Save/Insert buttons are disabled
while saveStatus === "saving" and no public DOM path can transition
saveStatus back during the in-flight pendingUntilAbort. abort-prior for
those handlers is implicitly pinned by test #7 (added in commit 2):
cross-handler within shared mutationOp.

All four pass green against pre-migration source — characterization
tests pin behaviour the migration must preserve, not behaviour the
migration introduces.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Commit 2 — Characterization tests for `refsOp` and cross-instance contracts

**Files:**

- Modify: `packages/client/src/__tests__/ImageGallery.test.tsx`

This task adds three new tests: #5 (`handleOpenDeleteConfirm` on `refsOp`), #6 (cross-instance independence between `mutationOp` and `refsOp`), and #7 (shared-`mutationOp` across handlers). Tests #6 and #7 pin the cross-cutting invariants the §Out-of-Scope rules defend. All three pass green against pre-migration source.

**Design references:** §Test plan (tests #5–#7), Plan-vs-Design Note [N2] (drain-and-clear pattern for `api.images.references`), [N3] (inline `openDetail`).

- [ ] **Step 1: Add new test #5 — `handleOpenDeleteConfirm (references refresh) aborts prior, threads signal, aborts on unmount`**

Append this test inside the `describe` block, after test #4:

```ts
it("handleOpenDeleteConfirm (references refresh) aborts prior, threads signal, aborts on unmount", async () => {
  // Pin 3 axes for the references refresh on refsOp. Pre-migration:
  // refsAbortRef.current?.abort() at line 599 + unmount cleanup at
  // lines 74–80. Post-migration: refsOp.run() and hook auto-abort.
  //
  // Per Plan-vs-Design Note [N2], the detail-references useEffect at
  // lines 145–170 also calls api.images.references on every
  // selectedImageId change. We drain its first call and mockClear
  // before installing the capture mock for refsOp's calls.
  const user = userEvent.setup();
  const image = makeImage();

  // Inline openDetail pattern per [N3]. The detail-references useEffect
  // fires once on selectedImageId change — drain it before re-mocking.
  vi.mocked(api.images.list).mockResolvedValue([image]);
  // Initial resolve so the useEffect call settles cleanly.
  vi.mocked(api.images.references).mockResolvedValueOnce({ chapters: [] });
  const { unmount } = render(<ImageGallery {...defaultProps} />);
  await waitFor(() => {
    expect(screen.getByRole("button", { name: imageButtonName(image) })).toBeInTheDocument();
  });
  await user.click(screen.getByRole("button", { name: imageButtonName(image) }));
  await waitFor(() => expect(api.images.references).toHaveBeenCalledTimes(1));

  // Now re-install the capture mock; from here every api.images.references
  // call is from refsOp via handleOpenDeleteConfirm.
  vi.mocked(api.images.references).mockClear();
  const capturedSignals: AbortSignal[] = [];
  vi.mocked(api.images.references).mockImplementation((_id, signal) => {
    if (signal) capturedSignals.push(signal);
    return pendingUntilAbort(signal);
  });

  // Click first Delete (link-style) — fires refsOp.run AND sets
  // confirmingDelete=true (the confirm UI replaces the link-style
  // button).
  await user.click(screen.getByText(S.deleteButton));
  await waitFor(() => expect(capturedSignals.length).toBe(1));
  expect(capturedSignals[0].aborted).toBe(false);

  // To trigger a second refsOp.run we must re-render the link-style
  // Delete button — backToGrid then re-open detail (which fires the
  // useEffect again; drain it).
  await user.click(screen.getByText(S.backToGrid));
  await user.click(screen.getByRole("button", { name: imageButtonName(image) }));
  // The detail-references useEffect fires again on the second openDetail.
  // It uses the capture mock (which still pushes), so capturedSignals
  // gets an extra entry that we must account for.
  await waitFor(() => expect(capturedSignals.length).toBe(2));
  // The second click on the link-style Delete fires refsOp.run for
  // the second time, aborting the first refsOp signal.
  await user.click(screen.getByText(S.deleteButton));
  await waitFor(() => expect(capturedSignals.length).toBe(3));

  // capturedSignals layout:
  //  [0] first refsOp signal (aborted by second refsOp.run)
  //  [1] second useEffect signal (NOT touched by refsOp.run)
  //  [2] second refsOp signal (current in-flight)
  // The first refsOp signal must be aborted; the third (latest refsOp)
  // must not.
  expect(capturedSignals[0].aborted).toBe(true);
  expect(capturedSignals[2].aborted).toBe(false);

  unmount();
  // After unmount all three signals abort: the useEffect's via its
  // cleanup function, refsOp's via the hook's auto-abort.
  expect(capturedSignals[2].aborted).toBe(true);
});
```

- [ ] **Step 2: Run new test #5 in isolation**

Run: `npm test -w packages/client -- ImageGallery.test.tsx -t "handleOpenDeleteConfirm"`

Expected: PASS. Pre-migration: line 599 aborts `refsAbortRef.current` on the second click and the unmount cleanup at lines 74–80 catches the second-refsOp signal.

- [ ] **Step 3: Add new test #6 — `mutationOp and refsOp are independent (no cross-abort)`**

Append this test inside the `describe` block, after test #5:

```ts
it("mutationOp and refsOp are independent (no cross-abort)", async () => {
  // Pin the §Out-of-Scope "do not fold the two ops" invariant. Without
  // this test, a future maintainer collapsing mutationOp and refsOp
  // into one instance would silently regress the "refs refresh in
  // flight does not abort an in-progress mutation" non-relationship.
  // This test is the executable enforcement of the rule that the prose
  // comment alone cannot enforce.
  const user = userEvent.setup();
  const image = makeImage();

  // updateSignals captures handleSave's signals via api.images.update.
  const updateSignals: AbortSignal[] = [];
  vi.mocked(api.images.update).mockImplementation((_id, _data, signal) => {
    if (signal) updateSignals.push(signal);
    return pendingUntilAbort(signal);
  });
  // uploadSignals captures handleFileSelect's signals via api.images.upload.
  const uploadSignals: AbortSignal[] = [];
  vi.mocked(api.images.upload).mockImplementation((_p, _f, signal) => {
    if (signal) uploadSignals.push(signal);
    return pendingUntilAbort(signal);
  });

  // Inline openDetail pattern per [N3]; drain the useEffect's
  // api.images.references call per [N2] so the refsSignals array is
  // clean.
  vi.mocked(api.images.list).mockResolvedValue([image]);
  vi.mocked(api.images.references).mockResolvedValueOnce({ chapters: [] });
  const { unmount } = render(<ImageGallery {...defaultProps} />);
  await waitFor(() => {
    expect(screen.getByRole("button", { name: imageButtonName(image) })).toBeInTheDocument();
  });
  await user.click(screen.getByRole("button", { name: imageButtonName(image) }));
  await waitFor(() => expect(api.images.references).toHaveBeenCalledTimes(1));
  vi.mocked(api.images.references).mockClear();
  const refsSignals: AbortSignal[] = [];
  vi.mocked(api.images.references).mockImplementation((_id, signal) => {
    if (signal) refsSignals.push(signal);
    return pendingUntilAbort(signal);
  });

  // Edit a field so Save is enabled; click Save (mutationOp.run, in flight).
  await user.type(screen.getByLabelText(S.altTextLabel), "x");
  await user.click(screen.getByText(S.saveButton));
  await waitFor(() => expect(updateSignals.length).toBe(1));
  expect(updateSignals[0].aborted).toBe(false);

  // Click first Delete — fires refsOp.run (in flight) AND sets
  // confirmingDelete=true. The link-style Delete button is in a
  // different DOM section from Save, not affected by saveStatus.
  await user.click(screen.getByText(S.deleteButton));
  await waitFor(() => expect(refsSignals.length).toBe(1));
  expect(refsSignals[0].aborted).toBe(false);
  // CRITICAL: refsOp.run did NOT abort the in-flight mutation.
  expect(updateSignals[0].aborted).toBe(false);

  // Navigate back to grid (does not abort either op — backToGrid is
  // pure state-clear; the hook instances live on at the component top
  // level).
  await user.click(screen.getByText(S.backToGrid));

  // Click upload from grid view — fires handleFileSelect (mutationOp.run
  // again). This aborts the in-flight handleSave's signal because they
  // share mutationOp.
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(["x"], "x.png", { type: "image/png" });
  await user.upload(fileInput, file);
  await waitFor(() => expect(uploadSignals.length).toBe(1));

  // CRITICAL: the mutationOp action aborted the prior mutation
  // (handleSave) but did NOT reach into refsOp.
  expect(updateSignals[0].aborted).toBe(true);
  expect(refsSignals[0].aborted).toBe(false);
  expect(uploadSignals[0].aborted).toBe(false);

  unmount();
  // Both hooks auto-abort independently on unmount.
  expect(refsSignals[0].aborted).toBe(true);
  expect(uploadSignals[0].aborted).toBe(true);
});
```

- [ ] **Step 4: Run new test #6 in isolation**

Run: `npm test -w packages/client -- ImageGallery.test.tsx -t "mutationOp and refsOp are independent"`

Expected: PASS. Pre-migration: `mutateAbortRef` and `refsAbortRef` are two distinct `useRef` allocations; they cannot collide. The unmount cleanup at lines 74–80 aborts both refs.

- [ ] **Step 5: Add new test #7 — `four mutations share mutationOp (cross-handler abort within one op)`**

Append this test inside the `describe` block, after test #6:

```ts
it("four mutations share mutationOp (cross-handler abort within one op)", async () => {
  // Pin the shared-ref behaviour so a future maintainer who
  // reflexively allocates one hook per handler ("isolation is
  // cleaner") would see CI fail. This test is the executable
  // enforcement of the §Architecture decision to share mutationOp
  // across the four mutation handlers.
  const user = userEvent.setup();
  const image = makeImage();
  const uploadSignals: AbortSignal[] = [];
  vi.mocked(api.images.upload).mockImplementation((_p, _f, signal) => {
    if (signal) uploadSignals.push(signal);
    return pendingUntilAbort(signal);
  });
  const updateSignals: AbortSignal[] = [];
  vi.mocked(api.images.update).mockImplementation((_id, _data, signal) => {
    if (signal) updateSignals.push(signal);
    return pendingUntilAbort(signal);
  });

  // Render in grid view with one image (so we can click into detail).
  vi.mocked(api.images.list).mockResolvedValue([image]);
  render(<ImageGallery {...defaultProps} />);
  await waitFor(() => {
    expect(screen.getByRole("button", { name: imageButtonName(image) })).toBeInTheDocument();
  });

  // Click upload from grid view (handleFileSelect, mutationOp.run, in flight).
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(["x"], "x.png", { type: "image/png" });
  await user.upload(fileInput, file);
  await waitFor(() => expect(uploadSignals.length).toBe(1));
  expect(uploadSignals[0].aborted).toBe(false);

  // Navigate to detail view; openDetail does not abort the in-flight
  // upload (it's pure setState).
  await user.click(screen.getByRole("button", { name: imageButtonName(image) }));

  // Edit a field so Save is enabled; click Save (handleSave,
  // mutationOp.run on the SAME instance).
  await user.type(screen.getByLabelText(S.altTextLabel), "x");
  await user.click(screen.getByText(S.saveButton));
  await waitFor(() => expect(updateSignals.length).toBe(1));

  // CRITICAL: the new mutationOp call aborted the prior in-flight one,
  // even though they're different handlers.
  expect(uploadSignals[0].aborted).toBe(true);
  expect(updateSignals[0].aborted).toBe(false);
});
```

- [ ] **Step 6: Run new test #7 in isolation**

Run: `npm test -w packages/client -- ImageGallery.test.tsx -t "four mutations share mutationOp"`

Expected: PASS. Pre-migration: both `handleFileSelect` (line 186) and `handleSave` (line 236) assign to the shared `mutateAbortRef`; the second call's `mutateAbortRef.current?.abort()` cancels the first.

- [ ] **Step 7: Run all three new tests together**

Run: `npm test -w packages/client -- ImageGallery.test.tsx -t "handleOpenDeleteConfirm|mutationOp and refsOp are independent|four mutations share mutationOp"`

Expected: PASS (3 tests).

- [ ] **Step 8: Run the full ImageGallery test file**

Run: `npm test -w packages/client -- ImageGallery.test.tsx`

Expected: PASS — all 51 existing + 7 new = 58 tests green. The new tests are characterization tests that pass against pre-migration source.

- [ ] **Step 9: Commit**

```bash
git add packages/client/src/__tests__/ImageGallery.test.tsx
git commit -m "$(cat <<'EOF'
test(image-gallery): characterization tests for refsOp + cross-instance + shared-handler (4b.3a.4)

Adds three new characterization tests:

- handleOpenDeleteConfirm (references refresh) aborts prior, threads
  signal, aborts on unmount (3-axis; pins refsOp behaviour)
- mutationOp and refsOp are independent (no cross-abort) — pins the
  §Out-of-Scope "do not fold the two ops" invariant
- four mutations share mutationOp (cross-handler abort within one op)
  — pins the §Architecture decision to share mutationOp across the
  four mutation handlers

Tests #5 and #6 use the drain-and-clear pattern (per Plan-vs-Design
Note [N2]) to distinguish refsOp signals from the detail-references
useEffect's own api.images.references calls.

Tests #6 and #7 are load-bearing — must not be deleted as
"obviously structural" by future maintainers. Inline code comments
reference the §Out-of-Scope rationale for that reason.

All three pass green against pre-migration source.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Commit 3 — Extract inline handler and migrate source

**Files:**

- Modify: `packages/client/src/components/ImageGallery.tsx`

This task applies the §Behaviour mapping in one atomic source change: extract the JSX `onClick` arrow to a named `handleOpenDeleteConfirm`, swap both `useRef<AbortController>` allocations for `useAbortableAsyncOperation` instances, remove the combined unmount cleanup effect, and replace every `controller.signal.aborted` gate with `signal.aborted` against the per-call destructured signal. All 51 existing + 7 new tests stay green.

**Optional split:** if reviewers prefer extraction-as-separate-commit for review readability, the steps below may be split into Task 3a (Steps 1–2: pure extraction, no abort-primitive change) and Task 3b (Steps 3–8: migrate). Both end states satisfy the same test set. The plan presents the atomic form because it minimizes commit count; the optional split adds one commit without changing the diff total.

**Design references:** §Behaviour mapping (rows 1–9), §Architecture.

- [ ] **Step 1: Add the `useAbortableAsyncOperation` import**

Open `packages/client/src/components/ImageGallery.tsx`. Locate the imports at the top:

```ts
import { useState, useEffect, useRef, useCallback, useReducer } from "react";
import type { ImageRow } from "@smudge/shared";
import { api } from "../api/client";
import { mapApiError } from "../errors";
import { STRINGS } from "../strings";
```

Add one new import line immediately after the `STRINGS` import:

```ts
import { useAbortableAsyncOperation } from "../hooks/useAbortableAsyncOperation";
```

`useRef` and `useEffect` stay in the React import — both are still used (by `fileInputRef`, `announcementTimerRef`, `selectedImageIdRef`, the list-load effect, detail-references effect, announcement-timer cleanup, and `selectedImageIdRef` sync effect).

- [ ] **Step 2: Extract the inline JSX `onClick` arrow to a named `handleOpenDeleteConfirm`**

Locate the link-style Delete button at lines 586–629 (within the `confirmingDelete ? ... : <button onClick={...}>` ternary). Its current form:

```tsx
            <button
              onClick={() => {
                // Re-fetch references to avoid stale state blocking a valid delete
                if (selectedImage) {
                  // Review 2026-04-24: capture id at click time and
                  // compare against the current id in the resolvers so
                  // a rapid navigate-away (back to grid, or another
                  // image) before resolution doesn't clobber the new
                  // image's references or announce an unrelated failure.
                  const imageId = selectedImage.id;
                  setReferencesLoaded(false);
                  // S2 (review 2026-04-25): thread a signal so unmount
                  // / new click cleanly drops the in-flight refresh.
                  refsAbortRef.current?.abort();
                  const controller = new AbortController();
                  refsAbortRef.current = controller;
                  api.images
                    .references(imageId, controller.signal)
                    .then((data) => {
                      if (controller.signal.aborted) return;
                      if (selectedImageIdRef.current !== imageId) return;
                      setReferences(data.chapters);
                      setReferencesLoaded(true);
                    })
                    .catch((err: unknown) => {
                      if (controller.signal.aborted) return;
                      if (selectedImageIdRef.current !== imageId) return;
                      // I6: keep referencesLoaded=false (show the
                      // "Loading details…" gate when reference_count>0
                      // rather than the plain Delete confirm) and
                      // announce the mapped failure so the user knows
                      // the refresh failed. The server's 409
                      // IMAGE_IN_USE still catches a slipped-through
                      // delete attempt.
                      const { message } = mapApiError(err, "image.references");
                      if (message) announce(message);
                    });
                }
                setConfirmingDelete(true);
              }}
              className="text-sm text-status-error hover:underline focus:outline-none focus:ring-2 focus:ring-focus-ring rounded px-1"
            >
              {S.deleteButton}
            </button>
```

**This step is pure extraction** — no abort-primitive change. We move the arrow body verbatim into a named function (placed alongside `handleDelete` and before `updateField`) and replace the `onClick` with a reference.

First, add the named function. Locate the existing `function handleDelete()` block (ends at line 344). Immediately after `handleDelete`'s closing `}` (line 344) and before `function updateField(...)` (line 346), insert:

```tsx
  function handleOpenDeleteConfirm() {
    // Re-fetch references to avoid stale state blocking a valid delete
    if (selectedImage) {
      // Review 2026-04-24: capture id at click time and
      // compare against the current id in the resolvers so
      // a rapid navigate-away (back to grid, or another
      // image) before resolution doesn't clobber the new
      // image's references or announce an unrelated failure.
      const imageId = selectedImage.id;
      setReferencesLoaded(false);
      // S2 (review 2026-04-25): thread a signal so unmount
      // / new click cleanly drops the in-flight refresh.
      refsAbortRef.current?.abort();
      const controller = new AbortController();
      refsAbortRef.current = controller;
      api.images
        .references(imageId, controller.signal)
        .then((data) => {
          if (controller.signal.aborted) return;
          if (selectedImageIdRef.current !== imageId) return;
          setReferences(data.chapters);
          setReferencesLoaded(true);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          if (selectedImageIdRef.current !== imageId) return;
          // I6: keep referencesLoaded=false (show the
          // "Loading details…" gate when reference_count>0
          // rather than the plain Delete confirm) and
          // announce the mapped failure so the user knows
          // the refresh failed. The server's 409
          // IMAGE_IN_USE still catches a slipped-through
          // delete attempt.
          const { message } = mapApiError(err, "image.references");
          if (message) announce(message);
        });
    }
    setConfirmingDelete(true);
  }
```

Then replace the inline JSX `onClick={() => { ... }}` (lines 586–625 of the arrow body) with `onClick={handleOpenDeleteConfirm}`. The button's other attributes (`className`, the `{S.deleteButton}` child) are unchanged:

```tsx
            <button
              onClick={handleOpenDeleteConfirm}
              className="text-sm text-status-error hover:underline focus:outline-none focus:ring-2 focus:ring-focus-ring rounded px-1"
            >
              {S.deleteButton}
            </button>
```

- [ ] **Step 3: Replace `mutateAbortRef` with `mutationOp` (row 1)**

Locate the existing `mutateAbortRef` declaration (currently line 62–67):

```tsx
  // I10 + I11 (review 2026-04-24): single abort ref for all gallery
  // mutations (upload, metadata update, delete). A new mutation aborts
  // the prior one so overlapping clicks cannot race at the server; the
  // unmount effect aborts any in-flight mutation so a multi-MB upload
  // does not keep running server-side after the gallery closes.
  const mutateAbortRef = useRef<AbortController | null>(null);
```

Replace with (per row 9 — comment block rephrased to reference `mutationOp` instead of "ref"):

```tsx
  // I10 + I11 (review 2026-04-24): single abort instance for all
  // gallery mutations (upload, metadata update, delete). A new
  // mutation aborts the prior one so overlapping clicks cannot race
  // at the server; the hook's auto-abort handles unmount so a
  // multi-MB upload does not keep running server-side after the
  // gallery closes.
  const mutationOp = useAbortableAsyncOperation();
```

- [ ] **Step 4: Replace `refsAbortRef` with `refsOp` (row 2)**

Immediately below, locate the existing `refsAbortRef` declaration (currently lines 68–73):

```tsx
  // S2 (review 2026-04-25): the click-time references refresh on the
  // delete button did not thread an AbortSignal (the load effect at
  // line 138 does). A late refresh resolving after the user
  // navigated back to grid would announce a stale failure or set
  // references for a vanished image. Mirror mutateAbortRef.
  const refsAbortRef = useRef<AbortController | null>(null);
```

Replace with (per row 9 — comment retargeted to reference `mutationOp` instead of `mutateAbortRef` in the closing sentence):

```tsx
  // S2 (review 2026-04-25): the click-time references refresh on the
  // delete button did not thread an AbortSignal (the load effect at
  // line 138 does). A late refresh resolving after the user
  // navigated back to grid would announce a stale failure or set
  // references for a vanished image. Mirror mutationOp.
  const refsOp = useAbortableAsyncOperation();
```

- [ ] **Step 5: Remove the combined unmount cleanup `useEffect` (row 3)**

Immediately below, locate the combined unmount cleanup (currently lines 74–80):

```tsx
  useEffect(
    () => () => {
      mutateAbortRef.current?.abort();
      refsAbortRef.current?.abort();
    },
    [],
  );
```

Delete this entire block. Both hook instances handle their own auto-abort on unmount. The announcement-timer cleanup effect (currently lines 129–135) is **separate** and stays.

- [ ] **Step 6: Migrate `handleFileSelect` body (row 4)**

Locate `handleFileSelect` (currently lines 172–209):

```tsx
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input so the same file can be re-selected
    e.target.value = "";

    if (file.size > MAX_FILE_SIZE) {
      announce(S.fileTooLarge);
      return;
    }

    mutateAbortRef.current?.abort();
    const controller = new AbortController();
    mutateAbortRef.current = controller;
    api.images
      .upload(projectId, file, controller.signal)
      .then((newImage) => {
        if (controller.signal.aborted) return;
        announce(S.uploadSuccess(newImage.filename));
        incrementRefreshKey();
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const { message, possiblyCommitted } = mapApiError(err, "image.upload");
        // I3 (2026-04-24 review): on 2xx BAD_JSON the server stored the
        // image but the client couldn't parse the response. Without the
        // refresh, the stale list stays on screen and a user retry
        // uploads the same file again (server doesn't dedupe) — creating
        // a second row and a second blob for one intended upload. The
        // refresh pulls the authoritative list so the newly-stored image
        // is visible and retry is unnecessary.
        if (possiblyCommitted) {
          incrementRefreshKey();
        }
        if (message) announce(message);
      });
  }
```

Replace the abort dance + API call with `mutationOp.run`:

```tsx
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input so the same file can be re-selected
    e.target.value = "";

    if (file.size > MAX_FILE_SIZE) {
      announce(S.fileTooLarge);
      return;
    }

    const { promise, signal } = mutationOp.run((s) =>
      api.images.upload(projectId, file, s),
    );
    promise
      .then((newImage) => {
        if (signal.aborted) return;
        announce(S.uploadSuccess(newImage.filename));
        incrementRefreshKey();
      })
      .catch((err: unknown) => {
        if (signal.aborted) return;
        const { message, possiblyCommitted } = mapApiError(err, "image.upload");
        // I3 (2026-04-24 review): on 2xx BAD_JSON the server stored the
        // image but the client couldn't parse the response. Without the
        // refresh, the stale list stays on screen and a user retry
        // uploads the same file again (server doesn't dedupe) — creating
        // a second row and a second blob for one intended upload. The
        // refresh pulls the authoritative list so the newly-stored image
        // is visible and retry is unnecessary.
        if (possiblyCommitted) {
          incrementRefreshKey();
        }
        if (message) announce(message);
      });
  }
```

Note the changes:
- `mutateAbortRef.current?.abort()` + `new AbortController()` + ref-store → `mutationOp.run((s) => api.images.upload(projectId, file, s))`. The callback parameter is named `s` to avoid shadowing the outer destructured `signal`.
- `api.images.upload(projectId, file, controller.signal)` → no longer called directly; the `mutationOp.run` closure threads the signal.
- Both `if (controller.signal.aborted) return` → `if (signal.aborted) return` against the destructured per-call `signal`. Placement preserved (`.then` body and start of `.catch`).
- The I3 comment block is untouched per row 9 — it doesn't name the old ref.

- [ ] **Step 7: Migrate `handleSave`, `handleInsert`, and `handleDelete` bodies (rows 5, 6, 7)**

Locate `handleSave` (currently lines 231–262):

```tsx
  async function handleSave() {
    if (!selectedImage) return;
    setSaveStatus("saving");
    mutateAbortRef.current?.abort();
    const controller = new AbortController();
    mutateAbortRef.current = controller;
    try {
      const updated = await api.images.update(selectedImage.id, formState, controller.signal);
      if (controller.signal.aborted) return;
      setSelectedImage(updated);
      setSaveStatus("saved");
      incrementRefreshKey();
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      setSaveStatus("idle");
      const { message, possiblyCommitted } = mapApiError(err, "image.updateMetadata");
      // I4 (review 2026-04-25): on 2xx BAD_JSON the server stored the
      // metadata change but the client couldn't parse the response.
      // Without the refresh, the detail view stays on the pre-save
      // values while the server has the new ones; a retry could 404
      // (the field already committed) and the user has no path to
      // learn the committed state. Mirror handleFileSelect's committed
      // branch: bump the refresh key so the gallery re-fetches the
      // authoritative row, and clear the detail view so the user
      // re-opens the row (or sees the fresh values on grid hover).
      if (possiblyCommitted) {
        incrementRefreshKey();
        setSelectedImage(null);
      }
      if (message) announce(message);
    }
  }
```

Replace with:

```tsx
  async function handleSave() {
    if (!selectedImage) return;
    setSaveStatus("saving");
    const { promise, signal } = mutationOp.run((s) =>
      api.images.update(selectedImage.id, formState, s),
    );
    try {
      const updated = await promise;
      if (signal.aborted) return;
      setSelectedImage(updated);
      setSaveStatus("saved");
      incrementRefreshKey();
    } catch (err: unknown) {
      if (signal.aborted) return;
      setSaveStatus("idle");
      const { message, possiblyCommitted } = mapApiError(err, "image.updateMetadata");
      // I4 (review 2026-04-25): on 2xx BAD_JSON the server stored the
      // metadata change but the client couldn't parse the response.
      // Without the refresh, the detail view stays on the pre-save
      // values while the server has the new ones; a retry could 404
      // (the field already committed) and the user has no path to
      // learn the committed state. Mirror handleFileSelect's committed
      // branch: bump the refresh key so the gallery re-fetches the
      // authoritative row, and clear the detail view so the user
      // re-opens the row (or sees the fresh values on grid hover).
      if (possiblyCommitted) {
        incrementRefreshKey();
        setSelectedImage(null);
      }
      if (message) announce(message);
    }
  }
```

Locate `handleInsert` (currently lines 264–299). Only its **inner branch** (lines 269–295, inside `if (saveStatus !== "saved")`) is migrated; the outer guard, `imageToInsert = updated` reassignment, and post-block `onInsertImage(...)`/`announce(...)` stay unchanged.

Current inner branch:

```tsx
    if (saveStatus !== "saved") {
      mutateAbortRef.current?.abort();
      const controller = new AbortController();
      mutateAbortRef.current = controller;
      try {
        setSaveStatus("saving");
        const updated = await api.images.update(selectedImage.id, formState, controller.signal);
        if (controller.signal.aborted) return;
        setSelectedImage(updated);
        setSaveStatus("saved");
        incrementRefreshKey();
        imageToInsert = updated;
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        setSaveStatus("idle");
        const { message, possiblyCommitted } = mapApiError(err, "image.updateMetadata");
        // I4 (review 2026-04-25): same possiblyCommitted handling as
        // handleSave. The server stored the metadata but the client
        // can't see it; the in-progress insert must abort because
        // imageToInsert still carries the pre-save values, which
        // would render with stale alt-text in the chapter.
        if (possiblyCommitted) {
          incrementRefreshKey();
          setSelectedImage(null);
        }
        if (message) announce(message);
        return;
      }
    }
```

Replace inner branch with:

```tsx
    if (saveStatus !== "saved") {
      const { promise, signal } = mutationOp.run((s) =>
        api.images.update(selectedImage.id, formState, s),
      );
      try {
        setSaveStatus("saving");
        const updated = await promise;
        if (signal.aborted) return;
        setSelectedImage(updated);
        setSaveStatus("saved");
        incrementRefreshKey();
        imageToInsert = updated;
      } catch (err: unknown) {
        if (signal.aborted) return;
        setSaveStatus("idle");
        const { message, possiblyCommitted } = mapApiError(err, "image.updateMetadata");
        // I4 (review 2026-04-25): same possiblyCommitted handling as
        // handleSave. The server stored the metadata but the client
        // can't see it; the in-progress insert must abort because
        // imageToInsert still carries the pre-save values, which
        // would render with stale alt-text in the chapter.
        if (possiblyCommitted) {
          incrementRefreshKey();
          setSelectedImage(null);
        }
        if (message) announce(message);
        return;
      }
    }
```

Locate `handleDelete` (currently lines 301–344). Current body:

```tsx
  async function handleDelete() {
    if (!selectedImage) return;

    mutateAbortRef.current?.abort();
    const controller = new AbortController();
    mutateAbortRef.current = controller;
    try {
      await api.images.delete(selectedImage.id, controller.signal);
      if (controller.signal.aborted) return;
      announce(S.deleteSuccess(selectedImage.filename));
      setSelectedImage(null);
      setConfirmingDelete(false);
      incrementRefreshKey();
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      const { message, possiblyCommitted, extras } = mapApiError(err, "image.delete");
      // ABORTED: silent (mapper returned message: null). Leave the detail
      // view and confirmation state as-is so the user can retry.
      if (!message) return;
      // C3 (review 2026-04-24): on 2xx BAD_JSON the server already
      // deleted the row but the client couldn't parse the response.
      // Without the refresh the detail view stays on a phantom image
      // and a user retry 409s because the image is gone. Close the
      // detail view, reset the confirm gate, and bump the refresh key
      // so the authoritative gallery list is fetched. The mapped
      // committed copy is announced so the user knows to refresh.
      if (possiblyCommitted) {
        announce(message);
        setSelectedImage(null);
        setConfirmingDelete(false);
        incrementRefreshKey();
        return;
      }
      if (extras?.chapters) {
        const chapters = (extras.chapters as Array<{ title: string; trashed?: boolean }>).map(
          (c) => (c.trashed ? `${c.title} (${S.inTrash})` : c.title),
        );
        announce(S.deleteBlocked(chapters));
      } else {
        announce(message);
      }
      setConfirmingDelete(false);
    }
  }
```

Replace with:

```tsx
  async function handleDelete() {
    if (!selectedImage) return;

    const { promise, signal } = mutationOp.run((s) =>
      api.images.delete(selectedImage.id, s),
    );
    try {
      await promise;
      if (signal.aborted) return;
      announce(S.deleteSuccess(selectedImage.filename));
      setSelectedImage(null);
      setConfirmingDelete(false);
      incrementRefreshKey();
    } catch (err: unknown) {
      if (signal.aborted) return;
      const { message, possiblyCommitted, extras } = mapApiError(err, "image.delete");
      // ABORTED: silent (mapper returned message: null). Leave the detail
      // view and confirmation state as-is so the user can retry.
      if (!message) return;
      // C3 (review 2026-04-24): on 2xx BAD_JSON the server already
      // deleted the row but the client couldn't parse the response.
      // Without the refresh the detail view stays on a phantom image
      // and a user retry 409s because the image is gone. Close the
      // detail view, reset the confirm gate, and bump the refresh key
      // so the authoritative gallery list is fetched. The mapped
      // committed copy is announced so the user knows to refresh.
      if (possiblyCommitted) {
        announce(message);
        setSelectedImage(null);
        setConfirmingDelete(false);
        incrementRefreshKey();
        return;
      }
      if (extras?.chapters) {
        const chapters = (extras.chapters as Array<{ title: string; trashed?: boolean }>).map(
          (c) => (c.trashed ? `${c.title} (${S.inTrash})` : c.title),
        );
        announce(S.deleteBlocked(chapters));
      } else {
        announce(message);
      }
      setConfirmingDelete(false);
    }
  }
```

Notes for all three migrations:
- The abort-prior + new controller + signal-thread block becomes one `mutationOp.run((s) => api.images.<verb>(args, s))` call. Callback param `s` to avoid shadowing the outer `signal`.
- Both `if (controller.signal.aborted) return` → `if (signal.aborted) return` against the per-call destructured `signal`. Placement preserved (success-path gate immediately after `await promise`, catch-path gate as first statement of catch above `mapApiError`).
- The I4, C3, IMAGE_IN_USE/`extras?.chapters` comment blocks are **untouched** per row 9 — they don't name the old refs and are orthogonal to the abort lifecycle.

- [ ] **Step 8: Migrate the extracted `handleOpenDeleteConfirm` body (row 8)**

Locate the `handleOpenDeleteConfirm` function added in Step 2. Its body still contains the pre-migration abort dance against `refsAbortRef`. Replace the inner abort + controller block with `refsOp.run`:

```tsx
  function handleOpenDeleteConfirm() {
    // Re-fetch references to avoid stale state blocking a valid delete
    if (selectedImage) {
      // Review 2026-04-24: capture id at click time and
      // compare against the current id in the resolvers so
      // a rapid navigate-away (back to grid, or another
      // image) before resolution doesn't clobber the new
      // image's references or announce an unrelated failure.
      const imageId = selectedImage.id;
      setReferencesLoaded(false);
      // S2 (review 2026-04-25): thread a signal so unmount
      // / new click cleanly drops the in-flight refresh.
      const { promise, signal } = refsOp.run((s) =>
        api.images.references(imageId, s),
      );
      promise
        .then((data) => {
          if (signal.aborted) return;
          if (selectedImageIdRef.current !== imageId) return;
          setReferences(data.chapters);
          setReferencesLoaded(true);
        })
        .catch((err: unknown) => {
          if (signal.aborted) return;
          if (selectedImageIdRef.current !== imageId) return;
          // I6: keep referencesLoaded=false (show the
          // "Loading details…" gate when reference_count>0
          // rather than the plain Delete confirm) and
          // announce the mapped failure so the user knows
          // the refresh failed. The server's 409
          // IMAGE_IN_USE still catches a slipped-through
          // delete attempt.
          const { message } = mapApiError(err, "image.references");
          if (message) announce(message);
        });
    }
    setConfirmingDelete(true);
  }
```

Notes:
- `setReferencesLoaded(false)` stays **before** the `refsOp.run` call — this preserves UI-reset-then-fire ordering per the design's row 8.
- The two `selectedImageIdRef.current !== imageId` identity gates stay **immediately after** the `signal.aborted` gates in both `.then` and `.catch`. Both axes of staleness arbitration are preserved.
- `setConfirmingDelete(true)` stays as the last statement, **outside** the `if (selectedImage)` guard.
- The two cited comment blocks (Review 2026-04-24, S2 2026-04-25) are untouched per row 9 — they don't name the old ref. The I6 comment block in the `.catch` is also untouched.

- [ ] **Step 9: Run the full ImageGallery test file against the migration**

Run: `npm test -w packages/client -- ImageGallery.test.tsx`

Expected: PASS — all 51 existing + 7 new = 58 tests green. The migration preserves every behaviour the tests pin.

If any test fails:
- Check the migration against the §Behaviour mapping in the design — most likely cause is a missed signal-gate placement, a typo in the `s` callback parameter that left a `signal` shadow ambiguous, or a stale `controller.` reference that escaped the find-and-replace.
- Re-grep: `grep -nE 'controller\.signal' packages/client/src/components/ImageGallery.tsx` should return nothing post-migration. If it returns lines inside `handleFileSelect`/`handleSave`/`handleInsert`/`handleDelete`/`handleOpenDeleteConfirm`, those are stale gates.
- Re-grep: `grep -nE '\b(mutate|refs)AbortRef\b' packages/client/src/components/ImageGallery.tsx` should return nothing. If it returns anything, those are stale references that escaped row 1, 2, or 9.

- [ ] **Step 10: Run lint + format + typecheck**

Run: `make lint && make format && npm run typecheck -w packages/client`

Expected: PASS. The migration removes two `useRef<AbortController>` allocations and one `useEffect` block; both `useEffect` and `useRef` imports stay (still used by `fileInputRef`, `announcementTimerRef`, `selectedImageIdRef`, the list-load effect, detail-references effect, announcement-timer cleanup, and `selectedImageIdRef` sync effect).

- [ ] **Step 11: Sanity-check the post-migration source for residual references**

Run: `grep -nE '\b(mutate|refs)AbortRef\b' packages/client/src/components/ImageGallery.tsx`

Expected: no output.

Run: `grep -nE 'controller\.signal' packages/client/src/components/ImageGallery.tsx`

Expected: only matches inside the list-load `useEffect` (lines ~98–127) and detail-references `useEffect` (lines ~145–170). Both are out of scope and stay. If any match falls inside a handler function, it's a stale gate that escaped Steps 6–8.

- [ ] **Step 12: Commit**

```bash
git add packages/client/src/components/ImageGallery.tsx
git commit -m "$(cat <<'EOF'
refactor(image-gallery): extract handleOpenDeleteConfirm + migrate to useAbortableAsyncOperation (4b.3a.4)

Replaces ImageGallery's two hand-rolled useRef<AbortController> slots
+ combined unmount cleanup useEffect with two side-by-side
useAbortableAsyncOperation instances:

- mutationOp: shared by handleFileSelect, handleSave, handleInsert
  inner branch, handleDelete (four mutually-exclusive mutations —
  calling any one aborts the in-flight one of the others)
- refsOp: owned by the references refresh, fired from the now-extracted
  handleOpenDeleteConfirm (independent of mutationOp; preserves the
  "user can refresh references while a mutation is in flight"
  concurrency model)

The link-style Delete button's inline JSX onClick arrow is extracted
to a named handleOpenDeleteConfirm function alongside the other
top-level handlers — the post-migration body is still 15+ lines and
matches the existing pattern of every other named handler in the file.

The combined unmount cleanup effect at lines 74–80 is removed — both
hook instances auto-abort on unmount. The list-load useEffect
(lines 98–127) and detail-references useEffect (lines 145–170) stay
as-is — different lifecycle shape (controller-per-effect,
cleanup-on-dep-change) from the hook's contract.

All controller.signal.aborted gates become signal.aborted against the
per-call destructured signal from run(); placement is preserved
exactly (success-path gates before setState, catch-path gates above
mapApiError; selectedImageIdRef identity gates stay immediately after
signal gates in the references refresh).

Row-9 comment retargeting: the I10+I11 comment block (lines 62–66)
and S2 comment block (lines 68–72) are rephrased to reference
mutationOp / refsOp instead of the old ref names; all other comment
blocks (I3, I4, C3, I6, I8, I9, selectedImageIdRef, S2 click-handler)
are untouched per design §Out of scope.

All 58 tests (51 existing + 7 new characterization tests from
commits 1–2) pass green. No user-visible behaviour change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Commit 4 — Collapse structural check + CLAUDE.md prose edit

**Files:**

- Modify: `packages/client/src/__tests__/migrationStructuralCheck.test.ts`
- Modify: `CLAUDE.md`

This task replaces the two per-file abort-migration tests in `migrationStructuralCheck.test.ts` with one global `useRef<AbortController>` ban (excluding `__tests__/` via the existing `collectTsSources` helper and excluding `hooks/useAbortableAsyncOperation.ts` itself via an explicit filter), and updates the corresponding CLAUDE.md prose to reflect the new enforcement layer.

**Design references:** §Test plan §Structural-check collapse, §CLAUDE.md edit.

- [ ] **Step 1: Locate the two per-file abort-migration tests**

Open `packages/client/src/__tests__/migrationStructuralCheck.test.ts`. The current file (verify before editing) contains two abort-migration tests:

- `it("useAbortableAsyncOperation is imported by every file that has been migrated to it", ...)` — currently around line 109
- `it("migrated files do not contain raw useRef<AbortController>", ...)` — currently around line 125

Both tests share the same `migrated` array (currently `["hooks/useFindReplaceState.ts", "hooks/useTrashManager.ts"]`).

- [ ] **Step 2: Replace both per-file tests with one global ban**

Find the block starting at the `it("useAbortableAsyncOperation is imported ...` test (around line 109) and ending at the closing `});` of the `it("migrated files do not contain raw useRef<AbortController>", ...)` test (around line 147). This is the block to replace.

The current form (verify by reading lines 109–147 before editing):

```ts
  it("useAbortableAsyncOperation is imported by every file that has been migrated to it", () => {
    // Phase 4b.3a.2 (find-replace) and 4b.3a.3 (useTrashManager) have
    // migrated; 4b.3a.4 (ImageGallery) will append its migrated file
    // to this list. Once 4b.3a.4 lands, this per-file check can
    // collapse into a global ban.
    const migrated = [
      resolve(clientSrcRoot, "hooks/useFindReplaceState.ts"),
      resolve(clientSrcRoot, "hooks/useTrashManager.ts"),
    ];
    const pattern = importPatternFor("useAbortableAsyncOperation");
    for (const file of migrated) {
      const source = readFileSync(file, "utf-8");
      expect(source, `${file} should import useAbortableAsyncOperation`).toMatch(pattern);
    }
  });

  it("migrated files do not contain raw useRef<AbortController>", () => {
    // Companion to the import assertion above; whichever migration phase
    // lands last can convert this from a per-file check to a global
    // packages/client/src ban (excluding the hook file itself).
    //
    // The regex covers `useRef<AbortController>` and any single-line
    // union that ends with `>` (`| null`, `| undefined`, `| null |
    // undefined`, etc). The `\b[^>]*>` tail is what catches drift —
    // S1 (review 2026-05-01) flagged the prior `(?:\|\s*null\s*)?>` as
    // missing the `| undefined` variant. The word-boundary on
    // `AbortController\b` keeps false positives like
    // `useRef<AbortControllerWrapper>` out.
    const migrated = [
      resolve(clientSrcRoot, "hooks/useFindReplaceState.ts"),
      resolve(clientSrcRoot, "hooks/useTrashManager.ts"),
    ];
    for (const file of migrated) {
      const source = readFileSync(file, "utf-8");
      expect(source, `${file} should not contain useRef<AbortController>`).not.toMatch(
        USE_REF_ABORT_CONTROLLER_PATTERN,
      );
    }
  });
```

Replace this entire block with one global ban test:

```ts
  it("no file in packages/client/src (excluding __tests__ and the hook itself) contains raw useRef<AbortController>", () => {
    // Phase 4b.3a.4 (ImageGallery) was the last per-file consumer
    // migration in the 4b.3a.2 → 4b.3a.4 sequence. The two per-file
    // checks that previously lived here (import-presence + no-raw-ref,
    // each scoped to a `migrated` array) collapsed into this single
    // global ban once ImageGallery no longer contained
    // useRef<AbortController>. The import-presence check disappeared
    // entirely — TypeScript's "no using undefined identifiers"
    // enforcement covers that question; the per-file array was always
    // a stepping stone to this global form.
    //
    // The regex (USE_REF_ABORT_CONTROLLER_PATTERN, line 20) covers
    // `useRef<AbortController>` and any single-line union that ends
    // with `>` (`| null`, `| undefined`, `| null | undefined`, etc).
    // The word-boundary on `AbortController\b` keeps false positives
    // like `useRef<AbortControllerWrapper>` out.
    //
    // The hook file itself is the one legitimate site for
    // useRef<AbortController> — it's the implementation. Every other
    // consumer goes through useAbortableAsyncOperation.
    const HOOK_FILE = resolve(clientSrcRoot, "hooks/useAbortableAsyncOperation.ts");
    const files = collectTsSources(clientSrcRoot);
    const offenders: string[] = [];
    for (const file of files) {
      if (file === HOOK_FILE) continue;
      const source = readFileSync(file, "utf-8");
      if (USE_REF_ABORT_CONTROLLER_PATTERN.test(source)) {
        offenders.push(file.replace(clientSrcRoot, "packages/client/src"));
      }
    }
    expect(offenders).toEqual([]);
  });
```

The four other tests in this file (SeqRef ban at line 57, `collectTsSources` skip-test at line 75, `useAbortableSequence` per-file import check at line 92, and the two internal regex tests at lines 149 and 182) are **untouched**. The exported `USE_REF_ABORT_CONTROLLER_PATTERN`, `importPatternFor`, and `collectTsSources` helpers are **untouched** — they're still used by other tests in this file.

- [ ] **Step 3: Run the structural check**

Run: `npm test -w packages/client -- migrationStructuralCheck.test.ts`

Expected: PASS. The new global ban walks `clientSrcRoot`, excludes `__tests__/` (via `collectTsSources`) and the hook file (via the explicit filter), and asserts no other file contains `useRef<AbortController>`. The post-migration `ImageGallery.tsx` (from Task 3) no longer contains the pattern, so the assertion passes. The previously-migrated `useFindReplaceState.ts` and `useTrashManager.ts` were already clean.

If the assertion fails with `offenders` printed, the migration in Task 3 was incomplete — revisit Steps 3–8 and Step 11 of Task 3.

- [ ] **Step 4: Locate the CLAUDE.md sentence to tighten**

Open `CLAUDE.md`. Locate §Save-pipeline invariants rule 4 (search for `Hand-rolled \`useRef<AbortController>\` allocations`). The current sentence at the end of rule 4 reads:

```
Hand-rolled `useRef<AbortController>` allocations at consumer call sites are reviewed against this hook (lint enforcement deferred).
```

- [ ] **Step 5: Replace the sentence with the post-collapse form**

Replace the located sentence with:

```
Hand-rolled `useRef<AbortController>` allocations at consumer call sites are banned (enforced by `packages/client/src/__tests__/migrationStructuralCheck.test.ts`; lint enforcement deferred to Phase 4b.4).
```

This is the only CLAUDE.md change in this PR. No other section is touched — the /roadmap step 7 drift review confirmed no other section needs an update.

- [ ] **Step 6: Run the full client test suite**

Run: `npm test -w packages/client`

Expected: PASS. All client tests, including the newly collapsed structural check and the migrated `ImageGallery.tsx` from Task 3.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/__tests__/migrationStructuralCheck.test.ts CLAUDE.md
git commit -m "$(cat <<'EOF'
test(structural): collapse per-file abort-migration checks into global ban (4b.3a.4)

Replaces the two per-file abort-migration tests in
migrationStructuralCheck.test.ts (import-presence + no-raw-ref,
each scoped to a `migrated` array) with one global
useRef<AbortController> ban that walks packages/client/src,
excluding __tests__/ (via collectTsSources) and
hooks/useAbortableAsyncOperation.ts (via an explicit filter).

The per-file import-presence check is deleted entirely —
TypeScript's "no using undefined identifiers" enforcement covers
that question; the per-file array was always a stepping stone to
this global form. Phase 4b.3a.4 (ImageGallery) was the last per-file
consumer migration in the 4b.3a.2 → 4b.3a.4 sequence.

CLAUDE.md §Save-pipeline invariants rule 4 prose updated to reflect
the new enforcement layer: "banned (enforced by
migrationStructuralCheck.test.ts; lint enforcement deferred to
Phase 4b.4)" replaces the prior "reviewed against this hook (lint
enforcement deferred)".

The four other tests in migrationStructuralCheck.test.ts (SeqRef
ban, collectTsSources skip-test, useAbortableSequence per-file
import check, two internal regex tests) and all three exported
helpers (USE_REF_ABORT_CONTROLLER_PATTERN, importPatternFor,
collectTsSources) are untouched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Commit 5 — Cleanup (if needed)

**Files:**

- Modify: `packages/client/src/components/ImageGallery.tsx` (only if residual cleanup surfaces)

This task inspects the migrated `ImageGallery.tsx` for residual cruft that escaped Tasks 1–4: stale comments that survived row-9's pruning, unused imports, or stale `controller` references. If nothing surfaces, **skip this task and proceed to Task 6** — no commit is needed and the order matters more than the count.

**Design references:** §Migration order step 5 ("Cleanup (if needed)").

- [ ] **Step 1: Grep for residual ref-name references**

Run: `grep -nE '\b(mutate|refs)AbortRef\b' packages/client/src/components/ImageGallery.tsx`

Expected: no output. (This grep already ran at the end of Task 3 Step 11; running it again confirms nothing slipped in between commits.)

If any line prints, retarget the reference per row 9's rule (token removal + sentence rephrase) and stage the change for this commit.

- [ ] **Step 2: Grep for stale `controller.` references inside handler functions**

Run: `grep -nE 'controller\.' packages/client/src/components/ImageGallery.tsx`

Expected: matches only inside the list-load `useEffect` (around lines 98–127) and detail-references `useEffect` (around lines 145–170). Both are out of scope.

If any match falls inside `handleFileSelect`, `handleSave`, `handleInsert`, `handleDelete`, or `handleOpenDeleteConfirm`, it's a stale gate or reference that escaped Task 3.

- [ ] **Step 3: Inspect the React imports**

Open `packages/client/src/components/ImageGallery.tsx`. The first import line should read:

```ts
import { useState, useEffect, useRef, useCallback, useReducer } from "react";
```

Verify all five names are still used in the post-migration file:

- `useState` — used by 8 `useState` calls (images, selectedImage, formState, saveStatus, announcement, references, referencesLoaded, confirmingDelete, loadError — actually 9; check current source)
- `useEffect` — used by the list-load effect, detail-references effect, announcement-timer cleanup, and `selectedImageIdRef` sync effect
- `useRef` — used by `fileInputRef`, `announcementTimerRef`, `selectedImageIdRef`
- `useCallback` — used by `announce`
- `useReducer` — used by `refreshKey` / `incrementRefreshKey`

The new `useAbortableAsyncOperation` import (added in Task 3 Step 1) should also be present:

```ts
import { useAbortableAsyncOperation } from "../hooks/useAbortableAsyncOperation";
```

All imports should still be needed. If lint flags any as unused, the migration broke something — revisit Task 3.

- [ ] **Step 4: Inspect for stale review-callout comments outside row 9's two blocks**

Open the migrated file and scan the comment blocks at:

- The I3 BAD_JSON upload comment block (immediately before `if (possiblyCommitted) { incrementRefreshKey(); }` in `handleFileSelect`)
- The I4 BAD_JSON save comment block (immediately before `if (possiblyCommitted) { incrementRefreshKey(); setSelectedImage(null); }` in `handleSave`)
- The I4 BAD_JSON insert comment block (immediately before the equivalent block in `handleInsert`)
- The C3 BAD_JSON delete comment block (immediately before the equivalent block in `handleDelete`)
- The I6 references-failure comment block in the detail-references `useEffect` AND in `handleOpenDeleteConfirm`
- The I8 `externalRefreshKey` comment block at lines 11–14 (in the props interface)
- The I9 list/detail `useEffect` migration callout comments (lines 99–104, 147)
- The `selectedImageIdRef` capture-time-identity comment blocks (lines 54–60, 138–144, 590–594)
- The S2 click-handler signal-thread comment (lines 597–598)

Per row 9 of the design, **all** of these comment blocks should be **untouched** by the migration. None of them named `mutateAbortRef` / `refsAbortRef` originally; all of them carry rationale that is orthogonal to the abort lifecycle. Confirm each block reads identically to the pre-migration source.

If any comment was inadvertently modified (e.g., a token replacement bled into a comment block it shouldn't have), revert it to its pre-migration form now.

- [ ] **Step 5: Decide whether a Cleanup commit is warranted**

- If Steps 1–4 surfaced **no changes**: skip this commit. Proceed to Task 6.
- If Steps 1–4 surfaced **any change**: stage and commit.

```bash
git add packages/client/src/components/ImageGallery.tsx
git commit -m "$(cat <<'EOF'
style(image-gallery): cleanup residual references after abort migration (4b.3a.4)

Tidies post-migration cruft surfaced by Task 5's inspection grep —
[describe the actual change here, e.g., "rephrases an inline review
comment that escaped Task 3's row-9 pruning" or "removes a stale
`controller.` reference inside a handler"].

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Final verification

**Files:**

- (No file modifications)

This task runs the full CI pass and inspects coverage to confirm the migration meets all DoD criteria. No commits — verification only.

**Design references:** §Definition of Done.

- [ ] **Step 1: Run the full CI pass**

Run: `make all`

Expected: PASS (lint + format + typecheck + coverage + e2e all green). The e2e suite shouldn't change behaviour — if any e2e test fails, investigate before considering the migration done. Likely failures point to a behavioural regression in the migration source (Task 3) that the unit tests didn't catch.

- [ ] **Step 2: Inspect coverage for ImageGallery.tsx and migrationStructuralCheck.test.ts**

Run: `make cover`

Inspect the coverage report (typically `packages/client/coverage/index.html` if HTML reporter is configured, or the terminal summary) for `packages/client/src/components/ImageGallery.tsx`. Confirm all four metrics meet or exceed CLAUDE.md §Testing Philosophy thresholds:

- statements ≥ 95%
- branches ≥ 85%
- functions ≥ 90%
- lines ≥ 95%

If any metric regresses below threshold, identify the uncovered branch and add a targeted test rather than relax the threshold (per CLAUDE.md §Testing Philosophy: "the goal is always to increase coverage as much as possible … never simply adjust the thresholds downward").

- [ ] **Step 3: Confirm zero test warnings**

Re-run `make test` and scan stderr for `console.warn` / `console.error` output. There should be none. If any noisy output appears, identify the source — likely an unsuppressed warning in a test that triggers an error path. Per CLAUDE.md §Testing Philosophy, spy on the output and assert the expected message rather than letting it leak.

- [ ] **Step 4: Walk the Definition of Done checklist from the design**

Verify each bullet from the design's §Definition of Done is met:

- [ ] `ImageGallery.tsx` no longer contains `useRef<AbortController>` (verified by Task 5 Step 1 grep AND Task 4's new global ban)
- [ ] `mutationOp` is shared by `handleFileSelect`, `handleSave`, `handleInsert`'s inner branch, `handleDelete`. `refsOp` is owned by `handleOpenDeleteConfirm` (Task 3 Steps 3–8)
- [ ] The combined unmount cleanup `useEffect` at the old lines 74–80 is removed; both hook instances handle their own auto-abort. The announcement-timer cleanup effect is untouched (Task 3 Step 5, verified Task 5 Step 4)
- [ ] The list-load `useEffect` and detail-references `useEffect` are unchanged (verified Task 5 Step 4)
- [ ] All `controller.signal.aborted` gates replaced with `signal.aborted` against the per-call destructured signal (Task 3 Steps 6, 7, 8); `selectedImageIdRef` identity gates stay immediately after signal gates in `handleOpenDeleteConfirm` (Task 3 Step 8)
- [ ] The JSX `onClick` for the link-style Delete button is `onClick={handleOpenDeleteConfirm}`; the named function lives at the top level of the component alongside the other handlers (Task 3 Step 2)
- [ ] All existing tests in `__tests__/ImageGallery.test.tsx` continue to pass (Step 1 above)
- [ ] Seven new characterization tests added: four `mutationOp`-handler tests, one `refsOp`-handler test, one cross-instance independence test, one shared-`mutationOp` test (Tasks 1, 2)
- [ ] `__tests__/migrationStructuralCheck.test.ts` collapsed: two per-file abort-migration tests replaced by one global ban; four helper / regex / internal tests preserved (Task 4 Steps 1–3)
- [ ] CLAUDE.md §Save-pipeline invariants rule 4 prose updated to reflect the post-collapse enforcement layer (Task 4 Steps 4–5)
- [ ] `make all` green (Step 1 above)
- [ ] Coverage on `ImageGallery.tsx` holds at or above 95/85/90/95 (Step 2 above)
- [ ] Zero test warnings (Step 3 above)
- [ ] No user-visible behaviour change (verified by all existing tests passing + e2e green)

- [ ] **Step 5: Branch is ready for Ovid's PR-creation**

The working branch `image-gallery-abort-migration` is ready. Ovid handles PR creation and merge per the design's §Migration order. The plan does NOT push, create a PR, or merge.
