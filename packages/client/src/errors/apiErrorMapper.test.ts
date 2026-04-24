import { describe, it, expect } from "vitest";
import type { MappedError } from "./apiErrorMapper";
import { resolveError, mapApiError, ALL_SCOPES } from "./apiErrorMapper";
import { ApiRequestError } from "../api/client";
import { SCOPES, type ApiErrorScope } from "./scopes";
import { STRINGS } from "../strings";
import { SNAPSHOT_ERROR_CODES, SEARCH_ERROR_CODES } from "@smudge/shared";
import * as errorsBarrel from "./index";

// Smoke-test the barrel so its re-exports have coverage and any typo in
// index.ts surfaces immediately rather than when commit 2 starts importing it.
describe("errors/index barrel re-exports", () => {
  it("exposes the expected public API", () => {
    expect(typeof errorsBarrel.mapApiError).toBe("function");
    expect(Array.isArray(errorsBarrel.ALL_SCOPES)).toBe(true);
  });
});

describe("MappedError shape", () => {
  it("has message, possiblyCommitted, transient, optional extras", () => {
    const m: MappedError = { message: null, possiblyCommitted: false, transient: false };
    expect(m.message).toBeNull();
    expect(m.possiblyCommitted).toBe(false);
    expect(m.transient).toBe(false);
  });
});

const testScope = { fallback: "test-fallback" } as const;

describe("mapApiError — fallback-only resolution", () => {
  it("returns fallback for non-ApiRequestError", () => {
    const result = resolveError(new Error("random"), testScope);
    expect(result).toEqual({
      message: "test-fallback",
      possiblyCommitted: false,
      transient: false,
    });
  });
  it("returns fallback when code and status match nothing in the scope", () => {
    const err = new ApiRequestError("oops", 500, "INTERNAL_ERROR");
    const result = resolveError(err, testScope);
    expect(result).toEqual({
      message: "test-fallback",
      possiblyCommitted: false,
      transient: false,
    });
  });
});

describe("mapApiError — ABORTED", () => {
  it("returns null message for ABORTED", () => {
    const err = new ApiRequestError("aborted", 0, "ABORTED");
    const result = resolveError(err, testScope);
    expect(result.message).toBeNull();
    expect(result.possiblyCommitted).toBe(false);
    expect(result.transient).toBe(false);
  });
});

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
  // S7 (2026-04-23 review): a scope without committed: copy does NOT
  // flag possiblyCommitted. The scope hasn't opted into the committed
  // contract, and setting possiblyCommitted: true would be misleading
  // for GET-only scopes (reads don't commit server state).
  it("does NOT flag possiblyCommitted when scope has no committed override", () => {
    const err = new ApiRequestError("bad json", 201, "BAD_JSON");
    const result = resolveError(err, testScope);
    expect(result).toEqual({
      message: "test-fallback",
      possiblyCommitted: false,
      transient: false,
    });
  });
  it("does NOT trigger possiblyCommitted for BAD_JSON on non-2xx (defensive)", () => {
    const err = new ApiRequestError("bad json", 500, "BAD_JSON");
    const result = resolveError(err, scopeWithCommitted);
    expect(result.possiblyCommitted).toBe(false);
  });
});

const scopeWithNetwork = { fallback: "fallback", network: "check your connection" } as const;

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

const scopeWithByCode = {
  fallback: "fallback",
  byCode: { VALIDATION_ERROR: "validation failed", INVALID_REGEX: "invalid regex" },
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
  it("skips byCode lookup when err.code is undefined", () => {
    // ApiRequestError.code is optional (status-only error envelope) — ensure
    // the ternary short-circuits rather than calling scope.byCode[undefined].
    const err = new ApiRequestError("no code", 400);
    const result = resolveError(err, scopeWithByCode);
    expect(result.message).toBe("fallback");
  });
});

const scopeWithByStatus = {
  fallback: "fallback",
  byStatus: { 413: "too large", 404: "not found" },
} as const;
const scopeWithBoth = {
  fallback: "fallback",
  byCode: { VALIDATION_ERROR: "validation failed" },
  byStatus: { 400: "bad request" },
} as const;

