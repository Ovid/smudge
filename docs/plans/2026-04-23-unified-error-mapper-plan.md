# Unified API Error Mapper — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consolidate all API-error-to-UI-string translation in the client into a single `packages/client/src/errors/` module, eliminate drift between call sites, and remove raw `err.message` leaks to the UI.

**Architecture:** A declarative registry of typed scopes maps `(ApiRequestError, scope) → { message, possiblyCommitted, transient, extras? }`. A single resolver applies cross-cutting rules (ABORTED silent, 2xx BAD_JSON possiblyCommitted, NETWORK transient) once; scopes declare only their overrides. Call sites call `mapApiError(err, 'chapter.save')` and branch on the structured result.

**Tech Stack:** TypeScript (strict), Vitest (unit tests, table-driven), React 18 (call-site tests via @testing-library/react), `@smudge/shared` for the envelope type.

**Design doc:** `docs/plans/2026-04-23-unified-error-mapper-design.md`

**Commits:** Five. Each must pass `make all` independently.

1. Commit 1 — new module (unused).
2. Commit 2 — transport change + `ImageGallery.handleDelete` migration (atomic).
3. Commit 3 — centralized-already sites migration (`findReplaceErrors.ts` + snapshot hook).
4. Commit 4 — generic-fallback sites migration.
5. Commit 5 — remaining raw-message leak kills + CLAUDE.md edits.

**Discipline reminders (CLAUDE.md):**
- Coverage floors: 95% statements, 85% branches, 90% functions, 95% lines. `make cover` enforces.
- Zero warnings in test output — spy-and-suppress when deliberately exercising error paths.
- All user-visible strings come from `packages/client/src/strings.ts`.
- Save-pipeline invariants still apply where touched (commit 3 especially).

---

## Commit 1: New module (unused)

**Files:**
- Create: `packages/client/src/errors/apiErrorMapper.ts`
- Create: `packages/client/src/errors/scopes.ts`
- Create: `packages/client/src/errors/index.ts`
- Create: `packages/client/src/errors/apiErrorMapper.test.ts`

At the end of this commit, the module exists, is fully tested, and is imported nowhere. `make all` passes. Intermediate state is safe.

---

### Task 1.1: Scaffold the types and empty resolver

**Files:**
- Create: `packages/client/src/errors/apiErrorMapper.ts`

**Step 1: Write the failing test (types only)**

Create `packages/client/src/errors/apiErrorMapper.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { MappedError } from "./apiErrorMapper";

describe("MappedError shape", () => {
  it("has message, possiblyCommitted, transient, optional extras", () => {
    const m: MappedError = { message: null, possiblyCommitted: false, transient: false };
    expect(m.message).toBeNull();
    expect(m.possiblyCommitted).toBe(false);
    expect(m.transient).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run packages/client/src/errors/apiErrorMapper.test.ts`
Expected: FAIL (module not found).

**Step 3: Create the module with types only**

Create `packages/client/src/errors/apiErrorMapper.ts`:

```ts
import type { ApiRequestError } from "../api/client";

export type MappedError = {
  message: string | null;
  possiblyCommitted: boolean;
  transient: boolean;
  extras?: Record<string, unknown>;
};

export type ScopeEntry = {
  fallback: string;
  committed?: string;
  network?: string;
  byCode?: Partial<Record<string, string>>;
  byStatus?: Partial<Record<number, string>>;
  extrasFrom?: (err: ApiRequestError) => Record<string, unknown> | undefined;
};
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run packages/client/src/errors/apiErrorMapper.test.ts`
Expected: PASS.

**Step 5: Do not commit yet** — scaffold only; will commit at end of commit 1.

---

### Task 1.2: Implement the resolver's fallback-only rule (Rule 1, Rule 7)

**Step 1: Add failing tests**

Append to `apiErrorMapper.test.ts`:

```ts
import { mapApiError } from "./apiErrorMapper";
import { ApiRequestError } from "../api/client";

const testScope = {
  fallback: "test-fallback",
} as const;

describe("mapApiError — fallback-only resolution", () => {
  it("returns fallback for non-ApiRequestError", () => {
    const result = mapApiError(new Error("random"), testScope);
    expect(result).toEqual({
      message: "test-fallback",
      possiblyCommitted: false,
      transient: false,
    });
  });

  it("returns fallback when code and status match nothing in the scope", () => {
    const err = new ApiRequestError("oops", 500, "INTERNAL_ERROR");
    const result = mapApiError(err, testScope);
    expect(result).toEqual({
      message: "test-fallback",
      possiblyCommitted: false,
      transient: false,
    });
  });
});
```

**Note:** This test uses `mapApiError(err, scopeEntry)` — not `mapApiError(err, scopeName)`. Keeping the resolver scope-entry-driven means it's unit-testable without the full registry; the public `mapApiError` (added in Task 1.11) wraps it.

Rename the exported function under test accordingly:

```ts
// Private, unit-tested directly
export function resolveError(err: unknown, scope: ScopeEntry): MappedError { ... }
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run packages/client/src/errors/apiErrorMapper.test.ts`
Expected: FAIL (resolveError not found).

**Step 3: Implement the minimal resolver**

Append to `apiErrorMapper.ts`:

```ts
export function resolveError(err: unknown, scope: ScopeEntry): MappedError {
  return {
    message: scope.fallback,
    possiblyCommitted: false,
    transient: false,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run packages/client/src/errors/apiErrorMapper.test.ts`
Expected: PASS.

---

### Task 1.3: Add the ABORTED rule (Rule 2)

**Step 1: Add failing test**

Append to `apiErrorMapper.test.ts`:

```ts
describe("mapApiError — ABORTED", () => {
  it("returns null message for ABORTED", () => {
    const err = new ApiRequestError("aborted", 0, "ABORTED");
    const result = resolveError(err, testScope);
    expect(result.message).toBeNull();
    expect(result.possiblyCommitted).toBe(false);
    expect(result.transient).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run packages/client/src/errors/apiErrorMapper.test.ts`
Expected: FAIL.

**Step 3: Implement ABORTED branch**

In `resolveError`:

```ts
export function resolveError(err: unknown, scope: ScopeEntry): MappedError {
  if (!isApiRequestError(err)) {
    return { message: scope.fallback, possiblyCommitted: false, transient: false };
  }
  if (err.code === "ABORTED") {
    return { message: null, possiblyCommitted: false, transient: false };
  }
  return { message: scope.fallback, possiblyCommitted: false, transient: false };
}

function isApiRequestError(err: unknown): err is ApiRequestError {
  return err instanceof ApiRequestError;
}
```

Import `ApiRequestError` as value (not type-only):

```ts
import { ApiRequestError } from "../api/client";
```

**Step 4: Run test to verify passing**

Run: `npx vitest run packages/client/src/errors/apiErrorMapper.test.ts`
Expected: PASS.

---

### Task 1.4: Add the 2xx BAD_JSON rule (Rule 3 — `possiblyCommitted`)

**Step 1: Add failing tests**

Append:

```ts
const scopeWithCommitted = {
  fallback: "fallback",
  committed: "server may have committed",
} as const;

describe("mapApiError — 2xx BAD_JSON", () => {
  it("returns scope.committed with possiblyCommitted:true for 2xx BAD_JSON", () => {
    const err = new ApiRequestError("bad json", 200, "BAD_JSON");
    const result = resolveError(err, scopeWithCommitted);
    expect(result).toEqual({
      message: "server may have committed",
      possiblyCommitted: true,
      transient: false,
    });
  });

  it("falls back to fallback when scope has no committed override", () => {
    const err = new ApiRequestError("bad json", 201, "BAD_JSON");
    const result = resolveError(err, testScope);
    expect(result).toEqual({
      message: "test-fallback",
      possiblyCommitted: true,
      transient: false,
    });
  });

  it("does NOT trigger possiblyCommitted for BAD_JSON on non-2xx (defensive)", () => {
    // apiFetch never assigns BAD_JSON on non-2xx today, but the resolver
    // must be robust if that contract ever loosens.
    const err = new ApiRequestError("bad json", 500, "BAD_JSON");
    const result = resolveError(err, scopeWithCommitted);
    expect(result.possiblyCommitted).toBe(false);
  });
});
```

