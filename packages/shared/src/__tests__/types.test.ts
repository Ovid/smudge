import { describe, it, expect, expectTypeOf } from "vitest";
import type { ApiError } from "../types";
import { ChapterStatus } from "../schemas";
import type { ChapterStatusValue } from "../schemas";

describe("ApiError envelope", () => {
  // The contract is a TYPE contract: the envelope's `error` object must
  // carry a `[key: string]: unknown` index signature so callers can
  // shove additional fields (chapters, details, etc.) onto the wire
  // without a `@ts-expect-error` at every site. Vitest/Vite's transpile
  // step does not run tsc, so a plain value-level `expect(...)` cannot
  // catch a broken contract on its own. `tsc -b packages/shared`
  // (wired into `make typecheck` and `make all`) DOES typecheck this
  // file because `include: ["src"]` covers `.test.ts`. Verified by
  // removing `[key: string]: unknown` from types.ts and observing
  // `tsc` report TS2353 on the `chapters` excess-property check below
  // — so the test catches regressions at CI time.
  it("allows arbitrary extra fields via the index signature (type-level)", () => {
    // Extras on .error must type-check. If the index signature is
    // removed from ApiError, tsc reports TS2353 here at typecheck time.
    const envelope = {
      error: {
        code: "IMAGE_IN_USE",
        message: "Image is referenced",
        chapters: [{ id: "c1", title: "Chapter 1" }],
        details: "extra",
      },
    } satisfies ApiError;

    // expectTypeOf pins the index signature explicitly so a refactor
    // that narrows `unknown` to something stricter (and still passes
    // the satisfies check) fails here. The `toEqualTypeOf<unknown>()`
    // matcher runs at typecheck time.
    expectTypeOf<ApiError["error"][string]>().toEqualTypeOf<unknown>();

    // Value-level sanity check — redundant with the type check above
    // but makes the failure mode obvious in test output on regression.
    expect(envelope.error.code).toBe("IMAGE_IN_USE");
    expect(envelope.error.chapters).toBeDefined();
  });

  it("rejects a value whose .error is missing code or message (type-level)", () => {
    // The required fields (code, message) are still enforced even
    // though arbitrary extras are allowed. This test exists so the
    // index signature's permissiveness doesn't silently relax the
    // required shape.
    // @ts-expect-error — `error` is missing `message`
    const _missingMessage: ApiError = { error: { code: "X" } };
    // @ts-expect-error — `error` is missing `code`
    const _missingCode: ApiError = { error: { message: "x" } };
    // Reference the unused bindings so `noUnusedLocals` / lint doesn't
    // complain while keeping the @ts-expect-error lines as the real
    // enforcement signal.
    void _missingMessage;
    void _missingCode;
  });
});

describe("ChapterStatusValue", () => {
  // ChapterStatusValue is the canonical chapter-status type, inferred from
  // the Zod enum. This pins it to exactly the five known literals so a
  // refactor that widens it (e.g. back to `string`) fails at typecheck time.
  it("resolves to exactly the five status literals (type-level)", () => {
    expectTypeOf<ChapterStatusValue>().toEqualTypeOf<
      "outline" | "rough_draft" | "revised" | "edited" | "final"
    >();
  });

  // Runtime pin so the schema and the inferred type cannot silently drift,
  // and so this file registers a value-level test alongside the type checks.
  it("the schema enumerates exactly those five values (runtime)", () => {
    expect(ChapterStatus.options).toEqual([
      "outline",
      "rough_draft",
      "revised",
      "edited",
      "final",
    ]);
  });
});
