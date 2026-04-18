import { describe, it, expect } from "vitest";
import { mapReplaceErrorToMessage } from "../utils/findReplaceErrors";
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

  it("maps 404 NOT_FOUND (project gone) to replaceScopeNotFound (not generic retry) (S2)", () => {
    const err = new ApiRequestError("project gone", 404, "NOT_FOUND");
    expect(mapReplaceErrorToMessage(err)).toBe(STRINGS.findReplace.replaceScopeNotFound);
  });

  it("returns replaceFailed for other statuses (no raw server copy)", () => {
    const err = new ApiRequestError("server boom", 500);
    expect(mapReplaceErrorToMessage(err)).toBe(STRINGS.findReplace.replaceFailed);
  });

  it("falls back to replaceFailed when err.message is empty", () => {
    const err = new ApiRequestError("", 500);
    expect(mapReplaceErrorToMessage(err)).toBe(STRINGS.findReplace.replaceFailed);
  });
});
