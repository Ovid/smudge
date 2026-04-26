# Agentic Code Review: ovid/miscellaneous-fixes

**Date:** 2026-04-26 10:52:40
**Branch:** `ovid/miscellaneous-fixes` -> `main`
**Commit:** 5443ba465164c22ad3471a088b3fd42e7344c879
**Files changed:** 23 | **Lines changed:** +2997 / -91 (code/tests: +830 / -88 across 13 files)
**Diff size category:** Medium

## Executive Summary

This branch implements Cluster D of Phase 4b.3a (sanitizer hardening + `image.delete` extras bounding) and ships a cluster of e2e cleanup-guard fixes across seven specs. The hardening is correctly implemented and well-tested for the threats it explicitly targets — DOMPurify private-instance isolation, URI-regex anchoring, prototype-pollution-safe `byCode` lookup, and surrogate-safe truncation all hold up to adversarial probing. The two issues worth acting on are: (1) the documented `ALLOWED_ATTR = ["src", "alt"]` contract silently understates DOMPurify's actual filter — `data-*` and `aria-*` attributes pass through by default, **empirically confirmed** by running the live config; and (2) seven copies of `createTestProject`/`deleteProject` across e2e specs have already diverged (four assert response.ok(), four don't), which the new cleanup-guard pattern just multiplied to seven copies of a try/finally idiom.

## Critical Issues

None found.

## Important Issues

### [I1] DOMPurify `data-*` and `aria-*` attributes pass through despite documented `ALLOWED_ATTR = ["src", "alt"]`
- **File:** `packages/client/src/sanitizer.ts:109-114`
- **Bug:** `purifier.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOWED_URI_REGEXP })` does not override DOMPurify 3.x's `ALLOW_DATA_ATTR: true` and `ALLOW_ARIA_ATTR: true` defaults. Empirically confirmed by running the exact config: `<p data-onclick="alert(1)">z</p>` → unchanged; `<p aria-label="hello">` → unchanged; `<img src="/api/images/<uuid>" alt="ok" data-evil="x">` → `data-evil` survives. The S3 unit test (`sanitizer.test.ts:221`) only asserts the static export shape (`expect(ALLOWED_ATTR).toEqual(["src", "alt"])`), not the sanitizer's actual output.
- **Impact:** Not exploitable today — `data-*`/`aria-*` attributes have no native browser action, no JS reads `dataset` from snapshot content, and React's `dangerouslySetInnerHTML` does not interpret them. The risk is twofold: (a) the comment chain at lines 30-59 reads as if `["src", "alt"]` is exhaustive — a future reviewer would need to know DOMPurify defaults to catch the gap; (b) if a future feature ever scripts against rendered snapshot DOM via `[data-*]` selectors (export tooling, metadata extraction, click-handlers via event delegation), an attacker who controls a snapshot blob can plant attributes that bend that scripting.
- **Suggested fix:** Add `ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false` to the sanitize options. None of the editor extensions emit data/aria attributes today, so this is a free defense-in-depth tightening. Add a regression test asserting `<p data-foo="bar">` and `<p aria-label="x">` strip both attributes.
- **Confidence:** High (empirically verified)
- **Found by:** Security

### [I2] e2e `createTestProject`/`deleteProject` helpers duplicated across 8 specs have diverged
- **Files:** `e2e/dashboard.spec.ts`, `e2e/editor-save.spec.ts`, `e2e/export.spec.ts`, `e2e/find-replace.spec.ts`, `e2e/images.spec.ts`, `e2e/sanitizer-snapshot-blob.spec.ts`, `e2e/snapshots.spec.ts`, `e2e/velocity.spec.ts`
- **Bug:** Four specs assert `expect(res.ok()).toBeTruthy()` on the delete response (`editor-save`, `find-replace`, `sanitizer-snapshot-blob`, `snapshots`). The other four do not (`dashboard`, `export`, `images`, `velocity`) — they silently swallow 4xx/5xx delete failures. Verified via grep:
  ```
  e2e/velocity.spec.ts:    await request.delete(`/api/projects/${slug}`);   // no assertion
  e2e/dashboard.spec.ts:   await request.delete(`/api/projects/${slug}`);   // no assertion
  e2e/snapshots.spec.ts:   const res = await request.delete(...); expect(res.ok()).toBeTruthy();
  ```
  This branch additionally introduces seven copies of the same `let projectCreated = false` / `if (projectCreated)` flag idiom. The same review-followup logic was copy-pasted seven times.
