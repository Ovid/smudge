import { describe, it, expect } from "vitest";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { stripCommentsFromTsSource } from "./tsSourceScan";
import { ApiRequestError } from "../api/client";

// Backlog `88502499` (agentic review 2026-08-23 round 2, OOSS3). Nineteen test
// files each declared their OWN `class ApiRequestError extends Error` inside a
// `vi.mock("…/api/client", …)` factory, because a module factory has to supply
// every export the module has. Nineteen hand-copied constructors is nineteen
// chances to drift from the real four-argument signature
// `(message, status, code?, extras?)` — and they had: three stopped at
// `(message, status)`, and NOT ONE carried `extras`, so scope `extras` (the 409
// referencing-chapter list, for one) was untestable through any of them.
//
// The correction the review's own impact claim needed: those three files
// construct zero errors, so nothing was silently green because of them. The
// defect was latent, not live. It was still worth closing, because the next
// test written in one of those files would have inherited a broken stub with
// no signal.
//
// The fix is not a shared stub — it is no stub. Vitest hands a mock factory
// `importOriginal`, so every factory now takes the REAL class from the real
// module. Drift is impossible by construction rather than centralised, which is
// strictly better: a shared stub is one copy that can still fall behind, and
// `staleProjectGuard`'s own header records what happens to hand-maintained
// copies of a contract ("nine copies is how four of them drifted unnoticed").
//
// This test is the forcing pause that keeps it that way.

const CLIENT_SRC = join(__dirname, "..");

/** The one legitimate declaration: the production class itself. */
const REAL_DECLARATION = join(CLIENT_SRC, "api", "client.ts");

function collectAllTsSources(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectAllTsSources(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("ApiRequestError has exactly one declaration (88502499)", () => {
  it("no test file re-declares the class its mock factory can import", () => {
    // Assembled rather than written as one literal: a regex spelling the
    // declaration verbatim would match this very file and fail on itself.
    const declaration = new RegExp(`class ${"Api"}${"RequestError"}\\b`);
    const offenders = collectAllTsSources(CLIENT_SRC)
      .filter((f) => f !== REAL_DECLARATION)
      .filter((f) => declaration.test(stripCommentsFromTsSource(readFileSync(f, "utf8"))))
      .map((f) => relative(CLIENT_SRC, f));

    // If this turns red, do not add a stub — reach for the real class:
    //   vi.mock("…/api/client", async (importOriginal) => ({
    //     ApiRequestError: (await importOriginal<typeof import("…/api/client")>()).ApiRequestError,
    //     api: { … },
    //   }));
    expect(offenders).toEqual([]);
  });

  it("the real class still carries all four constructor parameters", () => {
    // The reason the ban is worth enforcing: a stub that stops early is
    // undetectable at the call site, because the dropped arguments are simply
    // ignored. Pin the arity the mocks now inherit, so a change to the real
    // signature is a decision rather than a silent widening of the gap this
    // entry was about.
    // `code?` and `extras?` are optional to TypeScript but carry no default
    // value, so they still count toward Function.length. Four is the number the
    // nineteen stubs were supposed to match and three of them did not.
    expect(ApiRequestError.length).toBe(4);
    const built = new ApiRequestError("boom", 409, "IMAGE_IN_USE", {
      chapters: [{ title: "One" }],
    });
    expect(built.code).toBe("IMAGE_IN_USE");
    expect(built.extras).toEqual({ chapters: [{ title: "One" }] });
  });
});
