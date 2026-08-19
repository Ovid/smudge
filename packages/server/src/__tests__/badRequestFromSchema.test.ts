import { describe, it, expect } from "vitest";
import { OUTTAKE_ERROR_CODES, SNAPSHOT_ERROR_CODES } from "@smudge/shared";
import { badRequestFromSchema } from "../badRequestFromSchema";

// [S2] (agentic review 2026-08-19). This helper existed byte-identically in
// snapshots.routes.ts and outtakes.routes.ts, differing only in the constant
// each emitted. Both decode the SAME shared schema fragment
// (sanitizedLabelBase), so the predicate below is one rule about one producer
// — and two private copies of it could drift apart silently, leaving one
// endpoint emitting the discriminating code and its sibling falling back to
// generic retry-inviting copy for the same user action.
//
// These tests exist because the route-level tests cannot see the seam. Each
// route's suite proves ITS code is emitted; neither can prove the two agree on
// what "the cap was breached" looks like. That agreement is now this module's,
// and this is where it is pinned.
describe("badRequestFromSchema", () => {
  const tooBigLabel = [{ code: "too_big", path: ["label"], message: "Label is too long" }];

  it("emits the caller's code for a too_big issue on the label path", () => {
    const err = badRequestFromSchema(tooBigLabel, SNAPSHOT_ERROR_CODES.LABEL_TOO_LONG);

    expect(err.status).toBe(400);
    expect(err.code).toBe(SNAPSHOT_ERROR_CODES.LABEL_TOO_LONG);
    expect(err.message).toBe("Label is too long");
  });

  // The parameter IS the extraction: one predicate, two callers, two codes.
  // A helper that hard-coded either constant would pass the test above and
  // fail this one.
  it("emits a DIFFERENT caller's code from the same issue shape", () => {
    const err = badRequestFromSchema(tooBigLabel, OUTTAKE_ERROR_CODES.LABEL_TOO_LONG);

    expect(err.code).toBe(OUTTAKE_ERROR_CODES.LABEL_TOO_LONG);
  });
});
