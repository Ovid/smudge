import { describe, it, expectTypeOf } from "vitest";
import type { ScopeExtras } from "./scopeExtras";
import { applyMappedError, STOP } from "./applyMappedError";
import { mapApiError } from "./apiErrorMapper";
import { ApiRequestError } from "../api/client";

describe("ScopeExtras<S>", () => {
  it("ScopeExtras<'image.delete'> resolves to { chapters: { title; trashed? }[] }", () => {
    expectTypeOf<ScopeExtras<"image.delete">>().toEqualTypeOf<{
      chapters: { title: string; trashed?: boolean }[];
    }>();
  });

  it("ScopeExtras<'chapter.load'> resolves to never (no extrasFrom on this scope)", () => {
    expectTypeOf<ScopeExtras<"chapter.load">>().toEqualTypeOf<never>();
  });

  it("applyMappedError(mapApiError(err, 'image.delete'), { onExtras }) accepts the typed extras", () => {
    const err = new ApiRequestError("oops", 409, "IMAGE_IN_USE");
    // Compile-time check only; runtime behaviour is covered by applyMappedError.test.ts.
    // The point is that onExtras's argument is { chapters: ... }, not Record<string, unknown>.
    applyMappedError(mapApiError(err, "image.delete"), {
      onExtras: (e) => {
        expectTypeOf(e).toEqualTypeOf<{ chapters: { title: string; trashed?: boolean }[] }>();
        return STOP;
      },
    });
  });

  // Negative compile-time test — kept commented (the @ts-expect-error form is noisy
  // and a regression would surface via typecheck on a consumer site). See:
  // it("applyMappedError(mapApiError(err, 'chapter.load'), { onExtras }) fails to type-check", () => {
  //   const err = new ApiRequestError("oops", 500, "INTERNAL_ERROR");
  //   applyMappedError(mapApiError(err, "chapter.load"), {
  //     // @ts-expect-error — chapter.load has no extrasFrom; ScopeExtras<'chapter.load'> = never
  //     onExtras: (_e) => undefined,
  //   });
  // });
});