- **Impact:** A delete failure in one of the silent specs leaks server state across test runs (project rows, image blobs, snapshots). Future divergence is now structurally guaranteed — every fix has to be applied in eight places. The new `projectCreated` guard pattern, while correct, has the same problem multiplied.
- **Suggested fix:** Extract `e2e/helpers/test-project.ts` exporting `createTestProject`, `deleteProject`, and a Playwright `test.extend({ project })` fixture that handles beforeEach/afterEach with consistent assertions. Migrate the eight specs incrementally — the migration is mechanical. Consider doing this as a single small PR before adding more e2e coverage.
- **Confidence:** High (verified via grep)
- **Found by:** Contract & Integration, Concurrency & State

## Suggestions

- **`image.delete` extrasFrom whitespace check misses zero-width characters** (`packages/client/src/errors/scopes.ts:292`). `obj.title.trim().length === 0` does not strip ZWSP (`​`), LRM/RLM (`‎`/`‏`), word joiner (`⁠`), Arabic letter mark (`؜`), BOM (`﻿`), soft hyphen (`­`). A hostile envelope of `[{title: "​"}]` reaches `S.deleteBlocked(["​"])` and produces the same malformed announcement that the round-3 fix was meant to close. Server schema (`z.string().trim().min(1)`) has the same gap — the validator is the only gatekeeper. Suggested fix: tighten to `title.replace(/[\s​-‏⁠؜﻿­]+/g, "").length === 0` or require `/\p{L}|\p{N}|\p{P}|\p{S}/u`.
- **`<img alt>` survival not asserted in e2e** (`e2e/sanitizer-snapshot-blob.spec.ts:152-161`). The test feeds `alt: "data-uri-marker"` and `alt: "javascript-uri-marker"` but never asserts they survive. A regression that drops the entire `<img>` (rather than just the `src` attribute) would still pass. Add `await expect(snapshotDiv.locator('img[alt="data-uri-marker"]')).toBeVisible();` and matching for the javascript marker.
- **`UUID_PATTERN` duplicated 5 ways** (`packages/client/src/sanitizer.ts:91-92` inlines the hex shape; `packages/server/src/images/images.paths.ts:9` exports `UUID_PATTERN` reused in four server files). The sanitizer comment explicitly says "mirror the UUID shape from the server's `IMAGE_SRC_RE`" — but the contract is enforced by hand, not by code. Promote `UUID_PATTERN` to `@smudge/shared` and import on both sides.
- **`ALLOWED_URI_REGEXP` trailing `(?:[?#].*)?` accepts arbitrary content past `?` or `#`** (`packages/client/src/sanitizer.ts:91-92`). `/api/images/<uuid>?javascript:alert(1)` matches. Latent today (`<img src>` cannot execute JS) but the I14 round-3 reasoning explicitly defends against latent gaps if `<a>` is later added to ALLOWED_TAGS. Tighten the cache-buster portion to a printable allowlist: `(?:[?#][A-Za-z0-9_=&%.+\-]*)?$`.
- **`safeExtrasFrom` swallows extrasFrom throws silently in production** (`packages/client/src/errors/apiErrorMapper.ts:173-175`). Dev-only `console.error` means a buggy `extrasFrom` in a production build produces "extras: undefined" with zero diagnostic trail. Either route to `logger.warn` (matching server hygiene) or document the trade-off. Single-user app context softens this, but the same observability discipline applies as to the save-pipeline invariants.
- **No test enforces the `[...ALLOWED_ATTR]` spread in `purifier.sanitize`** (`packages/client/src/sanitizer.ts:112`). The freeze defends against external mutation; the spread defends against DOMPurify internal mutation. The test pins the freeze but a future refactor that drops the spread (passing the frozen array directly) could surface as "Cannot assign to read only property" in production. Add a comment "do not remove — DOMPurify may mutate this array internally" or wrap the assertion.
- **Sanitizer comment overstates "fail-closed" reliability** (`packages/client/src/sanitizer.ts:67-79`). The comment frames a broken `<img>` in snapshot view as "a deliberate fail-closed signal that lets us catch the divergence" — but the user is *previewing* a snapshot, not editing, and may shrug off the broken image as old content. Either widen the regex to match the server's accepting-absolute-URLs form (so client and server agree exactly) or add a `console.warn` in DEV when the hook strips a `/api/images/`-prefixed URL.
- **`safeExtrasFrom` runs on byStatus AND fallback paths** (`packages/client/src/errors/apiErrorMapper.ts:138, 147, 154`). A hostile `image.delete` envelope of `{status: 500, code: "TOTALLY_UNRELATED", chapters: [...]}` triggers the validator and forwards bounded `extras.chapters` to the consumer alongside an unrelated fallback message. Cosmetic — the `chapters` are bounded and announced via aria-live as plain text — but worth gating extras forwarding on byCode/byStatus matches if you want strict scope adherence.
- **`ALLOWED_ATTR` `Object.freeze` + spread comment overstates runtime safety** (`packages/client/src/sanitizer.ts:55, 110`). The comment says "belt-and-braces against any hypothetical mutation by the library itself" — true, but redundant given the freeze. The spread exists primarily for TypeScript compatibility with DOMPurify's `string[]` option type. Consider clarifying.
- **`S21` truncate test uses ASCII** (`packages/client/src/errors/apiErrorMapper.test.ts:483-492`). `"x".repeat(500).slice(0, 200) === truncateCodePoints("x".repeat(500), 200)`, so the test passes regardless of which implementation is used. The S4 surrogate-pair test (line 931-942) covers the code-point invariant separately — but consolidating into one test (e.g. using `("\u{1F984}x".repeat(250))`) would tighten the contract.