describe("mapApiError — byStatus", () => {
  it("returns scope.byStatus[status] when present", () => {
    const err = new ApiRequestError("too large", 413, "PAYLOAD_TOO_LARGE");
    expect(resolveError(err, scopeWithByStatus).message).toBe("too large");
  });
  it("byCode beats byStatus", () => {
    const err = new ApiRequestError("bad", 400, "VALIDATION_ERROR");
    expect(resolveError(err, scopeWithBoth).message).toBe("validation failed");
  });
  it("byStatus applies when byCode does not match", () => {
    const err = new ApiRequestError("bad", 400, "OTHER_CODE");
    expect(resolveError(err, scopeWithBoth).message).toBe("bad request");
  });
  it("invokes extrasFrom on byStatus match", () => {
    // Exercises the `extras: scope.extrasFrom?.(err)` expression inside the
    // byStatus branch — no registered scope wires both at once, so we cover
    // it with a test-local scope to keep the registry entries faithful.
    const extrasFromSpy = (err: ApiRequestError): Record<string, unknown> | undefined => ({
      status: err.status,
    });
    const scope = {
      fallback: "fallback",
      byStatus: { 413: "too large" },
      extrasFrom: extrasFromSpy,
    } as const;
    const err = new ApiRequestError("big", 413, "PAYLOAD_TOO_LARGE");
    expect(resolveError(err, scope).extras).toEqual({ status: 413 });
  });
});

const scopeWithExtras = {
  fallback: "fallback",
  byCode: { IMAGE_IN_USE: "in use" },
  extrasFrom: (err: ApiRequestError) => {
    const chapters = (err.extras as { chapters?: unknown } | undefined)?.chapters;
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
    const err = new ApiRequestError("bad", 400, "VALIDATION_ERROR", { something: "else" });
    const result = resolveError(err, scopeWithByCode);
    expect(result.extras).toBeUndefined();
  });
});

describe("SCOPES — chapter.save", () => {
  const scope = SCOPES["chapter.save"];
  it("413 → saveFailedTooLarge", () => {
    const err = new ApiRequestError("too large", 413, "PAYLOAD_TOO_LARGE");
    expect(resolveError(err, scope).message).toBe(STRINGS.editor.saveFailedTooLarge);
  });
  it("VALIDATION_ERROR → saveFailedInvalid", () => {
    const err = new ApiRequestError("bad", 400, "VALIDATION_ERROR");
    expect(resolveError(err, scope).message).toBe(STRINGS.editor.saveFailedInvalid);
  });
  it("500 → saveFailed (fallback)", () => {
    const err = new ApiRequestError("boom", 500, "INTERNAL_ERROR");
    expect(resolveError(err, scope).message).toBe(STRINGS.editor.saveFailed);
  });
});

describe("I4 — 2xx BAD_JSON on mutation scopes sets possiblyCommitted=true", () => {
  // Each mutation scope must surface the ambiguous-commit UX on 2xx
  // BAD_JSON. Missing this routes the user through the normal error
  // fallback and invites a retry after the server already committed.
  const mutationScopes: ApiErrorScope[] = [
    "chapter.save",
    "chapter.delete",
    "chapter.rename",
    "project.create",
    "project.delete",
    "image.upload",
    "image.delete",
    "image.updateMetadata",
    "snapshot.create",
    "snapshot.delete",
    "settings.update",
    "trash.restoreChapter",
  ];
  it.each(mutationScopes)("%s marks 2xx BAD_JSON possiblyCommitted", (scope) => {
    const err = new ApiRequestError("bad json", 200, "BAD_JSON");
    const result = mapApiError(err, scope);
    expect(result.possiblyCommitted).toBe(true);
    expect(result.message).not.toBeNull();
  });
});

describe("SCOPES — project.create", () => {
  const scope = SCOPES["project.create"];
  it("PROJECT_TITLE_EXISTS → projectTitleExists copy (I12)", () => {
    const err = new ApiRequestError("exists", 400, "PROJECT_TITLE_EXISTS");
    expect(resolveError(err, scope).message).toBe(STRINGS.error.projectTitleExists);
  });
  it("500 → createFailed (fallback)", () => {
    const err = new ApiRequestError("boom", 500, "INTERNAL_ERROR");
    expect(resolveError(err, scope).message).toBe(STRINGS.error.createFailed);
  });
});

describe("SCOPES — project.updateTitle", () => {
  const scope = SCOPES["project.updateTitle"];
  it("PROJECT_TITLE_EXISTS → projectTitleExists copy (I12)", () => {
    const err = new ApiRequestError("exists", 400, "PROJECT_TITLE_EXISTS");
    expect(resolveError(err, scope).message).toBe(STRINGS.error.projectTitleExists);
  });
  it("500 → updateTitleFailed (fallback)", () => {
    const err = new ApiRequestError("boom", 500, "INTERNAL_ERROR");
    expect(resolveError(err, scope).message).toBe(STRINGS.error.updateTitleFailed);
  });
});

