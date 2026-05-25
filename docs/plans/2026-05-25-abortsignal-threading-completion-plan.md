# Phase 4b.3b: AbortSignal Threading Completion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thread `AbortSignal` through Cluster B's remaining API call sites and sweep the `useRef<AbortController>` allowlist from 7 files down to 3 (one entry per documented second-tier-recovery or simultaneously-live-controller pattern), so Phase 4b.4's ESLint rule can land with inline `eslint-disable` lines instead of a file-level allowlist.

**Architecture:** Approach 3 (Hybrid Pragmatic) per design §1. Each migration decision is pinned in the design's §2.2 / §2.3 decision matrix — that matrix is the contract. Code follows: route textbook-fit sites through `useAbortableAsyncOperation`; keep hand-rolled refs with inline justification where lifecycle requires (second-tier recovery, simultaneously-live controllers). Each per-site commit is independently revertable.

**Tech Stack:** React 18 + TypeScript, Vitest, the existing `useAbortableAsyncOperation` hook (`packages/client/src/hooks/useAbortableAsyncOperation.ts`), the existing `useAbortableSequence` hook for response-staleness pairing, and `mapApiError(err, scope)` for any new error surfaces.

**Source design:** `docs/plans/2026-05-25-abortsignal-threading-completion-design.md`. Read §1, §2.2, §2.3, §3, §5, §6 before starting. The §5 execution order is the commit-ordering contract.

**Branch:** `abortsignal-threading-completion`. All commits land here; single PR at the end.

---

## File Structure

**New:**
- `packages/client/src/utils/abortable.ts` — `sleep(ms, signal)` helper (used by C-9 and S-2).
- `packages/client/src/utils/abortable.test.ts` — co-located unit tests for `sleep`.

**Modified:**
- `packages/client/src/api/client.ts` — 4 endpoints grow `signal?: AbortSignal` (API-1..API-4).
- `packages/client/src/__tests__/api-client.test.ts` — 4 new transport-level signal-threading tests + assertions on consumer test setup.
- `packages/client/src/pages/HomePage.tsx` — C-1, C-2 (hook), C-3 (justification comment on retained ref).
- `packages/client/src/hooks/useProjectEditor.ts` — C-4, C-5 (comment), C-6, C-7/C-8; S-2..S-7 sweep.
- `packages/client/src/pages/EditorPage.tsx` — C-9, C-10/C-11, S-1.
- `packages/client/src/components/ExportDialog.tsx` — S-8.
- `packages/client/src/components/ProjectSettingsDialog.tsx` — S-9, S-10.
- `packages/client/src/components/SnapshotPanel.tsx` — S-11, S-12.
- `packages/client/src/hooks/useSnapshotState.ts` — S-13, S-14, S-15 (S-16 stays, gets justification comment).
- `packages/client/src/__tests__/migrationStructuralCheck.test.ts` — incremental `PHASE_4B_3B_ALLOWLIST` shrinks per `§5 Allowlist-edit discipline`; final commit rewrites the comment block and adds the new import-implies-call assertion.
- `packages/client/src/hooks/useAbortableAsyncOperation.test.ts` — new hook-level contract test (per-call signal valid across multiple awaits within one `fn`).
- `CLAUDE.md` — §Save-pipeline invariants Rule 4 reframe + §Pull Request Scope footnote.

**Commit count target:** ~22-24 commits. One per per-site row in §2.2 / §2.3, plus API surface, sleep helper, structural test, and CLAUDE.md.

**Allowlist-edit discipline (design §5):** These commits must ALSO remove the file from `PHASE_4B_3B_ALLOWLIST` in `migrationStructuralCheck.test.ts:130-138` in the same commit:

| Last-ref-removal commit | Removes from allowlist |
|---|---|
| S-10 (second of S-9/S-10) | `ProjectSettingsDialog.tsx` |
| S-12 (second of S-11/S-12) | `SnapshotPanel.tsx` |
| S-1 (only ref in EditorPage) | `EditorPage.tsx` |
| S-8 (only ref in ExportDialog) | `ExportDialog.tsx` |

`useProjectEditor.ts`, `HomePage.tsx`, and `useSnapshotState.ts` retain at least one justified hand-rolled ref each (C-5, C-3, S-16) — they stay in the allowlist.

---

## Task 1: API surface — `api.projects.create` accepts `signal?: AbortSignal`

