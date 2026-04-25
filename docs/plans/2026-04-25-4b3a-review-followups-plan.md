# Phase 4b.3a — 4b.3 Review Follow-ups Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Land the 16 validated-but-unfixed items from the Phase 4b.3 code review across five sequential PRs (D → A → B → C → E) on `ovid/miscellaneous-fixes`.

**Architecture:** Five PRs, each delivering one cluster: sanitizer hardening, scope-coverage gaps, AbortSignal threading, consumer recovery completeness, and mapper internals + CLAUDE.md updates. Each cluster ships independently, rebased on `main` between merges. See `docs/plans/2026-04-25-4b3a-review-followups-design.md` for the full design and item-level rationale.

**Tech Stack:** TypeScript (npm workspaces), Vitest + React Testing Library + MSW for unit/integration, Playwright + aXe-core for e2e, DOMPurify (already vendored), Knex/SQLite (server unchanged).

**Repo discipline (CLAUDE.md):**
- TDD red-green-refactor for every fix.
- Coverage floors: 95% statements, 85% branches, 90% functions, 95% lines (`vitest.config.ts`). Aim higher.
- Zero warnings in test output. When deliberately triggering an error path that logs, spy and suppress.
- All UI strings in `packages/client/src/strings.ts`; never raw literals in components.
- Every PR description references this plan, lists the items it closes, and records the design doc.

---

## PR 1 — Cluster D: Sanitizer hardening

**Items:** [I14], [S21]. **Why first:** only Security finding; small, self-contained.

### Task 1.1: [I14] Failing test for `data:image/svg+xml` rejection

**Files:**
- Test: `packages/client/src/sanitizer.test.ts` (modify; create the file if it does not exist — verify with `ls`)

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "./sanitizer";

describe("sanitizer ALLOWED_URI_REGEXP", () => {
  it("rejects data: URIs in img src (XSS vector)", () => {
    const malicious = `<img src="data:image/svg+xml;base64,PHN2Zy8+" alt="x">`;
    const out = sanitizeHtml(malicious);
    expect(out).not.toContain("data:");
  });
});
```

**Step 2: Run, expect fail**

```bash
npm test -w packages/client -- sanitizer.test.ts
```

Expected: FAIL — DOMPurify defaults pass `data:` URIs through.

**Step 3: Implement**

`packages/client/src/sanitizer.ts`:

```ts
const ALLOWED_URI_REGEXP = /^\/api\/images\//i;

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
  });
}
```

(Note in the file: regex is intentionally simple; threat model is XSS in the rendered DOM, not server-side path traversal — the server enforces that.)

**Step 4: Run, expect pass**

Same command; expect PASS.

**Step 5: Commit**

```bash
git add packages/client/src/sanitizer.ts packages/client/src/sanitizer.test.ts
git commit -m "fix(sanitizer): pin ALLOWED_URI_REGEXP to reject data: URIs (I14)"
```

### Task 1.2: [I14] Add `javascript:` and non-Smudge URI rejection tests

**Files:** Test: `packages/client/src/sanitizer.test.ts`

**Step 1: Add tests**

```ts
it("rejects javascript: URIs in img src", () => {
  const m = `<img src="javascript:alert(1)" alt="x">`;
  expect(sanitizeHtml(m)).not.toMatch(/javascript:/i);
});

it("rejects http(s) URIs not under /api/images/", () => {
  const m = `<img src="http://example.com/x.png" alt="x">`;
  expect(sanitizeHtml(m)).not.toContain("example.com");
});

it("accepts /api/images/{uuid} URIs", () => {
  const m = `<img src="/api/images/123e4567-e89b-12d3-a456-426614174000" alt="x">`;
  expect(sanitizeHtml(m)).toContain("/api/images/");
});
```

**Step 2: Run, expect pass** (regex already in place from 1.1):

```bash
npm test -w packages/client -- sanitizer.test.ts
```

**Step 3: Commit**

```bash
git add packages/client/src/sanitizer.test.ts
git commit -m "test(sanitizer): cover javascript: and non-Smudge URI rejection (I14)"
```

### Task 1.3: [S21] Failing tests for `extrasFrom` bounds

**Files:** Test: `packages/client/src/errors/scopes.test.ts` (locate existing `image.delete` describe block; add to it)

**Step 1: Write tests**

```ts
describe("image.delete extrasFrom (S21 bounds)", () => {
  it("caps chapters at 50 entries", () => {
    const body = {
      error: { code: "IMAGE_REFERENCED", message: "x" },
      chapters: Array.from({ length: 200 }, (_, i) => ({
        id: `c-${i}`,
        title: `t-${i}`,
      })),
    };
    const extras = scopeFor("image.delete").extrasFrom?.(body);
    expect(extras?.chapters.length).toBe(50);
  });

  it("truncates per-title to 200 chars", () => {
    const body = {
      error: { code: "IMAGE_REFERENCED", message: "x" },
      chapters: [{ id: "c-1", title: "x".repeat(500) }],
    };
    const extras = scopeFor("image.delete").extrasFrom?.(body);
    expect(extras?.chapters[0].title.length).toBe(200);
  });
});
```

(`scopeFor` is the existing helper in scopes.test.ts; if it does not exist, import the scope object directly.)

**Step 2: Run, expect fail**

```bash
npm test -w packages/client -- scopes.test.ts
```

**Step 3: Implement bounds in `packages/client/src/errors/scopes.ts`**

In `image.delete`'s `extrasFrom`:

```ts
extrasFrom: (body: unknown) => {
  // ...existing chapter validation...
  const valid = chapters
    .slice(0, 50)
    .filter((c): c is { id: string; title: string } =>
      typeof c?.id === "string" && typeof c?.title === "string",
    )
    .map((c) => ({ id: c.id, title: c.title.slice(0, 200) }));
  return valid.length > 0 ? { chapters: valid } : undefined;
},
```

(Per pushback Issue 1: truncation is silent — no dev-warn — to avoid the [S6] bug that doesn't get fixed until Cluster E.)

**Step 4: Run, expect pass**

**Step 5: Commit**

```bash
git add packages/client/src/errors/scopes.ts packages/client/src/errors/scopes.test.ts
git commit -m "fix(scopes): bound image.delete chapters to 50 entries / 200 chars (S21)"
```

### Task 1.4: [I14] e2e — sanitizer rejects malicious URI in rendered snapshot content

**Files:** Create `e2e/sanitizer-snapshot-blob.spec.ts`. Server-side fixture support: identify the existing seed mechanism for snapshots (likely `packages/server/src/db/migrations/seeds` or a test-only insertion path); add a fixture snapshot whose content blob contains `<img src="data:image/svg+xml;base64,PHN2Zy8+">` and a second `<img src="javascript:alert(1)">` in TipTap JSON form.

**Step 1: Write the e2e**

```ts
import { test, expect } from "@playwright/test";