describe("SCOPES — image.upload", () => {
  const scope = SCOPES["image.upload"];
  it("413 → fileTooLarge", () => {
    const err = new ApiRequestError("big", 413, "PAYLOAD_TOO_LARGE");
    expect(resolveError(err, scope).message).toBe(STRINGS.imageGallery.fileTooLarge);
  });
  it("PAYLOAD_TOO_LARGE (without 413 status) → fileTooLarge", () => {
    const err = new ApiRequestError("big", 400, "PAYLOAD_TOO_LARGE");
    expect(resolveError(err, scope).message).toBe(STRINGS.imageGallery.fileTooLarge);
  });
  it("500 → uploadFailedGeneric (fallback)", () => {
    const err = new ApiRequestError("boom", 500, "INTERNAL_ERROR");
    expect(resolveError(err, scope).message).toBe(STRINGS.imageGallery.uploadFailedGeneric);
  });
});

describe("SCOPES — image.delete", () => {
  const scope = SCOPES["image.delete"];
  it("IMAGE_IN_USE (no extras) → deleteBlockedInUse copy", () => {
    const err = new ApiRequestError("in use", 409, "IMAGE_IN_USE");
    expect(resolveError(err, scope).message).toBe(STRINGS.imageGallery.deleteBlockedInUse);
  });
  it("500 → deleteFailedGeneric (fallback)", () => {
    const err = new ApiRequestError("boom", 500, "INTERNAL_ERROR");
    expect(resolveError(err, scope).message).toBe(STRINGS.imageGallery.deleteFailedGeneric);
  });
});

describe("SCOPES — image.delete extrasFrom", () => {
  const scope = SCOPES["image.delete"];
  it("IMAGE_IN_USE with chapters in extras → extras forwarded", () => {
    const err = new ApiRequestError("in use", 409, "IMAGE_IN_USE", {
      chapters: [{ id: "c1", title: "Chapter 1" }],
    });
    expect(resolveError(err, scope).extras).toEqual({
      chapters: [{ id: "c1", title: "Chapter 1" }],
    });
  });
  it("IMAGE_IN_USE with malformed extras → extras undefined", () => {
    const err = new ApiRequestError("in use", 409, "IMAGE_IN_USE", {
      chapters: "not-an-array",
    });
    expect(resolveError(err, scope).extras).toBeUndefined();
  });
  // S5 (2026-04-23 review): per-element validation, not just Array.isArray.
  it("IMAGE_IN_USE with array-of-wrong-shape elements → extras undefined", () => {
    const err = new ApiRequestError("in use", 409, "IMAGE_IN_USE", {
      chapters: [{ title: "ok" }, { missingTitle: true }],
    });
    expect(resolveError(err, scope).extras).toBeUndefined();
  });
  it("IMAGE_IN_USE with wrong trashed type → extras undefined", () => {
    const err = new ApiRequestError("in use", 409, "IMAGE_IN_USE", {
      chapters: [{ title: "ok", trashed: "not-a-boolean" }],
    });
    expect(resolveError(err, scope).extras).toBeUndefined();
  });
  it("IMAGE_IN_USE with optional trashed absent → extras kept", () => {
    const err = new ApiRequestError("in use", 409, "IMAGE_IN_USE", {
      chapters: [{ title: "ok" }, { title: "also ok" }],
    });
    expect(resolveError(err, scope).extras).toEqual({
      chapters: [{ title: "ok" }, { title: "also ok" }],
    });
  });
});