**Files:**
- Modify: `packages/client/src/api/client.ts:241-246`
- Test: `packages/client/src/__tests__/api-client.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the existing `describe("api.projects", () => { ... })` block in `api-client.test.ts`:

```typescript
  it("create(input, signal) threads signal to fetch (API-1)", async () => {
    const created = { id: "p3", title: "Sig", mode: "fiction" };
    mockFetch.mockResolvedValue(jsonResponse(created, 201));
    const controller = new AbortController();
    await api.projects.create({ title: "Sig", mode: "fiction" }, controller.signal);
    expect(mockFetch).toHaveBeenCalledWith("/api/projects", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ title: "Sig", mode: "fiction" }),
      signal: controller.signal,
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/client -- api-client.test.ts -t "API-1"`
Expected: FAIL — TypeScript error "Expected 1 arguments, but got 2."

- [ ] **Step 3: Update `api.projects.create`**

In `packages/client/src/api/client.ts:241-246`, replace:

```typescript
    create: (input: CreateProjectInput) =>
      apiFetch<Project>("/projects", {
        method: "POST",
        body: JSON.stringify(input),
      }),
```

with (matches the chapters.update pattern at lines 371-388):

```typescript
    create: (input: CreateProjectInput, signal?: AbortSignal) =>
      apiFetch<Project>("/projects", {
        method: "POST",
        body: JSON.stringify(input),
        // Only include `signal` when one was actually provided; otherwise
        // the fetch options object differs from the no-signal callers in
        // ways that break tests asserting the options shape (and can
        // subtly differ in fetch polyfills). Matches chapters.update.
        ...(signal ? { signal } : {}),
      }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w packages/client -- api-client.test.ts -t "API-1"`
Expected: PASS

Also re-run the existing no-signal `create` test to confirm the options-shape backward compat (the spread keeps the no-signal call identical):

Run: `npm test -w packages/client -- api-client.test.ts -t "create.input. sends POST"`
Expected: PASS (existing test, unchanged options shape)

- [ ] **Step 5: Do not commit yet** — bundle API-1..API-4 into one commit per design §5 step 1.

---

## Task 2: API surface — `api.projects.delete` accepts `signal?: AbortSignal`

**Files:**
- Modify: `packages/client/src/api/client.ts:273-274`
- Test: `packages/client/src/__tests__/api-client.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
  it("delete(slug, signal) threads signal to fetch (API-2)", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ message: "ok" }));
    const controller = new AbortController();
    await api.projects.delete("p1", controller.signal);
    expect(mockFetch).toHaveBeenCalledWith("/api/projects/p1", {
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
      signal: controller.signal,
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/client -- api-client.test.ts -t "API-2"`
Expected: FAIL (typing or assertion).

- [ ] **Step 3: Update `api.projects.delete`**

Replace lines 273-274:

```typescript
    delete: (slug: string, signal?: AbortSignal) =>
      apiFetch<{ message: string }>(`/projects/${enc(slug)}`, {
        method: "DELETE",
        ...(signal ? { signal } : {}),
      }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w packages/client -- api-client.test.ts -t "API-2"`
Expected: PASS

---

## Task 3: API surface — `api.chapters.create` accepts `signal?: AbortSignal`

**Files:**
- Modify: `packages/client/src/api/client.ts:368-369`
- Test: `packages/client/src/__tests__/api-client.test.ts`

- [ ] **Step 1: Write the failing test (inside `describe("api.chapters", ...)`)**

```typescript
  it("create(projectSlug, signal) threads signal to fetch (API-3)", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: "c1", title: UNTITLED_CHAPTER }, 201));
    const controller = new AbortController();
    await api.chapters.create("p1", controller.signal);
    expect(mockFetch).toHaveBeenCalledWith("/api/projects/p1/chapters", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: controller.signal,
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/client -- api-client.test.ts -t "API-3"`
Expected: FAIL.

- [ ] **Step 3: Update `api.chapters.create`**

Replace lines 368-369:

```typescript
    create: (projectSlug: string, signal?: AbortSignal) =>
      apiFetch<Chapter>(`/projects/${enc(projectSlug)}/chapters`, {
        method: "POST",
        ...(signal ? { signal } : {}),
      }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w packages/client -- api-client.test.ts -t "API-3"`
Expected: PASS

---

## Task 4: API surface — `api.chapterStatuses.list` accepts `signal?: AbortSignal` + commit

**Files:**
- Modify: `packages/client/src/api/client.ts:406-408`
- Test: `packages/client/src/__tests__/api-client.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside (or create) `describe("api.chapterStatuses", () => { ... })`:

```typescript
describe("api.chapterStatuses", () => {
  it("list(signal) threads signal to fetch (API-4)", async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));
    const controller = new AbortController();
    await api.chapterStatuses.list(controller.signal);
    expect(mockFetch).toHaveBeenCalledWith("/api/chapter-statuses", {
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    });
  });

  it("list() without signal omits the signal option", async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));
    await api.chapterStatuses.list();
    expect(mockFetch).toHaveBeenCalledWith("/api/chapter-statuses", {
      headers: { "Content-Type": "application/json" },
    });
  });
});
```

(The second test pins the no-arg backward-compatible options shape — mirrors the discipline used elsewhere in this file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/client -- api-client.test.ts -t "API-4"`
Expected: FAIL.

- [ ] **Step 3: Update `api.chapterStatuses.list`**

Replace lines 406-408:

```typescript
  chapterStatuses: {
    list: (signal?: AbortSignal) =>
      apiFetch<ChapterStatusRow[]>("/chapter-statuses", signal ? { signal } : undefined),
  },
```

(Mirrors the `projects.list` / `chapters.get` no-body pattern at lines 235-239.)

- [ ] **Step 4: Run all api-client tests to verify**

Run: `npm test -w packages/client -- api-client.test.ts`
Expected: All tests pass, including the 4 new transport-level tests and the no-arg backward-compat assertion.

- [ ] **Step 5: Verify per-package CI**

Run: `npm test -w packages/client`
Expected: Green, no warnings.

- [ ] **Step 6: Commit (API surface, single commit per design §5 step 1)**

```bash
git add packages/client/src/api/client.ts packages/client/src/__tests__/api-client.test.ts
git commit -m "$(cat <<'EOF'
feat(api): API-1..API-4 — accept signal?: AbortSignal on 4 endpoints (4b.3b)

Per design §2.1: api.projects.create, api.projects.delete,
api.chapters.create, api.chapterStatuses.list each accept signal?: AbortSignal.

Transport-level tests in __tests__/api-client.test.ts assert each new
signal reaches apiFetch options. No-arg callers retain the original
options shape (...(signal ? { signal } : {}) spread pattern matches
chapters.update / chapters.delete / chapters.restore).

Refs: docs/plans/2026-05-25-abortsignal-threading-completion-design.md §2.1, §5 step 1

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `sleep(ms, signal)` helper + tests + commit

**Files:**
- Create: `packages/client/src/utils/abortable.ts`
- Create: `packages/client/src/utils/abortable.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/client/src/utils/abortable.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { sleep } from "./abortable";

describe("sleep(ms, signal)", () => {
  it("resolves after ms when signal is not aborted", async () => {
    vi.useFakeTimers();
    const promise = sleep(100);
    vi.advanceTimersByTime(100);
    await expect(promise).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  it("rejects with ABORTED DOMException when signal aborts mid-sleep", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const promise = sleep(1000, controller.signal);
    controller.abort();
    await expect(promise).rejects.toMatchObject({
      name: "AbortError",
    });
    vi.useRealTimers();
  });

  it("rejects immediately if signal is already aborted at call time", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleep(1000, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("clears the timer when aborted, so no late callback fires", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const promise = sleep(1000, controller.signal);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    // Advance past the sleep window. If the timer wasn't cleared, we'd
    // see a stray resolution; with the timer cleared we just confirm
    // no unhandled rejection appears.
    vi.advanceTimersByTime(2000);
    vi.useRealTimers();
  });

  it("does not throw or leak listeners when called with no signal", async () => {
    vi.useFakeTimers();
    const promise = sleep(50);
    vi.advanceTimersByTime(50);
    await expect(promise).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w packages/client -- utils/abortable.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `sleep`**

Create `packages/client/src/utils/abortable.ts`:

```typescript
// Abortable setTimeout. Resolves after `ms`, or rejects with an
// AbortError DOMException if `signal` aborts (either before the call or
// during the wait). Used by retry-with-backoff sites (chapterStatuses
// retry in EditorPage, save retry in useProjectEditor) so unmount/
// navigation can cancel the backoff window cleanly without a stray
// resolution firing on a torn-down hook.
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timerId = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timerId);
      reject(new DOMException("Aborted", "AbortError"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w packages/client -- utils/abortable.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Per-package test sweep**

Run: `npm test -w packages/client`
Expected: Green, no new warnings.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/utils/abortable.ts packages/client/src/utils/abortable.test.ts
git commit -m "$(cat <<'EOF'
feat(utils): add sleep(ms, signal) helper for abortable backoff (4b.3b)

Used by C-9 (chapterStatuses retry in EditorPage) and S-2 (saveAbortRef
retry-with-backoff in useProjectEditor) per design §2.2 and §2.3. The
shared helper isolates the abort-aware setTimeout pattern from the
call-site refactor so both consumer migrations can land as straight
behavior-preserving changes.

Tests pin: resolves after ms; rejects AbortError on mid-sleep abort;
rejects immediately if pre-aborted; clears the timer on abort
(no stray resolution); no-signal path is safe.

Refs: docs/plans/2026-05-25-abortsignal-threading-completion-design.md §5 step 2

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: C-1 — `HomePage.handleCreate` adopts `createOp = useAbortableAsyncOperation()`

**Files:**
- Modify: `packages/client/src/pages/HomePage.tsx`
- Test: existing `packages/client/src/__tests__/HomePage.test.tsx` (verify green; add no new test — behavior-preserving)

**Design reference:** §2.2 row C-1.

- [ ] **Step 1: Read the current site**

Read `packages/client/src/pages/HomePage.tsx:58-90` (handleCreate body). Confirm: a single `await api.projects.create({ title, mode })` followed by `setProjects(prev => [...prev, project])` / navigate.

- [ ] **Step 2: Add the hook import + instance**

At the top of the file, ensure `useAbortableAsyncOperation` is imported:

```typescript
import { useAbortableAsyncOperation } from "../hooks/useAbortableAsyncOperation";
```

Inside the component body (alongside the other hook declarations near line 24, right next to `createRecoveryAbortRef`), add:

```typescript
const createOp = useAbortableAsyncOperation();
```

- [ ] **Step 3: Migrate `handleCreate`**

Inside `handleCreate` (line 58-90 area), wrap the `api.projects.create` call:

```typescript
async function handleCreate(title: string, mode: ProjectMode) {
  // ...existing pre-call setup...
  try {
    const { promise, signal } = createOp.run((s) =>
      api.projects.create({ title, mode }, s),
    );
    const project = await promise;
    if (signal.aborted) return;
    // ...existing post-success branch (setProjects, navigate, etc.)...
  } catch (err) {
    // ...existing recovery branch using createRecoveryAbortRef stays untouched...
  }
}
```

The `signal.aborted` check after the await is the per-call gate (per `useAbortableAsyncOperation` JSDoc); it replaces any implicit guard. Keep the existing recovery branch verbatim — that's C-3, which stays hand-rolled with justification (see Task 8).

- [ ] **Step 4: Run existing HomePage tests**

Run: `npm test -w packages/client -- HomePage`
Expected: All existing tests pass (behavior preserved). If a test fails because it asserts on the `api.projects.create` call without a signal arg, update the assertion to match the new `(input, signal)` shape.

- [ ] **Step 5: Per-package test sweep**

Run: `npm test -w packages/client`
Expected: Green, no warnings.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/pages/HomePage.tsx packages/client/src/__tests__/HomePage.test.tsx
git commit -m "$(cat <<'EOF'
refactor(home): C-1 — handleCreate adopts useAbortableAsyncOperation (4b.3b)

Per design §2.2 row C-1. Single-shot mutation, textbook hook fit.
createRecoveryAbortRef stays hand-rolled (C-3) — that's the
second-tier-recovery branch and lands in its own commit with the
justification comment.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: C-2 — `HomePage.handleDelete` adopts a separate `deleteOp` instance

**Files:**
- Modify: `packages/client/src/pages/HomePage.tsx`

**Design reference:** §2.2 row C-2.

- [ ] **Step 1: Add the second hook instance**

Next to `createOp`, add:

```typescript
const deleteOp = useAbortableAsyncOperation();
```

Per design §2.2 C-2: independent operations get separate instances (not shared).

- [ ] **Step 2: Migrate `handleDelete`**

Wrap the call at line 104:

```typescript
async function handleDelete() {
  if (!deleteTarget) return;
  // ...existing setup...
  try {
    const { promise, signal } = deleteOp.run((s) => api.projects.delete(deleteTarget.slug, s));
    await promise;
    if (signal.aborted) return;
    // ...existing post-success branch (filter projects, close dialog, etc.)...
  } catch (err) {
    // ...existing catch branch...
  }
}
```

- [ ] **Step 3: Run HomePage tests + per-package sweep**

Run: `npm test -w packages/client -- HomePage && npm test -w packages/client`
Expected: Green.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/pages/HomePage.tsx packages/client/src/__tests__/HomePage.test.tsx
git commit -m "refactor(home): C-2 — handleDelete adopts separate deleteOp instance (4b.3b)

Per design §2.2 row C-2. Separate hook instance from createOp because
create and delete are independent operations (the user can delete one
project while creating another) — sharing would cross-abort.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: C-3 — `HomePage.createRecoveryAbortRef` gets inline justification comment

**Files:**
- Modify: `packages/client/src/pages/HomePage.tsx:24`

**Design reference:** §2.2 row C-3.

- [ ] **Step 1: Add the justification comment**

At `packages/client/src/pages/HomePage.tsx:24`, prepend (above the existing line):

```typescript
// Phase 4b.3b decision matrix row C-3: kept hand-rolled. The recovery
// branch outlives the primary mutation by design — by the time the
// recovery `api.projects.list` resolves, the create dialog has already
// closed and `createOp` may have advanced to a new run() (e.g. a second
// project create). Routing this through createOp would auto-abort the
// recovery refresh whenever the user kicks off another create —
// exactly the case where the previous error's recovery still needs to
// run to completion. Phase 4b.4 replaces this file-level allowlist
// entry with an inline `// eslint-disable-next-line` on the same line.
const createRecoveryAbortRef = useRef<AbortController | null>(null);
```

- [ ] **Step 2: Verify no behavioral change**

Run: `npm test -w packages/client -- HomePage`
Expected: Green.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/pages/HomePage.tsx
git commit -m "docs(home): C-3 — inline justification for hand-rolled createRecoveryAbortRef (4b.3b)

Per design §2.2 row C-3 and §1 Approach 3 table row 'Second-tier
recovery'. HomePage stays in PHASE_4B_3B_ALLOWLIST for this one
retained ref.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: C-4 — `useProjectEditor.handleCreateChapter` adopts `createChapterOp`

**Files:**
- Modify: `packages/client/src/hooks/useProjectEditor.ts:577` (api.chapters.create call)

**Design reference:** §2.2 row C-4. The `projectRef.current?.id !== projectId` staleness check stays — it's response-discard, orthogonal to network cancel.

- [ ] **Step 1: Add the hook instance**

Near the existing ref declarations (lines 90-156 area), inside the hook body, add:

```typescript
const createChapterOp = useAbortableAsyncOperation();
```

(Import the hook at the top of the file if not already imported.)

- [ ] **Step 2: Migrate the call site at line 577**

Wrap the existing call:

```typescript
const { promise, signal } = createChapterOp.run((s) => api.chapters.create(slug, s));
const newChapter = await promise;
if (signal.aborted) return;
// ...existing post-create handling (projectRef staleness check, setProject, etc.)...
```

The existing `projectRef.current?.id !== projectId` check stays — design §2.2 C-4 explicitly notes this.

- [ ] **Step 3: Run per-hook tests**

Run: `npm test -w packages/client -- useProjectEditor`
Expected: Green. If a test mocks `api.chapters.create(slug)` and now needs to accept `(slug, signal)`, update the mock assertion.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/hooks/useProjectEditor.ts packages/client/src/__tests__/useProjectEditor.test.ts
git commit -m "refactor(project-editor): C-4 — handleCreateChapter adopts createChapterOp (4b.3b)

Per design §2.2 row C-4. Hook adoption is orthogonal to the existing
projectRef staleness check (response-discard, stays).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: C-5 — `useProjectEditor` recovery refs get one shared block comment

**Files:**
- Modify: `packages/client/src/hooks/useProjectEditor.ts:154-156`

**Design reference:** §2.2 row C-5. All three recovery refs share one rationale.

- [ ] **Step 1: Add the block comment above line 154**

Insert above the existing `createRecoveryAbortRef = useRef<AbortController | null>(null);`:

```typescript
// Phase 4b.3b decision matrix row C-5: createRecoveryAbortRef,
// statusRecoveryAbortRef, and titleRecoveryAbortRef are kept hand-rolled.
// Each fires from the catch branch of its respective primary mutation
// (handleCreateChapter / handleStatusChange / handleTitleChange) and
// runs a follow-up GET that must complete even after the primary
// mutation's hook has auto-aborted (e.g. on the next handleStatusChange
// after a failed one). Routing these through the primary's hook would
// cause the next mutation to cancel the previous mutation's recovery
// refresh — exactly the case where the previous error's user-visible
// state most needs the refresh to land. Phase 4b.4 replaces this
// file-level allowlist entry with inline `// eslint-disable-next-line`
// on each of the three lines below.
const createRecoveryAbortRef = useRef<AbortController | null>(null);
const statusRecoveryAbortRef = useRef<AbortController | null>(null);
const titleRecoveryAbortRef = useRef<AbortController | null>(null);
```

- [ ] **Step 2: Verify no behavioral change**

Run: `npm test -w packages/client -- useProjectEditor`
Expected: Green.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/hooks/useProjectEditor.ts
git commit -m "docs(project-editor): C-5 — shared justification block for recovery refs (4b.3b)

Per design §2.2 row C-5 and §1 Approach 3 'Second-tier recovery'.
useProjectEditor stays in PHASE_4B_3B_ALLOWLIST for these three refs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: C-6 — `useProjectEditor.loadProject` replaces `let cancelled` with `loadProjectOp`

**Files:**
- Modify: `packages/client/src/hooks/useProjectEditor.ts:204-268`
- Test: `packages/client/src/__tests__/useProjectEditor.test.ts` (add new behavioral test per design §3.2)

**Design reference:** §2.2 row C-6, §3.2 first row.

- [ ] **Step 1: Write the failing behavioral test**

Add to `useProjectEditor.test.ts`:

```typescript
it("C-6: unmount mid-api.projects.get does NOT call setProject (preserves cancelled-flag guarantee)", async () => {
  let resolveGet: (data: unknown) => void = () => {};
  const apiSpy = vi.spyOn(api.projects, "get").mockImplementation(
    () => new Promise((resolve) => { resolveGet = resolve; }),
  );
  const setProject = vi.fn();
  // Render the hook with a slug, then unmount before the GET resolves.
  const { unmount } = renderHook(() => useProjectEditor({ slug: "p1", /* ...other props with setProject... */ }));
  // Trigger an unmount mid-flight.
  unmount();
  // Resolve the in-flight GET after unmount.
  resolveGet({ id: "p1", chapters: [] });
  await Promise.resolve();
  expect(setProject).not.toHaveBeenCalled();
  apiSpy.mockRestore();
});
```

(Adapt the rendering harness to match existing tests in the file. The key assertion is "setProject not called after unmount.")

- [ ] **Step 2: Run test to verify it passes today (regression baseline)**

Run: `npm test -w packages/client -- useProjectEditor -t "C-6"`
Expected: PASS (the existing `let cancelled = false` flag already provides this guarantee). This test exists to prevent regression during the migration.

- [ ] **Step 3: Migrate `loadProject`**

At `packages/client/src/hooks/useProjectEditor.ts:204-268`, replace the entire `useEffect` body:

```typescript
const loadProjectOp = useAbortableAsyncOperation();

useEffect(() => {
  // I7 (review 2026-04-25): reset the confirmed-status cache at the
  // start of every loadProject. The hook persists across slug changes
  // (refs survive), so on a failed loadProject the ref retained the
  // previous project's status table and a status revert on the new
  // (partially-rendered) project would read against the wrong baseline.
  confirmedStatusRef.current = {};

  const { promise, signal } = loadProjectOp.run(async (s) => {
    if (!slug) return;
    try {
      const data = await api.projects.get(slug, s);
      if (s.aborted) return;
      setProject(data);
      confirmedStatusRef.current = Object.fromEntries(
        data.chapters.map((c) => [c.id, c.status]),
      );
      const currentChapterId = activeChapterRef.current?.id;
      const stillInProject =
        currentChapterId !== undefined &&
        data.chapters.some((c) => c.id === currentChapterId);
      if (!stillInProject) {
        setActiveChapter(null);
        activeChapterRef.current = null;
        setChapterWordCount(0);
      }
      const firstChapter = data.chapters[0];
      if (firstChapter && !activeChapterRef.current) {
        const chapter = await api.chapters.get(firstChapter.id, s);
        if (s.aborted) return;
        const cached = getCachedContent(chapter.id);
        const effectiveChapter = cached ? { ...chapter, content: cached } : chapter;
        setActiveChapter(effectiveChapter);
        setChapterWordCount(countWords(effectiveChapter.content));
      }
    } catch (err) {
      // Copilot review 2026-04-24: gate console.warn on s.aborted so a
      // late rejection on unmount/slug-change does not leak noise into
      // test output. (Replaces the pre-migration `cancelled` gate.)
      if (s.aborted) return;
      console.warn("Failed to load project:", err);
      const { message } = mapApiError(err, "project.load");
      if (message) setError(message);
    }
  });
  void promise;
}, [slug]);
```

The `cancelled` flag is gone; `signal.aborted` from the per-call signal replaces every cancellation gate. The same signal threads through both `api.projects.get` and `api.chapters.get`, so a single unmount aborts both.

- [ ] **Step 4: Re-run the behavioral test + per-package sweep**

Run: `npm test -w packages/client -- useProjectEditor`
Expected: PASS (C-6 test, plus existing tests, plus zero new warnings).

- [ ] **Step 5: Confirm no `let cancelled = false` remains in this file**

Run: `grep -n "let cancelled = false" packages/client/src/hooks/useProjectEditor.ts`
Expected: No matches.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/hooks/useProjectEditor.ts packages/client/src/__tests__/useProjectEditor.test.ts
git commit -m "refactor(project-editor): C-6 — loadProject replaces cancelled-flag with loadProjectOp (4b.3b)

Per design §2.2 row C-6 and §6 DoD 'no let cancelled = false flag
remains in loadProject'. The hook's per-call signal threads through
both api.projects.get and api.chapters.get, so one unmount aborts
both. Behavioral test pins the unmount-mid-flight guarantee.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: C-7 + C-8 verify-and-migrate — `useProjectEditor` chapter loading

**Files:**
- Modify: `packages/client/src/hooks/useProjectEditor.ts:704, 757`
- Test: add behavioral test if separate-instance path is taken

**Design reference:** §2.2 rows C-7 and C-8. C-8 has a **verify-before-migration** gate.

- [ ] **Step 1: Investigate `reloadActiveChapter` call sites**

Run:

```bash
grep -n "reloadActiveChapter" packages/client/src/
```

Identify every caller of `reloadActiveChapter`. For each, determine whether it could fire while `handleSelectChapter` is mid-flight (e.g. a focus-driven refresh, a post-save reload, a snapshot-restore follow-up).

Record the finding in the commit message (Step 5).

- [ ] **Step 2: Choose the migration shape**

Based on Step 1:

- **If `reloadActiveChapter` can't race `handleSelectChapter`** (e.g. it only fires from code paths that are mutually exclusive with a sidebar click): proceed with **shared `selectChapterOp` instance** per design §2.2 C-8 default. No new behavioral test required.
- **If a race exists:** declare two separate hook instances — `selectChapterOp` for C-7 and `reloadOp` for C-8. Add a behavioral test asserting "concurrent reloadActiveChapter and handleSelectChapter calls each cancel only their own prior in-flight request."

Document the choice and the reason in a comment above the instance declaration(s).

- [ ] **Step 3: Add the hook instance(s) + import**

Add inside the hook body (near the existing instances):

```typescript
const selectChapterOp = useAbortableAsyncOperation();
// If two-instance path chosen, also:
// const reloadOp = useAbortableAsyncOperation();
```

- [ ] **Step 4: Migrate `handleSelectChapter` (line 704) and `reloadActiveChapter` (line 757)**

For shared-instance path:

```typescript
// handleSelectChapter
const { promise, signal } = selectChapterOp.run((s) => api.chapters.get(chapterId, s));
const chapter = await promise;
if (signal.aborted) return;
// ...existing post-load handling (selectChapterSeq epoch check, setActiveChapter, etc.)...

// reloadActiveChapter (line 757) — same selectChapterOp:
const { promise, signal } = selectChapterOp.run((s) => api.chapters.get(current.id, s));
// ...same pattern...
```

For two-instance path: use `selectChapterOp` for line 704 and `reloadOp` for line 757.

The existing `selectChapterSeq` (`useAbortableSequence`) pairing stays — orthogonal. Both `selectChapterSeq.start()` and `selectChapterOp.run(...)` apply per design §2.2 C-7.

- [ ] **Step 5: Run tests + commit**

Run: `npm test -w packages/client -- useProjectEditor`
Expected: Green.

```bash
git add packages/client/src/hooks/useProjectEditor.ts packages/client/src/__tests__/useProjectEditor.test.ts
git commit -m "$(cat <<'EOF'
refactor(project-editor): C-7/C-8 — chapter loading adopts useAbortableAsyncOperation (4b.3b)

Per design §2.2 rows C-7 and C-8. Verified before migration:
<insert one sentence describing the reloadActiveChapter call-site
analysis from Step 1 — whether a race with handleSelectChapter is
possible, and which migration shape was chosen.>

selectChapterSeq pairing stays — useAbortableSequence and
useAbortableAsyncOperation are orthogonal.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: C-9 — `EditorPage` chapterStatuses retry adopts `statusesOp` + `sleep` helper

**Files:**
- Modify: `packages/client/src/pages/EditorPage.tsx:1222-1250`
- Test: `packages/client/src/__tests__/EditorPage.test.tsx` (add new behavioral test per design §3.2)

**Design reference:** §2.2 row C-9, §3.2 row 2.

- [ ] **Step 1: Write the failing behavioral test**

Add to `EditorPage.test.tsx`:

```typescript
it("C-9: unmount during chapterStatuses backoff aborts the timer; no warnings; no retry", async () => {
  vi.useFakeTimers();
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const listSpy = vi.spyOn(api.chapterStatuses, "list").mockRejectedValue(
    new Error("first attempt fails"),
  );
  const { unmount } = renderEditorPage(/* ...standard props... */);
  // First attempt fires immediately and rejects. Backoff sleep begins.
  await vi.advanceTimersByTimeAsync(0);
  expect(listSpy).toHaveBeenCalledTimes(1);
  // Unmount during the 2s backoff window.
  unmount();
  // Advance past the backoff. With the abortable sleep, the next attempt MUST NOT fire.
  await vi.advanceTimersByTimeAsync(5000);
  expect(listSpy).toHaveBeenCalledTimes(1); // not 2
  expect(warnSpy).toHaveBeenCalledTimes(1); // only the first attempt's warn, none after unmount
  warnSpy.mockRestore();
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/client -- EditorPage -t "C-9"`
Expected: FAIL — the current `setTimeout` queue doesn't honor a hook-level abort signal; the second attempt fires after unmount.

- [ ] **Step 3: Migrate the retry effect**

At `packages/client/src/pages/EditorPage.tsx:1222-1250`, replace the `useEffect`:

```typescript
const statusesOp = useAbortableAsyncOperation();

useEffect(() => {
  const { promise, signal } = statusesOp.run(async (s) => {
    let attempts = 0;
    while (true) {
      if (s.aborted) return;
      try {
        const data = await api.chapterStatuses.list(s);
        if (s.aborted) return;
        setStatuses(data);
        return;
      } catch (err) {
        if (s.aborted) return;
        console.warn("Failed to load chapter statuses:", err);
        if (attempts >= 2) {
          const { message } = mapApiError(err, "chapterStatus.fetch");
          if (message) setActionError(message);
          return;
        }
        attempts++;
        try {
          await sleep(2000 * attempts, s);
        } catch {
          return; // sleep aborted — exit silently, cleanup will handle.
        }
      }
    }
  });
  void promise;
}, [setActionError]);
```

Add the import at the top of the file:

```typescript
import { sleep } from "../utils/abortable";
import { useAbortableAsyncOperation } from "../hooks/useAbortableAsyncOperation";
```

The `let cancelled = false` flag and the `timerId` ref are both gone — `signal.aborted` after each await replaces them, and `sleep`'s built-in abort handling replaces the `clearTimeout`.

- [ ] **Step 4: Re-run the test**

Run: `npm test -w packages/client -- EditorPage -t "C-9"`
Expected: PASS.

- [ ] **Step 5: Confirm no `let cancelled = false` remains in chapterStatuses retry**

Run: `grep -n "let cancelled = false" packages/client/src/pages/EditorPage.tsx`
Expected: No matches in the chapterStatuses retry block (other unrelated uses elsewhere in the file are out of scope).

- [ ] **Step 6: Per-package sweep + commit**

Run: `npm test -w packages/client`
Expected: Green.

```bash
git add packages/client/src/pages/EditorPage.tsx packages/client/src/__tests__/EditorPage.test.tsx
git commit -m "refactor(editor): C-9 — chapterStatuses retry adopts statusesOp + sleep helper (4b.3b)

Per design §2.2 row C-9 and §6 DoD 'no let cancelled = false flag
remains in chapterStatuses retry'. Retry-with-backoff lives inside
one statusesOp.run() callback; sleep(ms, signal) handles the backoff
window's abort cleanly. Behavioral test pins unmount-mid-backoff.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: C-10 + C-11 — `EditorPage` replace flow adopts shared `replaceOp` instance

**Files:**
- Modify: `packages/client/src/pages/EditorPage.tsx:775, 1018`
- Test: `packages/client/src/__tests__/EditorPage.test.tsx` (add behavioral test per design §3.2 row 3)

**Design reference:** §2.2 rows C-10 and C-11. Shared instance — replace-all and replace-one are mutually exclusive (gated by `isActionBusy`).

- [ ] **Step 1: Write the failing behavioral test**

```typescript
it("C-10/C-11: aborting replaceOp during a mutation.run body causes api.search.replace to receive an aborted signal", async () => {
  let capturedSignal: AbortSignal | undefined;
  const replaceSpy = vi
    .spyOn(api.search, "replace")
    .mockImplementation(async (_slug, _search, _replace, _opts, _scope, signal) => {
      capturedSignal = signal;
      return new Promise(() => {}); // never resolves
    });
  // Render EditorPage in a state where executeReplace is wired.
  const { rerender, unmount } = renderEditorPage(/* ...props... */);
  // Trigger executeReplace
  triggerReplaceAll(/* ... */);
  expect(capturedSignal).toBeDefined();
  expect(capturedSignal!.aborted).toBe(false);
  unmount();
  expect(capturedSignal!.aborted).toBe(true);
  replaceSpy.mockRestore();
});
```

(Adapt `triggerReplaceAll` to the existing harness pattern.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/client -- EditorPage -t "C-10/C-11"`
Expected: FAIL — current code doesn't pass a signal to `api.search.replace`.

- [ ] **Step 3: Add the hook instance**

In `EditorPage.tsx`, near the other operation hooks:

```typescript
const replaceOp = useAbortableAsyncOperation();
```

- [ ] **Step 4: Migrate both call sites**

At line 775 (`executeReplace`) and line 1018 (`executeReplaceOne`), inside the existing `mutation.run(...)` callback, wrap the `api.search.replace` call:

```typescript
const { promise, signal: replaceSignal } = replaceOp.run((s) =>
  api.search.replace(slug, query, replaceText, options, scope, s),
);
const resp = await promise;
if (replaceSignal.aborted) return;
```

The mutation wrapper (`useEditorMutation`) keeps owning staleness/locking; the hook owns network cancellation. Both apply.

- [ ] **Step 5: Re-run the test + per-package sweep**

Run: `npm test -w packages/client -- EditorPage && npm test -w packages/client`
Expected: Green.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/pages/EditorPage.tsx packages/client/src/__tests__/EditorPage.test.tsx
git commit -m "refactor(editor): C-10/C-11 — replace flow adopts shared replaceOp instance (4b.3b)

Per design §2.2 rows C-10/C-11. Shared instance — replace-all and
replace-one are mutually exclusive (gated by isActionBusy). useEditorMutation
keeps owning staleness/locking; replaceOp adds network cancellation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: S-1 — `EditorPage.settingsRefreshAbortRef` adopts `settingsRefreshOp` (allowlist shrink)

**Files:**
- Modify: `packages/client/src/pages/EditorPage.tsx:1193`
- Modify: `packages/client/src/__tests__/migrationStructuralCheck.test.ts:130-138` (remove `EditorPage.tsx` from allowlist)

**Design reference:** §2.3 row S-1. Textbook fit. EditorPage's only ref → allowlist shrink in same commit.

- [ ] **Step 1: Migrate**

Replace the ref declaration at line 1193 and any usages (`settingsRefreshAbortRef.current?.abort()` becomes `settingsRefreshOp.abort()` or moves inside a `run()` callback). Add at the existing ref's location:

```typescript
const settingsRefreshOp = useAbortableAsyncOperation();
```

Find all uses of `settingsRefreshAbortRef` in the file and migrate each to `settingsRefreshOp.run((s) => api.settings.get(s))` for the GET, plus `settingsRefreshOp.abort()` in the unmount cleanup (replacing the `settingsRefreshAbortRef.current?.abort()` at line 1210).

- [ ] **Step 2: Shrink the allowlist**

In `packages/client/src/__tests__/migrationStructuralCheck.test.ts`, remove the EditorPage entry:

```typescript
const PHASE_4B_3B_ALLOWLIST = new Set([
  resolve(clientSrcRoot, "components/ExportDialog.tsx"),
  resolve(clientSrcRoot, "components/ProjectSettingsDialog.tsx"),
  resolve(clientSrcRoot, "components/SnapshotPanel.tsx"),
  resolve(clientSrcRoot, "hooks/useProjectEditor.ts"),
  resolve(clientSrcRoot, "hooks/useSnapshotState.ts"),
  // EditorPage.tsx removed by Phase 4b.3b row S-1 (settingsRefreshAbortRef migrated)
  resolve(clientSrcRoot, "pages/HomePage.tsx"),
]);
```

- [ ] **Step 3: Run structural test + EditorPage tests + per-package sweep**

```bash
npm test -w packages/client -- migrationStructuralCheck
npm test -w packages/client -- EditorPage
npm test -w packages/client
```

Expected: All green.

- [ ] **Step 4: Commit (migration + allowlist shrink atomic)**

```bash
git add packages/client/src/pages/EditorPage.tsx packages/client/src/__tests__/migrationStructuralCheck.test.ts
git commit -m "refactor(editor): S-1 — settingsRefresh adopts hook; EditorPage exits allowlist (4b.3b)

Per design §2.3 row S-1 and §5 Allowlist-edit discipline. EditorPage's
only useRef<AbortController> migrates; allowlist shrinks from 7 files
to 6 in the same commit so CI stays green per-commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: S-3..S-6 — `useProjectEditor` textbook-fit refs (one commit per ref)

**Files:**
- Modify: `packages/client/src/hooks/useProjectEditor.ts:108, 116, 124, 131`

**Design reference:** §2.3 rows S-3 through S-6. All textbook fit. `useProjectEditor.ts` stays in the allowlist (still has saveAbortRef + deleteChapterAbortRef + 3 recovery refs).

For **each** of S-3 (statusChangeAbortRef:108), S-4 (titleChangeAbortRef:116), S-5 (reorderAbortRef:124), S-6 (renameChapterAbortRef:131):

- [ ] **Step 1: Migrate the ref**

Replace `const xxxAbortRef = useRef<AbortController | null>(null);` with `const xxxOp = useAbortableAsyncOperation();`. Find every usage in the file (`xxxAbortRef.current?.abort()`, `xxxAbortRef.current = new AbortController()`, etc.) and rewrite to `xxxOp.run((s) => api.someEndpoint(..., s))` for the call site and `xxxOp.abort()` for explicit aborts (e.g. unmount cleanup at line 192-202).

- [ ] **Step 2: Run useProjectEditor tests**

Run: `npm test -w packages/client -- useProjectEditor`
Expected: Green.

- [ ] **Step 3: Commit (one commit per ref)**

```bash
git add packages/client/src/hooks/useProjectEditor.ts packages/client/src/__tests__/useProjectEditor.test.ts
git commit -m "refactor(project-editor): S-N — <refName> adopts useAbortableAsyncOperation (4b.3b)

Per design §2.3 row S-N. Textbook single-shot mutation fit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

(Replace S-N and `<refName>` with the actual row and ref name. Four commits total — S-3, S-4, S-5, S-6.)

---

## Task 17: S-9 — `ProjectSettingsDialog.timezoneAbortRef` adopts `timezoneOp`

**Files:**
- Modify: `packages/client/src/components/ProjectSettingsDialog.tsx:45`

**Design reference:** §2.3 row S-9. ProjectSettingsDialog stays in allowlist — still has fieldAbortRef (S-10).

- [ ] **Step 1: Migrate**

Replace `const timezoneAbortRef = useRef<AbortController | null>(null);` at line 45 with `const timezoneOp = useAbortableAsyncOperation();`. Find all usages, migrate to `timezoneOp.run(...)` at the PATCH call site and `timezoneOp.abort()` at the open-transition cleanup.

- [ ] **Step 2: Run dialog tests + per-package sweep**

```bash
npm test -w packages/client -- ProjectSettingsDialog
npm test -w packages/client
```

Expected: Green.

- [ ] **Step 3: Commit (no allowlist change yet — fieldAbortRef still pins the file)**

```bash
git add packages/client/src/components/ProjectSettingsDialog.tsx packages/client/src/__tests__/ProjectSettingsDialog.test.tsx
git commit -m "refactor(project-settings): S-9 — timezone adopts useAbortableAsyncOperation (4b.3b)

Per design §2.3 row S-9. fieldAbortRef (S-10) still pins
ProjectSettingsDialog in PHASE_4B_3B_ALLOWLIST; the file exits in S-10.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 18: S-10 — `ProjectSettingsDialog.fieldAbortRef` adopts `fieldOp` + allowlist shrink

**Files:**
- Modify: `packages/client/src/components/ProjectSettingsDialog.tsx:55`
- Modify: `packages/client/src/__tests__/migrationStructuralCheck.test.ts` (remove `ProjectSettingsDialog.tsx`)

**Design reference:** §2.3 row S-10 and §5 Allowlist-edit discipline.

- [ ] **Step 1: Migrate the ref**

Replace `const fieldAbortRef = useRef<AbortController | null>(null);` at line 55 with `const fieldOp = useAbortableAsyncOperation();`. Migrate all usages.

- [ ] **Step 2: Shrink the allowlist (last ref in the file)**

Remove the `ProjectSettingsDialog.tsx` entry from `PHASE_4B_3B_ALLOWLIST` in the structural test.

- [ ] **Step 3: Run structural test + dialog tests + per-package sweep**

```bash
npm test -w packages/client -- migrationStructuralCheck
npm test -w packages/client -- ProjectSettingsDialog
npm test -w packages/client
```

Expected: All green.

- [ ] **Step 4: Commit (atomic — allowlist shrink + last-ref migration)**

```bash
git add packages/client/src/components/ProjectSettingsDialog.tsx packages/client/src/__tests__/migrationStructuralCheck.test.ts packages/client/src/__tests__/ProjectSettingsDialog.test.tsx
git commit -m "refactor(project-settings): S-10 — fieldAbortRef migrated; dialog exits allowlist (4b.3b)

Per design §2.3 row S-10 and §5 Allowlist-edit discipline. Last
useRef<AbortController> in the file migrates; allowlist shrinks in
the same commit so the 'allowlist entries actually contain
useRef<AbortController>' assertion stays green per-commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 19: S-14 + S-15 — `useSnapshotState` textbook-fit refs

**Files:**
- Modify: `packages/client/src/hooks/useSnapshotState.ts:172, 178`

**Design reference:** §2.3 rows S-14 (refreshCountAbortRef:172) and S-15 (restoreAbortRef:178). Single-shot. `useSnapshotState.ts` stays in allowlist (S-13 and S-16 pending).

For **each** of S-14 and S-15:

- [ ] **Step 1: Migrate the ref**

Replace `const xxxAbortRef = useRef<AbortController | null>(null);` with `const xxxOp = useAbortableAsyncOperation();`. Migrate all usages.

- [ ] **Step 2: Run useSnapshotState tests**

Run: `npm test -w packages/client -- useSnapshotState`
Expected: Green.

- [ ] **Step 3: Commit (one per row)**

```bash
git add packages/client/src/hooks/useSnapshotState.ts packages/client/src/__tests__/useSnapshotState.test.ts
git commit -m "refactor(snapshots): S-N — <refName> adopts useAbortableAsyncOperation (4b.3b)

Per design §2.3 row S-N. Single-shot fit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

(Replace S-N and `<refName>` with S-14 / refreshCountAbortRef, then S-15 / restoreAbortRef. Two commits total.)

---

## Task 20: S-11 — `SnapshotPanel.fetchAbortRef` adopts `fetchOp` (paired with `chapterSeq`)

**Files:**
- Modify: `packages/client/src/components/SnapshotPanel.tsx:125`

**Design reference:** §2.3 row S-11. Paired with `useAbortableSequence` — the find/replace pattern. SnapshotPanel stays in allowlist (still has mutateAbortRef).

- [ ] **Step 1: Migrate**

Replace `const fetchAbortRef = useRef<AbortController | null>(null);` at line 125 with `const fetchOp = useAbortableAsyncOperation();`. Migrate all usages. The existing `chapterSeq` (sequence-paired) stays — both apply (epoch token AND network cancel).

- [ ] **Step 2: Run SnapshotPanel tests + per-package sweep**

```bash
npm test -w packages/client -- SnapshotPanel
npm test -w packages/client
```

Expected: Green.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/components/SnapshotPanel.tsx packages/client/src/__tests__/SnapshotPanel.test.tsx
git commit -m "refactor(snapshots): S-11 — fetchAbortRef adopts fetchOp; chapterSeq pairing stays (4b.3b)

Per design §2.3 row S-11. Find/replace pattern — useAbortableSequence
arbitrates response staleness via epoch tokens; useAbortableAsyncOperation
cancels network requests via AbortController. Both apply.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 21: S-12 — `SnapshotPanel.mutateAbortRef` adopts `mutateOp` + allowlist shrink

**Files:**
- Modify: `packages/client/src/components/SnapshotPanel.tsx:131`
- Modify: `packages/client/src/__tests__/migrationStructuralCheck.test.ts` (remove `SnapshotPanel.tsx`)

**Design reference:** §2.3 row S-12 and §5 Allowlist-edit discipline.

- [ ] **Step 1: Migrate**

Replace `const mutateAbortRef = useRef<AbortController | null>(null);` at line 131 with `const mutateOp = useAbortableAsyncOperation();`. Migrate all usages.

- [ ] **Step 2: Shrink the allowlist (last ref in the file)**

Remove the `SnapshotPanel.tsx` entry from `PHASE_4B_3B_ALLOWLIST`.

- [ ] **Step 3: Run structural test + SnapshotPanel tests + per-package sweep**

```bash
npm test -w packages/client -- migrationStructuralCheck
npm test -w packages/client -- SnapshotPanel
npm test -w packages/client
```

Expected: All green.

- [ ] **Step 4: Commit (atomic — allowlist shrink + last-ref migration)**

```bash
git add packages/client/src/components/SnapshotPanel.tsx packages/client/src/__tests__/migrationStructuralCheck.test.ts packages/client/src/__tests__/SnapshotPanel.test.tsx
git commit -m "refactor(snapshots): S-12 — mutateAbortRef migrated; SnapshotPanel exits allowlist (4b.3b)

Per design §2.3 row S-12 and §5 Allowlist-edit discipline. Last
useRef<AbortController> in the file migrates; allowlist shrinks in
the same commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 22: S-13 — `useSnapshotState.viewAbortRef` adopts `viewOp` (paired with `viewSeq`)

**Files:**
- Modify: `packages/client/src/hooks/useSnapshotState.ts:171`

**Design reference:** §2.3 row S-13.

- [ ] **Step 1: Migrate**

Replace `const viewAbortRef = useRef<AbortController | null>(null);` at line 171 with `const viewOp = useAbortableAsyncOperation();`. Migrate all usages. `viewSeq` pairing stays.

- [ ] **Step 2: Run + commit**

```bash
npm test -w packages/client -- useSnapshotState
git add packages/client/src/hooks/useSnapshotState.ts packages/client/src/__tests__/useSnapshotState.test.ts
git commit -m "refactor(snapshots): S-13 — viewAbortRef adopts viewOp; viewSeq pairing stays (4b.3b)

Per design §2.3 row S-13.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 23: S-2 — `useProjectEditor.saveAbortRef` adopts `saveOp` with retry-using-sleep + behavioral test

**Files:**
- Modify: `packages/client/src/hooks/useProjectEditor.ts:90`
- Test: `packages/client/src/__tests__/useProjectEditor.test.ts` (add behavioral regression test per design §3.2 row S-2)

**Design reference:** §2.3 row S-2. Retry-with-backoff using the new `sleep(ms, signal)` helper.

- [ ] **Step 1: Write the behavioral regression test (existing behavior)**

```typescript
it("S-2: cancelInFlightSave() aborts an in-flight save (regression test)", async () => {
  let resolveSave: (data: unknown) => void = () => {};
  const updateSpy = vi.spyOn(api.chapters, "update").mockImplementation(
    () => new Promise((resolve) => { resolveSave = resolve; }),
  );
  const { result } = renderHook(() => useProjectEditor(/* ...props... */));
  // Trigger a save (via the hook's exposed save handler).
  void result.current.handleSave({}, "ch1");
  // Verify the call started.
  expect(updateSpy).toHaveBeenCalledTimes(1);
  // Cancel it via the public API.
  result.current.cancelInFlightSave();
  // Verify the signal passed to the call is aborted.
  const passedSignal = updateSpy.mock.calls[0][2]; // (id, data, signal)
  expect(passedSignal).toBeDefined();
  expect(passedSignal.aborted).toBe(true);
  updateSpy.mockRestore();
});
```

(Adapt to the hook's actual `cancelInFlightSave` signature.)

- [ ] **Step 2: Run test against current code to verify it passes (regression baseline)**

Run: `npm test -w packages/client -- useProjectEditor -t "S-2"`
Expected: PASS (current `saveAbortRef` already supports this). The test exists to lock the behavior across the migration.

- [ ] **Step 3: Migrate `saveAbortRef`**

Replace `const saveAbortRef = useRef<AbortController | null>(null);` at line 90 with `const saveOp = useAbortableAsyncOperation();`. Then locate the save retry-with-backoff loop. Migrate the loop into a `saveOp.run((s) => async { ... })` callback. Replace any `setTimeout`-based backoff with `await sleep(backoffMs, s)`. Migrate `cancelInFlightSave()` to call `saveOp.abort()`.

Add the `sleep` import at the top of the file:

```typescript
import { sleep } from "../utils/abortable";
```

- [ ] **Step 4: Re-run the test + per-package sweep**

```bash
npm test -w packages/client -- useProjectEditor
npm test -w packages/client
```

Expected: Green.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/hooks/useProjectEditor.ts packages/client/src/__tests__/useProjectEditor.test.ts
git commit -m "refactor(project-editor): S-2 — saveAbortRef adopts saveOp + sleep helper (4b.3b)

Per design §2.3 row S-2. Retry-with-backoff loop lives inside one
saveOp.run() callback; sleep(ms, signal) handles the backoff windows.
cancelInFlightSave() maps to saveOp.abort(). Behavioral regression
test pins the cancel-in-flight guarantee across the refactor.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 24: S-7 — `useProjectEditor.deleteChapterAbortRef` adopts `deleteChapterOp` (dual-signal) + hook contract test

**Files:**
- Modify: `packages/client/src/hooks/useProjectEditor.ts:132, 849`
- Test: `packages/client/src/__tests__/useProjectEditor.test.ts` (add behavioral test per design §3.2 row S-7)
- Test: `packages/client/src/hooks/useAbortableAsyncOperation.test.ts` (add hook-level contract test per design §3.2)

**Design reference:** §2.3 row S-7 and §3.2 "Hook-level contract test".

- [ ] **Step 1: Add the hook-level contract test**

In `packages/client/src/hooks/useAbortableAsyncOperation.test.ts`, add:

```typescript
it("per-call signal passed to fn remains valid across multiple awaited calls within fn, and aborts all on next run()", async () => {
  const { result } = renderHook(() => useAbortableAsyncOperation());
  const seenSignals: AbortSignal[] = [];
  let resolveFirst: () => void = () => {};
  let resolveSecond: () => void = () => {};
  const firstAwait = new Promise<void>((r) => { resolveFirst = r; });
  const secondAwait = new Promise<void>((r) => { resolveSecond = r; });

  const { promise } = result.current.run(async (s) => {
    seenSignals.push(s);
    await firstAwait;
    seenSignals.push(s); // same instance — across-await stability
    await secondAwait;
    return "ok";
  });

  resolveFirst();
  await Promise.resolve();
  expect(seenSignals).toHaveLength(2);
  expect(seenSignals[0]).toBe(seenSignals[1]);
  expect(seenSignals[0].aborted).toBe(false);

  // A new run() aborts the prior signal — both awaits would see it aborted.
  result.current.run(async () => "second");
  expect(seenSignals[0].aborted).toBe(true);

  // Drain the first run's pending awaits to satisfy unhandled-rejection guards.
  resolveSecond();
  await expect(promise).resolves.toBe("ok");
});
```

- [ ] **Step 2: Run hook test (should already pass — the contract is implicit in current implementation)**

Run: `npm test -w packages/client -- useAbortableAsyncOperation`
Expected: PASS. This test exists to pin the contract that S-7 relies on, so any future refactor that breaks it fails here.

- [ ] **Step 3: Write the consumer behavioral test**

In `useProjectEditor.test.ts`:

```typescript
it("S-7: the same signal threaded into delete and the post-delete api.chapters.get aborts both together", async () => {
  let captured: { delete?: AbortSignal; get?: AbortSignal } = {};
  vi.spyOn(api.chapters, "delete").mockImplementation((_id, signal) => {
    captured.delete = signal;
    return new Promise(() => {}); // never resolves; force the signal-check after
  });
  vi.spyOn(api.chapters, "get").mockImplementation((_id, signal) => {
    captured.get = signal;
    return Promise.resolve({} as Chapter);
  });
  const { result, unmount } = renderHook(() => useProjectEditor(/* ...props... */));
  // Trigger handleDeleteChapter; do not await.
  void result.current.handleDeleteChapter("ch1");
  // The delete signal exists; the get signal won't exist yet (sequential).
  expect(captured.delete).toBeDefined();
  expect(captured.delete!.aborted).toBe(false);
  // Unmount cancels both branches via the same signal.
  unmount();
  expect(captured.delete!.aborted).toBe(true);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -w packages/client -- useProjectEditor -t "S-7"`
Expected: FAIL — current code uses two separate `AbortController` instances or doesn't thread a signal at all to the post-delete GET.

Actually note: existing code at line 849 already threads `controller.signal` from the deleteChapter ref. The test may already pass if `controller.signal === captured.get`. If so, the test still serves as a regression test for the migration.

- [ ] **Step 5: Migrate the deleteChapter flow**

Replace `const deleteChapterAbortRef = useRef<AbortController | null>(null);` at line 132 with `const deleteChapterOp = useAbortableAsyncOperation();`. Migrate `handleDeleteChapter` so the entire DELETE + follow-up GET lives inside one `run()` callback:

```typescript
const { promise, signal } = deleteChapterOp.run(async (s) => {
  await api.chapters.delete(chapterId, s);
  if (s.aborted) return;
  // ... post-delete refresh: api.chapters.get with the SAME signal s ...
  const ch = await api.chapters.get(firstId, s);
  // ... handle ch ...
});
```

The same signal flows into both calls per the hook contract test from Step 1.

- [ ] **Step 6: Re-run tests + per-package sweep**

```bash
npm test -w packages/client -- useProjectEditor
npm test -w packages/client -- useAbortableAsyncOperation
npm test -w packages/client
```

Expected: All green.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/hooks/useProjectEditor.ts packages/client/src/__tests__/useProjectEditor.test.ts packages/client/src/hooks/useAbortableAsyncOperation.test.ts
git commit -m "refactor(project-editor): S-7 — deleteChapter adopts dual-signal hook; hook contract test (4b.3b)

Per design §2.3 row S-7 and §3.2 'Hook-level contract test'. The
DELETE and post-delete GET share one signal from a single
deleteChapterOp.run() callback. The hook contract test pins the
per-call-signal-valid-across-multiple-awaits property that S-7
relies on, so any future hook refactor that breaks it fails here.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 25: S-8 — `ExportDialog.abortRef` adopts `exportOp` + allowlist shrink

**Files:**
- Modify: `packages/client/src/components/ExportDialog.tsx:36, 53`
- Modify: `packages/client/src/__tests__/migrationStructuralCheck.test.ts` (remove `ExportDialog.tsx`)

**Design reference:** §2.3 row S-8 and §5 Allowlist-edit discipline.

- [ ] **Step 1: Migrate**

Replace `const abortRef = useRef<AbortController | null>(null);` at line 36 with `const exportOp = useAbortableAsyncOperation();`. Migrate the export-call site to `exportOp.run((s) => api.projects.export(slug, config, s))`. Call `exportOp.abort()` in the open→close transition effect at line 53.

- [ ] **Step 2: Shrink the allowlist (last ref in the file)**

Remove the `ExportDialog.tsx` entry from `PHASE_4B_3B_ALLOWLIST`.

- [ ] **Step 3: Run structural test + ExportDialog tests + per-package sweep**

```bash
npm test -w packages/client -- migrationStructuralCheck
npm test -w packages/client -- ExportDialog
npm test -w packages/client
```

Expected: All green.

- [ ] **Step 4: Commit (atomic — last-ref + allowlist shrink)**

```bash
git add packages/client/src/components/ExportDialog.tsx packages/client/src/__tests__/migrationStructuralCheck.test.ts packages/client/src/__tests__/ExportDialog.test.tsx
git commit -m "refactor(export): S-8 — ExportDialog adopts exportOp; dialog exits allowlist (4b.3b)

Per design §2.3 row S-8 and §5 Allowlist-edit discipline. Dialog-close
lifecycle: exportOp.abort() in the open→close transition effect.
Allowlist shrinks in the same commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 26: S-16 — `useSnapshotState.restoreFollowupAbortRef` gets inline justification comment

**Files:**
- Modify: `packages/client/src/hooks/useSnapshotState.ts:186`

**Design reference:** §2.3 row S-16. Kept hand-rolled — two simultaneously-live controllers.

- [ ] **Step 1: Add the justification comment**

Insert above line 186:

```typescript
// Phase 4b.3b decision matrix row S-16: kept hand-rolled. The follow-up
// GET fires from inside the restore's success branch — by the time
// it runs, restoreOp's controller has been replaced by the next
// restore (if any), so routing this through restoreOp would
// auto-abort the follow-up. Two simultaneously-live controllers from
// one useAbortableAsyncOperation instance are not expressible —
// run() aborts the prior on each call. Splitting into two hook
// instances loses the entangled-lifecycle context documented at the
// existing comment block (lines 395-402). Phase 4b.4 replaces this
// file-level allowlist entry with an inline `// eslint-disable-next-line`
// on the line below.
const restoreFollowupAbortRef = useRef<AbortController | null>(null);
```

- [ ] **Step 2: Verify the §3.2 row 6 behavioral coverage already exists**

The design's §3.2 includes a behavioral assertion for S-16: "The hand-rolled two-controller pattern still aborts correctly on unmount and on a new restore." Confirm this coverage exists in the test suite before committing.

Run:

```bash
grep -nE "restoreFollowup|restore.*followup|followup.*restore" packages/client/src/__tests__/useSnapshotState.test.ts packages/client/src/hooks/useSnapshotState.test.ts 2>/dev/null
```

- **If a test asserting unmount-aborts-followup AND new-restore-aborts-followup exists:** cite the test name(s) in the Step 3 commit message ("S-16 behavioral coverage already pinned by `<test name>`").
- **If no such test exists:** add a new behavioral test to `useSnapshotState.test.ts` before committing. Template:

```typescript
it("S-16: restoreFollowupAbortRef aborts the follow-up GET on unmount AND on a new restore", async () => {
  let resolveFollowupGet: (data: unknown) => void = () => {};
  const followupCalls: AbortSignal[] = [];
  vi.spyOn(api.chapters, "get").mockImplementation((_id, signal) => {
    if (signal) followupCalls.push(signal);
    return new Promise((resolve) => { resolveFollowupGet = resolve; });
  });
  // Trigger a restore that succeeds and kicks off the follow-up GET.
  const { result, unmount } = renderHook(() => useSnapshotState(/* ...props... */));
  await act(async () => {
    await result.current.restoreSnapshot("snap1");
  });
  expect(followupCalls).toHaveLength(1);
  expect(followupCalls[0].aborted).toBe(false);
  // Path 1: unmount aborts the follow-up.
  unmount();
  expect(followupCalls[0].aborted).toBe(true);
  // (Adapt for "new restore aborts the prior follow-up" — second hook
  // instance, second restore call before the first follow-up resolves.)
});
```

Run: `npm test -w packages/client -- useSnapshotState`
Expected: Green.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/hooks/useSnapshotState.ts packages/client/src/__tests__/useSnapshotState.test.ts
git commit -m "docs(snapshots): S-16 — inline justification for hand-rolled restoreFollowupAbortRef (4b.3b)

Per design §2.3 row S-16 and §1 Approach 3 'Multi-controller live
simultaneously'. useSnapshotState stays in PHASE_4B_3B_ALLOWLIST
for this one retained ref.

§3.2 row 6 behavioral coverage: <cite existing test name, OR 'added
new test asserting unmount-aborts-followup AND new-restore-aborts-
followup'>.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 27: Structural test — final comment rewrite + import-implies-call assertion + `make cover` checkpoint

**Files:**
- Modify: `packages/client/src/__tests__/migrationStructuralCheck.test.ts:109-138`

**Design reference:** §3.1 and §5 step 7. By this point, `PHASE_4B_3B_ALLOWLIST` should already contain exactly 3 entries (HomePage, useProjectEditor, useSnapshotState) — the per-commit shrinks in S-1, S-10, S-12, S-8 already happened.

- [ ] **Step 1: Verify the current allowlist state**

```bash
grep -A 10 "PHASE_4B_3B_ALLOWLIST = new Set" packages/client/src/__tests__/migrationStructuralCheck.test.ts
```

Expected output: exactly 3 entries — `pages/HomePage.tsx`, `hooks/useProjectEditor.ts`, `hooks/useSnapshotState.ts`. If any of ExportDialog/ProjectSettingsDialog/SnapshotPanel/EditorPage are still listed, the prior task failed to shrink — stop and fix that task first.

- [ ] **Step 2: Rewrite the comment block at lines 109-129**

Replace the existing comment with:

```typescript
// Phase 4b.3b post-sweep state: three files retain hand-rolled
// useRef<AbortController> for documented second-tier-recovery
// (HomePage.createRecoveryAbortRef; useProjectEditor's three
// recovery refs) or simultaneously-live-controller patterns
// (useSnapshotState.restoreFollowupAbortRef). Each retained ref
// carries an inline justification comment at its allocation. Phase
// 4b.4 replaces this file-level allowlist with inline
// `// eslint-disable-next-line` on each of the surviving lines and
// removes this `PHASE_4B_3B_ALLOWLIST` set entirely.
//
// Files in the allowlist are pinned by absolute-path equivalence
// (resolved against clientSrcRoot) so the assertion stays robust
// against rename within the tree. A file that's renamed without
// updating this list will fail the ban — that's the intended
// forcing function.
```

- [ ] **Step 3: Add the new "import-implies-call" assertion**

After the existing assertions, add:

```typescript
it("every file that imports useAbortableAsyncOperation contains at least one .run( call", () => {
  // Guards against drift: a file that imports the hook but never
  // calls .run() either has dead code or has had its only call
  // removed without removing the import. Either is a code-smell.
  const importPattern = importPatternFor("useAbortableAsyncOperation");
  const runPattern = /\.run\s*\(/;
  const files = collectTsSources(clientSrcRoot);
  const offenders: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf-8");
    if (!importPattern.test(source)) continue;
    if (!runPattern.test(source)) {
      offenders.push(file.replace(clientSrcRoot, "packages/client/src"));
    }
  }
  expect(offenders).toEqual([]);
});
```

- [ ] **Step 4: Attempt the §3.1 best-effort assertion (every signal-bearing API endpoint has ≥1 consumer threading a non-undefined signal)**

The design's §3.1 last bullet calls for a best-effort structural assertion that every API endpoint that grew `signal?: AbortSignal` is used by at least one consumer that threads a non-undefined signal, with explicit permission to defer if grep-on-source gets too fragile.

Attempt the assertion. The grep targets the 4 endpoints from §2.1 (API-1..API-4) plus the endpoints they extend the surface of. For each, look for at least one call site that passes a non-undefined signal:

```bash
for endpoint in "api\.projects\.create" "api\.projects\.delete" "api\.chapters\.create" "api\.chapterStatuses\.list"; do
  echo "--- $endpoint ---"
  grep -rnE "${endpoint}\([^)]*,\s*[a-zA-Z_]" packages/client/src/ 2>/dev/null | grep -v __tests__ | grep -v "api/client.ts"
done
```

Each endpoint should return at least one match where a non-undefined argument follows the first positional arg.

**Decision tree:**

- **If grep cleanly identifies ≥1 consumer per endpoint:** Encode the assertion as a new `it()` block in `migrationStructuralCheck.test.ts`. Template:

```typescript
it("each new signal-bearing API endpoint has ≥1 consumer threading a non-undefined signal", () => {
  const endpoints = [
    "api.projects.create",
    "api.projects.delete",
    "api.chapters.create",
    "api.chapterStatuses.list",
  ];
  const files = collectTsSources(clientSrcRoot).filter(
    (f) => !f.endsWith("/api/client.ts"),
  );
  const missing: string[] = [];
  for (const endpoint of endpoints) {
    // Match a call that passes ≥2 args (i.e. includes a signal arg).
    // Pattern: api.x.y(arg1, arg2) — second positional must be present.
    const pattern = new RegExp(
      endpoint.replace(/\./g, "\\.") + "\\(\\s*[^)]+,\\s*[a-zA-Z_]",
    );
    const found = files.some((f) => pattern.test(readFileSync(f, "utf-8")));
    if (!found) missing.push(endpoint);
  }
  expect(missing).toEqual([]);
});
```

- **If the grep is fragile** (e.g. multi-line call sites get split, `op.run((s) => api.X.create(slug, s))` syntax confuses the regex, false positives from comments): **defer**. Add a `// TODO(4b.4 or later)` comment in `migrationStructuralCheck.test.ts` at the end of the `describe` block referencing the design's §3.1 deferral path, and record the deferral rationale in the Step 7 commit message ("§3.1 best-effort API-consumer-uses-signal assertion deferred — grep-on-source too fragile for `op.run((s) => api.X(arg, s))` shapes. Coverage of signal-threading is provided behaviorally by Tasks 11, 13, 14, 23, 24 mock-call assertions.").

The deferral path is explicitly sanctioned by §3.1; the only requirement is that the decision is recorded, not silently skipped.

- [ ] **Step 5: Run the structural test**

```bash
npm test -w packages/client -- migrationStructuralCheck
```

Expected: Green. The new import-implies-call assertion passes against the post-sweep tree. If Step 4's attempt encoded the API-consumer-uses-signal assertion, it passes too.

- [ ] **Step 6: Per-package sweep + COVERAGE CHECKPOINT (per design §5 step 7)**

```bash
npm test -w packages/client
make cover
```

Record the per-package coverage delta vs branch-base. If any threshold dropped (even within the still-passing range — e.g. statements 96.1% → 95.2%), add a focused test before opening the PR. Common candidates: the new `sleep` helper, the new contract test for `useAbortableAsyncOperation`, any consumer site whose previous "ref was wired" test was dropped in the migration. Aim to push coverage higher, not coast at the floor (CLAUDE.md §Testing Philosophy).

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/__tests__/migrationStructuralCheck.test.ts
git commit -m "test(structural): rewrite allowlist comment + import-implies-call assertion (4b.3b)

Per design §3.1 and §5 step 7. PHASE_4B_3B_ALLOWLIST is at its
3-file post-sweep state; comment block reflects post-sweep reality
and signals Phase 4b.4's inline-eslint-disable replacement. New
import-implies-call assertion guards against future drift where the
hook is imported but never called.

Coverage delta vs branch-base recorded in PR description; no
thresholds regressed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 28: §3.3 drop-redundant-tests sweep

**Files:**
- Modify: per-package test files where ref-wiring tests exist (`useProjectEditor.test.ts`, `useSnapshotState.test.ts`, `SnapshotPanel.test.tsx`, `ProjectSettingsDialog.test.tsx`, `ExportDialog.test.tsx`, `EditorPage.test.tsx`, `HomePage.test.tsx`).

**Design reference:** §3.3.

- [ ] **Step 1: Identify candidates**

Run:

```bash
grep -nE "AbortRef.current|xxxOpRef|abortRef.*non-null|saveAbortRef.*null" packages/client/src/__tests__/ 2>/dev/null
```

Look for tests whose only assertion is "the ref is non-null after a call fires" or "the ref's signal is the same instance across N calls" — those tested the old internal pattern, not behavior. Keep tests whose assertions are about user-visible behavior (the migrations behavior tests added in C-6, C-9, C-10/11, S-2, S-7 are keepers).

- [ ] **Step 2: Delete redundant tests**

Per design §3.3, delete tests that prove *internals* (ref existence, controller wiring) but not *behavior*. Document each deletion in the commit message with the file:test-name and rationale.

- [ ] **Step 3: Run per-package sweep + COVERAGE CHECK**

```bash
npm test -w packages/client
make cover
```

Expected: Green. Verify coverage didn't drop below threshold; if it did, add focused tests on the now-uncovered lines (typically the migration sites themselves) rather than restoring the deleted internals tests.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/__tests__/
git commit -m "test(client): drop redundant useRef<AbortController> internals tests (4b.3b)

Per design §3.3. Tests that asserted on ref existence / controller
wiring under the old pattern are removed; behavioral tests (C-6,
C-9, C-10/11, S-2, S-7 from this phase, plus pre-existing
behavior tests) remain.

Coverage stays at or above threshold.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 29: CLAUDE.md edits — §Save-pipeline Rule 4 reframe + §Pull Request Scope footnote

**Files:**
- Modify: `/workspace/CLAUDE.md:132` and `/workspace/CLAUDE.md:211`

**Design reference:** §4.1 and §4.2.

- [ ] **Step 1: §Save-pipeline invariants Rule 4 — reframe the "seven files" sentence**

In `CLAUDE.md`, locate the sentence in Rule 4 paragraph (around line 132):

> "...the seven Phase 4b.3b files — each containing one or more such allocations — are allowlisted there until their call sites are per-site re-evaluated; lint enforcement deferred to Phase 4b.4)."

Replace with:

> "...three justified-survivor files (HomePage.tsx, useProjectEditor.ts, useSnapshotState.ts) — each containing one or more retained allocations for documented second-tier-recovery or simultaneously-live-controller patterns — remain allowlisted; Phase 4b.4's ESLint rule replaces this file-level allowlist with inline `// eslint-disable-next-line` on each of the surviving lines.)"

- [ ] **Step 2: §Pull Request Scope — add the recorded-exception footnote**

In `CLAUDE.md`, at the end of §Pull Request Scope (after line 211 "Line count is not a hard limit..."), add:

```markdown

**Exceptions to the one-feature rule require an explicit decision recorded in the phase's decision log; the rule defaults to enforcement.** The 2026-05-25 Phase 4b.3b decision log entry is the first such recorded exception (bundling Cluster B threading with the allowlist sweep).
```

- [ ] **Step 3: Verify CLAUDE.md still parses + per-package tests still green**

```bash
npm test -w packages/client
```

Expected: Green (no test reads CLAUDE.md; this is a doc edit).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(claude-md): Rule 4 reframe + §Pull Request Scope exception footnote (4b.3b)

Per design §4.1: §Save-pipeline Rule 4 reframed from 'seven Phase 4b.3b
files' to 'three justified-survivor files' with the inline-eslint-disable
path forward in 4b.4.

Per design §4.2: §Pull Request Scope footnote — exceptions to the
one-feature rule require an explicit decision recorded in the phase's
decision log; the rule defaults to enforcement.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 30: Final verification — `make all` + DoD checklist walk-through

**Design reference:** §6 Definition of Done.

- [ ] **Step 1: Run the full CI gate**

```bash
make all
```

Expected: lint, format, typecheck, coverage, e2e all green. Zero warnings in test output (`console.warn` / `console.error` from production code paths must not appear; intentional warns must be spied per CLAUDE.md §Testing Philosophy).

- [ ] **Step 2: Walk the §6 Definition of Done checklist**

For each section of the design's §6 (API surface, Shared helpers, Hook contract, Cluster B consumers, Allowlist sweep, Structural assertions, CLAUDE.md, Test output, CI gates, Documentation):

- [ ] Confirm every checkbox is true.
- [ ] Mark each one done in the design doc (or in the decision log entry — your choice).

If anything is false, return to the relevant task and fix before opening the PR.

- [ ] **Step 3: Confirm the allowlist state**

```bash
grep -A 8 "PHASE_4B_3B_ALLOWLIST = new Set" packages/client/src/__tests__/migrationStructuralCheck.test.ts
```

Expected: exactly 3 entries — `pages/HomePage.tsx`, `hooks/useProjectEditor.ts`, `hooks/useSnapshotState.ts`.

- [ ] **Step 4: Confirm 5 surviving `useRef<AbortController>` allocations**

```bash
grep -rn "useRef<AbortController" packages/client/src/ | grep -v __tests__ | grep -v useAbortableAsyncOperation.ts
```

Expected output: exactly 5 lines —
- `pages/HomePage.tsx:N: createRecoveryAbortRef` (C-3)
- `hooks/useProjectEditor.ts:N: createRecoveryAbortRef` (C-5)
- `hooks/useProjectEditor.ts:N: statusRecoveryAbortRef` (C-5)
- `hooks/useProjectEditor.ts:N: titleRecoveryAbortRef` (C-5)
- `hooks/useSnapshotState.ts:N: restoreFollowupAbortRef` (S-16)

- [ ] **Step 5: Open the PR**

Reference docs/roadmap.md Phase 4b.3b and docs/plans/2026-05-25-abortsignal-threading-completion-design.md in the PR description. PR title under 70 chars (e.g. `4b.3b: AbortSignal threading completion + allowlist sweep`). Body should cite both Decision 1 (API surface in scope) and Decision 2 (allowlist sweep — recorded exception to one-feature rule).

---

## Self-Review (already performed)

- **Spec coverage:** Every row in §2.1 (API-1..API-4), §2.2 (C-1..C-11), §2.3 (S-1..S-16) is mapped to a task. CLAUDE.md edits (§4.1, §4.2) → Task 29. Structural test (§3.1) → Task 27. Hook contract test (§3.2) → Task 24. `sleep` helper (§3.2) → Task 5. Drop-redundant-tests (§3.3) → Task 28. Coverage checkpoint (§5 step 7) → Task 27 step 5. `make all` final gate → Task 30.
- **Placeholder scan:** No "TBD" / "fill in details" / "appropriate error handling" placeholders. Every step has actual code or commands. The only "adapt to existing harness" notes are in test scaffolding, where the test plan should match the existing per-file test setup (not invent a new one).
- **Type consistency:** Hook surface (`run<T>(fn: (signal: AbortSignal) => Promise<T>): { promise; signal }`) is used consistently across all tasks. `sleep(ms: number, signal?: AbortSignal): Promise<void>` signature is consistent between definition (Task 5) and use (Tasks 13, 23). `cancelInFlightSave` keeps its public name across Task 23.
- **§5 ordering preserved:** Tasks 1-4 = step 1 (API surface). Task 5 = step 2 (sleep helper). Tasks 6-14 = step 3 (Cluster B). Tasks 15-22 = steps 4-5 (allowlist sweep textbook + paired). Tasks 23-25 = step 6 (tricky). Tasks 27-28 = step 7 (structural test + redundant-test drop). Task 29 = step 8 (CLAUDE.md). Task 30 = final gate.
- **Allowlist-edit discipline:** Tasks 15, 18, 21, 25 each include the allowlist shrink in the same commit as the file's last ref-removal — matches design §5 discipline.

---

## Execution Handoff

**Plan complete and saved to `docs/plans/2026-05-25-abortsignal-threading-completion-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks. Best fit given the 30-task scope and §5 review-strategy ("review per-commit, decision matrix is the contract").

**2. Inline Execution** — execute tasks in this session using executing-plans, with checkpoints for review.

Which approach? (Defer this choice until after Phase 4b.3b's plan-writing and alignment steps complete — implementation typically runs in a separate session.)