## Plan Alignment

Plan documents consulted:
- `docs/plans/2026-04-25-4b3a-review-followups-design.md`
- `docs/plans/2026-04-25-4b3a-review-followups-plan.md`
- `docs/roadmap.md`

**Implemented (Cluster D, expected):**
- [I14] Sanitizer URI hardening — UUID-shaped `ALLOWED_URI_REGEXP`, private DOMPurify instance, `uponSanitizeAttribute` hook, regression tests, full PATCH→snapshot→render e2e.
- [S21] `image.delete` extrasFrom — 50-entry cap with cap+1 validation window, 200-codepoint title truncation via `truncateCodePoints`, all-or-nothing rejection, allowlisted output (drops `id`), empty-array/empty-title/whitespace-only rejection.
- Roadmap update: 4b.3 → Done, 4b.3a → In Progress, plan-comment marker added.

**Not yet implemented (deferred to subsequent PRs on this branch, per plan):**
- Cluster A: `chapter.reorder` REORDER_MISMATCH, `chapter.save` network/404 strings, `trash.restoreChapter` 404 mapping.
- Cluster B: AbortSignal threading through `api/client.ts` and consumers.
- Cluster C: 14 items including the foundational `applyMappedError` helper and `ScopeExtras<S>` type.
- Cluster E: Mapper internals + CLAUDE.md updates (`safeExtrasFrom` not yet hardened, no `useTrashManager`/`SnapshotPanel` dedup).

**Deviations:**
- The two new skill files (`.claude/skills/ovid-receive-code-review/SKILL.md`, `.claude/skills/roadmap/SKILL.md`) and the Phase 4b.5 entry in roadmap Out-of-Scope are not enumerated as plan tasks. Substance is plan-traceable (mirrors design.md §Out-of-scope) but the changes were workflow-driven, not plan-driven. Low severity.
- Cluster D delivered more rounds of hardening than the plan originally listed: `Object.freeze(ALLOWED_ATTR)` (S3 round 3), surrogate-safe `for...of` truncation (S4 round 3), cap+1 validation window, `id`-drop, empty-string/whitespace title rejection, separate mXSS-namespace test. The plan was iteratively updated in tandem (commits `c1d90ef`, `43e5a82`, `01bc860`, `a9dd440`). Consistent with the plan's spirit.
- Branch name `ovid/miscellaneous-fixes` does not match plan title `4b.3a-review-followups`. Design.md:344 explicitly accepts this.

## Review Metadata

- **Agents dispatched:** Logic & Correctness; Error Handling & Edge Cases; Contract & Integration; Concurrency & State; Security; Plan Alignment
- **Scope:** packages/client/src/{sanitizer.ts, errors/scopes.ts, errors/apiErrorMapper.ts, __tests__/sanitizer.test.ts, errors/apiErrorMapper.test.ts}; packages/server/src/images/images.references.ts; e2e/{sanitizer-snapshot-blob, dashboard, editor-save, export, find-replace, images, snapshots, velocity}.spec.ts; adjacent consumers (ImageGallery.tsx, EditorPage.tsx, api/client.ts) read for verification
- **Raw findings:** 15 (after specialist review)
- **Verified findings:** 11 (after verification + empirical DOMPurify test)
- **Filtered out:** 4 (informational/redundant)
- **Steering files consulted:** `CLAUDE.md`, `docs/plans/2026-04-25-4b3a-review-followups-design.md`, `docs/plans/2026-04-25-4b3a-review-followups-plan.md`
- **Plan/design docs consulted:** Phase 4b.3a design + plan + `docs/roadmap.md`