test("snapshot view rejects malicious img src URIs", async ({ page }) => {
  // The fixture seeds a snapshot whose content includes data:image/svg+xml
  // and javascript: URIs in <img> tags. The sanitizer must strip them.
  await page.goto("/projects/<seed-slug>/snapshots/<malicious-snapshot-id>");
  const html = await page.content();
  expect(html).not.toMatch(/data:image/i);
  expect(html).not.toMatch(/javascript:/i);
});
```

**Step 2: Run, expect fail or pass**

```bash
make e2e
```

If the fixture is set up correctly and Task 1.1's sanitizer fix is applied, this should PASS. If FAIL, the sanitizer is not actually wired into the snapshot-rendering path — investigate before declaring [I14] complete (the unit test alone is insufficient if the rendering path bypasses `sanitizeHtml`).

**Step 3: If wiring gap discovered:** trace `SnapshotPanel` / `SnapshotView` HTML rendering to confirm `sanitizeHtml` is called on snapshot content. Add the call if missing. (This is a separate concern from the regex pin — flag clearly in the commit if applicable.)

**Step 4: Run, expect pass.**

**Step 5: Commit**

```bash
git add e2e/sanitizer-snapshot-blob.spec.ts <fixture-paths>
git commit -m "test(e2e): sanitizer strips malicious URIs from snapshot content (I14)"
```

### Task 1.5: PR 1 finalization

**Step 1: Run full test suite + coverage**

```bash
make cover && make e2e
```

Expected: all tests pass; coverage at or above thresholds.

**Step 2: Open PR**

```bash
gh pr create --title "Phase 4b.3a Cluster D: sanitizer hardening (I14, S21)" --body "$(cat <<'EOF'
Cluster D of Phase 4b.3a (see `docs/plans/2026-04-25-4b3a-review-followups-design.md`).

Closes [I14], [S21] from the 4b.3 code review (`paad/code-reviews/ovid-unified-error-mapper-2026-04-25-10-32-46-a68afd1.md`).

## Changes
- `sanitizer.ts`: pin `ALLOWED_URI_REGEXP` to `/^\/api\/images\//i` — rejects `data:` and `javascript:` URIs that DOMPurify defaults pass through.
- `scopes.ts`: bound `image.delete`'s `extrasFrom` chapters at 50 entries / 200 chars per title.

## Test plan
- [ ] Sanitizer rejects `data:image/svg+xml` (unit + e2e via snapshot blob)
- [ ] Sanitizer rejects `javascript:` (unit + e2e via snapshot blob)
- [ ] Sanitizer accepts `/api/images/{uuid}`
- [ ] `extrasFrom` cap and truncation verified
EOF
)"
```

**Step 3: Wait for review and merge.** When merged, rebase `ovid/miscellaneous-fixes` on `main` before starting PR 2.

---

## PR 2 — Cluster A: Scope-coverage gaps

**Items:** [I1], [I2], [S1].

### Task 2.1: [I1] `chapter.reorder` REORDER_MISMATCH

**Files:**
- Modify: `packages/client/src/strings.ts` (add string)
- Modify: `packages/client/src/errors/scopes.ts` (`chapter.reorder` entry, around line 134)
- Modify: `packages/client/src/errors/scopes.test.ts`

**Step 1: Failing test**

```ts
it("chapter.reorder maps REORDER_MISMATCH to specific copy", () => {
  const err = makeApiError({ status: 400, code: "REORDER_MISMATCH" });
  expect(mapApiError(err, "chapter.reorder").message).toBe(
    STRINGS.error.reorderMismatch,
  );
});
```

**Step 2: Run, expect fail**

```bash
npm test -w packages/client -- scopes.test.ts -t "REORDER_MISMATCH"
```

**Step 3: Implement**

`strings.ts`:

```ts
reorderMismatch: "The chapter list is out of sync. Refresh and try again.",
```

`scopes.ts` `chapter.reorder` entry — add `byCode`:

```ts
"chapter.reorder": {
  byCode: { REORDER_MISMATCH: STRINGS.error.reorderMismatch },
  fallback: STRINGS.error.reorderFailed,
},
```

**Step 4: Run, expect pass**

**Step 5: Commit**

```bash
git add packages/client/src/strings.ts packages/client/src/errors/scopes.ts packages/client/src/errors/scopes.test.ts
git commit -m "fix(scopes): map REORDER_MISMATCH to specific copy (I1)"
```

### Task 2.2: [I2] `chapter.save` network field + 404 byStatus

**Files:**
- Modify: `packages/client/src/strings.ts` (3 new strings)
- Modify: `packages/client/src/errors/scopes.ts` (`chapter.save`)
- Modify: `packages/client/src/errors/scopes.test.ts`

**Step 1: Failing tests**

```ts
describe("chapter.save (I2)", () => {
  it("uses dedicated network copy for NETWORK", () => {
    const err = makeApiError({ code: "NETWORK" });
    expect(mapApiError(err, "chapter.save").message).toBe(
      STRINGS.editor.saveFailedNetwork,
    );
  });

  it("uses chapter-gone copy on 404", () => {
    const err = makeApiError({ status: 404 });
    expect(mapApiError(err, "chapter.save").message).toBe(
      STRINGS.editor.saveFailedChapterGone,
    );
  });

  it("falls back to neutral saveFailed", () => {
    const err = makeApiError({ status: 500 });
    expect(mapApiError(err, "chapter.save").message).toBe(
      STRINGS.editor.saveFailed,
    );
  });
});
```

**Step 2: Run, expect fail**

```bash
npm test -w packages/client -- scopes.test.ts -t "chapter.save \(I2\)"
```

**Step 3: Implement**

`strings.ts`:

```ts
saveFailed: "Save failed. Try again.",                                       // reword to neutral
saveFailedNetwork: "Unable to save — check your connection.",                // new
saveFailedChapterGone: "This chapter no longer exists. Reload to continue.", // new
```

`scopes.ts` `chapter.save`:

```ts
"chapter.save": {
  network: STRINGS.editor.saveFailedNetwork,
  byStatus: { 404: STRINGS.editor.saveFailedChapterGone },
  // ...existing entries (committed:, committedCodes:, byCode:)...
  fallback: STRINGS.editor.saveFailed,
},
```

**Step 4: Run, expect pass**

**Step 5: Commit**

```bash
git add packages/client/src/strings.ts packages/client/src/errors/scopes.ts packages/client/src/errors/scopes.test.ts
git commit -m "fix(scopes): add network and 404 mappings to chapter.save (I2)"
```

### Task 2.3: [I2] e2e test — chapter-save 404 banner

**Files:** Create `e2e/chapter-save-404.spec.ts` (or add to existing e2e/save-failure.spec.ts if present — verify with `ls e2e/`).

**Step 1: Write e2e**

```ts
import { test, expect } from "@playwright/test";