describe("SCOPES — snapshot.restore", () => {
  const scope = SCOPES["snapshot.restore"];
  it("CORRUPT_SNAPSHOT → restoreFailedCorrupt", () => {
    const err = new ApiRequestError("corrupt", 400, SNAPSHOT_ERROR_CODES.CORRUPT_SNAPSHOT);
    expect(resolveError(err, scope).message).toBe(STRINGS.snapshots.restoreFailedCorrupt);
  });
  it("CROSS_PROJECT_IMAGE_REF → restoreFailedCrossProjectImage", () => {
    const err = new ApiRequestError("cross", 400, SNAPSHOT_ERROR_CODES.CROSS_PROJECT_IMAGE_REF);
    expect(resolveError(err, scope).message).toBe(STRINGS.snapshots.restoreFailedCrossProjectImage);
  });
  it("404 → restoreFailedNotFound", () => {
    const err = new ApiRequestError("gone", 404, "NOT_FOUND");
    expect(resolveError(err, scope).message).toBe(STRINGS.snapshots.restoreFailedNotFound);
  });
  it("NETWORK → restoreNetworkFailed + transient:true", () => {
    const err = new ApiRequestError("offline", 0, "NETWORK");
    const result = resolveError(err, scope);
    expect(result.message).toBe(STRINGS.snapshots.restoreNetworkFailed);
    expect(result.transient).toBe(true);
  });
  it("2xx BAD_JSON → restoreResponseUnreadable + possiblyCommitted:true", () => {
    const err = new ApiRequestError("bad body", 200, "BAD_JSON");
    const result = resolveError(err, scope);
    expect(result.message).toBe(STRINGS.snapshots.restoreResponseUnreadable);
    expect(result.possiblyCommitted).toBe(true);
  });
  it("500 → restoreFailed (fallback)", () => {
    const err = new ApiRequestError("boom", 500, "INTERNAL_ERROR");
    expect(resolveError(err, scope).message).toBe(STRINGS.snapshots.restoreFailed);
  });
});

describe("SCOPES — snapshot.view", () => {
  const scope = SCOPES["snapshot.view"];
  it("CORRUPT_SNAPSHOT → viewFailedCorrupt", () => {
    const err = new ApiRequestError("corrupt", 400, SNAPSHOT_ERROR_CODES.CORRUPT_SNAPSHOT);
    expect(resolveError(err, scope).message).toBe(STRINGS.snapshots.viewFailedCorrupt);
  });
  it("404 → viewFailedNotFound", () => {
    const err = new ApiRequestError("gone", 404, "NOT_FOUND");
    expect(resolveError(err, scope).message).toBe(STRINGS.snapshots.viewFailedNotFound);
  });
  it("NETWORK → viewFailedNetwork + transient:true", () => {
    const err = new ApiRequestError("offline", 0, "NETWORK");
    const result = resolveError(err, scope);
    expect(result.message).toBe(STRINGS.snapshots.viewFailedNetwork);
    expect(result.transient).toBe(true);
  });
  it("500 → viewFailed (fallback)", () => {
    const err = new ApiRequestError("boom", 500, "INTERNAL_ERROR");
    expect(resolveError(err, scope).message).toBe(STRINGS.snapshots.viewFailed);
  });
});

describe("SCOPES — findReplace.search", () => {
  const scope = SCOPES["findReplace.search"];
  it("MATCH_CAP_EXCEEDED → tooManyMatches", () => {
    const err = new ApiRequestError("cap", 400, SEARCH_ERROR_CODES.MATCH_CAP_EXCEEDED);
    expect(resolveError(err, scope).message).toBe(STRINGS.findReplace.tooManyMatches);
  });
  it("REGEX_TIMEOUT → searchTimedOut", () => {
    const err = new ApiRequestError("slow", 400, SEARCH_ERROR_CODES.REGEX_TIMEOUT);
    expect(resolveError(err, scope).message).toBe(STRINGS.findReplace.searchTimedOut);
  });
  it("CONTENT_TOO_LARGE → contentTooLarge", () => {
    const err = new ApiRequestError("big", 400, SEARCH_ERROR_CODES.CONTENT_TOO_LARGE);
    expect(resolveError(err, scope).message).toBe(STRINGS.findReplace.contentTooLarge);
  });
  it("INVALID_REGEX → invalidRegex", () => {
    const err = new ApiRequestError("bad re", 400, SEARCH_ERROR_CODES.INVALID_REGEX);
    expect(resolveError(err, scope).message).toBe(STRINGS.findReplace.invalidRegex);
  });
  it("generic 400 → invalidSearchRequest", () => {
    const err = new ApiRequestError("bad", 400, "VALIDATION_ERROR");
    expect(resolveError(err, scope).message).toBe(STRINGS.findReplace.invalidSearchRequest);
  });
  it("413 → contentTooLarge", () => {
    const err = new ApiRequestError("big", 413, "PAYLOAD_TOO_LARGE");
    expect(resolveError(err, scope).message).toBe(STRINGS.findReplace.contentTooLarge);
  });
  it("404 → searchProjectNotFound", () => {
    const err = new ApiRequestError("gone", 404, "NOT_FOUND");
    expect(resolveError(err, scope).message).toBe(STRINGS.findReplace.searchProjectNotFound);
  });
  it("NETWORK → searchNetworkFailed + transient:true", () => {
    const err = new ApiRequestError("offline", 0, "NETWORK");
    const result = resolveError(err, scope);
    expect(result.message).toBe(STRINGS.findReplace.searchNetworkFailed);
    expect(result.transient).toBe(true);
  });
  it("500 → searchFailed (fallback)", () => {
    const err = new ApiRequestError("boom", 500, "INTERNAL_ERROR");
    expect(resolveError(err, scope).message).toBe(STRINGS.findReplace.searchFailed);
  });
});