**Step 2: Run — expect FAIL**

**Step 3: Implement**

Insert after the ABORTED branch in `resolveError`:

```ts
if (err.code === "BAD_JSON" && err.status >= 200 && err.status < 300) {
  return {
    message: scope.committed ?? scope.fallback,
    possiblyCommitted: true,
    transient: false,
  };
}
```

**Step 4: Run — expect PASS**

---

### Task 1.5: Add the NETWORK rule (Rule 4 — `transient`)

**Step 1: Add failing tests**

```ts
const scopeWithNetwork = {
  fallback: "fallback",
  network: "check your connection",
} as const;

describe("mapApiError — NETWORK", () => {
  it("returns scope.network with transient:true when scope has network override", () => {
    const err = new ApiRequestError("offline", 0, "NETWORK");
    const result = resolveError(err, scopeWithNetwork);
    expect(result).toEqual({
      message: "check your connection",
      possiblyCommitted: false,
      transient: true,
    });
  });

  it("falls back to fallback with transient:true when scope has no network override", () => {
    const err = new ApiRequestError("offline", 0, "NETWORK");
    const result = resolveError(err, testScope);
    expect(result).toEqual({
      message: "test-fallback",
      possiblyCommitted: false,
      transient: true,
    });
  });
});
```

**Step 2: Run — expect FAIL**

**Step 3: Implement**

Insert after the BAD_JSON branch:

```ts
if (err.code === "NETWORK") {
  return {
    message: scope.network ?? scope.fallback,
    possiblyCommitted: false,
    transient: true,
  };
}
```

**Step 4: Run — expect PASS**

---

### Task 1.6: Add the byCode rule (Rule 5)

**Step 1: Add failing tests**

```ts
const scopeWithByCode = {
  fallback: "fallback",
  byCode: {
    VALIDATION_ERROR: "validation failed",
    INVALID_REGEX: "invalid regex",
  },
} as const;

describe("mapApiError — byCode", () => {
  it("returns scope.byCode[code] when present", () => {
    const err = new ApiRequestError("bad", 400, "VALIDATION_ERROR");
    const result = resolveError(err, scopeWithByCode);
    expect(result.message).toBe("validation failed");
    expect(result.possiblyCommitted).toBe(false);
    expect(result.transient).toBe(false);
  });

  it("falls through to fallback when code not in byCode", () => {
    const err = new ApiRequestError("unknown", 400, "UNKNOWN_CODE");
    const result = resolveError(err, scopeWithByCode);
    expect(result.message).toBe("fallback");
  });
});
```

**Step 2: Run — expect FAIL**

**Step 3: Implement**

Insert after NETWORK branch:

```ts
if (err.code && scope.byCode?.[err.code]) {
  return {
    message: scope.byCode[err.code]!,
    possiblyCommitted: false,
    transient: false,
    extras: scope.extrasFrom?.(err),
  };
}
```

**Step 4: Run — expect PASS**

---

### Task 1.7: Add the byStatus rule (Rule 6) and verify byCode beats byStatus

**Step 1: Add failing tests**

```ts
const scopeWithByStatus = {
  fallback: "fallback",
  byStatus: {
    413: "too large",
    404: "not found",
  },
} as const;

const scopeWithBoth = {
  fallback: "fallback",
  byCode: { VALIDATION_ERROR: "validation failed" },
  byStatus: { 400: "bad request" },
} as const;

describe("mapApiError — byStatus", () => {
  it("returns scope.byStatus[status] when present", () => {
    const err = new ApiRequestError("too large", 413, "PAYLOAD_TOO_LARGE");
    const result = resolveError(err, scopeWithByStatus);
    expect(result.message).toBe("too large");
  });

  it("byCode beats byStatus", () => {
    const err = new ApiRequestError("bad", 400, "VALIDATION_ERROR");
    const result = resolveError(err, scopeWithBoth);
    expect(result.message).toBe("validation failed");
  });

  it("byStatus applies when byCode does not match", () => {
    const err = new ApiRequestError("bad", 400, "OTHER_CODE");
    const result = resolveError(err, scopeWithBoth);
    expect(result.message).toBe("bad request");
  });
});
```

**Step 2: Run — expect FAIL**

**Step 3: Implement**

Insert after byCode branch:

```ts
if (scope.byStatus?.[err.status] !== undefined) {
  return {
    message: scope.byStatus[err.status]!,
    possiblyCommitted: false,
    transient: false,
    extras: scope.extrasFrom?.(err),
  };
}
```

Also append `extras: scope.extrasFrom?.(err)` to the final fallback branch so callers that opt into extras still get them on fall-through:

```ts
return {
  message: scope.fallback,
  possiblyCommitted: false,
  transient: false,
  extras: scope.extrasFrom?.(err),
};
```

**Step 4: Run — expect PASS**

---

### Task 1.8: Verify `extras` are computed only when `extrasFrom` declared

**Step 1: Add failing tests**

```ts
const scopeWithExtras = {
  fallback: "fallback",
  byCode: { IMAGE_IN_USE: "in use" },
  extrasFrom: (err: ApiRequestError) => {
    const chapters = (err.extras as { chapters?: unknown })?.chapters;
    return Array.isArray(chapters) ? { chapters } : undefined;
  },
} as const;

describe("mapApiError — extras", () => {
  it("computes extras when scope declares extrasFrom", () => {
    const err = new ApiRequestError("in use", 409, "IMAGE_IN_USE", {
      chapters: [{ id: "c1", title: "Chapter 1" }],
    });
    const result = resolveError(err, scopeWithExtras);
    expect(result.extras).toEqual({ chapters: [{ id: "c1", title: "Chapter 1" }] });
  });

  it("returns extras: undefined when server envelope is malformed", () => {
    const err = new ApiRequestError("in use", 409, "IMAGE_IN_USE", {
      chapters: "not-an-array",
    });
    const result = resolveError(err, scopeWithExtras);
    expect(result.extras).toBeUndefined();
  });

  it("does not include extras when scope has no extrasFrom", () => {
    const err = new ApiRequestError("bad", 400, "VALIDATION_ERROR", {
      something: "else",
    });
    const result = resolveError(err, scopeWithByCode);
    expect(result.extras).toBeUndefined();
  });
});
```

**Note:** these tests construct `ApiRequestError` with a fourth `extras` arg. The existing class (pre-commit-2) only accepts three args. So this test will not compile yet. **That is expected** — it sets up the contract commit 2 will fulfill. We address it in the next task.

**Step 2: Make the test skeleton compile by temporarily widening the test-local `ApiRequestError`**

Options:
- Declare a local stub class in the test file that extends `ApiRequestError` with a fourth arg; or
- Wait: these tests for `extras` stay red until commit 2.

Choose the second option: comment these three tests out with a `// TODO: unskip in commit 2` marker so commit 1's test suite is green.

**Revised Step 1:** Add the three extras tests but wrap them in `describe.skip(...)` with a comment `// TODO: unskip after commit 2 widens ApiRequestError to carry extras`.

**Step 3: Run — tests skipped, suite green**

Run: `npx vitest run packages/client/src/errors/apiErrorMapper.test.ts`
Expected: all other tests PASS; these three tests SKIPPED (reported green with skip count).

---

### Task 1.9: Define the scope registry file (empty scope entries for every ApiErrorScope)

**Files:**
- Create: `packages/client/src/errors/scopes.ts`

**Step 1: Add failing test**

In `apiErrorMapper.test.ts`, append:

```ts
import { SCOPES, type ApiErrorScope } from "./scopes";

describe("SCOPES registry", () => {
  it("has an entry for every ApiErrorScope (TypeScript enforces this)", () => {
    // Runtime sanity: every key is a non-empty string, every entry has a fallback.
    for (const scope of Object.keys(SCOPES) as ApiErrorScope[]) {
      expect(typeof scope).toBe("string");
      expect(SCOPES[scope].fallback).toBeTruthy();
    }
  });

  it("covers all known scopes", () => {
    const expected: ApiErrorScope[] = [
      "project.load", "project.create", "project.delete", "project.updateTitle", "project.velocity",
      "chapter.load", "chapter.save", "chapter.create", "chapter.delete", "chapter.rename",
      "chapter.reorder", "chapter.updateStatus",
      "chapterStatus.fetch",
      "image.upload", "image.delete", "image.updateMetadata",
      "snapshot.restore", "snapshot.view", "snapshot.list", "snapshot.create", "snapshot.delete",
      "findReplace.search", "findReplace.replace",
      "export.run",
      "trash.load", "trash.restoreChapter",
      "settings.get", "settings.update",
      "dashboard.load",
    ];
    const actual = Object.keys(SCOPES).sort();
    expect(actual).toEqual(expected.sort());
  });
});
```

**Step 2: Run — expect FAIL (module missing)**

**Step 3: Implement scopes.ts with empty entries**

```ts
import type { ScopeEntry } from "./apiErrorMapper";
import { STRINGS } from "../strings";

export type ApiErrorScope =
  | "project.load"     | "project.create"   | "project.delete"  | "project.updateTitle"
  | "project.velocity"
  | "chapter.load"     | "chapter.save"     | "chapter.create"  | "chapter.delete"
  | "chapter.rename"   | "chapter.reorder"  | "chapter.updateStatus"
  | "chapterStatus.fetch"
  | "image.upload"     | "image.delete"     | "image.updateMetadata"
  | "snapshot.restore" | "snapshot.view"    | "snapshot.list"
  | "snapshot.create"  | "snapshot.delete"
  | "findReplace.search" | "findReplace.replace"
  | "export.run"
  | "trash.load"       | "trash.restoreChapter"
  | "settings.get"     | "settings.update"
  | "dashboard.load";

// Every scope entry starts with its fallback only. Subsequent tasks in
// commit 1 populate byCode / byStatus / network / committed / extrasFrom.
export const SCOPES: Record<ApiErrorScope, ScopeEntry> = {
  "project.load":        { fallback: STRINGS.error.loadProjectFailed },
  "project.create":      { fallback: STRINGS.error.createFailed },
  "project.delete":      { fallback: STRINGS.error.deleteFailed },
  "project.updateTitle": { fallback: STRINGS.error.updateTitleFailed },
  "project.velocity":    { fallback: STRINGS.velocity.loadError },
  "chapter.load":        { fallback: STRINGS.error.loadChapterFailed },
  "chapter.save":        { fallback: STRINGS.editor.saveFailed },
  "chapter.create":      { fallback: STRINGS.error.createChapterFailed },
  "chapter.delete":      { fallback: STRINGS.error.deleteChapterFailed },
  "chapter.rename":      { fallback: STRINGS.error.renameChapterFailed },
  "chapter.reorder":     { fallback: STRINGS.error.reorderFailed },
  "chapter.updateStatus":{ fallback: STRINGS.error.statusChangeFailed },
  "chapterStatus.fetch": { fallback: STRINGS.error.statusesFetchFailed },
  "image.upload":        { fallback: STRINGS.imageGallery.uploadFailedGeneric },
  "image.delete":        { fallback: STRINGS.imageGallery.deleteFailedGeneric },
  "image.updateMetadata":{ fallback: STRINGS.imageGallery.saveFailed },
  "snapshot.restore":    { fallback: STRINGS.snapshots.restoreFailed },
  "snapshot.view":       { fallback: STRINGS.snapshots.viewFailed },
  "snapshot.list":       { fallback: STRINGS.snapshots.listFailedGeneric },
  "snapshot.create":     { fallback: STRINGS.snapshots.createFailedGeneric },
  "snapshot.delete":     { fallback: STRINGS.snapshots.deleteFailedGeneric },
  "findReplace.search":  { fallback: STRINGS.findReplace.searchFailed },
  "findReplace.replace": { fallback: STRINGS.findReplace.replaceFailed },
  "export.run":          { fallback: STRINGS.export.errorFailed },
  "trash.load":          { fallback: STRINGS.error.loadTrashFailed },
  "trash.restoreChapter":{ fallback: STRINGS.error.restoreChapterFailed },
  "settings.get":        { fallback: STRINGS.error.settingsLoadFailedGeneric },
  "settings.update":     { fallback: STRINGS.error.settingsUpdateFailedGeneric },
  "dashboard.load":      { fallback: STRINGS.error.loadDashboardFailed },
};
```

Many strings above do not exist yet (`uploadFailedGeneric`, `deleteFailedGeneric`, `listFailedGeneric`, `createFailedGeneric`, `deleteFailedGeneric`, `settingsLoadFailedGeneric`, `settingsUpdateFailedGeneric`). Add them to `packages/client/src/strings.ts` in their respective namespaces. Suggested drafts:

- `STRINGS.imageGallery.uploadFailedGeneric` = `"Upload failed. Check your connection and try again."`
- `STRINGS.imageGallery.deleteFailedGeneric` = `"Delete failed. Try again."`
- `STRINGS.snapshots.listFailedGeneric` = `"Unable to load snapshots. Try again."`
- `STRINGS.snapshots.createFailedGeneric` = `"Unable to create snapshot. Try again."`
- `STRINGS.snapshots.deleteFailedGeneric` = `"Unable to delete snapshot. Try again."`
- `STRINGS.error.settingsLoadFailedGeneric` = `"Unable to load settings."`
- `STRINGS.error.settingsUpdateFailedGeneric` = `"Unable to save settings."`

**Step 4: Run — expect PASS**

Run: `npx vitest run packages/client/src/errors/apiErrorMapper.test.ts`

---

### Task 1.10: Populate byCode / byStatus / network / committed / extrasFrom for the "active" scopes

Some scopes have richer behavior than fallback-only. These are: `chapter.save`, `image.delete`, `snapshot.restore`, `snapshot.view`, `findReplace.search`, `findReplace.replace`. One subtask per scope — each is red-green-refactor.

#### Task 1.10.a: `chapter.save`

**Step 1:** Add tests:

```ts
import { ApiRequestError } from "../api/client";
import { STRINGS } from "../strings";
import { SCOPES } from "./scopes";

describe("SCOPES['chapter.save']", () => {
  it("413 → saveFailedTooLarge", () => {
    const err = new ApiRequestError("too large", 413, "PAYLOAD_TOO_LARGE");
    expect(resolveError(err, SCOPES["chapter.save"]).message).toBe(STRINGS.editor.saveFailedTooLarge);
  });
  it("VALIDATION_ERROR → saveFailedInvalid", () => {
    const err = new ApiRequestError("invalid", 400, "VALIDATION_ERROR");
    expect(resolveError(err, SCOPES["chapter.save"]).message).toBe(STRINGS.editor.saveFailedInvalid);
  });
  it("500 → saveFailed (fallback)", () => {
    const err = new ApiRequestError("oops", 500, "INTERNAL_ERROR");
    expect(resolveError(err, SCOPES["chapter.save"]).message).toBe(STRINGS.editor.saveFailed);
  });
});
```

**Step 2:** Run — FAIL.

**Step 3:** Update `scopes.ts`:

```ts
"chapter.save": {
  fallback: STRINGS.editor.saveFailed,
  byStatus: { 413: STRINGS.editor.saveFailedTooLarge },
  byCode:   { VALIDATION_ERROR: STRINGS.editor.saveFailedInvalid },
},
```

**Step 4:** Run — PASS.

#### Task 1.10.b: `image.delete`

**Step 1:** Add tests:

```ts
describe("SCOPES['image.delete']", () => {
  it("IMAGE_IN_USE → deleteBlockedInUse with chapters extras", () => {
    const err = new ApiRequestError("in use", 409, "IMAGE_IN_USE", {
      chapters: [{ id: "c1", title: "Chapter One" }],
    });
    const result = resolveError(err, SCOPES["image.delete"]);
    expect(result.message).toBe(STRINGS.imageGallery.deleteBlockedInUse);
    expect(result.extras).toEqual({ chapters: [{ id: "c1", title: "Chapter One" }] });
  });

  it("IMAGE_IN_USE with malformed extras → message set, extras undefined", () => {
    const err = new ApiRequestError("in use", 409, "IMAGE_IN_USE", { chapters: "bad" });
    const result = resolveError(err, SCOPES["image.delete"]);
    expect(result.message).toBe(STRINGS.imageGallery.deleteBlockedInUse);
    expect(result.extras).toBeUndefined();
  });
});
```

