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

  it("applyMappedError with 'chapter.load' scope: onExtras callback parameter is typed as never", () => {
    // Regression guard for the `ScopeExtras<S> = ... : never` conditional.
    // If a future refactor widens `chapter.load`'s extras (e.g. by adding
    // an `extrasFrom` or by accidentally defaulting `ScopeExtras` away from
    // `never`), the `expectTypeOf(e).toEqualTypeOf<never>()` below fails
    // at typecheck — both the unit suite and `tsc -b` catch it.
    //
    // Per agentic-review S3 on 2026-05-26: an `@ts-expect-error` directive
    // over a no-op `onExtras` callback was considered as the negative form
    // but does NOT work — TypeScript's parameter contravariance accepts
    // any callable when the expected parameter is `never`, so the
    // directive would always be unused. The positive `expectTypeOf<never>`
    // inside the callback is the only structural guard available.
    //
    // The callback body itself never fires at runtime: chapter.load has
    // no `extrasFrom`, so the mapper never populates `mapped.extras` for
    // this scope. Compile-time-only check, exactly like the image.delete
    // positive test above.
    const err = new ApiRequestError("oops", 500, "INTERNAL_ERROR");
    applyMappedError(mapApiError(err, "chapter.load"), {
      onExtras: (e) => {
        expectTypeOf(e).toEqualTypeOf<never>();
        return STOP;
      },
    });
  });
});