describe("SCOPES — findReplace.replace", () => {
  const scope = SCOPES["findReplace.replace"];
  it("MATCH_CAP_EXCEEDED → tooManyMatches", () => {
    const err = new ApiRequestError("cap", 400, SEARCH_ERROR_CODES.MATCH_CAP_EXCEEDED);
    expect(resolveError(err, scope).message).toBe(STRINGS.findReplace.tooManyMatches);
  });
  it("REGEX_TIMEOUT → searchTimedOut", () => {
    const err = new ApiRequestError("slow", 400, SEARCH_ERROR_CODES.REGEX_TIMEOUT);
    expect(resolveError(err, scope).message).toBe(STRINGS.findReplace.searchTimedOut);
  });
  it("CONTENT_TOO_LARGE → contentTooLarge", () => {
    const err = new ApiRequestError("big", 400, SEARCH_ERROR_CODES.CONTENT_TOO_LARGE);
    expect(resolveError(err, scope).message).toBe(STRINGS.findReplace.contentTooLarge);
  });
  it("INVALID_REGEX → invalidRegex", () => {
    const err = new ApiRequestError("bad re", 400, SEARCH_ERROR_CODES.INVALID_REGEX);
    expect(resolveError(err, scope).message).toBe(STRINGS.findReplace.invalidRegex);
  });
  it("SCOPE_NOT_FOUND (404) → replaceScopeNotFound", () => {
    const err = new ApiRequestError("scope gone", 404, SEARCH_ERROR_CODES.SCOPE_NOT_FOUND);
    expect(resolveError(err, scope).message).toBe(STRINGS.findReplace.replaceScopeNotFound);
  });
  it("generic 400 → invalidReplaceRequest", () => {
    const err = new ApiRequestError("bad", 400, "VALIDATION_ERROR");
    expect(resolveError(err, scope).message).toBe(STRINGS.findReplace.invalidReplaceRequest);
  });
  it("413 → contentTooLarge", () => {
    const err = new ApiRequestError("big", 413, "PAYLOAD_TOO_LARGE");
    expect(resolveError(err, scope).message).toBe(STRINGS.findReplace.contentTooLarge);
  });
  it("generic 404 → replaceProjectNotFound", () => {
    const err = new ApiRequestError("gone", 404, "NOT_FOUND");
    expect(resolveError(err, scope).message).toBe(STRINGS.findReplace.replaceProjectNotFound);
  });
  it("NETWORK → replaceNetworkFailed + transient:true", () => {
    const err = new ApiRequestError("offline", 0, "NETWORK");
    const result = resolveError(err, scope);
    expect(result.message).toBe(STRINGS.findReplace.replaceNetworkFailed);
    expect(result.transient).toBe(true);
  });
  it("2xx BAD_JSON → replaceResponseUnreadable + possiblyCommitted:true", () => {
    const err = new ApiRequestError("bad body", 200, "BAD_JSON");
    const result = resolveError(err, scope);
    expect(result.message).toBe(STRINGS.findReplace.replaceResponseUnreadable);
    expect(result.possiblyCommitted).toBe(true);
  });
  it("500 → replaceFailed (fallback)", () => {
    const err = new ApiRequestError("boom", 500, "INTERNAL_ERROR");
    expect(resolveError(err, scope).message).toBe(STRINGS.findReplace.replaceFailed);
  });
});