**Note:** These tests depend on `ApiRequestError`'s 4-arg constructor (arrives in commit 2). **Skip with `describe.skip(...)` and a `// TODO: unskip in commit 2` marker.**

**Step 3:** Update `scopes.ts`:

```ts
"image.delete": {
  fallback: STRINGS.imageGallery.deleteFailedGeneric,
  byCode: { IMAGE_IN_USE: STRINGS.imageGallery.deleteBlockedInUse },
  extrasFrom: (err) => {
    const chapters = (err.extras as { chapters?: unknown } | undefined)?.chapters;
    return Array.isArray(chapters) ? { chapters } : undefined;
  },
},
```

Ensure `STRINGS.imageGallery.deleteBlockedInUse` exists. It does (design doc audit confirmed).

**Step 4:** Run — skipped tests show as skipped; other tests pass.

#### Task 1.10.c: `snapshot.restore`

**Step 1:** Add tests:

```ts
import { SNAPSHOT_ERROR_CODES } from "@smudge/shared";

describe("SCOPES['snapshot.restore']", () => {
  it("CORRUPT_SNAPSHOT → restoreFailedCorrupt", () => {
    const err = new ApiRequestError("corrupt", 400, SNAPSHOT_ERROR_CODES.CORRUPT_SNAPSHOT);
    expect(resolveError(err, SCOPES["snapshot.restore"]).message).toBe(STRINGS.snapshots.restoreFailedCorrupt);
  });
  it("CROSS_PROJECT_IMAGE_REF → restoreFailedCrossProjectImage", () => {
    const err = new ApiRequestError("cross", 409, SNAPSHOT_ERROR_CODES.CROSS_PROJECT_IMAGE_REF);
    expect(resolveError(err, SCOPES["snapshot.restore"]).message).toBe(STRINGS.snapshots.restoreFailedCrossProjectImage);
  });
  it("404 → restoreFailedNotFound", () => {
    const err = new ApiRequestError("gone", 404, "NOT_FOUND");
    expect(resolveError(err, SCOPES["snapshot.restore"]).message).toBe(STRINGS.snapshots.restoreFailedNotFound);
  });
  it("NETWORK → restoreNetworkFailed + transient", () => {
    const err = new ApiRequestError("offline", 0, "NETWORK");
    const r = resolveError(err, SCOPES["snapshot.restore"]);
    expect(r.message).toBe(STRINGS.snapshots.restoreNetworkFailed);
    expect(r.transient).toBe(true);
  });
  it("2xx BAD_JSON → restoreResponseUnreadable + possiblyCommitted", () => {
    const err = new ApiRequestError("bad json", 200, "BAD_JSON");
    const r = resolveError(err, SCOPES["snapshot.restore"]);
    expect(r.message).toBe(STRINGS.snapshots.restoreResponseUnreadable);
    expect(r.possiblyCommitted).toBe(true);
  });
  it("500 → restoreFailed (fallback)", () => {
    const err = new ApiRequestError("oops", 500, "INTERNAL_ERROR");
    expect(resolveError(err, SCOPES["snapshot.restore"]).message).toBe(STRINGS.snapshots.restoreFailed);
  });
});
```

**Step 2:** Run — FAIL.

**Step 3:** Update `scopes.ts`:

```ts
"snapshot.restore": {
  fallback: STRINGS.snapshots.restoreFailed,
  network: STRINGS.snapshots.restoreNetworkFailed,
  committed: STRINGS.snapshots.restoreResponseUnreadable,
  byCode: {
    [SNAPSHOT_ERROR_CODES.CORRUPT_SNAPSHOT]:        STRINGS.snapshots.restoreFailedCorrupt,
    [SNAPSHOT_ERROR_CODES.CROSS_PROJECT_IMAGE_REF]: STRINGS.snapshots.restoreFailedCrossProjectImage,
  },
  byStatus: { 404: STRINGS.snapshots.restoreFailedNotFound },
},
```

Import `SNAPSHOT_ERROR_CODES` from `@smudge/shared`.

**Step 4:** Run — PASS.

#### Task 1.10.d: `snapshot.view`

Mirror of 1.10.c using `STRINGS.snapshots.view*` strings. Tests:

```ts
describe("SCOPES['snapshot.view']", () => {
  it("CORRUPT_SNAPSHOT → viewFailedCorrupt", ...);
  it("404 → viewFailedNotFound", ...);
  it("NETWORK → viewFailedNetwork + transient", ...);
  it("500 → viewFailed (fallback)", ...);
});
```

Then update `scopes.ts` with the corresponding entry. Run red → green.

#### Task 1.10.e: `findReplace.search`

**Step 1:** Add tests mirroring the cases in current `findReplaceErrors.ts:81-116`:
- MATCH_CAP_EXCEEDED → tooManyMatches
- REGEX_TIMEOUT → searchTimedOut
- CONTENT_TOO_LARGE → contentTooLarge
- INVALID_REGEX → invalidRegex
- Other 400 → invalidSearchRequest
- 413 → contentTooLarge
- 404 → searchProjectNotFound
- NETWORK → searchNetworkFailed + transient
- fallback → searchFailed

**Step 2:** Run — FAIL.

**Step 3:** Update `scopes.ts`:

```ts
"findReplace.search": {
  fallback: STRINGS.findReplace.searchFailed,
  network:  STRINGS.findReplace.searchNetworkFailed,
  byCode: {
    [SEARCH_ERROR_CODES.MATCH_CAP_EXCEEDED]: STRINGS.findReplace.tooManyMatches,
    [SEARCH_ERROR_CODES.REGEX_TIMEOUT]:      STRINGS.findReplace.searchTimedOut,
    [SEARCH_ERROR_CODES.CONTENT_TOO_LARGE]:  STRINGS.findReplace.contentTooLarge,
    [SEARCH_ERROR_CODES.INVALID_REGEX]:      STRINGS.findReplace.invalidRegex,
    VALIDATION_ERROR:                        STRINGS.findReplace.invalidSearchRequest,
  },
  byStatus: {
    413: STRINGS.findReplace.contentTooLarge,
    404: STRINGS.findReplace.searchProjectNotFound,
  },
},
```