test("chapter PATCH 404 surfaces chapter-gone copy", async ({ page }) => {
  await page.goto("/projects/<seed-slug>/chapters/<seed-id>");
  await page.locator(".tiptap").click();
  await page.route("**/api/chapters/*", (r) => r.fulfill({ status: 404, body: '{"error":{"code":"NOT_FOUND","message":"x"}}' }));
  await page.keyboard.type("trigger save");
  await expect(page.getByText(/no longer exists/i)).toBeVisible();
});
```

(Use the project's existing seed fixtures; mirror an existing e2e test in `e2e/` for setup boilerplate.)

**Step 2: Run, expect fail**

```bash
make e2e
```

**Step 3:** No new implementation needed — Task 2.2 already mapped 404. Test should pass once selectors are right. Iterate.

**Step 4: Run, expect pass.**

**Step 5: Commit**

```bash
git add e2e/chapter-save-404.spec.ts
git commit -m "test(e2e): chapter PATCH 404 surfaces chapter-gone copy (I2)"
```

### Task 2.4: [S1] `trash.restoreChapter` 404 mapping

**Files:** `strings.ts`, `scopes.ts`, `scopes.test.ts`.

**Step 1: Failing test**

```ts
it("trash.restoreChapter maps 404 to already-purged copy", () => {
  const err = makeApiError({ status: 404 });
  expect(mapApiError(err, "trash.restoreChapter").message).toBe(
    STRINGS.error.restoreChapterAlreadyPurged,
  );
});
```

**Step 2: Run, expect fail.**

**Step 3: Implement**

`strings.ts`:

```ts
restoreChapterAlreadyPurged: "This chapter has been permanently deleted and cannot be restored.",
```

`scopes.ts` `trash.restoreChapter` — add:

```ts
byStatus: { 404: STRINGS.error.restoreChapterAlreadyPurged },
```

**Step 4: Run, expect pass.**

**Step 5: Commit**

```bash
git add packages/client/src/strings.ts packages/client/src/errors/scopes.ts packages/client/src/errors/scopes.test.ts
git commit -m "fix(scopes): map trash.restoreChapter 404 to already-purged copy (S1)"
```

### Task 2.5: PR 2 finalization

**Step 1: Run `make cover` + `make e2e`. Expect green.**

**Step 2: Open PR** with title `Phase 4b.3a Cluster A: scope-coverage gaps (I1, I2, S1)`. PR body lists items closed; references the design doc.

**Step 3: After merge, rebase on `main`.**

---

## PR 3 — Cluster B: AbortSignal threading

**Items:** [I6]–[I12], [S12]. Single PR with eight touchpoints (one coherent refactor; rationale logged in design doc).

### Task 3.1: [I7] [I8] [I9] API surface — add `signal` parameter

**Files:**
- Modify: `packages/client/src/api/client.ts` (4 method signatures)
- Modify: `packages/client/src/api/client.test.ts`

**Step 1: Failing tests** — for each of `projects.create`, `projects.delete`, `chapters.create`, `chapterStatuses.list`:

```ts
it("projects.create forwards AbortSignal to fetch", async () => {
  const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
    new Response('{"id":"x","title":"t","slug":"t","mode":"manual"}', { status: 201 }),
  );
  const ac = new AbortController();
  await api.projects.create({ title: "t", mode: "manual" }, ac.signal);
  expect(fetchSpy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: ac.signal }));
  fetchSpy.mockRestore();
});
```

(Repeat for delete, chapters.create, chapterStatuses.list.)

**Step 2: Run, expect fail.**

```bash
npm test -w packages/client -- api/client.test.ts
```

**Step 3: Implement**

In `api/client.ts`, add `signal?: AbortSignal` to each method's last parameter and forward to `fetch(url, { ...options, signal })`. Mirror the pattern already used in `chapters.get`.

**Step 4: Run, expect pass.**

**Step 5: Commit**

```bash
git add packages/client/src/api/client.ts packages/client/src/api/client.test.ts
git commit -m "feat(api): accept signal in projects.{create,delete}, chapters.create, chapterStatuses.list (I7-I9)"
```

### Task 3.2: [I10] `loadProject` AbortController migration

**Files:**
- Modify: `packages/client/src/hooks/useProjectEditor.ts` (lines ~198–262)
- Modify: `packages/client/src/hooks/useProjectEditor.test.ts`

**Step 1: Failing test** — render `useProjectEditor`, unmount mid-load, assert underlying `projects.get` and `chapters.get` saw an aborted signal.

```ts
it("loadProject aborts in-flight GETs on unmount", async () => {
  const projectsSpy = vi.spyOn(api.projects, "get").mockImplementation((slug, signal) =>
    new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
  );
  const { unmount } = renderHook(() => useProjectEditor("slug"));
  unmount();
  await expect(projectsSpy.mock.calls[0][1]?.aborted).toBe(true);
  projectsSpy.mockRestore();
});
```

**Step 2: Run, expect fail** (current code uses `let cancelled = false`).

**Step 3: Implement** — replace `cancelled` flag with `AbortController` in the load effect:

```ts
useEffect(() => {
  const ac = new AbortController();
  (async () => {
    try {
      const project = await api.projects.get(slug, ac.signal);
      const chapters = await api.chapters.get(project.id, ac.signal);
      // ...existing setProject logic, gated on !ac.signal.aborted...
    } catch (err) {
      if (isAborted(err)) return;
      // existing error handling
    }
  })();
  return () => ac.abort();
}, [slug]);
```

**Step 4: Run, expect pass.**

**Step 5: Commit**

```bash
git add packages/client/src/hooks/useProjectEditor.ts packages/client/src/hooks/useProjectEditor.test.ts
git commit -m "refactor(useProjectEditor): convert loadProject to AbortController (I10)"
```

### Task 3.3: [S12] Thread `chapters.get` signal at remaining call sites

**Files:** `packages/client/src/hooks/useProjectEditor.ts` lines `:239`, `:635`, `:688` (`loadProject`, `handleSelectChapter`, `reloadActiveChapter`).

**Step 1: Failing tests** — for each call site, assert the underlying `api.chapters.get` mock receives a signal that aborts on unmount.

**Step 2: Run, expect fail.**

**Step 3: Implement** — pass the existing relevant controller's signal as the second arg to `api.chapters.get` at each site. (For `handleSelectChapter` and `reloadActiveChapter`, the design's `useAbortableSequence` pattern already provides a signal; thread it.)

**Step 4: Run, expect pass.**

**Step 5: Commit**

```bash
git add packages/client/src/hooks/useProjectEditor.ts packages/client/src/hooks/useProjectEditor.test.ts
git commit -m "fix(useProjectEditor): thread chapters.get signal at all call sites (S12)"
```

### Task 3.4: [I9] `EditorPage` chapterStatuses retry-with-backoff → AbortController

**Files:** `packages/client/src/pages/EditorPage.tsx` lines `:1228–1244`, `EditorPage.test.tsx`.

**Step 1: Failing test** — render `EditorPage`, unmount during a backoff retry, assert no late `setStatuses` runs.

**Step 2: Run, expect fail.**

**Step 3: Implement** — replace `let cancelled = false` + `setTimeout`-queue with a single `AbortController`. Each retry checks `controller.signal.aborted` before scheduling next retry. Cleanup aborts.

**Step 4: Run, expect pass.**

**Step 5: Commit**

```bash
git add packages/client/src/pages/EditorPage.tsx packages/client/src/pages/EditorPage.test.tsx
git commit -m "refactor(EditorPage): chapterStatuses retry uses AbortController (I9)"
```

### Task 3.5: [I11] `search.replace` signal threading

**Files:** `packages/client/src/pages/EditorPage.tsx` lines `:775` and `:1018`, `EditorPage.test.tsx`.

**Step 1: Failing tests** — render, trigger replace, unmount mid-flight, assert `api.search.replace` received an aborted signal.

**Step 2–4:** Allocate `replaceAbortRef = useRef<AbortController | null>(null)` at component scope; both call sites set `replaceAbortRef.current = new AbortController()` and pass `controller.signal` to `api.search.replace`. Component unmount aborts.

**Step 5: Commit**

```bash
git add packages/client/src/pages/EditorPage.tsx packages/client/src/pages/EditorPage.test.tsx
git commit -m "fix(EditorPage): thread signal through search.replace at both call sites (I11)"
```

### Task 3.6: [I12] `ExportDialog` unmount cleanup

**Files:** `packages/client/src/components/ExportDialog.tsx`, `ExportDialog.test.tsx`.

**Step 1: Failing test** — mount with `open=true` and an in-flight export; unmount; assert `abortRef.current.abort` was called.

**Step 2: Run, expect fail.**

**Step 3: Implement** — add a separate `useEffect(() => () => abortRef.current?.abort(), [])` distinct from the open-transition effect.

**Step 4: Run, expect pass.**

**Step 5: Commit**

```bash
git add packages/client/src/components/ExportDialog.tsx packages/client/src/components/ExportDialog.test.tsx
git commit -m "fix(ExportDialog): abort in-flight export on unmount (I12)"
```

### Task 3.7: [I6] [S18] `Editor.tsx` paste/drop image upload signal

**Files:** `packages/client/src/components/Editor.tsx` line `:281`, `Editor.test.tsx`.

(Note: [S18] in Cluster C is the announcement-on-cross-chapter-switch fix and is handled in PR 4. Here we only thread the signal — [I6].)

**Step 1: Failing test** — paste an image; unmount mid-upload; assert `api.images.upload` saw an aborted signal.

**Step 2: Run, expect fail.**

**Step 3: Implement** — allocate `uploadAbortRef = useRef<AbortController | null>(null)` on the editor; thread signal to `api.images.upload`; abort on unmount and on chapter switch.

**Step 4: Run, expect pass.**

**Step 5: Commit**

```bash
git add packages/client/src/components/Editor.tsx packages/client/src/components/Editor.test.tsx
git commit -m "fix(Editor): thread signal through paste/drop image upload (I6)"
```

### Task 3.8: [I7-derived] `HomePage.handleCreate` and `handleDelete` signal threading

**Files:** `packages/client/src/pages/HomePage.tsx`, `HomePage.test.tsx`.

**Step 1: Failing tests** — for create and delete, assert per-handler `AbortController` aborts on unmount.

**Step 2: Run, expect fail.**

**Step 3: Implement** — each handler allocates its own controller; threads signal through `api.projects.create` / `api.projects.delete`; aborts on unmount via a top-level effect that owns the refs.

**Step 4: Run, expect pass.**

**Step 5: Commit**

```bash
git add packages/client/src/pages/HomePage.tsx packages/client/src/pages/HomePage.test.tsx
git commit -m "fix(HomePage): thread signal through projects.create and projects.delete (I7)"
```

### Task 3.9: e2e — navigate mid-export

**Files:** `e2e/export-mid-navigate.spec.ts`.

**Step 1: Write test** — open export dialog; intercept the export route to delay 5s; navigate away during the delay; assert no error toast appears post-unmount.

**Step 2: Run.** Iterate selectors as needed.

**Step 5: Commit**

```bash
git add e2e/export-mid-navigate.spec.ts
git commit -m "test(e2e): no error toast when navigating mid-export (I12)"
```

### Task 3.10: e2e — navigate mid-replace

**Files:** `e2e/replace-mid-navigate.spec.ts`. Same shape as 3.9 against `/api/.../replace`.

**Step 5: Commit**

```bash
git add e2e/replace-mid-navigate.spec.ts
git commit -m "test(e2e): no error toast when navigating mid-replace (I11)"
```

### Task 3.11: PR 3 finalization

`make cover && make e2e`; open PR with title `Phase 4b.3a Cluster B: AbortSignal threading (I6-I12, S12)`. Body lists all items + the scope-exception rationale (one coherent refactor with eight touchpoints). After merge, rebase.

---

## PR 4 — Cluster C: Consumer recovery completeness

**Items:** [I3], [I4], [I5], [S3]/[S7], [S4], [S5], [S8], [S10], [S11], [S15], [S16], [S17], [S18], [S19], [S20]. **One PR; one commit per item where feasible** (per design's scope-exception discipline).

### Task 4.0: Introduce `ScopeExtras<S>` and `applyMappedError` helper (foundation for [S15])

**Files:**
- Create: `packages/client/src/errors/applyMappedError.ts`
- Create: `packages/client/src/errors/applyMappedError.test.ts`
- Modify: `packages/client/src/errors/index.ts` (export both)
- Modify: `packages/client/src/errors/scopes.ts` (export `ScopeExtras<S>` type)

**Step 1: Write helper unit tests first** (per pushback Issue 4 — helper before any migration):

```ts
describe("applyMappedError", () => {
  it("calls onMessage with non-null message", () => {
    const onMessage = vi.fn();
    applyMappedError({ message: "boom", possiblyCommitted: false, transient: false }, { onMessage });
    expect(onMessage).toHaveBeenCalledWith("boom");
  });

  it("does not call onMessage when message is null (ABORTED)", () => {
    const onMessage = vi.fn();
    applyMappedError({ message: null, possiblyCommitted: false, transient: false }, { onMessage });
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("calls onTransient with transient flag when provided", () => {
    const onMessage = vi.fn(); const onTransient = vi.fn();
    applyMappedError({ message: "x", possiblyCommitted: false, transient: true }, { onMessage, onTransient });
    expect(onTransient).toHaveBeenCalledWith(true);
  });

  it("calls onCommitted with possiblyCommitted when provided", () => {
    const onMessage = vi.fn(); const onCommitted = vi.fn();
    applyMappedError({ message: "x", possiblyCommitted: true, transient: false }, { onMessage, onCommitted });
    expect(onCommitted).toHaveBeenCalledWith(true);
  });

  it("calls onExtras when extras present and callback provided", () => {
    const onMessage = vi.fn(); const onExtras = vi.fn();
    applyMappedError({ message: "x", possiblyCommitted: false, transient: false, extras: { chapters: [] } }, { onMessage, onExtras });
    expect(onExtras).toHaveBeenCalledWith({ chapters: [] });
  });

  it("omitting onTransient/onCommitted/onExtras does not throw", () => {
    expect(() => applyMappedError({ message: "x", possiblyCommitted: true, transient: true, extras: { chapters: [] } }, { onMessage: () => {} })).not.toThrow();
  });
});
```

**Step 2: Run, expect fail.**

**Step 3: Implement**

`applyMappedError.ts`:

```ts
import type { MappedError, Scopes } from "./scopes";

export type ScopeExtras<S extends keyof Scopes> = Scopes[S] extends { extras?: infer E } ? E : never;

export function applyMappedError<S extends keyof Scopes>(
  mapped: MappedError<S>,
  handlers: {
    onMessage: (message: string) => void;
    onTransient?: (transient: boolean) => void;
    onCommitted?: (possiblyCommitted: boolean) => void;
    onExtras?: (extras: ScopeExtras<S>) => void;
  },
): void {
  if (mapped.transient && handlers.onTransient) handlers.onTransient(true);
  if (mapped.possiblyCommitted && handlers.onCommitted) handlers.onCommitted(true);
  if (mapped.extras !== undefined && handlers.onExtras) handlers.onExtras(mapped.extras as ScopeExtras<S>);
  if (mapped.message !== null) handlers.onMessage(mapped.message);
}
```

(Adjust `MappedError<S>` import based on existing apiErrorMapper's exported type. If a generic version isn't already exported, export it alongside — same module already returns the shape.)

**Step 4: Run, expect pass.**

**Step 5: Commit**

```bash
git add packages/client/src/errors/applyMappedError.ts packages/client/src/errors/applyMappedError.test.ts packages/client/src/errors/index.ts packages/client/src/errors/scopes.ts
git commit -m "feat(errors): introduce applyMappedError helper and ScopeExtras<S> (S15 foundation)"
```

### Task 4.1: [I3] `SnapshotPanel.handleCreate` consumes possiblyCommitted

**Files:** `packages/client/src/components/SnapshotPanel.tsx` line `:305`, `SnapshotPanel.test.tsx`.

**Step 1: Failing test** — simulate snapshot.create returning 2xx BAD_JSON; assert form is hidden, label cleared, snapshots refetched.

**Step 2: Run, expect fail.**

**Step 3: Implement** — destructure `possiblyCommitted` from `mapApiError`; branch:

```ts
if (possiblyCommitted) {
  setShowCreateForm(false);
  setCreateLabel("");
  setDuplicateMessage(false);
  await fetchSnapshots();
}
```

**Step 4: Run, expect pass.**

**Step 5: Commit**

```bash
git add packages/client/src/components/SnapshotPanel.tsx packages/client/src/components/SnapshotPanel.test.tsx
git commit -m "fix(snapshots): handle possiblyCommitted on snapshot.create (I3)"
```

### Task 4.2: [I4] `useTrashManager.handleRestore` refresh project + reseed confirmedStatusRef

**Files:** `packages/client/src/hooks/useTrashManager.ts` line `:117–138`, `useTrashManager.test.ts`.

**Step 1: Failing test** — possiblyCommitted on restore; assert `api.projects.get` called and `confirmedStatusRef` updated.

**Step 2: Run, expect fail.**

**Step 3: Implement** — in the `possiblyCommitted` branch, run `await api.projects.get(slug, signal)` then update both `project.chapters` and `confirmedStatusRef` (mirror `handleCreateChapter`'s recovery branch).

**Step 4: Run, expect pass.**

**Step 5: Commit**

```bash
git add packages/client/src/hooks/useTrashManager.ts packages/client/src/hooks/useTrashManager.test.ts
git commit -m "fix(trash): refresh project and reseed confirmedStatusRef on possiblyCommitted restore (I4)"
```

### Task 4.3: [I5] `confirmDeleteChapter` surfaces error before dismiss

**Files:** `useTrashManager.ts:147–156`, `useTrashManager.test.ts`.

**Step 1: Failing test** — make `handleDeleteChapter` throw; assert `setActionError` called with mapped message before `setDeleteTarget(null)`.

**Step 2: Run, expect fail.**

**Step 3: Implement** — in catch: call `applyMappedError(mapApiError(err, "chapter.delete"), { onMessage: setActionError })` before dismissing.

**Step 5: Commit**

```bash
git add packages/client/src/hooks/useTrashManager.ts packages/client/src/hooks/useTrashManager.test.ts
git commit -m "fix(trash): surface error before dismissing confirmDeleteChapter dialog (I5)"
```

### Task 4.4: [S3]/[S7] move `chapter.save` BAD_JSON dispatch into the scope

**Files:** `packages/client/src/errors/scopes.ts` (`chapter.save`), `packages/client/src/hooks/useProjectEditor.ts:357–369, 441–448`.

**Step 1: Failing tests** — assert that for `chapter.save` 2xx BAD_JSON the call site no longer does ad-hoc detection; the scope itself drives the editor-locking copy.

**Step 2: Run, expect fail.**

**Step 3: Implement** — extend `committedCodes` semantics or add a parallel `terminalCodes` field to `ScopeEntry` that maps named codes to a "terminal/locking" message; remove the call-site allowlist hardcode.

**Step 4: Run, expect pass.**

**Step 5: Commit**

```bash
git add packages/client/src/errors/scopes.ts packages/client/src/hooks/useProjectEditor.ts packages/client/src/errors/scopes.test.ts packages/client/src/hooks/useProjectEditor.test.ts
git commit -m "fix(errors): move chapter.save BAD_JSON dispatch into scope (S3, S7)"
```

### Task 4.5: [S4] `handleStatusChange` mirror onError fallback

**Files:** `useProjectEditor.ts:1032–1040`, test.

**Step 1: Failing test** — call `handleStatusChange` without `onError`; assert `setError(message)` is called when `possiblyCommitted` is true.

**Step 2–4:** Implement `if (onError) onError(message); else setError(message);` (mirror `handleReorderChapters`).

**Step 5: Commit**

```bash
git commit -m "fix(useProjectEditor): handleStatusChange falls back to setError when onError omitted (S4)"
```

### Task 4.6: [S5] `restoreSnapshot` `dispatched` flag

**Files:** `packages/client/src/hooks/useSnapshotState.ts:421–434`, test.

**Step 1: Failing test** — make a pre-send throw (e.g. an arg-validation throw before fetch); assert mapper is NOT given a synthesized 200 BAD_JSON.

**Step 2–4:** Implement `let dispatched = false; … dispatched = true; await api...; … catch: only synth 200 BAD_JSON when dispatched === true`.

**Step 5: Commit**

```bash
git commit -m "fix(snapshots): only synthesize 200 BAD_JSON for dispatched restore failures (S5)"
```

### Task 4.7: [S8] `image.delete` `extrasFrom` returns valid subset

**Files:** `scopes.ts:195–206`, scopes.test.ts.

**Step 1: Failing test** — supply `chapters` with mixed valid/invalid entries; assert valid subset returned, not `undefined`.

**Step 2–4:** Implement: `return valid.length > 0 ? { chapters: valid } : undefined`.

**Step 5: Commit**

```bash
git commit -m "fix(scopes): image.delete extrasFrom returns valid subset on partial malformed (S8)"
```

### Task 4.8: [S11] `chapter.create` 404 redirect

**Files:** `useProjectEditor.ts:530–613` (caller of `chapters.create`), test.

**Step 1: Failing test** — mock `chapters.create` 404; assert `navigate("/")` called.

**Step 2–4:** In the catch, gate `isNotFound(err)` and call `navigate("/")` before mapping. Mirror `EditorPage:1552`'s comment justifying the redirect.

**Step 5: Commit**

```bash
git commit -m "fix(useProjectEditor): redirect home on stale-project chapter.create 404 (S11)"
```

### Task 4.9: [S16] `chapter.flushBeforeNavigate` scope

**Files:** `scopes.ts`, `EditorPage.tsx:1481–1485`, scopes.test.ts.

**Step 1: Failing test** — assert that flush-before-navigate failures use the new scope.

**Step 2–4:** Add a `chapter.flushBeforeNavigate` scope to `scopes.ts` with appropriate fallback/network/byCode entries; switch the call site.

**Step 5: Commit**

```bash
git commit -m "fix(EditorPage): use chapter.flushBeforeNavigate scope for flush failures (S16)"
```

### Task 4.10: [S17] null `createRecoveryAbortRef` on success

**Files:** `useProjectEditor.ts:566–608`.

**Step 1: Failing test** — successful create, assert `createRecoveryAbortRef.current === null` after.

**Step 2–4:** Add `if (createRecoveryAbortRef.current === recoveryController) createRecoveryAbortRef.current = null;` at success.

**Step 5: Commit**

```bash
git commit -m "fix(useProjectEditor): null createRecoveryAbortRef after successful create (S17)"
```

### Task 4.11: [S19] null `viewAbortRef` on success

**Files:** `useSnapshotState.ts:265–345`. Mirror Task 4.10.

**Step 5: Commit**

```bash
git commit -m "fix(snapshots): null viewAbortRef after successful viewSnapshot (S19)"
```

### Task 4.12: [S20] `handleReorderChapters` epoch re-check before setProject

**Files:** `useProjectEditor.ts:868–889`, test.

**Step 1: Failing test** — simulate reorder followed by chapter switch (epoch bump); assert `setProject` is NOT called on the now-stale possiblyCommitted branch.

**Step 2–4:** Move `setProject` into the existing `projectId`-match guard or duplicate it.

**Step 5: Commit**

```bash
git commit -m "fix(useProjectEditor): epoch re-check before setProject in possiblyCommitted reorder (S20)"
```

### Task 4.13: [S18] `Editor.tsx` paste announcement gated on editor instance

**Files:** `Editor.tsx:269–312`, test.

**Step 1: Failing test** — paste; switch to another chapter in same project; assert announcement does NOT fire on torn-down editor.

**Step 2–4:** Capture `editorInstanceRef.current` at upload start; gate announcement on `editor === editorInstanceRef.current`.

**Step 5: Commit**

```bash
git commit -m "fix(Editor): gate paste announcement on captured editor instance (S18)"
```

### Task 4.14: [S10] dev-only `console.warn` on silent recovery-catches

**Files:** `useProjectEditor.ts` (lines `:1079` `handleStatusChange`, `:604` `handleCreateChapter`), tests.

**Step 1: Failing test** — make recovery throw; assert `console.warn` called when `!signal.aborted`. (Use `vi.spyOn(console, "warn").mockImplementation(() => {});` per CLAUDE.md zero-warnings rule.)

**Step 2–4:** Add a dev-only `if (import.meta.env?.DEV && !signal.aborted) console.warn(...)` in each silent catch. (This depends on Cluster B's signal threading; verify signal is in scope at both call sites.)

**Step 5: Commit**

```bash
git commit -m "fix(useProjectEditor): dev-warn on silent recovery catches (S10)"
```

### Task 4.15: [S15] migrate one call site at a time — start with simple sites

**Files:** identify all sites with the `if (message === null) return; if (message) setX(message)` shape via grep:

```bash
grep -rn 'if (message === null) return' packages/client/src
```

**Per-site loop (one commit each):**

For each site:

**Step 1:** Verify site is "simple shape" (just `setX(message)` after the null check) — if mixed catch logic (e.g. interleaved with `confirmedStatusRef` updates), flag for closer review and treat as a separate task with its own test.

**Step 2:** Replace `mapApiError(err, scope)` ladder with:

```ts
applyMappedError(mapApiError(err, scope), { onMessage: setX });
```

(Add `onTransient`/`onCommitted`/`onExtras` only if the site needs them.)

**Step 3:** Run that file's tests — expect green.

**Step 4: Commit**

```bash
git commit -m "refactor(<file>): migrate to applyMappedError (S15)"
```

**Mixed-catch sites (flagged for closer review):**
- `useTrashManager.handleRestore` (interleaves `confirmedStatusRef` + `setActionError`)
- Any site identified during the grep that has additional state updates between the null-check and the `setX` call

For each flagged site, write a behavior-pinning test BEFORE migration that asserts the full effect (state + side effects) remains identical post-migration.

### Task 4.16: e2e — [S11] redirect on stale-project chapter create

**Files:** `e2e/chapter-create-stale-project.spec.ts`.

Open project, intercept `chapters.create` with 404, click "New chapter", assert URL is `/`.

**Step 5: Commit**

```bash
git commit -m "test(e2e): redirect home on stale-project chapter create (S11)"
```

### Task 4.17: e2e — [I3] possiblyCommitted snapshot create then panel refresh

**Files:** `e2e/snapshot-create-possibly-committed.spec.ts`.

Open project, intercept `POST /api/.../snapshots` with 2xx + invalid JSON; assert form clears and snapshot list refetches (snapshot appears in panel).

**Step 5: Commit**

```bash
git commit -m "test(e2e): snapshot panel refreshes on possiblyCommitted create (I3)"
```

### Task 4.18: e2e — [I5] silent dismiss now surfaces error

**Files:** `e2e/trash-confirm-delete-error.spec.ts`.

Open trash, attempt to delete a chapter with a forced 500 from the server; assert error banner appears and dialog closes.

**Step 5: Commit**

```bash
git commit -m "test(e2e): confirmDeleteChapter surfaces error on unexpected throw (I5)"
```

### Task 4.19: PR 4 finalization

`make cover && make e2e`; open PR with title `Phase 4b.3a Cluster C: consumer recovery completeness (14 items)`. Body lists every item closed AND the scope-exception rationale ("single theme: consumer mishandling of mapper output; one commit per item; mixed-catch sites flagged"). After merge, rebase.

---

## PR 5 — Cluster E: Mapper internals + CLAUDE.md updates

**Items:** [S2], [S6], [S9], [S13], [S14].

### Task 5.1: [S6] `safeExtrasFrom` dev-log try/catch

**Files:** `packages/client/src/errors/apiErrorMapper.ts:173`, test.

**Step 1: Failing test** — using a `Proxy` that throws on `import.meta` access, assert `safeExtrasFrom` does not throw.

**Step 2: Run, expect fail.**

**Step 3: Implement** — wrap the dev-log block in `try {} catch {}`.

**Step 4: Run, expect pass.**

**Step 5: Commit**

```bash
git commit -m "fix(errors): wrap safeExtrasFrom dev-log in try/catch (S6)"
```

### Task 5.2: [S9] verify and drop `ImageGallery` extras cast

**Files:** `packages/client/src/components/ImageGallery.tsx:334–338`, test.

**Step 1:** Run `npm run typecheck` — confirm `ScopeExtras<S>` (introduced by Cluster C) makes the existing cast unnecessary. If the cast is still load-bearing, fix the underlying narrowing in `errors/`.

**Step 2: Drop the cast** and run `npm run typecheck`. Expect green.

**Step 3:** Add a type-test in `errors/scopes.test.ts` that asserts `ScopeExtras<"image.delete">["chapters"]` is the expected shape:

```ts
type _Test = ScopeExtras<"image.delete">["chapters"][number];
const _check: _Test = { id: "x", title: "y" }; // compile-time only
```

**Step 5: Commit**

```bash
git commit -m "refactor(ImageGallery): drop extras.chapters cast (S9)"
```

### Task 5.3: [S13] extract `refreshTrashList()` helper

**Files:** `packages/client/src/hooks/useTrashManager.ts:53–71`, `:158–178`, test.

**Step 1: Pin behavior** — ensure existing tests cover both `openTrash` and `confirmDeleteChapter` flows hitting the trash-list refresh.

**Step 2:** Extract the shared body to `const refreshTrashList = useCallback(async () => { ... }, [...])`. Both sites call it.

**Step 3: Run all useTrashManager tests, expect green.**

**Step 5: Commit**

```bash
git commit -m "refactor(trash): extract refreshTrashList helper (S13)"
```

### Task 5.4: [S14] dedupe `SnapshotPanel` mount-effect

**Files:** `packages/client/src/components/SnapshotPanel.tsx:139–159`, `:164–189`, test.

**Step 1: Pin behavior** — existing tests cover mount + manual refetch.

**Step 2: Implement** — mount effect calls `fetchSnapshots()` directly; move `chapterSeq.abort()` into the effect. Remove the duplicate.

**Step 3: Run, expect green.**

**Step 5: Commit**

```bash
git commit -m "refactor(snapshots): dedupe SnapshotPanel mount effect (S14)"
```

### Task 5.5: [S2] + [F retrospective] CLAUDE.md updates

**Files:** `CLAUDE.md`.

**Step 1: Read current CLAUDE.md `§Key Architecture Decisions / "Unified API error mapping"` block (lines 94–104).**

**Step 2: Edit** to:

1. Describe both `possiblyCommitted` mechanisms (2xx BAD_JSON for `committed:`-declaring scopes AND the `committedCodes` extension mapping `UPDATE_READ_FAILURE`, `READ_AFTER_CREATE_FAILURE`, `RESTORE_READ_FAILURE`).
2. Reference `ScopeExtras<S>` as the typed `extras` accessor.
3. Reference `applyMappedError(mapped, handlers)` as the canonical consumer pattern (parallel with `useEditorMutation` and `useAbortableSequence` references already in the doc). Note hand-rolled message ladders are deprecated.

**Step 3: Edit `§Pull Request Scope`** to add the one-line acknowledgement of the 4b.3 bundling exception:

> The unified-error-mapper migration (Phase 4b.3) shipped with sanitizer hardening + CONTRIBUTING + Node-engines pin attached, in violation of the one-feature rule. Phase 4b.3a accepts this as a logged exception; recurrence requires explicit per-phase justification.

**Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): document committedCodes, ScopeExtras<S>, applyMappedError, and 4b.3 scope exception (S2, F)"
```

### Task 5.6: PR 5 finalization

`make cover && make e2e`. Open PR with title `Phase 4b.3a Cluster E: mapper internals + CLAUDE.md (S2, S6, S9, S13, S14)`. Body lists items closed AND notes `[S22]/[S23]` as documented in the design doc (no code change required). After merge, the phase is complete.

### Task 5.7: Phase close-out

**Step 1: Update `docs/roadmap.md` Phase Structure table:**

Mark Phase 4b.3a `Done` (currently `In Progress`).

**Step 2: Commit**

```bash
git add docs/roadmap.md
git commit -m "docs(roadmap): mark Phase 4b.3a done"
```

**Step 3: Final verification**

```bash
make all
```

Expected: lint clean, format clean, typecheck clean, coverage ≥ thresholds, e2e green.

---

## Dependencies between PRs

- D → A → B independent at the file level; sequencing is for risk + value.
- B → C: only [S10] (Task 4.14) requires B's signal threading; [S17]/[S19] (Tasks 4.10/4.11) are independent.
- C → E: Cluster C introduces `ScopeExtras<S>` and `applyMappedError`; Cluster E's [S9] (Task 5.2) consumes the type.

If a PR is delayed or rejected, defer dependent tasks rather than working around them.

## Definition of Done (phase)

- All five PRs merged to `main`.
- `make all` green at the close of each PR.
- Coverage at or above the existing thresholds throughout.
- Zero new test-output warnings.
- Roadmap updated: Phase 4b.3a → Done.

## References

- Design: `docs/plans/2026-04-25-4b3a-review-followups-design.md`
- Source review: `paad/code-reviews/ovid-unified-error-mapper-2026-04-25-10-32-46-a68afd1.md`
- CLAUDE.md sections: §Key Architecture Decisions, §Testing Philosophy, §Pull Request Scope