describe("SCOPES registry", () => {
  it("has an entry for every ApiErrorScope (TypeScript enforces this)", () => {
    for (const scope of Object.keys(SCOPES) as ApiErrorScope[]) {
      expect(typeof scope).toBe("string");
      expect(SCOPES[scope].fallback).toBeTruthy();
    }
  });
  it("covers all known scopes", () => {
    const expected: ApiErrorScope[] = [
      "project.load",
      "projectList.load",
      "project.create",
      "project.delete",
      "project.updateTitle",
      "project.updateFields",
      "chapter.load",
      "chapter.save",
      "chapter.create",
      "chapter.delete",
      "chapter.rename",
      "chapter.reorder",
      "chapter.updateStatus",
      "chapterStatus.fetch",
      "image.list",
      "image.references",
      "image.upload",
      "image.delete",
      "image.updateMetadata",
      "snapshot.restore",
      "snapshot.view",
      "snapshot.list",
      "snapshot.create",
      "snapshot.delete",
      "findReplace.search",
      "findReplace.replace",
      "export.run",
      "trash.load",
      "trash.restoreChapter",
      "settings.update",
      "settings.get",
      "dashboard.load",
      "project.velocity",
    ];
    const actual = Object.keys(SCOPES).sort();
    expect(actual).toEqual(expected.sort());
  });
});

describe("mapApiError public API", () => {
  it("accepts a scope name and looks up the entry", () => {
    const err = new ApiRequestError("too large", 413, "PAYLOAD_TOO_LARGE");
    expect(mapApiError(err, "chapter.save").message).toBe(STRINGS.editor.saveFailedTooLarge);
  });
});

describe("mapper never surfaces raw err.message (S10)", () => {
  // S10 (2026-04-23 review): the mapper must never forward a raw
  // ApiRequestError.message to its MappedError.message output. Server
  // messages are dev/log-only text (possibly hostile HTML, leaked
  // stack traces, or just unlocalized English); every UI string must
  // come from the scope registry. These tests pin that invariant so a
  // future "pass the server message through when scope has nothing to
  // say" regression surfaces immediately.
  const hostileMessage = "<script>alert('xss')</script> plus an untranslated error";

  it.each(ALL_SCOPES)(
    "discards hostile err.message on a fallback-class error for %s",
    (scopeName) => {
      const err = new ApiRequestError(hostileMessage, 500, "INTERNAL_ERROR");
      const result = mapApiError(err, scopeName);
      if (result.message !== null) {
        expect(result.message).not.toContain("<script>");
        expect(result.message).not.toContain(hostileMessage);
      }
    },
  );

  it.each(ALL_SCOPES)(
    "discards hostile err.message on a NETWORK classification for %s",
    (scopeName) => {
      const err = new ApiRequestError(hostileMessage, 0, "NETWORK");
      const result = mapApiError(err, scopeName);
      if (result.message !== null) {
        expect(result.message).not.toContain("<script>");
        expect(result.message).not.toContain(hostileMessage);
      }
    },
  );

  it.each(ALL_SCOPES)(
    "discards hostile err.message on a 2xx BAD_JSON classification for %s",
    (scopeName) => {
      const err = new ApiRequestError(hostileMessage, 200, "BAD_JSON");
      const result = mapApiError(err, scopeName);
      if (result.message !== null) {
        expect(result.message).not.toContain("<script>");
        expect(result.message).not.toContain(hostileMessage);
      }
    },
  );
});

describe("cross-cutting rules apply to every scope", () => {
  it.each(ALL_SCOPES)("ABORTED is silent for %s", (scope) => {
    expect(mapApiError(new ApiRequestError("aborted", 0, "ABORTED"), scope).message).toBeNull();
  });
  it.each(ALL_SCOPES)("NETWORK flags transient for %s", (scope) => {
    expect(mapApiError(new ApiRequestError("offline", 0, "NETWORK"), scope).transient).toBe(true);
  });
  // S7 (2026-04-23 review): gated on scope.committed being defined. A
  // scope without committed: copy is a GET-only scope (reads don't
  // commit) or a mutation scope that hasn't opted into the committed
  // UX — possiblyCommitted should not fire unconditionally for every
  // scope.
  it.each(ALL_SCOPES)(
    "2xx BAD_JSON possiblyCommitted flag matches scope.committed for %s",
    (scopeName) => {
      const scope = SCOPES[scopeName];
      const hasCommitted = scope.committed !== undefined;
      expect(
        mapApiError(new ApiRequestError("bad", 200, "BAD_JSON"), scopeName).possiblyCommitted,
      ).toBe(hasCommitted);
    },
  );
  it.each(ALL_SCOPES)("non-ApiRequestError falls through to scope.fallback for %s", (scope) => {
    const r = mapApiError(new Error("wtf"), scope);
    expect(r.message).toBeTruthy();
    expect(r.possiblyCommitted).toBe(false);
    expect(r.transient).toBe(false);
  });
});