Note: the current `findReplaceErrors.ts:93` uses `STRINGS.findReplace.invalidSearchRequest` as the fallback for all non-matching 400 codes — mirror this via `byCode.VALIDATION_ERROR`, and accept that a *truly* unknown 400 code would fall through to `searchFailed` (acceptable — the old ladder's "all other 400 codes → invalidSearchRequest" was a defensive bucket; the new mapper codifies it more narrowly).

Actually: the old ladder explicitly returned `invalidSearchRequest` for *any* 400, including unknown codes. Preserve that exact behavior by setting `byStatus: { 400: STRINGS.findReplace.invalidSearchRequest, 413: ..., 404: ... }` — but remember `byCode` wins over `byStatus`, so the four specific codes above still get their copy, and other 400 codes fall through to the 400 byStatus entry.

Update the scope entry accordingly.

**Step 4:** Run — PASS.

#### Task 1.10.f: `findReplace.replace`

Mirror 1.10.e with the replace-specific strings. Additionally includes:
- SCOPE_NOT_FOUND → replaceScopeNotFound (byCode)
- 404 (other) → replaceProjectNotFound (byStatus)
- 2xx BAD_JSON → replaceResponseUnreadable + possiblyCommitted (committed)
- NETWORK → replaceNetworkFailed + transient (network)

---

### Task 1.11: Public `mapApiError(err, scope: ApiErrorScope)` wrapper + ALL_SCOPES + cross-cutting coverage

**Step 1:** Add test:

```ts
import { mapApiError, ALL_SCOPES } from "./apiErrorMapper";

describe("mapApiError public API", () => {
  it("accepts a scope name and looks up the entry", () => {
    const err = new ApiRequestError("too large", 413, "PAYLOAD_TOO_LARGE");
    expect(mapApiError(err, "chapter.save").message).toBe(STRINGS.editor.saveFailedTooLarge);
  });
});

describe("cross-cutting rules apply to every scope", () => {
  it.each(ALL_SCOPES)("ABORTED is silent for %s", (scope) => {
    const err = new ApiRequestError("aborted", 0, "ABORTED");
    expect(mapApiError(err, scope).message).toBeNull();
  });
  it.each(ALL_SCOPES)("NETWORK flags transient for %s", (scope) => {
    const err = new ApiRequestError("offline", 0, "NETWORK");
    expect(mapApiError(err, scope).transient).toBe(true);
  });
  it.each(ALL_SCOPES)("2xx BAD_JSON flags possiblyCommitted for %s", (scope) => {
    const err = new ApiRequestError("bad", 200, "BAD_JSON");
    expect(mapApiError(err, scope).possiblyCommitted).toBe(true);
  });
  it.each(ALL_SCOPES)("non-ApiRequestError falls through to scope.fallback for %s", (scope) => {
    const r = mapApiError(new Error("wtf"), scope);
    expect(r.message).toBeTruthy();
    expect(r.possiblyCommitted).toBe(false);
    expect(r.transient).toBe(false);
  });
});
```

**Step 2:** Run — FAIL (`mapApiError` / `ALL_SCOPES` not exported).

**Step 3:** Implement in `apiErrorMapper.ts`:

```ts
import { SCOPES, type ApiErrorScope } from "./scopes";

export function mapApiError(err: unknown, scope: ApiErrorScope): MappedError {
  return resolveError(err, SCOPES[scope]);
}

// Runtime tuple of every scope, typed as the literal union. Safe because
// SCOPES: Record<ApiErrorScope, ScopeEntry> is enforced exhaustive by the
// compiler.
export const ALL_SCOPES = Object.keys(SCOPES) as ApiErrorScope[];
```

And re-export from `packages/client/src/errors/index.ts`:

```ts
export { mapApiError, ALL_SCOPES } from "./apiErrorMapper";
export type { MappedError, ScopeEntry } from "./apiErrorMapper";
export type { ApiErrorScope } from "./scopes";
```

**Step 4:** Run — PASS.

---

### Task 1.12: Defensive — programmer-error non-ApiRequestError logging (optional; Minor from pushback)

Consider logging a dev-warning when `err` is not an ApiRequestError. This is optional; if included:

- Use `console.warn("[mapApiError] unexpected non-ApiRequestError; falling back to scope.fallback", err)` behind an `import.meta.env.DEV` guard.
- Test must spy-and-suppress to keep the zero-warnings rule.

If omitted (recommended for YAGNI), skip this task.

---

### Task 1.13: `make all` + commit 1

**Step 1:** Run the full gate: `make all`
Expected: green (lint, format, typecheck, coverage floors, e2e).

If coverage drops below floor on the new module (unlikely — resolver is 100%-testable), add missing test cases until green.

**Step 2:** Commit:

```bash
git add packages/client/src/errors/ packages/client/src/strings.ts
git commit -m "$(cat <<'EOF'
feat(errors): add mapApiError + scope registry (unused)

Adds packages/client/src/errors/ with a declarative scope registry,
a pure resolver for cross-cutting rules (ABORTED silent, 2xx BAD_JSON
possiblyCommitted, NETWORK transient), and comprehensive unit tests.
No call sites are migrated yet — the module is fully tested but unused.
Also adds placeholder generic strings (uploadFailedGeneric etc.) needed
by scope fallbacks. Phase 4b.3 commit 1 of 5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Commit 2: Transport change + `ImageGallery.handleDelete` migration (atomic)

**Files:**
- Modify: `packages/shared/src/types.ts` (widen `ApiError`)
- Modify: `packages/client/src/api/client.ts` (add `extras`; remove DELETE special case)
- Modify: `packages/client/src/components/ImageGallery.tsx` (migrate `handleDelete`)
- Modify: `packages/client/src/__tests__/api-client.test.ts` (new throw shape)
- Modify: `packages/client/src/__tests__/ImageGallery.test.tsx` (new mock shape)
- Modify: `packages/client/src/errors/apiErrorMapper.test.ts` (unskip extras tests)

---

### Task 2.1: Widen `ApiError` in `@smudge/shared`

**Step 1:** Add failing test in `packages/shared/src/types.test.ts` (create if missing):

```ts
import type { ApiError } from "./types";

describe("ApiError", () => {
  it("accepts arbitrary extras alongside code and message", () => {
    const envelope: ApiError = {
      error: {
        code: "IMAGE_IN_USE",
        message: "Image is referenced",
        chapters: [{ id: "c1", title: "Chapter 1" }],
        details: "extra",
      },
    };
    expect(envelope.error.code).toBe("IMAGE_IN_USE");
    expect(envelope.error.chapters).toBeDefined();
  });
});
```

**Step 2:** Run — FAIL (type error; `chapters` not assignable).

**Step 3:** Edit `packages/shared/src/types.ts:55-60`:

```ts
export interface ApiError {
  error: {
    code: string;
    message: string;
    [key: string]: unknown;
  };
}
```

**Step 4:** Run — PASS.

---

### Task 2.2: Widen `ApiRequestError` with `extras`

**Step 1:** Add failing tests to `packages/client/src/__tests__/api-client.test.ts`:

```ts
it("carries envelope extras on ApiRequestError when present", async () => {
  // Server returns 409 with chapters array in the envelope
  global.fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        error: {
          code: "IMAGE_IN_USE",
          message: "in use",
          chapters: [{ id: "c1", title: "Chapter 1" }],
        },
      }),
      { status: 409 },
    ),
  );

  // (Must call a method that goes through apiFetch — any GET works.)
  // Use apiFetch indirectly via api.projects.get; we need it to throw
  // and inspect err.extras:
  let caught: unknown;
  try {
    await api.projects.get("some-slug");
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(ApiRequestError);
  expect((caught as ApiRequestError).extras).toEqual({
    chapters: [{ id: "c1", title: "Chapter 1" }],
  });
});

it("ApiRequestError.extras is undefined when envelope has only code and message", async () => {
  global.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "gone" } }), {
      status: 404,
    }),
  );
  let caught: ApiRequestError | undefined;
  try {
    await api.projects.get("slug");
  } catch (err) {
    caught = err as ApiRequestError;
  }
  expect(caught?.extras).toBeUndefined();
});
```

**Step 2:** Run — FAIL.

**Step 3:** Edit `packages/client/src/api/client.ts`:

```ts
export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly extras?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}
```

In `apiFetch` (around line 62-77), after capturing `code`:

```ts
try {
  const body = (await res.json()) as ApiError;
  message = body.error?.message ?? message;
  code = body.error?.code;
  const { code: _c, message: _m, ...rest } = body.error ?? ({} as ApiError["error"]);
  const extras = Object.keys(rest).length > 0 ? (rest as Record<string, unknown>) : undefined;
  throw new ApiRequestError(message, res.status, code, extras);
} catch (err: unknown) {
  if (err instanceof ApiRequestError) throw err;
  if (err instanceof DOMException && err.name === "AbortError") {
    throw classifyFetchError(err);
  }
}
throw new ApiRequestError(message, res.status, code);
```

Structure the block so `extras` flows to the throw, and the nested try/catch distinguishes "JSON parse failed" (throws outer `ApiRequestError` without extras) from "body parsed fine, now throw with extras."

**Step 4:** Run — PASS.

---

### Task 2.3: Unskip the extras tests in `apiErrorMapper.test.ts`

**Step 1:** Change the `describe.skip(...)` markers added in Task 1.8 and Task 1.10.b back to `describe(...)`.

**Step 2:** Run — PASS (the 4-arg `ApiRequestError` constructor now exists).

---

### Task 2.4: Remove the `deleteImage` DELETE special case

**Step 1:** Add failing tests to `api-client.test.ts`:

```ts
describe("api.images.delete (unified throw contract)", () => {
  it("throws ApiRequestError with code IMAGE_IN_USE and chapters in extras on 409", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "IMAGE_IN_USE",
            message: "in use",
            chapters: [{ id: "c1", title: "Chapter 1" }],
          },
        }),
        { status: 409 },
      ),
    );
    await expect(api.images.delete("img-1")).rejects.toMatchObject({
      code: "IMAGE_IN_USE",
      status: 409,
      extras: { chapters: [{ id: "c1", title: "Chapter 1" }] },
    });
  });

  it("returns { deleted: true } on 200", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ deleted: true }), { status: 200 }),
    );
    expect(await api.images.delete("img-1")).toEqual({ deleted: true });
  });
});
```

Also **delete or update** the existing test at `api-client.test.ts:378` and `397` that asserted the old 409-return shape.

**Step 2:** Run — FAIL.

**Step 3:** Edit `packages/client/src/api/client.ts:263-304`. Replace the entire method with:

```ts
delete: (id: string) =>
  apiFetch<{ deleted: boolean }>(`/images/${id}`, { method: "DELETE" }),
