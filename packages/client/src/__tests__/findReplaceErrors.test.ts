import { describe, it, expect } from "vitest";
import { mapReplaceErrorToMessage, mapSearchErrorToMessage } from "../utils/findReplaceErrors";
import { ApiRequestError } from "../api/client";
import { STRINGS } from "../strings";

describe("mapReplaceErrorToMessage", () => {
  it("returns generic replaceFailed for non-ApiRequestError", () => {
    expect(mapReplaceErrorToMessage(new Error("oops"))).toBe(STRINGS.findReplace.replaceFailed);
    expect(mapReplaceErrorToMessage("string")).toBe(STRINGS.findReplace.replaceFailed);
    expect(mapReplaceErrorToMessage(null)).toBe(STRINGS.findReplace.replaceFailed);
  });

  it("returns null for ABORTED so caller shows no banner", () => {
    const err = new ApiRequestError("aborted", 0, "ABORTED");
    expect(mapReplaceErrorToMessage(err)).toBeNull();
  });

  it("maps 400 MATCH_CAP_EXCEEDED to tooManyMatches", () => {
    const err = new ApiRequestError("too many", 400, "MATCH_CAP_EXCEEDED");
    expect(mapReplaceErrorToMessage(err)).toBe(STRINGS.findReplace.tooManyMatches);
  });

  it("maps 400 REGEX_TIMEOUT to searchTimedOut", () => {
    const err = new ApiRequestError("timeout", 400, "REGEX_TIMEOUT");
    expect(mapReplaceErrorToMessage(err)).toBe(STRINGS.findReplace.searchTimedOut);
  });

  it("maps 400 CONTENT_TOO_LARGE to contentTooLarge", () => {
    const err = new ApiRequestError("too big", 400, "CONTENT_TOO_LARGE");
    expect(mapReplaceErrorToMessage(err)).toBe(STRINGS.findReplace.contentTooLarge);
  });

  it("maps 400 INVALID_REGEX to invalidRegex", () => {
    const err = new ApiRequestError("bad regex", 400, "INVALID_REGEX");
    expect(mapReplaceErrorToMessage(err)).toBe(STRINGS.findReplace.invalidRegex);
  });

  it("returns generic invalidReplaceRequest for other 400 codes (no raw server copy)", () => {
    const err = new ApiRequestError("validation failed", 400, "VALIDATION_ERROR");
    expect(mapReplaceErrorToMessage(err)).toBe(STRINGS.findReplace.invalidReplaceRequest);
  });

  it("maps 404 SCOPE_NOT_FOUND to replaceScopeNotFound", () => {
    const err = new ApiRequestError("scope gone", 404, "SCOPE_NOT_FOUND");
    expect(mapReplaceErrorToMessage(err)).toBe(STRINGS.findReplace.replaceScopeNotFound);
  });

  it("maps 404 NOT_FOUND (project gone) to replaceProjectNotFound (distinct from chapter copy)", () => {
    const err = new ApiRequestError("project gone", 404, "NOT_FOUND");
    expect(mapReplaceErrorToMessage(err)).toBe(STRINGS.findReplace.replaceProjectNotFound);
  });

  it("maps 413 PAYLOAD_TOO_LARGE to contentTooLarge", () => {
    // Body-size guard (CLAUDE.md: 413). Retrying the same payload is
    // doomed, so the mapper must not fall through to replaceFailed which
    // invites a retry.
    const err = new ApiRequestError("too big", 413, "PAYLOAD_TOO_LARGE");
    expect(mapReplaceErrorToMessage(err)).toBe(STRINGS.findReplace.contentTooLarge);
  });

  it("returns replaceFailed for other statuses (no raw server copy)", () => {
    const err = new ApiRequestError("server boom", 500);
    expect(mapReplaceErrorToMessage(err)).toBe(STRINGS.findReplace.replaceFailed);
  });

  it("maps BAD_JSON on a 2xx to replaceResponseUnreadable (S4)", () => {
    // Server-side replace likely committed; falling through to the generic
    // replaceFailed would invite a retry that double-replaces.
    const err = new ApiRequestError("Unexpected token", 200, "BAD_JSON");
    expect(mapReplaceErrorToMessage(err)).toBe(STRINGS.findReplace.replaceResponseUnreadable);
  });

  it("does NOT map BAD_JSON on a non-2xx to replaceResponseUnreadable", () => {
    // A 5xx with an unparseable body really did fail server-side; falling
    // through to the generic replaceFailed copy is correct here — the
    // ambiguous-commit copy is only honest for the 2xx case.
    const err = new ApiRequestError("oops", 500, "BAD_JSON");
    expect(mapReplaceErrorToMessage(err)).toBe(STRINGS.findReplace.replaceFailed);
  });

  it("falls back to replaceFailed when err.message is empty", () => {
    const err = new ApiRequestError("", 500);
    expect(mapReplaceErrorToMessage(err)).toBe(STRINGS.findReplace.replaceFailed);
  });
});

describe("mapSearchErrorToMessage", () => {
  it("maps 413 PAYLOAD_TOO_LARGE to contentTooLarge", () => {
    const err = new ApiRequestError("too big", 413, "PAYLOAD_TOO_LARGE");
    expect(mapSearchErrorToMessage(err)).toBe(STRINGS.findReplace.contentTooLarge);
  });

  it("maps 404 to searchScopeNotFound", () => {
    const err = new ApiRequestError("gone", 404);
    expect(mapSearchErrorToMessage(err)).toBe(STRINGS.findReplace.searchScopeNotFound);
  });

  it("returns null for ABORTED", () => {
    const err = new ApiRequestError("aborted", 0, "ABORTED");
    expect(mapSearchErrorToMessage(err)).toBeNull();
  });
});