```

**Step 4:** Run the api-client test — PASS.

---

### Task 2.5: Migrate `ImageGallery.handleDelete` to the new throw-based contract

**Step 1:** Update the test `ImageGallery.test.tsx:391-408` (and related) — change `mockResolvedValue({ deleted: true })` to match the new return type and add:

```ts
it("surfaces deleteBlockedInUse with chapter list when server returns 409", async () => {
  vi.mocked(api.images.delete).mockRejectedValue(
    new ApiRequestError("in use", 409, "IMAGE_IN_USE", {
      chapters: [{ id: "c1", title: "Chapter One" }],
    }),
  );
  // ... render, click delete, confirm
  expect(announceSpy).toHaveBeenCalledWith(
    STRINGS.imageGallery.deleteBlockedInUse,
    // or whatever the component surfaces — adapt to the existing assertion shape
  );
});
```

**Step 2:** Run — FAIL (current handler still uses the old shape).

**Step 3:** Edit `packages/client/src/components/ImageGallery.tsx:190-219` (`handleDelete`):

```ts
async function handleDelete() {
  if (!selectedImage) return;
  try {
    await api.images.delete(selectedImage.id);
    announce(S.deleteSuccess(selectedImage.filename));
    setSelectedImage(null);
    setConfirmingDelete(false);
    incrementRefreshKey();
  } catch (err) {
    const { message, extras } = mapApiError(err, "image.delete");
    if (!message) return;                                // defensive (ABORTED)
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

Add import: `import { mapApiError } from "../errors";`.

**Step 4:** Run — PASS.

---

### Task 2.6: `make all` + commit 2

**Step 1:** Run: `make all` — expect green.

**Step 2:** Commit:

```bash
git add packages/shared/src/types.ts \
        packages/client/src/api/client.ts \
        packages/client/src/components/ImageGallery.tsx \
        packages/client/src/__tests__/api-client.test.ts \
        packages/client/src/__tests__/ImageGallery.test.tsx \
        packages/client/src/errors/apiErrorMapper.test.ts
git commit -m "$(cat <<'EOF'
feat(api): unify error transport; migrate image delete to new contract

Widens @smudge/shared ApiError with an index signature so the envelope
type matches what the server has always emitted (e.g. `chapters` on
IMAGE_IN_USE 409). Adds `extras` to ApiRequestError, captured from the
envelope in apiFetch. Removes the DELETE special case in api.images.delete
so every non-2xx throws uniformly. Migrates ImageGallery.handleDelete to
the new throw-based contract via mapApiError, preserving the existing
"in use by chapters" dialog. Phase 4b.3 commit 2 of 5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Commit 3: Centralized-already sites migration

**Files:**
- Delete: `packages/client/src/utils/findReplaceErrors.ts`
- Delete: `packages/client/src/utils/findReplaceErrors.test.ts` (if exists)
- Modify: `packages/client/src/hooks/useFindReplaceState.ts`
- Modify: `packages/client/src/pages/EditorPage.tsx` (replace handleReplaceOne / executeReplace error paths)
- Modify: `packages/client/src/hooks/useSnapshotState.ts` (drop failure-reason enums; carry ApiRequestError on ok:false)
- Modify: `packages/client/src/pages/EditorPage.tsx` (handleRestoreSnapshot, handleSnapshotView branches)
- Modify: corresponding test files

This is the highest-risk commit — it touches the snapshot-restore path which the 2026-04-20 review identified as Critical. Run the three regression tests continually.

---

### Task 3.1: Migrate `useFindReplaceState` off `findReplaceErrors.ts`

**Step 1:** Read `packages/client/src/hooks/useFindReplaceState.ts` around line 110-160 (the search catch block). The call is `mapSearchErrorToMessage(err)`.

**Step 2:** Update existing tests in `useFindReplaceState.test.ts` — should still pass because output strings are unchanged.

**Step 3:** Edit the catch block:

```ts
} catch (err) {
  if (!seq.isStale()) {
    const { message } = mapApiError(err, "findReplace.search");
    if (message) setError(message);
  }
}
```

Add import: `import { mapApiError } from "../errors";`.

**Step 4:** Run — expect PASS (behavior unchanged).

---

### Task 3.2: Migrate `EditorPage.handleReplaceOne` and `executeReplace`

**Step 1:** Locate `EditorPage.tsx:878` (handleReplaceOne) and `:1105` (executeReplace). Both call `mapReplaceErrorToMessage(err)`.

**Step 2:** Update each call:

```ts
const { message } = mapApiError(err, "findReplace.replace");
if (message) setActionError(message);  // or whatever the local error setter is
```

**Step 3:** Run the EditorPage tests — PASS.

---

### Task 3.3: Delete `findReplaceErrors.ts`

**Step 1:** Verify no remaining imports:

```bash
grep -rn "findReplaceErrors" packages/client/src/
```

Expected: only the file itself and possibly its test file.

**Step 2:** Delete `packages/client/src/utils/findReplaceErrors.ts` and `packages/client/src/utils/findReplaceErrors.test.ts` if present.

**Step 3:** Run: `npx vitest run` — all tests PASS. `npx tsc -p packages/client` — clean.

---

### Task 3.4: Refactor `useSnapshotState` failure arm — `restoreSnapshot`

**Step 1:** Update the type:

```ts
// Before:
export type RestoreFailureReason = ...;
export interface RestoreResult {
  ok: boolean;
  reason?: RestoreFailureReason;
  staleChapterSwitch?: boolean;
  restoredChapterId?: string;
}

// After:
export type RestoreResult =
  | { ok: true; staleChapterSwitch?: boolean; restoredChapterId?: string }
  | { ok: false; error: ApiRequestError };
```

**Step 2:** In the `restoreSnapshot` implementation, every `return { ok: false, reason: "..." }` becomes `return { ok: false, error: err }` where `err` is the caught `ApiRequestError`. For cases where the hook previously synthesized a reason without an underlying error (e.g. stale sequence), these stay on the success arm (`{ ok: true, ... }`) or become explicit — no reason-less failures.

**Step 3:** Update `EditorPage.handleRestoreSnapshot` (around `EditorPage.tsx:460-598`):

```ts
const result = await snapshots.restoreSnapshot(id);
if (result.ok) {
  // Handle staleChapterSwitch / restoredChapterId exactly as today.
  return;
}
const { message, possiblyCommitted, transient } = mapApiError(
  result.error,
  "snapshot.restore",
);
if (!message) return;
if (possiblyCommitted) {
  setEditorLockedMessage(message);
  return;
}
if (transient) {
  setActionError(message);
  return;
}
setActionError(message);
exitSnapshotView();
```

**Step 4:** Delete the `RestoreFailureReason` export from `useSnapshotState.ts`. Update any other consumers (grep for `RestoreFailureReason` across packages/client/src/).

**Step 5:** Run the three 2026-04-20 Critical regression tests. Locate them (they likely live in `EditorPage.test.tsx` or `useSnapshotState.test.ts`). All three must PASS:
- stale `expectedChapterId` skip
- 2xx BAD_JSON on restore
- 2xx BAD_JSON on replace (already covered in task 3.2)

Run: `npx vitest run packages/client/src/__tests__/EditorPage.test.tsx packages/client/src/__tests__/useSnapshotState.test.ts`

Expected: PASS.

---

### Task 3.5: Refactor `useSnapshotState` failure arm — `viewSnapshot`

Same shape as 3.4 but for view (`ViewFailureReason` → carried `ApiRequestError`). Preserve `ViewSupersededReason` and the `superseded` field on the success arm exactly as it is today (commits 8ae123b, a2d0f09 depend on this).

**Step 3:** Update `EditorPage.handleSnapshotView` similarly:

```ts
const result = await snapshots.viewSnapshot(...);
if (result.ok) {
  // Handle superseded: "chapter" → show cross-chapter banner, "sameChapterNewer" → silent
  return;
}
const { message, possiblyCommitted, transient } = mapApiError(result.error, "snapshot.view");
// ... same branching shape as restoreSnapshot
```

Run all snapshot tests — PASS.

---

### Task 3.6: `make all` + commit 3

**Step 1:** Run: `make all` — green.

**Step 2:** Commit:

```bash
git add packages/client/src/hooks/useFindReplaceState.ts \
        packages/client/src/hooks/useSnapshotState.ts \
        packages/client/src/pages/EditorPage.tsx \
        packages/client/src/utils/ \
        packages/client/src/__tests__/
git commit -m "$(cat <<'EOF'
refactor(errors): migrate findReplace + snapshot off local mappers

Deletes findReplaceErrors.ts; migrates useFindReplaceState and EditorPage's
handleReplaceOne / executeReplace to mapApiError('findReplace.*').
Collapses RestoreFailureReason / ViewFailureReason enums in useSnapshotState;
the failure arm now carries ApiRequestError and EditorPage branches on
MappedError fields (possiblyCommitted, transient, message). Success-arm
staleChapterSwitch / restoredChapterId / superseded metadata preserved
exactly — recent commits 8ae123b, a2d0f09, 894f0ac depend on it.
Three 2026-04-20 Critical regressions (stale expectedChapterId skip,
2xx BAD_JSON on restore, 2xx BAD_JSON on replace) stay green.
Phase 4b.3 commit 3 of 5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Commit 4: Generic-fallback sites migration

**Files (one subtask per file):**
- Modify: `packages/client/src/pages/HomePage.tsx`
- Modify: `packages/client/src/hooks/useProjectEditor.ts`
- Modify: `packages/client/src/hooks/useTrashManager.ts`
- Modify: `packages/client/src/components/DashboardView.tsx`
- Modify: `packages/client/src/pages/EditorPage.tsx` (remaining catches)
- Modify: `packages/client/src/components/SnapshotPanel.tsx`
- Modify: `packages/client/src/hooks/useTimezoneDetection.ts`
- Modify: `packages/client/src/components/ProjectSettingsDialog.tsx`
- Modify: corresponding test files

Each subtask follows the same pattern: identify the catch block, replace inline mapping with `mapApiError(err, '<scope>')`, update tests, verify green.

**Discipline note — one site at a time.** Tasks 4.2, 4.3, 4.6, and 4.7 each list multiple call sites. **Do not batch.** For every site, run a full red/green cycle against that site's existing test: write the failing test first (asserts the new scope's fallback or code-specific copy surfaces), run FAIL, migrate the single site, run PASS. Commit all migrations in this commit together at the end, but execute one red/green per site. Batching skips the "RED" step — the exact failure mode CLAUDE.md §Testing Philosophy warns against for mechanical migrations.

**Zero-warnings reminder.** Several sites in this commit currently `console.warn(err)` inside the catch block (HomePage lines 24/45/58, useProjectEditor throughout). Preserve the warn calls but **every test that exercises the error path must spy-and-suppress** per CLAUDE.md §Testing Philosophy — otherwise `make all` flags noisy test output.

---

### Task 4.1: Migrate `HomePage.tsx`

**Step 1:** Edit three catch blocks (load, create, delete). Example for `HomePage.tsx:24`:

```ts
} catch (err) {
  console.warn("Failed to load projects:", err);
  if (!cancelled) {
    const { message } = mapApiError(err, "project.load");
    if (message) setError(message);
  }
}
```

Repeat for create (line 45) and delete (line 58).

**Step 2:** Update `HomePage.test.tsx`: any test that deliberately triggers an error and checks the surfaced message must now spy-and-suppress `console.warn` (zero-warnings rule). Existing tests should still pass because the emitted string is the same.

**Step 3:** Run — PASS.

---

### Task 4.2: Migrate `useProjectEditor.ts`

Ten catch blocks at lines 152, 378, 412, 478, 548, 560, 600, 632, 716, 744. Apply the same pattern to each — one scope per catch:

- 152 → `project.load`
- 378 → `chapter.create`
- 412, 478, 548 → `chapter.load`
- 560 → `chapter.delete`
- 600 → `chapter.reorder`
- 632 → `project.updateTitle`
- 716 → `chapter.updateStatus`
- 744 → `chapter.rename`

Do each as a red-green cycle: write a test that asserts `mapApiError` is called with the right scope (or asserts the UI copy matches the scope's fallback), run, migrate, verify.

---

### Task 4.3: Migrate `useTrashManager.ts`

Two catch blocks: line 26 (`trash.load`), line 53 (`trash.restoreChapter`). Same pattern.

---

### Task 4.4: Migrate `DashboardView.tsx`

Two call sites:
- The dashboard `.catch` (line 40-50) → `dashboard.load`.
- The velocity `.catch` (line 61) → `project.velocity`.

Each is one catch replacement + matching test update.

---

### Task 4.5: Migrate remaining `EditorPage.tsx` catches

Three sites:
- Line 1199 → `chapterStatus.fetch`
- Line 1441 → `chapter.load`
- Line 1497 → `project.load`

---

### Task 4.6: Migrate `SnapshotPanel.tsx`

Three sites:
- Line 121 → `snapshot.list`
- Line 255 → `snapshot.create`
- Line 272 → `snapshot.delete`

These may have their own copy expectations; update the scope entries in `scopes.ts` if the existing inline copy is more specific than the generic fallback (e.g., snapshot.create may have "Unable to create snapshot — the content is too large" for 413).

---

### Task 4.7: Migrate `useTimezoneDetection.ts` + `ProjectSettingsDialog.tsx`

- `useTimezoneDetection.ts:5` → `settings.get`
- `useTimezoneDetection.ts:8` → `settings.update`
- `ProjectSettingsDialog.tsx:192` → `settings.update`

Note: `useTimezoneDetection` today may swallow errors silently (first-launch detection should be non-fatal). Keep that behavior — call `mapApiError`, log for diagnostics, but do not surface to UI.

---

### Task 4.8: Audit — grep for stragglers

**Step 1:** From the repo root:

```bash
grep -rn --include="*.ts" --include="*.tsx" \
  -e "err instanceof ApiRequestError" \
  -e "err.message" \
  -e "Unknown error" \
  packages/client/src/ | grep -v __tests__ | grep -v ".test."
```

**Step 2:** Every hit must be one of:
- A pattern replaced by the mapper (and should be gone — if it appears, the migration missed it).
- A legitimate diagnostic log (preserve).
- Documented silent-error semantics (preserve, comment why).

**Step 3:** If any straggler is found, add a task to migrate it before committing.

---

### Task 4.9: `make all` + commit 4

**Step 1:** Run: `make all` — green.

**Step 2:** Commit:

```bash
git add packages/client/src/pages/HomePage.tsx \
        packages/client/src/hooks/useProjectEditor.ts \
        packages/client/src/hooks/useTrashManager.ts \
        packages/client/src/components/DashboardView.tsx \
        packages/client/src/pages/EditorPage.tsx \
        packages/client/src/components/SnapshotPanel.tsx \
        packages/client/src/hooks/useTimezoneDetection.ts \
        packages/client/src/components/ProjectSettingsDialog.tsx \
        packages/client/src/__tests__/
git commit -m "$(cat <<'EOF'
refactor(errors): migrate generic-fallback call sites to mapApiError

Migrates every generic try/catch in the client that previously used
STRINGS.error.* without code discrimination. Each call site now routes
through mapApiError with an explicit scope, so a 413 "too large" and
a 500 no longer surface the same fallback copy. Covers HomePage,
useProjectEditor (10 sites), useTrashManager, DashboardView (+ velocity),
EditorPage misc catches, SnapshotPanel (list/create/delete),
useTimezoneDetection, and ProjectSettingsDialog. Phase 4b.3 commit 4 of 5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Commit 5: Remaining raw-message leaks + CLAUDE.md

**Files:**
- Modify: `packages/client/src/components/ImageGallery.tsx` (handleUpload, handleSave)
- Modify: `packages/client/src/components/Editor.tsx` (image upload from editor)
- Modify: `packages/client/src/components/ExportDialog.tsx`
- Modify: `packages/client/src/strings.ts` (remove templated `uploadFailed(reason)` / `deleteFailed(reason)` after callers stop using them; confirm `uploadFailedGeneric` / `deleteFailedGeneric` added in commit 1 are referenced)
- Modify: `CLAUDE.md`

---

### Task 5.1: Migrate `ImageGallery.handleUpload` (line 128-131)

**Step 1:** Update test to expect the generic upload-failed string:

```ts
it("surfaces uploadFailedGeneric on upload failure", async () => {
  vi.mocked(api.images.upload).mockRejectedValue(new ApiRequestError("oops", 500));
  // ... trigger upload
  expect(announceSpy).toHaveBeenCalledWith(STRINGS.imageGallery.uploadFailedGeneric);
});
```

**Step 2:** Run — FAIL.

**Step 3:** Replace the catch block:

```ts
.catch((err: unknown) => {
  const { message } = mapApiError(err, "image.upload");
  if (message) announce(message);
});
```

**Step 4:** Run — PASS.

---

### Task 5.2: Migrate `ImageGallery.handleSave` (line 162-165)

Currently already uses a fixed string (`S.saveFailed`) — migrate to `mapApiError(err, "image.updateMetadata")` for consistency and to get code-discriminated copy if we later add codes. Minor.

---

### Task 5.3: Migrate `Editor.tsx` image upload (line 260)

**Step 1:** Update the catch to call `mapApiError(err, "image.upload")`.

**Step 2:** Run existing Editor tests — PASS.

---

### Task 5.4: Migrate `ExportDialog.tsx` (line 150)

**Step 1:** Test update: assert `STRINGS.export.errorFailed` surfaces for all error types.

**Step 2:** Replace:

```ts
} catch (err) {
  if (controller.signal.aborted) return;
  const { message } = mapApiError(err, "export.run");
  if (message) setError(message);
}
```

---

### Task 5.5: Remove dead templated strings from `strings.ts`

**Step 1:** Verify no remaining callers:

```bash
grep -rn "uploadFailed(" packages/client/src/ | grep -v strings.ts | grep -v ".test."
grep -rn "deleteFailed(" packages/client/src/ | grep -v strings.ts | grep -v ".test."
```

**Step 2:** Delete the templated function definitions:

```ts
// Before (in strings.ts):
uploadFailed: (reason: string) => `Upload failed: ${reason}`,
deleteFailed: (reason: string) => `Delete failed: ${reason}`,

// After: delete these lines. Keep uploadFailedGeneric and deleteFailedGeneric.
```

**Step 3:** Run — PASS.

---

### Task 5.6: CLAUDE.md edits

**Step 1:** Edit `CLAUDE.md` §Key Architecture Decisions. Insert after the §Save-pipeline invariants block (look for the end of the numbered list and the "For mutation-via-server flows..." paragraph):

```markdown
**Unified API error mapping.** All client code that surfaces a user-visible
message from an API error must route through `mapApiError(err, scope)` in
`packages/client/src/errors/`. The mapper returns `{ message,
possiblyCommitted, transient, extras? }`; it is the single owner of
code/status-to-string translation and of the cross-cutting rules (ABORTED
is silent, 2xx BAD_JSON is `possiblyCommitted`, NETWORK is `transient`).
Raw `err.message` must never reach the UI. New API surfaces add a scope
entry to `scopes.ts`; they do not write ad-hoc ladders at call sites.
This invariant will be enforced by ESLint in Phase 4b.4; until then, it
is enforced by review.
```

**Step 2:** Edit §Target Project Structure. Find the `client/` bullet and add `errors/`:

```
  client/       # React SPA, components/, hooks/, pages/, api/, errors/, strings.ts
```

**Step 3:** Run: `make all` — green.

---

### Task 5.7: Commit 5

```bash
git add packages/client/src/components/ImageGallery.tsx \
        packages/client/src/components/Editor.tsx \
        packages/client/src/components/ExportDialog.tsx \
        packages/client/src/strings.ts \
        CLAUDE.md \
        packages/client/src/__tests__/
git commit -m "$(cat <<'EOF'
refactor(errors): kill raw err.message leaks; update CLAUDE.md

Migrates ImageGallery.handleUpload, ImageGallery.handleSave, Editor.tsx
image upload, and ExportDialog to mapApiError. Removes the templated
uploadFailed(reason)/deleteFailed(reason) helpers from strings.ts now
that no callers interpolate server text. Adds the "Unified API error
mapping" invariant to CLAUDE.md §Key Architecture Decisions and lists
errors/ under §Target Project Structure so future phases route through
the mapper by default. Phase 4b.3 commit 5 of 5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final Gate: PR prep

**Step 1:** Run `make all` one more time from a clean state:

```bash
make clean || true
make all
```

Expected: green.

**Step 2:** Verify scope completeness:

```bash
# Every api call has a catch that routes through mapApiError, OR has
# documented silent-error semantics.
grep -rn --include="*.ts" --include="*.tsx" "await api\." packages/client/src/ \
  | grep -v __tests__ | grep -v ".test."
```

Walk each hit; confirm either (a) no catch (caller lets the error propagate upward, handled at a higher site), (b) catch routes through `mapApiError`, or (c) catch is documented silent.

**Step 3:** Confirm the DoD from the design doc:

- [ ] Only `packages/client/src/errors/apiErrorMapper.ts` owns API-error → UI-string translation. `findReplaceErrors.ts` is deleted; `useSnapshotState.ts` no longer classifies *errors* (success-arm supersede metadata preserved untouched).
- [ ] No call site in `packages/client/src/` contains inline error-to-text mapping.
- [ ] All strings emitted by the mapper come from `packages/client/src/strings.ts`.
- [ ] Transport unified; `ImageGallery.handleDelete` migration landed atomically with transport change.
- [ ] Three 2026-04-20 regression tests pass.
- [ ] `make all` green.
- [ ] Zero noisy console.warn/error in test output.
- [ ] CLAUDE.md updated (§Key Architecture Decisions + §Target Project Structure).
- [ ] No user-visible behavior change.

**Step 4:** Open the PR per CLAUDE.md §Pull Request Scope. Body references Phase 4b.3 and this plan. Description notes the atomic transport-change + ImageGallery pairing (commit 2) and the preserved success-arm supersede metadata (commit 3).

---

## Open Items (resolve during implementation, not blocking the plan)

1. **`STRINGS.error.possiblyCommitted` draft copy.** The design proposes a generic fallback but every scope that realistically hits 2xx BAD_JSON (snapshot.restore, findReplace.replace, chapter.save) will likely want custom copy. Decide during commit 1 whether the generic is reachable. If not, drop it.
2. **`chapter.save` `committed` override.** Does `chapter.save` need `STRINGS.editor.saveResponseUnreadable` (new string) or does the existing lock-banner flow cover it? Confirm with the save-pipeline tests in commit 1, before the DoD is closed.
3. **`ALL_SCOPES` typed-tuple approach.** Current plan uses `Object.keys(SCOPES) as ApiErrorScope[]`. Alternative: hand-maintained tuple with `satisfies` clause. Plan chose the runtime approach; revisit if lint flags the cast.
