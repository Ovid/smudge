# Out-of-Scope Findings Backlog

> **These items were flagged by `/paad:agentic-review` as out of scope for the branch
> on which they were found.** They may be stale, may already have been fixed by other
> means, may no longer apply after refactors, or may simply have been judged not worth
> addressing. Verify each entry against the current code before acting on it. Entries
> are removed only when explicitly addressed — no automatic cleanup.
>
> **Entry lifecycle — do not delete a cited id.** When an entry is addressed, mark it
> **in place** with a `FIXED <date> by <sha>` or `Disposition` line. Delete an entry
> outright only if no commit tag and no code comment names its id. A citation is a
> permanent address: an id resolving to nothing makes a commit's fix-session PR-scope
> license unverifiable (`docs/roadmap-decisions/2026-08-19-architecture-fix-session-pr-scope.md`
> rule 1) and leaves a code comment justifying itself by a reference the reader cannot
> follow. This has already gone wrong eight times: `f518cf8d` had to be filed
> retroactively for exactly this reason, and the seven stubs in the closed-addresses
> section at the foot of this file were each cited by live code or by a commit tag
> while resolving to nothing. Reviews declare far more ids than are ever filed here;
> only the ones that reach code or a commit message need an address.

---

## `f4b4b15c` — `EditorFooter.tsx` `saveFailed` fallback is structurally unreachable
- **File (at first sighting):** `packages/client/src/components/EditorFooter.tsx:40`
- **Symbol:** `EditorFooter` (saveStatus="error" branch)
- **Bug class:** Contract
- **Description:** The `?? STRINGS.editor.saveFailed` defensive fallback at the saveStatus="error" render is unreachable in production: every site in `useProjectEditor.ts` that flips `saveStatus` to `"error"` always sets `saveErrorMessage` first. The branch's rename of `STRINGS.editor.saveFailed` therefore has no user-visible impact at this site, but the dead-code defense is a maintenance hazard.
- **Suggested fix:** Audit reachability and either remove the fallback or document its unreachability inline. Lower priority — purely cosmetic.
- **Disposition (2026-08-23, backlog triage):** **Won't fix — unreachability re-confirmed, and the fallback is the cheaper of the two states.** `useProjectEditor.ts` has exactly one `setSaveStatus("error")` site (`:621`) and it always writes a non-null `saveErrorMessage` on the next statement: `terminalSaveError?.message ?? (lastErr ? mapApiErrorMessage(...) : STRINGS.editor.saveFailed)` cannot evaluate to `null`. So the finding is accurate. Removing the `??` is still the wrong trade: it converts a one-token defence into a `string | null` render that shows nothing if a future second error-site forgets the message, and the render site cannot know that. Left as-is deliberately.
- **Confidence:** Medium
- **Found by:** Contract & Integration (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `e79576f`
- **Last seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `20f2616`
- **Severity:** Suggestion

## `7e2a9d41` — `Editor.flushSave` does not honor `setEditable(false)` lock
- **File (at first sighting):** `packages/client/src/components/Editor.tsx:333`
- **Symbol:** `flushSave` (exposed via `editorRef.current.flushSave`)
- **Bug class:** Logic
- **Description:** The I6 fix on the `ovid/miscellaneous-fixes` branch added an `editorInstance.isEditable === false` short-circuit inside `debouncedSave`. The same rationale (locked editor → save would deterministically 4xx and re-fire the lock setter) applies whenever any caller triggers `flushSave` while the editor is locked, but `flushSave` itself reads `editor.getJSON()` and calls `onSaveRef.current(...)` unconditionally. Today every live caller (Ctrl+S handler, `useEditorMutation`) gates externally via `editorLockedMessageRef`/`isEditorLocked()`, so no live path can reach this — pre-existing dead-defense gap, not exposed by this branch.
- **Suggested fix:** Add `if (!editor.isEditable) return Promise.resolve(true);` at the top of `flushSave` so the invariant is enforced at the Editor level (defense-in-depth). Add a regression test mirroring the I6 test in `Editor.test.tsx`.
- **Disposition (2026-08-23, backlog triage):** **Won't fix — the codebase has already decided against this fix, in writing, and the entry contradicts it.** `Editor.tsx`'s `flushSave` carries a comment ("C1, review 2026-04-26 f346047") stating that the guard is omitted *on purpose*: `useEditorMutation.run()` calls `setEditable(false)` **before** `flushSave` precisely so pending typing commits ahead of the server-side mutation, and a mirrored guard would silently destroy that typing — `markClean()` runs immediately after, `dirtyRef` goes false, and the cached draft is wiped. The comment also names the reason the flag cannot discriminate here: `isEditable` is overloaded, serving as both the persistent failure-lock signal and `useEditorMutation`'s in-flight mutation lock. The two callers that must not flush against a lock gate externally on `editorMachine.isLocked()`. The sibling guard the entry cites as precedent *was* applied where it is safe — the unmount cleanup (backlog `4d5b9e81`), whose comment says explicitly that "flushSave's C1 exemption below does NOT extend here". Do not re-derive this; adding the guard is a data-loss regression, not defence-in-depth.
- **Confidence:** Medium
- **Found by:** Logic & Correctness (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `20f2616`
- **Last seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `20f2616`
- **Severity:** Suggestion

## `3c4e8f72` — `chapter.create` scope lacks 5xx mapping; sibling-asymmetric to `chapter.save` 502/503/504
- **File (at first sighting):** `packages/client/src/errors/scopes.ts:157`
- **Symbol:** `chapter.create` scope
- **Bug class:** Error Handling
- **Description:** S7 of the prior review extended `chapter.save.byStatus` to map 500/502/503/504 → `saveFailedServer`. The same gap exists for `chapter.create`: it only maps 404 (project-gone) and the `committed`/network paths. A bare 500 (DB writer-lock saturation, transient sqlite I/O error) or a reverse-proxy 502/503/504 falls through to the `createChapterFailed` fallback. Same UX problem S7 was opened to solve, in a sibling scope.
- **Suggested fix:** Either add `byStatus: { 500/502/503/504: <new server-trouble copy> }` to `chapter.create`, or document the deliberate asymmetry inline. The new copy could reuse `STRINGS.editor.saveFailedServer`'s phrasing.
- **Re-verified 2026-08-23 (backlog triage): still open, unchanged.** `chapter.create` in `scopes.ts` still carries `byStatus: { 404: STRINGS.error.createChapterProjectGone }` and nothing else; `chapter.save` still carries the full `413/404/500/502/503/504` set. The asymmetry is intact and the fix is one scope edit.
- **FIXED 2026-08-23 by `8b146072`.** `chapter.create` now maps 500/502/503/504 to a new `STRINGS.error.createChapterFailedServer`, mirroring `chapter.save`'s I3 + S7 copy. A `SCOPES — chapter.create` describe block covers the four statuses and pins the surviving fallback on an unmapped 599. **Wider occurrence, not swept:** only these two scopes carry any 5xx mapping; the other ~36 fall through to their own fallback. Deliberately left — a blanket sweep means ~36 new strings for a UX gap nobody has reported on those surfaces, and this entry named the sibling asymmetry, not a repo-wide rule.
- **Confidence:** Medium
- **Found by:** Error Handling (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `f346047`
- **Last seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `f346047`
- **Severity:** Suggestion

## `5e6c7a92` — `ChapterTitle.test.tsx` retry-exhaustion test mocks raw `TypeError` instead of `ApiRequestError`
- **File (at first sighting):** `packages/client/src/__tests__/ChapterTitle.test.tsx:432`
- **Symbol:** retry-exhaustion test
- **Bug class:** Contract
- **Description:** `vi.mocked(api.chapters.update).mockRejectedValue(new TypeError("Failed to fetch"));`. Production's `apiFetch` wraps `TypeError("Failed to fetch")` into `new ApiRequestError("[dev] Failed to fetch", 0, "NETWORK")` before it reaches `useProjectEditor`. The test bypasses the entire NETWORK scope mapping; it passes because `scope.fallback` happens to equal `STRINGS.editor.saveFailed`. Real NETWORK retry exhaustion would surface `saveFailedNetwork` ("Unable to save — check your connection.") not `saveFailed` ("Save failed. Try again."). The test would still pass even if the scope's network mapping were broken.
- **Suggested fix:** Change the mock to `new ApiRequestError("[dev] Failed to fetch", 0, "NETWORK")` and update the assertion to `STRINGS.editor.saveFailedNetwork`. This actually exercises the scope.network mapping.
- **Re-verified 2026-08-23 (backlog triage): still open, unchanged.** The `mockRejectedValue(new TypeError("Failed to fetch"))` is now at `ChapterTitle.test.tsx:436` (line drift only). The test still passes for the wrong reason and would still pass if `chapter.save`'s `network:` mapping were deleted.
- **FIXED 2026-08-23 by `0a1c6f3c`.** The mock now rejects with `ApiRequestError("[dev] Failed to fetch", 0, "NETWORK")` — what `apiFetch` actually produces — and asserts `saveFailedNetwork`. The file's `api/client` mock gained the `code` field the mapper keys on. Verified load-bearing: deleting `chapter.save`'s `network:` entry turns it red. **Wider sweep done:** the four other raw-`TypeError` rejections are correct — the `api-client.test.ts` ones mock `fetch` itself (the layer that does the wrapping), and `EditorPageFeatures.test.tsx`'s is the deliberate I2 non-`ApiRequestError` case.
- **Confidence:** Medium-High
- **Found by:** Contract & Integration (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `f346047`
- **Last seen:** 2026-04-26 on branch `ovid/miscellaneous-fixes` at `f346047`
- **Severity:** Suggestion

## `afcaee1c` — Steering files don't mention SMUDGE_PORT/SMUDGE_CLIENT_PORT
- **File (at first sighting):** `CLAUDE.md`
- **Symbol:** "Tech Stack" / "Build & Run Commands" / project README sections
- **Bug class:** Contract
- **Description:** The branch `ovid/shared-port-validation` introduced a real env-var contract (`SMUDGE_PORT`, `SMUDGE_CLIENT_PORT`) for both server and client dev workflow, but no steering file mentions them. CLAUDE.md still describes "Express serves API + static frontend on port 3456" without qualification. CONTRIBUTING.md, README.md, and `.github/copilot-instructions.md` are similarly silent. Future maintainers reading CLAUDE.md as the contract will not realize these env vars exist or how they're validated.
- **Suggested fix:** Add a one-paragraph "Configuration" section to CLAUDE.md (and mirror in CONTRIBUTING.md) listing the supported env vars: `SMUDGE_PORT`, `SMUDGE_CLIENT_PORT`, `DB_PATH`, `LOG_LEVEL`, `NODE_ENV`. Reference `@smudge/shared/parsePort` for validation rules.
- **FIXED — and over-delivered — by commit `c882d2b9` (`fix(architecture): [F-33] add a configuration inventory and guard it`).** `docs/configuration.md` now inventories every variable the entry asked for plus `DATA_DIR` and the backup knobs, marking which fail fast and which warn-and-fall-back; CLAUDE.md carries a §Configuration paragraph pointing at it. The part the entry did not ask for is the part that keeps it true: `scripts/__tests__/configuration-doc.test.mjs` turns red when a new `process.env` read appears in production source without a row in that table, so the drift this entry describes cannot silently recur. Entry kept rather than deleted because commit `c882d2b9` cites the id (see §Entry lifecycle in the header).
- **Confidence:** High
- **Found by:** Contract & Integration (`claude-opus-4-7`)
- **First seen:** 2026-04-26 on branch `ovid/shared-port-validation` at `e6b6447`
- **Last seen:** 2026-04-27 on branch `ovid/devcontainer-and-e2e-isolation` at `5b89539`
- **Severity:** Suggestion

## `ca84e075` — CLAUDE.md / README / copilot-instructions reference docker-compose that doesn't exist
- **File (at first sighting):** `CLAUDE.md:22, 66`
- **Symbol:** "Tech Stack" / "Build & Run Commands" docker references
- **Bug class:** Contract
- **Description:** CLAUDE.md, README, and `.github/copilot-instructions.md` all describe `docker compose up` running the app on port 3456, but `find -maxdepth 2 \( -name "docker-compose*" -o -name "Dockerfile*" \) -not -path "*/node_modules/*"` returns nothing in the repo. The mvp.md plan references a future `${SMUDGE_PORT:-3456}:3456` mapping but the file does not exist. The newly-added JSDoc on `packages/shared/src/constants.ts:11` continues this pattern, claiming the constant is "Documented in CLAUDE.md and docker-compose."
- **Suggested fix:** Either add a minimal `docker-compose.yml` that uses `${SMUDGE_PORT:-3456}` and a matching Dockerfile (the architecture spec calls for it), or strip the docker references from CLAUDE.md / README / copilot-instructions / constants.ts JSDoc until those files exist. Document drift, pre-existing on main.
- **Partially fixed; re-scoped 2026-08-23 (backlog triage).** Two of the four sites are closed. The `constants.ts` JSDoc no longer claims the value is "documented in docker-compose" — commit `ff2f6b43` replaced that with the real ESM root cause and the parity test that enforces it. CLAUDE.md's §Tech Stack entry now qualifies the target at length: not yet implemented, no `Dockerfile`, and — added by architecture finding F-02 — an explanation that `docker run -p` **cannot** reach the `127.0.0.1` bind and that the `Host` allowlist would reject the forwarded header anyway, with both halves owned by roadmap Phase 7g.1.
- **Residual — three unqualified command lines, one of which is user-facing.** The verified fix now takes only `docker-compose.yml` still not existing as given:
  1. `README.md` — a `### Docker` heading whose body is a bare ```docker compose up``` fenced block followed by "Single container, single port (3456), SQLite database persisted via volume. Nothing to configure." This is the only one a **new reader** meets, and it instructs them to run a command that cannot work. Fix it first; it is the whole user-facing liability in this entry.
  2. `CLAUDE.md` §Build & Run Commands — `docker compose up` in the command block, unqualified, ~55 lines below the §Tech Stack paragraph that explains it does not work. A reader who greps the command block never sees the qualification.
  3. `.github/copilot-instructions.md` — the same line in its own command block.
  Mark all three as a Phase 7g.1 target rather than a runnable command. Do **not** close this by writing the Dockerfile: per CLAUDE.md §Tech Stack, the bind and the `Host` allowlist must widen together and that is a decision 7g.1 has to record, not a default to inherit.
- **FIXED 2026-08-23 by `c4ae0382`.** All three sites closed. README's `### Docker` section no longer carries a fenced command: it states that no Dockerfile or compose file exists, names Phase 7g.1, and gives the reason it is not merely unwritten (the `127.0.0.1` bind that `docker run -p` cannot reach, and the forwarded `Host` the allowlist rejects). CLAUDE.md's and copilot-instructions' command lines are commented out and labelled NOT RUNNABLE. The Dockerfile was deliberately not written, per the instruction above. No formatter was run over any of the three files.
- **Follow-up 2026-08-23 (review I9): "all three sites closed" was true of the three COMMAND LINES and false of the file-level drift this entry's heading describes.** `.github/copilot-instructions.md:20` still asserted the Docker deployment as accomplished fact — "**Deployment:** Single Docker container, Express serves API + static frontend on port 3456" — unqualified, 45 lines above the command line the fix commented out. That inverts the failure mode the entry was opened against, in a steering file for a code-generating assistant, and it states two things the code does not do: there is no container, and Express serves no static frontend. `docs/deferred-issues.md` carried the same false claim ("The app is exposed via Docker on port 3456") outside the three sites the entry enumerated. Both corrected; the deferred-issues one is annotated in place rather than rewritten, because it is a quoted historical finding.
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases, Contract & Integration (`claude-opus-4-7`)
- **First seen:** 2026-04-26 on branch `ovid/shared-port-validation` at `e6b6447`
- **Last seen:** 2026-04-27 on branch `ovid/devcontainer-and-e2e-isolation` at `5b89539`
- **Severity:** Suggestion

## `a4f29c1d` — Workspace `package.json` files lack `engines.node`
- **File (at first sighting):** `packages/server/package.json`
- **Symbol:** `engines` field (absent)
- **Bug class:** Contract
- **Description:** Root `package.json` declares `"engines": { "node": "22.x" }`, but `packages/shared/package.json`, `packages/server/package.json`, and `packages/client/package.json` have no `engines` field. With npm workspaces this is normally fine because the root constraint applies to monorepo-wide installs, but a future `npm install -w packages/server` invoked with `engine-strict=true` would not enforce 22.x at the per-workspace boundary. Pre-existing on main; not worsened by this branch.
- **Suggested fix:** Either propagate `"engines": { "node": "22.x" }` into each workspace's `package.json` (so the constraint is local), or document inline that the root engines field is authoritative for the monorepo.
- **Disposition (2026-08-23, backlog triage):** **Won't fix.** Still accurate — root `package.json` declares `"engines": { "node": "22.x" }` and the three workspaces declare none. It stays a non-problem because the trigger it needs does not occur here: nothing in the repo, the Makefile, CI, or CONTRIBUTING.md ever runs `npm install -w packages/<x>` as an entry point — installs go through the root. Propagating the field to three files buys enforcement for an invocation nobody makes, and then has to be kept in sync on every Node bump. Root is authoritative; that is the documentation.
- **Confidence:** Medium
- **Found by:** Contract & Integration (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-27 on branch `ovid/native-binding-build-infra` at `aff8498`
- **Last seen:** 2026-04-27 on branch `ovid/native-binding-build-infra` at `aff8498`
- **Severity:** Suggestion

## `b7e3d042` — `make all` reaches `ensure-native` only after lint/format-check/typecheck
- **File (at first sighting):** `Makefile:8`
- **Symbol:** `all` target prereq order
- **Bug class:** Contract
- **Description:** `all: lint format-check typecheck cover e2e`. Make resolves prereqs left-to-right by default, so a contributor with broken native bindings burns ~30s on lint/format-check/typecheck before `cover` invokes `ensure-native` and surfaces the rebuild prompt. The `all` target's order pre-dates this branch; the `ensure-native` prereq added by this branch only reaches it via `cover`/`e2e`. Cosmetic-touch demoted to OOS — line 8 was not modified.
- **Suggested fix:** Add `ensure-native` as the first explicit prereq of `all`, or as a prereq of `lint`/`format-check`/`typecheck`. Trade-off: ~50ms happy-path cost on every lint/format/typecheck run, paid more often than the cross-platform-churn rebuild it guards.
- **Re-verified 2026-08-23 (backlog triage): still open, and the stated trade-off is wrong in the cheap direction.** The target now reads `all: lint-check format-check typecheck cover e2e` (`lint` became `lint-check`), so the ordering problem is unchanged. But the entry prices the fix as a ~50ms tax, and for `all` specifically it is **free**: `cover` and `e2e` already declare `ensure-native` as a prerequisite, and Make runs a given target at most once per invocation — so adding it to the front of `all` reorders a probe that was always going to run, rather than adding one. Recommended form is `all: ensure-native lint-check format-check typecheck cover e2e`, which touches `all` only. The entry's *other* option — hanging it off `lint`/`format-check`/`typecheck` — is the one that really does cost a probe on every standalone lint run; skip that.
- **FIXED 2026-08-23 by `707afc10`.** Applied exactly the recommended form. Verified with `make -n all`: `node scripts/ensure-native.mjs` now prints first, and `grep -c` over the dry-run output confirms it appears exactly once — the free-not-a-tax claim holds. The `lint`/`format-check`/`typecheck` variant was skipped as instructed.
- **Confidence:** Medium
- **Found by:** Contract & Integration (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-27 on branch `ovid/native-binding-build-infra` at `aff8498`
- **Last seen:** 2026-04-27 on branch `ovid/native-binding-build-infra` at `aff8498`
- **Severity:** Suggestion

## `c9e54a31` — Em-dashes / arrows in Makefile error messages mojibake under non-UTF-8 locales
- **File (at first sighting):** `Makefile:65`
- **Symbol:** `ensure-native` diagnostic strings
- **Bug class:** Error Handling
- **Description:** The recipe uses UTF-8 glyphs (`→`, `—`) in error messages at lines 65, 73, 88, etc. On terminals with `LANG=C`/`LC_ALL=C`/minimal locales these render as mojibake. Most modern terminals are UTF-8 by default (macOS Terminal, iTerm2, GNOME Terminal, Windows Terminal, GitHub Actions runners, devcontainer terminals), so this is cosmetic in practice. Consistent with existing pattern in `cover` recipe (`════` boxes). Pre-existing repo-wide convention.
- **Suggested fix:** Replace `→` with `>>` and `—` with `--` for ASCII-safety, or document UTF-8 as a contributor-environment requirement. Repo-wide consistency matters more than locale resilience here.
- **Disposition (2026-08-23, backlog triage):** **Won't fix, and the target has moved.** The `ensure-native` recipe body no longer lives in the Makefile — it moved to `scripts/ensure-native.mjs` (plus `scripts/native-cache.mjs`) so it could be unit-tested, and that script uses the same `→` glyphs in its own diagnostics. So "fixing" this is now a two-file sweep across a Makefile that still carries 19 glyph-bearing lines plus a Node script, to change rendering on locales no contributor uses. The entry's own closing sentence already reaches this conclusion ("repo-wide consistency matters more than locale resilience here"); recording it so the next review does not re-open it.
- **Confidence:** Medium
- **Found by:** Error Handling & Edge Cases (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-27 on branch `ovid/native-binding-build-infra` at `aff8498`
- **Last seen:** 2026-04-27 on branch `ovid/native-binding-build-infra` at `aff8498`
- **Severity:** Suggestion

## `d8a1f562` — `npm rebuild` could surface `EBADENGINE` warnings to recipe stderr
- **File (at first sighting):** `Makefile:75`
- **Symbol:** `ensure-native` rebuild branch
- **Bug class:** Error Handling
- **Description:** Hypothetical: if a transitive dep declares an `engines.node` that current Node 22 doesn't satisfy, `npm rebuild` emits `npm warn EBADENGINE` to stderr. Per CLAUDE.md "Zero warnings in test output", this could be confused with a violation. However: (a) the zero-warnings rule applies to test runner output, not Make recipe output; (b) line 75 deliberately preserves stderr so warnings ARE meant to surface; (c) no current dep in `package-lock.json` has an unmet engines requirement. Current behavior is correct as-is.
- **Suggested fix:** None — surfacing warnings is the desired UX. If confusion recurs, document the rule's scope clarification ("zero warnings in test runner output, not Make recipe stderr") in CLAUDE.md.
- **Disposition (2026-08-23, backlog triage):** **Won't fix — closed as filed.** The entry proposes no change and its analysis holds: preserving `npm rebuild` stderr is the intended behaviour, and the CLAUDE.md zero-warnings rule scopes to test-runner output. It was a hypothetical logged for completeness, and the confusion it hedges against has not recurred in the ~4 months since. Nothing to act on.
- **Confidence:** Medium
- **Found by:** Logic & Correctness (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-27 on branch `ovid/native-binding-build-infra` at `aff8498`
- **Last seen:** 2026-04-27 on branch `ovid/native-binding-build-infra` at `aff8498`
- **Severity:** Suggestion

## `e7c64d29` — Round-trip dlopen probe cannot distinguish a partial `.node` from a Ctrl-C'd rebuild
- **File (at first sighting):** `Makefile:70`
- **Symbol:** `ensure-native` dlopen probes
- **Bug class:** Concurrency
- **Description:** Concurrency specialist's claim: a `Ctrl-C` mid-rebuild could leave a `.node` whose ELF header is valid but `.text` truncated, passing the `:memory:` probe and crashing on first real query. In practice, the dynamic linker maps file segments by offset — a truncated `.text` would either fail at `dlopen` (mmap returns ENXIO when offset+length exceeds file size) or surface as `SIGBUS` on first symbol resolution. The `new(...)(:memory:)` constructor exercises symbol resolution immediately. The probe is more robust than the finding suggests; pre-existing concern, low ROI to harden.
- **Suggested fix:** None — probe is sufficient for the threat model. If extra paranoia desired, switch the recipe to write to a temp path and atomically `mv -f` after a successful build to close the partial-write window. Most users will simply re-run `make test` after a Ctrl-C.
- **Disposition (2026-08-23, backlog triage):** **Won't fix — the optional half already shipped.** The "extra paranoia" the entry describes is now the implementation on the path where a partial file is actually produced by Smudge's own code: `scripts/native-cache.mjs` writes the cached binary to a `.tmp-<pid>-<rand>` path and then `renameSync`s it into place, with a best-effort cleanup so a failed copy leaves no orphan. The remaining window belongs to `npm rebuild --build-from-source`, which owns its own output file and which Smudge cannot wrap in a rename without reimplementing node-gyp's install step. The entry's primary conclusion — the `new(...)(":memory:")` probe forces symbol resolution and so a truncated `.text` fails at load rather than at first query — stands, and re-running `make test` after a Ctrl-C recovers regardless.
- **Confidence:** Medium
- **Found by:** Concurrency & State (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-27 on branch `ovid/native-binding-build-infra` at `aff8498`
- **Last seen:** 2026-04-27 on branch `ovid/native-binding-build-infra` at `aff8498`
- **Severity:** Suggestion

## `f3b8201a` — Direct `npm test` / `npm test -w` / `npx playwright test` bypass `ensure-native`
- **File (at first sighting):** `package.json:14-15`
- **Symbol:** root `scripts.test` and per-workspace `npm test -w` paths
- **Bug class:** Contract
- **Description:** Root `package.json` script `test` runs `npm test -w packages/{shared,server,client}` directly, and CONTRIBUTING.md (`:90-95`) actively recommends `npm test -w packages/server` and `npx playwright test` as per-package workflows. Neither path triggers `ensure-native`. A contributor doing per-package work after a host↔devcontainer crossing has no native-binding guard. Pre-existing — these scripts were not modified by this branch (the branch only added `ensure-native` to `make`-driven targets).
- **Suggested fix:** Add a `pretest` script in each workspace `package.json` (e.g. `"pretest": "node ../../scripts/ensure-native.mjs"` after extracting the recipe body), or strengthen the guidance in CONTRIBUTING.md to note "If you bypass `make`, run `make ensure-native` first when switching between host and devcontainer." Cleanest is to extract the probe into a node script with a single home.
- **Disposition (2026-08-23, backlog triage):** **Won't fix — the documentation branch of the entry's own fix shipped, and the enforcement branch is the wrong trade.** Both docs now carry the warning the entry asked for: `CONTRIBUTING.md` states that the per-package commands "bypass `make ensure-native`" and to run it once after a host↔guest crossing or a Node-version switch, and CLAUDE.md's §Build & Run Commands repeats it. The entry's "cleanest" suggestion also landed independently — the probe *is* a single-home Node script now (`scripts/ensure-native.mjs`), which is what makes a `pretest` hook a one-liner. It is still not worth adding: `pretest` fires on **every** `npm test`, including CI, where the platform never changes, to guard a failure mode that only a developer straddling macOS and the Linux devcontainer over one bind-mounted `node_modules` can reach — and that developer gets a loud `dlopen` error naming the fix. Reconsider only if the wrong-platform binding starts costing real debugging time.
- **Confidence:** Medium
- **Found by:** Contract & Integration (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-27 on branch `ovid/native-binding-build-infra` at `aff8498`
- **Last seen:** 2026-04-27 on branch `ovid/native-binding-build-infra` at `aff8498`
- **Severity:** Suggestion

## `05f9c8a4` — Compile-from-source still trusts the publisher's source tarball
- **File (at first sighting):** `Makefile:75`
- **Symbol:** `ensure-native` rebuild path (and the I5 rationale framing)
- **Bug class:** Security
- **Description:** General supply-chain residual: a compromised better-sqlite3 publisher can include malicious C++ in the next tarball; `package-lock.json` integrity hashes faithfully match the post-compromise source, so `npm rebuild --build-from-source` would compile and run that C++ at the next cross-platform churn. The branch's I5 framing ("eliminates ... attacker-controlled native binary running with developer's privileges") accurately describes the binary-trust improvement but understates the source-trust residual. The trust model is strictly better than `prebuild-install` (publisher compromise must include malicious source visible to code review, not just a `.node` on a CDN), but it is not zero-trust.
- **Suggested fix:** Document the residual precisely in CLAUDE.md (or a SECURITY.md). Optionally pin better-sqlite3 to an exact version (e.g., `=12.9.0` instead of `^12.x.x`) in `packages/server/package.json` to remove auto-pickup of compromised patches; pair with `npm audit signatures` (sigstore) to catch publisher key changes.
- **Narrowed 2026-08-23 (backlog triage) — most of this was answered by a control that did not exist when it was filed.** The dependency-cooldown gate has since landed: no lockfile version may be younger than 7 days, direct **or transitive**, enforced by the `dep-cooldown` CI job with a committed `dependency-cooldown-allowlist.json` (currently empty) where every waiver needs a written reason. That is a materially better answer to "a compromised publisher ships a bad tarball" than pinning is — a pin freezes one package against one attack, the quarantine covers the whole tree and still lets patches through after a week. Its spec, `docs/superpowers/specs/2026-06-01-dependency-cooldown-design.md`, already states the boundary in the entry's own terms: "age is a proxy, not integrity."
- **Residual — one paragraph, and it belongs in that spec.** What no document says is the compile-from-source half this entry is actually about: `npm rebuild --build-from-source` executes publisher-supplied C++ with the developer's privileges, and lockfile `integrity` hashes cannot detect it because they faithfully match the post-compromise tarball. The trust model is strictly better than `prebuild-install` (a compromise must ship source a human could read, not an opaque `.node` from a CDN) but it is not zero-trust. Add that to the spec's threat-model section, next to the sentence quoted above. Do **not** create a `SECURITY.md` for it — there is none today and one paragraph does not justify a new top-level policy document. Pinning `better-sqlite3` (today `^11.9.1`) is **not** recommended: it trades automatic security-patch uptake for protection the 7-day quarantine already provides.
- **FIXED 2026-08-23 by `2f413428`.** The paragraph is now in `docs/superpowers/specs/2026-06-01-dependency-cooldown-design.md`'s threat-model section, beside its own "age is a proxy, not integrity" boundary: `npm rebuild --build-from-source` runs publisher C++ with the developer's privileges, lockfile `integrity` cannot detect it, and the model is better than `prebuild-install` without being zero-trust. No `SECURITY.md` created; `better-sqlite3` left unpinned, both as instructed.
- **Confidence:** Medium
- **Found by:** Security (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-27 on branch `ovid/native-binding-build-infra` at `aff8498`
- **Last seen:** 2026-04-27 on branch `ovid/devcontainer-and-e2e-isolation` at `5f46256`
- **Severity:** Suggestion

## `20eccaf3` — `restoreFollowupAbortRef` allocation could leak controller past unmount in a theoretical microtask/commit interleaving (mountedRef gate prevents user-observable impact)
- **File (at first sighting):** `packages/client/src/hooks/useSnapshotState.ts:408-410, 473-478`
- **Symbol:** `restoreSnapshot`
- **Bug class:** Contract
- **Description:** Unmount cleanup at line 475 fires `restoreFollowupAbortRef.current?.abort()` once on tear-down. The follow-up controller is allocated synchronously after `await promise` resumes at line 376. If React committed an unmount between the microtask resolving `promise` and the continuation that runs the synchronous block at 408-410, the cleanup would have run against null/prior controller, and the new `followupController` would land AFTER cleanup. In practice the window is essentially closed (microtasks run before React's macrotask-scheduled commits) and the consuming `.then` is `mountedRef`-gated via `freshToken.isStale()`, so no setState-on-unmounted occurs even in the hypothetical case. Documents a theoretical hole in the S-16 hand-rolled-survivor contract for Phase 4b.4's inline justification.
- **Suggested fix:** Thread a `mountedRef` check before the assignment (skip the GET when `mountedRef.current === false`), or attach the unmount-cleanup behavior to a local boolean checked synchronously at allocation time.
- **Disposition (2026-08-23, backlog triage):** **Won't fix.** The shape is unchanged in `useSnapshotState.restoreSnapshot` — abort the prior follow-up controller, allocate a new one, assign the ref, fire the snapshot-list GET — and the entry's analysis of it is still correct on both halves: the interleaving needs React to commit an unmount between a microtask resolving and its own continuation, which the microtask/macrotask ordering does not permit, and even granting it, the `freshToken.isStale()` gate means no `setState` reaches an unmounted hook. The leak in the worst case is one `AbortController` and one in-flight GET, garbage-collected with the hook. What the site *did* gain since filing is the part that mattered: the follow-up now `devWarn`s on failure (was a bare swallow) and nulls the ref in `.finally` under an identity check, so a rejected follow-up no longer strands the ref. Adding a `mountedRef` to close a window that cannot open is not worth another moving part in this function.
- **Confidence:** Medium
- **Found by:** Contract & Integration (`claude-opus-4-7[1m]`)
- **First seen:** 2026-05-25 on branch `abortsignal-threading-completion` at `7d6e720`
- **Last seen:** 2026-05-25 on branch `abortsignal-threading-completion` at `7d6e720`
- **Severity:** Suggestion

## `8e3c1a47` — `cancelPendingSaves` clears `saveErrorMessage` but leaves `editorLockedMessage` banner stale
- **File (at first sighting):** `packages/client/src/hooks/useProjectEditor.ts:1243`
- **Symbol:** `cancelPendingSaves`
- **Bug class:** Logic
- **Description:** `cancelPendingSaves` sets `setSaveStatus("idle")` and `setSaveErrorMessage(null)` but does not clear the `editorLockedMessage` banner. If the user is in a `setEditable(false)` locked state and a flow calls `cancelPendingSaves` (e.g. snapshot restore initiation, future cleanup callers), the footer status clears but the alert lock banner remains, leaving a contradictory UI: footer says "idle" while alert still says "no longer available." Edge case — requires a cancel call after a terminal-code lock.
- **Suggested fix:** Factor the lock-banner clear into `cancelPendingSaves`, OR document that lock state is independent of save state and add an `editorLockedMessage` clear-on-success path in the lock-firing scopes.
- **Disposition (2026-08-23, backlog triage):** **Obsolete — the premise is gone, and the suggested fix would now violate a documented invariant.** Two things moved. First, `cancelPendingSaves` (`useProjectEditor.ts`) no longer resets the status unconditionally: it aborts the in-flight save and then clears only a `"saving"` status (`setSaveStatus((prev) => (prev === "saving" ? "idle" : prev))`), so the contradictory pairing the entry describes — footer reading "idle" beneath a live lock banner — no longer arises from this function; an `"error"` status survives the cancel. Second, and decisive: there is no `editorLockedMessage` state for `cancelPendingSaves` to clear. The lock now lives in the reducer in `useEditorMutationMachine` and renders from `editorMachine.state.lock?.message`, and CLAUDE.md §"Editor operational state lives in one machine" requires lock/unlock intent to route through that machine, naming free-standing `editorLockedMessage` refs as the thing not to reintroduce. Doing what this entry asks — teaching a save-pipeline function to clear lock state directly — is precisely the pattern that invariant forbids. Closed; do not re-file against the machine.
- **Confidence:** Medium
- **Found by:** Error Handling & Edge Cases (`general-purpose (claude-opus-4-7)`)
- **First seen:** 2026-04-27 on branch `ovid/cluster-a-error-mapping` at `4b43b07`
- **Last seen:** 2026-05-25 on branch `abortsignal-threading-completion` at `63c3049`
- **Severity:** Suggestion

## `a65acf76` — `handleCreateChapter` recovery `setProject(refreshed)` lacks S20-style inside-updater epoch guard
- **File (at first sighting):** `packages/client/src/hooks/useProjectEditor.ts:800`
- **Symbol:** `handleCreateChapter`
- **Bug class:** Concurrency
- **Description:** The recovery `setProject(refreshed)` at line 800 is gated only by the outer `projectRef.current?.id === projectId` check at line 799. Between that check and the queued setProject draining, a concurrent `loadProject(B)` can interleave a `setProject(B)`; because `projectRef` does not update until render commit, the outer guard can pass while a setProject(B) is already queued. If A's queued update drains after B's, project B is overwritten by A's refreshed snapshot. Plan Task 34 Step 5 (S20) explicitly identifies this site as analogous to `handleReorderChapters` and elects to leave as-is for 4b.3c.2, deferring the fix to 4b.3c.3 [I4] (Task 40).
- **Suggested fix:** Convert to `setProject((prev) => prev && prev.id === projectId ? refreshed : prev)`. The `confirmedStatusRef` re-seed at lines 809-811 and the `setActiveChapter`/`setChapterWordCount` calls at 820-821 should be guarded similarly or moved into a render-keyed effect.
- **Merged into `8b34a209` on 2026-08-23 (backlog triage); this heading kept as an address only.** Both entries describe one missing guard — no `prev.id === projectId` re-check *inside* the `setProject` updater — at the two `setProject` calls of the same function, which has since moved from `useProjectEditor.ts` to `useChapterCrud.ts`. Work them as one fix; the analysis and the current line references live under `8b34a209`. Kept rather than deleted because commit `7e57a178` names this id (see §Entry lifecycle in the header).
- **Note on what already changed here.** The recovery arm this entry points at *was* strengthened, on a different axis: it now gates on the full `isStaleProject()` guard instead of the id-only compare, closing the pre-load window in which the URL has advanced to project B while `projectRef` still holds A. That was finding OOSS1 (commit `8e6dad22`), and commit `7e57a178` dropped its sibling entry `ddfa2117` while explicitly keeping this one — "it proposes an inside-updater epoch guard on the same setProject call, which is a different fix from upgrading the outer guard." That reasoning stands: an outer guard, however strong, is evaluated before React drains the queued updater.
- **Confidence:** Medium
- **Found by:** Concurrency & State (`claude-opus-4-7[1m]`)
- **First seen:** 2026-05-26 on branch `consumer-recovery-helper-consuming-fixes` at `490e351`
- **Last seen:** 2026-05-26 on branch `consumer-recovery-helper-consuming-fixes` at `490e351`
- **Severity:** Suggestion

## `7f2c1e08` — `handleUpdateProjectTitle` recovery-GET catch silently swallows every non-404 error
- **File (at first sighting):** `packages/client/src/hooks/useProjectEditor.ts:1418`
- **Symbol:** `handleUpdateProjectTitle` recovery branch
- **Bug class:** Error Handling
- **Description:** The recovery `catch (recoveryErr) { if (isApiError(recoveryErr) && recoveryErr.status === 404) onRequestEditorLockRef.current?.(...) }` block fires `onRequestEditorLock` only on a 404. NETWORK, 500, BAD_JSON, ABORTED — every other failure path drops on the floor with no `devWarn`, no banner. The OOSS1/OOSS2/S2 sweep added `devWarn` to three sibling recovery sites (`handleStatusChange:1564`, `handleCreateChapter:937`, `handleRestore:307`); `handleUpdateProjectTitle` is now the lone remaining silent-swallow. Pre-existing on main (authored 2026-04-24 commit `35e95c66`); the 4b.3c.3 branch did not touch the hunk.
- **Suggested fix:** Add `devWarn("handleUpdateProjectTitle recovery GET failed", recoveryController.signal, recoveryErr);` immediately before the 404 check at line 1430. Optionally also reread `projectSlugRef.current` for the recovery GET URL freshness (matches the S1 round-2 pattern in `handleCreateChapter:879`).
- **Re-verified 2026-08-23 (backlog triage): still open. Two corrections — the file moved, and the swallow is narrower than described.** `handleUpdateProjectTitle` now lives in `packages/client/src/hooks/useChapterMetadata.ts`, not `useProjectEditor.ts`; the entry's `:1418`/`:1430` line numbers are dead. In the current code the recovery `catch (recoveryErr)` still fires `onRequestEditorLock` on a 404 and does nothing at all on NETWORK, 500, `BAD_JSON` or `ABORTED` — the finding holds. But the *outer* catch already ran `clientWarn("Failed to update project title:", err)` on the originating error before entering the `possiblyCommitted` branch, so a developer is not blind to the flow; what is lost is specifically the recovery GET's own failure reason. That downgrades the impact from "silent" to "unattributed" — still worth the one `devWarn`, no longer the lone silent-swallow the entry claims.
- **Also note the recovery arm gained a guard since filing.** Its success path is now `if (!isStaleProject()) { setProject(refreshed); projectSlugRef.current = refreshed.slug; }` — OOSS1, which fixed a worse bug in the same block: the old id-only check let this arm rewind `projectSlugRef` to the previous project's slug during the pre-load navigation window, permanently, causing silent cross-project writes for the rest of the session. Read that comment before touching the block; the `devWarn` goes in the `catch`, which OOSS1 did not change.
- **FIXED 2026-08-23 by `947c0bc6`.** `devWarn("handleUpdateProjectTitle recovery GET failed", recoveryController.signal, recoveryErr)` now leads the catch, ahead of the unchanged 404 arm, gated on the per-call signal so a supersede or unmount stays silent. New test in `useProjectEditor.test.ts` drives a recovery 500 and asserts both the originating warn and the recovery warn, plus that no lock fires (a non-404 does not move the slug). OOSS1's success arm untouched.
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases (`claude-opus-4-7[1m]`)
- **First seen:** 2026-05-27 on branch `consumer-recovery-independent-fixes` at `a4bb07e`
- **Last seen:** 2026-05-27 on branch `consumer-recovery-independent-fixes` at `a4bb07e`
- **Severity:** Suggestion

## `8b34a209` — `handleCreateChapter` success-path `setProject` lacks inside-updater epoch guard
- **File (at first sighting):** `packages/client/src/hooks/useProjectEditor.ts:780`
- **Symbol:** `handleCreateChapter` success path
- **Bug class:** Concurrency
- **Description:** `setProject((prev) => prev ? { ...prev, chapters: [...prev.chapters, newChapter] } : prev)` at line 780 does NOT re-check `prev.id === projectId` inside the updater, unlike the analogous `handleReorderChapters:1289-1306` which DOES check (S20 pattern). If a concurrent `loadProject(B)`'s `setProject(B)` queues between the outer drift guard at line 775-777 and React draining A's updater, and A's drains after B's, A's `newChapter` is appended to B's chapter list — a phantom chapter referencing project A wedged into project B's UI. Sibling `setActiveChapter(newChapter)` at line 778 and `confirmedStatusRef.current[newChapter.id] = newChapter.status` at line 788 compound. Pre-existing on main (commit `dc6a8fca`, 2026-04-21); not touched by this branch. Sibling-asymmetric with the S20 inside-updater pattern.
- **Suggested fix:** Convert to `setProject((prev) => prev && prev.id === projectId ? { ...prev, chapters: [...prev.chapters, newChapter] } : prev)`. The `setActiveChapter(newChapter)` at line 778 and the imperative `confirmedStatusRef.current[newChapter.id] = newChapter.status` at line 788 should be similarly guarded (or moved into a render-keyed effect).
- **Re-verified and merged 2026-08-23 (backlog triage): still open. Absorbs `a65acf76`, which is the same missing guard on the other `setProject` call of the same function.** The function has moved from `useProjectEditor.ts` to `packages/client/src/hooks/useChapterCrud.ts`; every line number in both entries is dead. The two sites now are:
  1. **Success path** — `setProject((prev) => (prev ? { ...prev, chapters: [...prev.chapters, newChapter] } : prev))`, immediately after `setActiveChapter(newChapter)` / `setChapterWordCount(0)` and before the `confirmedStatusRef.current[newChapter.id] = newChapter.status` seed. Unchanged since filing: no `prev.id === projectId` test inside the updater.
  2. **Recovery path** (was `a65acf76`) — `setProject(refreshed)` plus `replaceConfirmedStatusesFromProject(refreshed)`, inside an `if (!isStaleProject())`.
- **What the outer guards do and do not cover.** Both sites are now behind `isStaleProject()` (built at entry via `makeStaleProjectGuard`), which is strictly stronger than the id-only compare the entries were written against — it also catches the pre-load window where the URL has advanced to project B but `projectRef` still holds A. That closes the *common* miss. It does not close the one these entries are about: `isStaleProject()` is evaluated when the handler resumes, while the updater body runs later, when React drains the queue. A `setProject(B)` from a concurrent `loadProject(B)` queued in between still drains first, and A's updater then appends A's chapter onto B's list — a phantom chapter in project B's sidebar whose id points into project A. An outer guard cannot see inside the queue; only the updater can.
- **Fix, both sites together:** re-test identity inside the updater — `setProject((prev) => (prev && prev.id === projectId ? <merge> : prev))` on the success path and the same wrapper around `refreshed` on the recovery path. Follow the existing precedent rather than inventing one: `handleReorderChapters` already does the inside-updater check (the S20 pattern). The imperative siblings that ride along — `setActiveChapter`, `setChapterWordCount`, and both `confirmedStatusRef` writes — are the residual: they are plain assignments with no updater to hide in, so either guard them on the same condition or move them into a render-keyed effect. Note the reachability caveat that has kept this at Suggestion since 2026-05: it needs a project switch to land mid-POST, which the UI makes hard to provoke.
- **FIXED 2026-08-23 by `a254d743` (closing `a65acf76` with it).** Both `setProject` calls in `useChapterCrud.handleCreateChapter` now re-test `prev.id === projectId` inside the updater, following the S20 precedent in `handleReorderChapters`. New test file `hooks/__tests__/useChapterCrud.epochGuard.test.tsx` drives the hook with a spy `setProject`, captures the updater, and invokes it with a foreign-project `prev` — the exact state React would hand it after a concurrent switch drained first. Both guards verified load-bearing by reverting them individually.
- **Residual documented in code, not fixed — enumeration corrected 2026-08-23 (review I6).** FOUR writes keep the outer guard only, not three: `setActiveChapter` and `setChapterWordCount` on the success path, and on the RECOVERY path `replaceConfirmedStatusesFromProject(refreshed)` plus its own `setActiveChapter`/`setChapterWordCount`. This line and the in-code comment both said "the `confirmedStatusRef` seed", singular, which named only the success-path single-key seed and dropped the recovery arm's WHOLE-MAP replacement — the more damaging of the two, since it evicts every live baseline rather than adding one. Per CLAUDE.md F-19 the enumeration is the mitigation, so the unnamed residual had none. Note also that the obvious patch does not work: adding a statement-time re-check before those writes, as `useTrashManager` does, cannot close the drain window, because `projectRef.current` is a render-body mirror and still reads the OLD project at that point. The additive-write fix that would close it is filed as `9c2ad4e1`.
  The three `setActiveChapter`/`setChapterWordCount` writes remain genuinely unclosable here: they are plain value sets with no updater body, so there is no drain-time hook where the same re-test could live, and closing them means moving the active-chapter transition into a render-keyed effect — a structural change past a backlog fix. The comment at the site records the trade that makes: in the queue-drain window the sidebar now stays correct while the editor may briefly hold A's chapter — confusing, and it clears on the next project load, where before the window left a phantom chapter wedged in B's list that reorder and delete would then operate on.
- **Confidence:** Medium
- **Found by:** Concurrency & State (`claude-opus-4-7[1m]`)
- **First seen:** 2026-05-27 on branch `consumer-recovery-independent-fixes` at `a4bb07e`
- **Last seen:** 2026-05-27 on branch `consumer-recovery-independent-fixes` at `a4bb07e`
- **Severity:** Suggestion

## `c4571a83` — `useKeyboardShortcuts` bare `.catch(() => {})` on two awaitable calls
- **File (at first sighting):** `packages/client/src/hooks/useKeyboardShortcuts.ts:168, 190`
- **Symbol:** `switchToViewRef.current(...).catch(() => {})` and `handleSelectChapterWithFlushRef.current(...).catch(() => {})`
- **Bug class:** Error Handling
- **Description:** Both awaitable calls drop errors silently with no `devWarn`. Sibling-divergence with the OOSS1/OOSS2/S2 sweep that just upgraded structurally identical swallows in `useSnapshotState.ts:241, 530`. Pre-existing on main; not touched by this branch. Both targets surface user-visible errors internally via `setActionError`, so the impact is observability-only today; a thrown-not-caught error from a future refactor that bypasses the internal banner would silently disappear.
- **Suggested fix:** Replace each bare swallow with `devWarn("keyboard shortcut switchToView failed", <signal>, err)` and the analogous wording for the chapter-switch path. The two callers don't have a controller signal in scope today; either pass `new AbortController().signal` (always non-aborted) or accept the silent swallow with a comment explaining why these are recoverable internal-error sites.
- **Halved 2026-08-23 (backlog triage): one of the two sites is fixed; narrow this entry to the other.** The chapter-switch call is no longer a bare swallow — it now reads `.then(settle).catch(() => { settle(false); })` with the comment "Navigation failed outright — same as a refusal", which routes the failure into the same live-region announcement a refused navigation produces (`STRINGS.sidebar.navigationFailed`). That is a better outcome than the `devWarn` this entry asked for: the *user* learns the navigation did not happen, not just a developer reading a console.
- **Residual — the view-toggle site only.** `switchToViewRef.current(target).catch(() => {})`, on the Ctrl+Shift+P preview/editor toggle, is still a bare swallow. Its sibling now shows the shape to copy: give the failure a user-visible consequence rather than a log line. The natural one is the same `setNavAnnouncement` live region the chapter-switch path uses, since a silently-refused view toggle is otherwise indistinguishable from a dead keybinding. If that is judged overkill for a toggle whose target surfaces its own errors via `setActionError`, then take the entry's fallback and leave a comment saying so — but do not leave it bare and unexplained, which is what makes it read as an oversight to every subsequent review.
- **FIXED 2026-08-23 by `dc94651d`, taking the fallback and saying why.** The live-region option was rejected on evidence rather than on effort: `switchToView` answers every refusal it knows about with its own banner (`mutationBusy`, `lockedRefusal`, `viewSwitchSaveFailed`) and converts a `flushSave` throw into banner + `false`, so it has **no rejecting path today**. A rejection arriving at the shortcut is therefore a defect in `switchToView`, not a condition to narrate to the writer — an announcement would be inventing a user-facing story for something that cannot happen. The swallow is now `clientWarn("Ctrl+Shift+P view toggle failed:", err)` under a comment stating that reasoning, with two tests (warns on reject, silent on resolve). **Wider sweep:** one bare `.catch(() => {})` remains, at `Editor.tsx`'s unmount cleanup. Left deliberately — it sits inside a documented fire-and-forget block that states `dirtyRef` stays true and the content cache still holds the draft, and warning at unmount would fire on ordinary navigate-away-while-offline.
- **Confidence:** Medium
- **Found by:** Error Handling & Edge Cases (`claude-opus-4-7[1m]`)
- **First seen:** 2026-05-27 on branch `consumer-recovery-independent-fixes` at `a4bb07e`
- **Last seen:** 2026-05-27 on branch `consumer-recovery-independent-fixes` at `a4bb07e`
- **Severity:** Suggestion

## `fa8e879a` — restore inflates each archive entry fully into RAM before the byte-budget check
- **File (at first sighting):** `packages/server/src/backup/backup-core.ts` (`runRestore`, the `file.async("nodebuffer")` extraction loop)
- **Symbol:** `runRestore` per-entry extraction
- **Bug class:** Security (resource exhaustion)
- **Description:** `file.async("nodebuffer")` decompresses a full entry into memory before the post-write cumulative-size assertion fires, so a central directory that lies about declared sizes can OOM the host before the disk-budget check. This is an explicitly documented tradeoff: design §2b and the inline comment acknowledge per-entry RAM is unbounded under jszip's in-memory model and ship no mitigation. Review S1 (operational-backup-stopgap).
- **Suggested fix:** Future hardening pass — stream-decompress with a running counter, or bound per-entry declared size before inflating. Deferred from the 4b.14 review pass as an accepted design tradeoff (not a regression).
- **Reclassified 2026-08-23 (backlog triage): not a review finding — a Phase 8b inheritance.** Re-verified present: `runRestore` still calls `file.async("nodebuffer")` per entry, and the inline comment above it still names the unbounded per-entry RAM. Nothing has changed and nothing should change here, because this is not an unaddressed defect — it is a property the operator-tool stopgap was *approved with*, recorded in `docs/roadmap-decisions/2026-06-03-phase-4b-14-operational-backup-stopgap.md` and in the design's §2b. Leaving it in an "out-of-scope findings" list invites each new review to rediscover it and each triage to re-adjudicate it. **Action:** when Phase 8b (the real backup story) is brainstormed, carry this and `248bf265` in as known constraints of the code being replaced — jszip's in-memory model is the thing 8b gets to choose differently. It does not need fixing inside the stopgap: the threat needs a hostile archive, and the stopgap only ever consumes archives it wrote itself, on a single-user machine, under a manually-confirmed command.
- **Confidence:** High (behavior), Low (real-world risk — stopgap consumes its own archives)
- **Found by:** Security (`claude-opus-4-8[1m]`)
- **First seen:** 2026-06-04 on branch `operational-backup-stopgap` at `1aa1eec`
- **Last seen:** 2026-06-04 on branch `operational-backup-stopgap` at `1aa1eec`
- **Severity:** Suggestion

## `248bf265` — restore probe-then-act TOCTOU: server can bind between probePort() and the move-aside
- **File (at first sighting):** `packages/server/src/backup/backup-core.ts` (`runRestore`, between the `probePort()` check and the move-aside rename)
- **Symbol:** `runRestore` running-server guard
- **Bug class:** Concurrency
- **Description:** A Smudge server binding the port between `probePort() === false` and the move-aside rename is not re-detected → potential split-brain. Inherent to any probe-then-act guard; the move-aside ("never delete") is the deliberate backstop and restore is manual/confirmed/rare. Review S5 (operational-backup-stopgap).
- **Suggested fix:** Optionally re-probe immediately before the rename, or document the residual window. Deferred from the 4b.14 review pass as an accepted, backstopped tradeoff.
- **Reclassified 2026-08-23 (backlog triage): not a review finding — a Phase 8b inheritance. Same disposition as `fa8e879a`, and for a stronger reason.** Re-verified present: `runRestore` still guards with `if (opts.probePort && (await opts.probePort()))` ahead of the move-aside. The window is real and cannot be closed, only narrowed — a re-probe immediately before the rename shortens it but leaves the identical shape, because every probe-then-act guard has one. Narrowing an unclosable window buys little against a deliberate backstop that already exists: the restore never deletes, it moves aside, so the split-brain outcome is recoverable rather than destructive. **Action:** carry into Phase 8b as a known constraint. A genuine fix means a different mechanism — a lockfile or an advisory lock the server holds for its lifetime, so the restore tests for ownership rather than for a symptom — which is an 8b design choice, not a patch to the stopgap.
- **Confidence:** High (window exists), Low (single-operator usage model)
- **Found by:** Concurrency & State (`claude-opus-4-8[1m]`)
- **First seen:** 2026-06-04 on branch `operational-backup-stopgap` at `1aa1eec`
- **Last seen:** 2026-06-04 on branch `operational-backup-stopgap` at `1aa1eec`
- **Severity:** Suggestion

## `e8ba6c7b` — EOCD backward scan can mis-identify a 0x06054b50 inside the archive comment
- **File (at first sighting):** `packages/server/src/backup/backup-core.ts` (`findEocdOffset`)
- **Symbol:** `findEocdOffset`
- **Bug class:** Logic / Security (safe-failure)
- **Description:** The end-of-central-directory backward scan stops at the first `0x06054b50`; a zip comment containing those bytes after the true EOCD causes a mis-parse. Safe-failure — a valid archive is *refused* (DecompressionBombError), never clobbered — and low likelihood (our archives carry no comment; image names are UUIDs). Review S4 (operational-backup-stopgap). NOTE: not part of the enumerated "cheap suggestions" set addressed in the 4b.14 review pass; explicitly descoped, recorded here.
- **Suggested fix:** In `findEocdOffset`, validate the candidate EOCD's comment-length field (`buf.readUInt16LE(i + 20)`) reaches exactly end-of-buffer (`i + 22 + commentLen === buf.length`) before accepting it; continue scanning otherwise. Now a ~3-line guard since the parser is centralized (S9).
- **Re-verified 2026-08-23 (backlog triage): still open, unchanged, and it is the cheapest real fix left in this file.** `findEocdOffset` has moved to `packages/server/src/backup/backup-zip-format.ts` (the parser was centralized there, which is what S9 anticipated), and its body is still the bare backward scan returning the first `0x06054b50` with no comment-length validation. The suggested guard drops in as written. Two notes for whoever takes it. First, the scan runs backward from the end, so the *first* signature it meets is the last one in the file — a comment containing those bytes shadows the true EOCD only when it sits after it, which is exactly the case the length check discriminates. Second, `findEocdOffset` is exported specifically so the decompression-bomb tests parse with production's own logic, so the new guard is covered by those tests the moment it lands; add one positive case (an archive with a comment whose bytes contain the signature, which must still parse) so the guard is not merely present but pinned.
- **ATTEMPTED AND REVERTED 2026-08-23 (`fe7acdb7`, reverted same day). STILL OPEN — and not fixable at this layer.** The suggested guard shipped, then came out again after review 2026-08-23 (I1/I2/I3) measured it. Three findings, all by execution, all of which the next person to pick this up needs:
  1. **The guard refused working archives.** Any trailing bytes after the comment — block padding, a transfer that rounded up, a zip at the head of a larger file — made every candidate fail the equality, so `findEocdOffset` returned -1 and `walkCentralDirectory` threw `DecompressionBombError("not a valid zip (no EOCD)")`. Measured at +1/+4/+17/+18/+22/+30/+1000 bytes: `JSZip.loadAsync` loads all of them, the guard refuses all of them. `make restore` is the post-data-loss path; it must not be pickier than the library it hands the bytes to. Now pinned end-to-end by the `runRestore` test "restores an archive that carries trailing bytes after the EOCD comment".
  2. **The guard rescued nothing.** `runRestore` parses each archive **twice with two independent parsers** — this module's locator at step 1 (validation) and `JSZip.loadAsync` at step 6 (extraction). jszip locates the EOCD with a bare backward `lastIndexOfSignature` and no comment-length validation of its own (`node_modules/jszip/lib/zipEntries.js` `readEndOfCentral`, `lib/reader/ArrayReader.js` `lastIndexOfSignature`), so it selects the same decoy and throws `End of data reached ... Corrupted zip ?`. The guard only moved the refusal from step 1 to step 6 and changed the message to blame corruption. Pinned by "jszip refuses the archive, so no locator change here can restore it".
  3. **The case was hypothetical and remains unreachable for Smudge's own archives.** `runBackup` never passes a `comment` to `generateAsync`, exactly as this entry's original Description said ("our archives carry no comment"). The "real jszip archive" in the `fe7acdb7` commit message was a fixture the commit constructed.
  **What would actually close it:** not a better locator. The two parsers cannot be brought into agreement by patching one of them — jszip scans the whole buffer from `length - 4`, this one stops at `length - 22` and after 64 KiB, so an archive with an over-long comment loads in jszip and is refused here under *any* rule (measured: a 70 000-char comment gives jszip offset 102 and a successful load, and -1 here). See the new entry below on collapsing to a single parser. Until that lands, keeping this locator's rule identical to jszip's is the property worth protecting, and the current bare-signature scan is what protects it.
- **Confidence:** High
- **Found by:** Logic & Correctness / Security (`claude-opus-4-8[1m]`)
- **First seen:** 2026-06-04 on branch `operational-backup-stopgap` at `1aa1eec`
- **Last seen:** 2026-06-04 on branch `operational-backup-stopgap` at `1aa1eec`
- **Severity:** Suggestion


## `6c588883` — F-29's liveness-check-plus-read atomicity applied at 3 sites; ~11 identical siblings left split
- **File (at first sighting):** `packages/server/src/projects/projects.service.ts:112`
- **Symbol:** `getProject`
- **Bug class:** Logic
- **Description:** F-29 wrapped the parent-liveness check and the child read in one `store.transaction` at `listImages`, `listSnapshots` and `getSnapshot`. Structurally identical check-then-act siblings stay split across two round trips: `projects.service.ts` `getProject:112`, `updateProject:133`, `createChapter:204`, `reorderChapters:248`, `getDashboard:281`; `images.service.ts` `uploadImage:73`, `getImageReferences:270`; `search.service.ts` `searchProject:128`, `replaceInProject:222`; `export.service.ts:36`; `velocity.service.ts:85`. Reads answer 200-with-data instead of 404 on a soft-delete race; the two write sites commit a row or rewrite chapters under a trashed project. The race is verified real: no `pool` key in `knexfile.ts`, Knex sqlite3 defaults to `{min:1,max:1}`, a real `BEGIN` is issued, and under WAL the read snapshot is pinned at the first read.
- **Suggested fix:** Either wrap the remaining sites, prioritising `replaceInProject` (a write, and no I/O complication), or record in F-29's report entry which sites were knowingly left split and why. Two caveats: `uploadImage` does filesystem I/O the codebase deliberately keeps outside transactions on the max:1 pool (see `createChapter`'s comment at `:236-239`), and `getImageReferences` needs `scanImageReferences` to accept a store rather than calling `getProjectStore()` itself (the starvation trap the new F-29 comments warn about). At 11 sites a `withLiveProject(store, projectId, fn)` helper stops being speculative.
- **Disposition (2026-08-20, `/paad:rethink`):** **Won't fix — the premise is false for 10 of the 11 sites.** Measured, not argued: a second request's handler cannot run between two awaited Knex/better-sqlite3 calls in this process (synchronous driver → microtask continuation → drains before Node polls network I/O; a `setImmediate` control in the same harness interleaved on hop 0). `getImageReferences` is a false positive (the `images` table has no soft delete). `uploadImage` is the one reachable site — its window contains a filesystem write, which does yield — but its outcome self-heals (restore yields the image correct; the 30-day trash purge deletes both row and directory), so it is left too. Full reasoning, the shape a future fix should take, and the conditions that would flip this are recorded in F-29's Status note in `paad/architecture-reviews/2026-08-11-smudge-architecture-report.md`. Entry kept rather than deleted so a later review that re-finds these sites lands on the measurement instead of re-deriving it.
- **Confidence:** Medium
- **Found by:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration (`claude-opus-5[1m]`)
- **First seen:** 2026-08-20 on branch `ovid/architecture` at `67c00204`
- **Last seen:** 2026-08-20 on branch `ovid/architecture` at `67c00204`
- **Severity:** Suggestion

## `8ff156ec` — Nothing at any level tests that a locked editor can become writable again
- **File (at first sighting):** `e2e/editor-save.spec.ts:107`
- **Symbol:** `PATCH 404 surfaces chapter-gone copy`
- **Bug class:** Error Handling
- **Description:** The editor's persistent read-only lock has zero tests, at any level, demonstrating a writer getting back to work after one. Five reducer unit tests assert the lock field becomes `null` (`useEditorMutationMachine.test.tsx:47,54,70,80,91`); two hook tests fold a dispatched-event list through the reducer by hand (`useEditorMutation.test.tsx:1687,1706`); nineteen component tests name the lock but only assert it appears, or that something is refused while it stands; the one e2e test intercepts a save with a 404, asserts `contenteditable === "false"`, and ends. Counterfactual verified by exhaustive grep: make `EDITOR_REMOUNTED` preserve the lock and exactly two reducer unit assertions go red — zero component tests, zero e2e tests. The lock is reachable in ordinary use (autosave PATCH 404 when a chapter is deleted under an open editor, via `chapter.save` `terminalStatuses` at `scopes.ts:237` + `useProjectEditor.ts:666-671`) and is an in-editor dead end: the three lock-clearing events all dispatch from inside `useEditorMutation.run()`, whose three callers all refuse at entry while locked, and `UNLOCK` has no production dispatcher. Recovery is the banner's `window.location.reload()` button (`EditorMainContent.tsx:231-241`) and an undocumented logo-navigation route (`EditorPage.tsx:1115` → `EditorHeader.tsx:77-82`, unmounting the page discards the reducer state). Both untested as exits. A regression in either strands a writer in a read-only editor.
- **PARTIALLY ADDRESSED 2026-08-22** on branch `ovid/architecture`: two e2e tests added in `e2e/editor-save.spec.ts` covering both real exits (banner Refresh button; leave-project-and-return), each verified load-bearing by breaking its exit and watching the matching test fail. **Corrected 2026-08-22 ([I2], same-day review):** the leave-and-return test's return leg called `gotoProjectEditor`, i.e. `page.goto` — a full document navigation that would have satisfied the test on its own, so it did not actually exercise the SPA route it claimed. It now returns through the dashboard card and carries a `window` marker that fails the test if a page load ever creeps back in. Note the original counterfactual in this entry was empirically confirmed but MISREAD: `EDITOR_REMOUNTED`'s `lock: null` is unreachable in production (neither effect dependency can move while a lock stands), so only two reducer assertions failing is correct coverage for a dead arm, not a gap — and neither real exit passes through the reducer at all. **Entry kept open** for the residual: a guard test pinning that the lock banner renders above every view branch (its universality is incidental — a future early return above `EditorMainContent` would hide the only documented escape and no test would notice).
- **Suggested fix (residual), rewritten 2026-08-23 (backlog triage) — the block that stood here still described the two tests that have since shipped.** One thing is left: a guard test pinning that the lock banner renders above **every** view branch. Re-verified in `EditorMainContent.tsx`: the banner (with its Refresh button, the only documented escape) renders inside the `flex-1 flex flex-col` column, above a five-way ternary — trash view, the no-chapters empty state, preview, dashboard, and the active editor. Its universality is therefore **incidental**, a consequence of sitting above the chain rather than of any rule. An early return added above that column, or the banner moved inside one arm, would strand a locked writer on whichever view they happened to be on, and no existing test would notice: the two e2e escape tests both run from the editor branch. The test is a component-level one — mount `EditorMainContent` with a non-null `editorLockedMessage` once per branch and assert the Refresh button is present in all five. It pins the placement, not the behaviour the e2e tests already cover.
- **FIXED 2026-08-23 by `386043c5`; entry now fully closed.** New `components/EditorMainContent.lockBanner.test.tsx` mounts the component once per branch with heavy children stubbed: ten cases, banner-plus-Refresh present on all five when locked and absent on all five when not. Each case asserts a branch marker first, so a typo in the selector props cannot silently test the editor branch five times. Verified load-bearing by hiding the banner on the trash branch — exactly one case goes red.
- **Confidence:** High
- **Found by:** `/paad:rethink` premise verification (`claude-opus-5[1m]`)
- **First seen:** 2026-08-22 on branch `ovid/architecture` at `7b9e1c68`
- **Last seen:** 2026-08-22 on branch `ovid/architecture` at `7b9e1c68`
- **Severity:** Important


## `f518cf8d` — S5 late-mount re-lock catch skipped the `clearCacheFor` escalation its sibling applies
- **File (at first sighting):** `packages/client/src/hooks/useEditorMutation.ts:434`
- **Symbol:** `run` (the S5 late-mount re-lock catch)
- **Bug class:** Error Handling
- **Description:** The S5 late-mount re-lock catch returned `{ok:true}` whenever `!directive.reloadActiveChapter`, omitting the `clearCacheFor.includes(currentId)` escalation that the sibling post-mutate catch applies — while its own comment claimed parity with it ("exactly as the post-mutate re-lock catch does above"). The two catches began as separate inlined copies and then diverged: the post-mutate copy grew the I5 escalation and the late-mount copy did not. The cache-clear has already run by the time either catch fires, so the omission left an un-re-lockable editor writable over possibly pre-mutation content with `markClean()` never having run. Reachability is narrow — it needs `markClean()` or `cancelPendingSaves()` to throw during a late TipTap mount.
- **Suggested fix:** Give both catches one settle path so the next guard lands once.
- **FIXED 2026-08-22** on branch `ovid/architecture` by commit `3ac13bca`, which extracted `settleAfterFailedRelock` — one function reached by both catches, escalating through `committed()` when the directive asked for a reload or when the active chapter is in `clearCacheFor`. Pinned by "S5 late-lock throw escalates when the active chapter was affected (OOSS1)" in `useEditorMutation.test.tsx`.
- **Filed late (S2, code review 2026-08-22):** this entry did not exist when `3ac13bca` landed, yet that commit's `[backlog f518cf8d]` tag is the only thing licensing it under the fix-session PR-scope rules, and production code cites the id twice as the reason `settleAfterFailedRelock` exists. An id resolving to nothing makes both unverifiable. Recorded here retroactively, with the fix, rather than by rewriting the citations.
- **Confidence:** Medium
- **Found by:** Logic & Correctness, Error Handling & Edge Cases (`claude-opus-5[1m]`)
- **First seen:** 2026-08-21 on branch `ovid/architecture` at `94c958c4`
- **Last seen:** 2026-08-21 on branch `ovid/architecture` at `94c958c4`
- **Severity:** Suggestion

## `c8c9f95b` — `INVALID_HOST` reaches no client error scope, so a wrong-`Host` deployment fails everywhere under transient-sounding copy
- **File (at first sighting):** `packages/client/src/errors/apiErrorMapper.ts` (`_resolveErrorInternal`, alongside the existing `ABORTED` / 2xx-`BAD_JSON` / `NETWORK` arms); server side at `packages/server/src/app.ts` (the `Host` middleware)
- **Symbol:** `_resolveErrorInternal` — the cross-cutting-code arms
- **Bug class:** Error Handling
- **Description:** The `Host` middleware added by architecture finding F-02 rejects any request whose `Host` does not name the local machine, with `400` and the code `INVALID_HOST`. It sits ahead of every route, so when it fires it fires on every request the app makes at once. `grep -rn "INVALID_HOST" packages/client/src` returns **zero hits**: no scope in `scopes.ts` recognises the code, and there is no cross-cutting arm for it in the mapper. Every surface therefore shows its own generic `fallback` copy — "Save failed. Try again.", "Failed to load project", and the 32 siblings — each of which invites a retry that can never succeed, and none of which names the cause. The writer sees a total, permanent, unexplained failure of the whole app described to them as a passing glitch.
- **Correction to the source finding:** the 2026-08-22 review's `[I7]` says "`chapter.save`'s `terminalStatuses` is `[404]`, so 400 is not terminal and auto-save burns its full retry ladder." That conclusion is **wrong**, verified against the tree: `useProjectEditor.ts`'s save loop tests `isClientError(err)` — true for any status 400–499 — and breaks before reaching the backoff, so the 2s/4s/8s ladder never runs. The accurate residual is the opposite shape: because 400 is *not* in `terminalStatuses`, the client also does not treat it as fatal, so the editor is never locked and no persistent "Unable to save" warning appears. The writer keeps typing into an editor that will never save again.
- **Reachability:** not reachable in the default single-user setup — the server binds `127.0.0.1`, so a request that arrives at all carries a `Host` the allowlist accepts. It goes live behind a reverse proxy that forwards its own host (nginx's `proxy_pass` sends `Host: $proxy_host` by default), and it goes live for the general case the day roadmap Phase 7g.1 widens the bind. Severity is graded on that: harmless today, and the diagnostic of first resort on the day the deployment story changes.
- **Suggested fix:** One cross-cutting arm in `_resolveErrorInternal`, next to the three that already exist there, plus one sentence in `strings.ts` that says in a writer's terms that the address they are using is not one the server accepts. Do **not** add a `byCode` entry per scope: there are 34 scopes, so that is 34 edits, and the 35th scope added later would be wrong by default. `INVALID_HOST` does not vary in meaning by endpoint, which is exactly the property the existing cross-cutting arms are keyed on.
- **Re-verified 2026-08-23 (backlog triage): still open, unchanged.** `grep -rn "INVALID_HOST" packages/client/src` is still zero hits. The code exists at exactly two places in the tree — the `Host` middleware in `packages/server/src/app.ts`, which throws `new BadRequestError("Request Host is not recognized.", "INVALID_HOST")`, and the server's own `health.test.ts`, which asserts the 400 and the code. No client scope and no mapper arm recognises it. The fix remains the one described above: one cross-cutting arm in `_resolveErrorInternal`, one string, no per-scope `byCode` entries.
- **FIXED 2026-08-23 by `f3638dd1`.** One cross-cutting arm in `_resolveErrorInternal` beside `ABORTED` / 2xx-`BAD_JSON` / `NETWORK`, plus `STRINGS.error.invalidHost`. No per-scope `byCode` entries, as instructed. `terminal: true` is the load-bearing half and closes the residual this entry identified as the accurate one: without it `chapter.save`'s loop breaks on `isClientError(400)` with both flags false, so the editor never locks and the writer keeps typing into an editor that will never save again. 400 stays out of `chapter.save`'s `terminalStatuses` (an ordinary `VALIDATION_ERROR` 400 is not terminal); the terminality is declared with the code that earns it. Pinned by two `it.each(ALL_SCOPES)` cases, so a 39th scope inherits it.
- **Confidence:** High — the zero-hit grep, the `isClientError` break, and the fallback strings were each read from the tree.
- **Found by:** Error Handling & Edge Cases, Contract & Integration, Security (`claude-opus-5[1m]`), as the fourth impact bullet of `[I7]`; the server-side half of that finding (the missing log line) was fixed on this branch by `5debae46`.
- **First seen:** 2026-08-22 on branch `ovid/architecture` at `b66c3f77`
- **Last seen:** 2026-08-23 on branch `ovid/architecture` at `cdc9c8a2`
- **Severity:** Suggestion


## `e0b41bcc` — `handleUpdateProjectTitle`'s committed-recovery `setProject(refreshed)` lacks the inside-updater identity re-test its two siblings now carry
- **File (at first sighting):** `packages/client/src/hooks/useChapterMetadata.ts`
- **Symbol:** `handleUpdateProjectTitle`
- **Bug class:** Concurrency
- **Description:** The committed-recovery arm calls `setProject(refreshed)` with a whole-project snapshot and no `prev.id` re-test inside the updater, unlike `useChapterCrud.handleCreateChapter` (both call sites, guarded 2026-08-23 by `a254d743`) and `useTrashManager` (`prev?.id === refreshed.id`). The outer `isStaleProject()` is evaluated when the handler resumes; the updater body runs later, when React drains the queue. This arm additionally rewrites `projectSlugRef.current = refreshed.slug`, which the OOSI1 comment directly above it calls session-permanent and the cause of silent cross-project writes. Reachability is the same open question as the sibling sites — see the residual note under `8b34a209` and the report's `[S6]`.
- **Suggested fix:** `setProject((prev) => (prev?.id === refreshed.id ? refreshed : prev));` — and settle the reachability question once for all three sites rather than per site.
- **Confidence:** Medium
- **Found by:** Logic & Correctness (`claude-opus-5[1m]`)
- **First seen:** 2026-08-23 on branch `ovid/backlog` at `55edd3e1`
- **Last seen:** 2026-08-23 on branch `ovid/backlog` at `55edd3e1`
- **Severity:** Suggestion

## `872b6760` — `handleDeleteChapter`'s success path runs `setActiveChapter` with no drift guard, pinning project A's chapter under project B's URL
- **File (at first sighting):** `packages/client/src/hooks/useChapterCrud.ts`
- **Symbol:** `handleDeleteChapter`
- **Bug class:** Concurrency
- **Description:** `isStaleProject` is built at handler entry but consulted only in the two catch arms. The success path — the `setProject` filter and the `setActiveChapter(ch)` / `setChapterWordCount(...)` after the post-delete `api.chapters.get` — is unguarded, and `deleteChapterOp` aborts only on unmount or on a newer delete. An A-to-B navigation while the DELETE is in flight lets the secondary GET land A's chapter as active under B's URL; `loadProject` never calls `selectChapterSeq.start()`, so last-resolver wins and the next keystroke auto-saves against A's chapter id. Same hazard the OOSS1 comment describes for the create-recovery arm. The `setProject` is safe by accident (filtering B's chapters by A's chapter id matches nothing, as the catch-path comment already says); the `setActiveChapter` is not. Pre-existing.
- **Suggested fix:** `if (isStaleProject()) return true;` immediately after the `if (s.aborted) return false;` that follows the DELETE. The guard object already exists at this site.
- **Confidence:** Medium
- **Found by:** Concurrency & State (`claude-opus-5[1m]`)
- **First seen:** 2026-08-23 on branch `ovid/backlog` at `55edd3e1`
- **Last seen:** 2026-08-23 on branch `ovid/backlog` at `55edd3e1`
- **Severity:** Suggestion

## `61659add` — CLAUDE.md §API Design cites `app.ts:41,45,46,50,52` and `images.routes.ts:39` for code that is at `:80,84,85,89,91` and `:100,103`
- **File (at first sighting):** `CLAUDE.md`
- **Symbol:** `<file-scope>`
- **Bug class:** Contract
- **Description:** "Five routers mount on `/api/projects` (`app.ts:41,45,46,50,52`)" — the count is right, the lines are not; the five mounts are at `app.ts:80,84,85,89,91` and the cited lines are middleware/comments. The images carve-out cites `images.routes.ts:39`, which is a `/**`; the `:projectId` mount and its `requireUuidParam` guard are at `:100,103`. A reader cannot verify a paragraph that records a binding decision (slug vs UUID for new project sub-resources). This is the failure §Documentation Discipline rule 2 was written about, in the file that carries the rule. Spot-checked and still correct, so not part of this entry: `outtakes.routes.ts:14,44`; `images.paths.ts:94-96`; `projects.service.ts:155`; `client.ts:605,619`; `useChapterMetadata.ts:103-118`.
- **Suggested fix:** Cite symbols per rule 2 — e.g. "the five `app.use("/api/projects", ...)` mounts in `createApp`" and "`images.routes.ts`'s `router.use("/:projectId/images", requireUuidParam("projectId"))`" — rather than line ranges that the next edit above them invalidates.
- **Confidence:** High
- **Found by:** Contract & Integration (`claude-opus-5[1m]`)
- **First seen:** 2026-08-23 on branch `ovid/backlog` at `55edd3e1`
- **Last seen:** 2026-08-23 on branch `ovid/backlog` at `55edd3e1`
- **Severity:** Suggestion
---

## `3d5f0a91` — `runRestore` parses every archive with two different parsers, and they cannot be made to agree

- **File (at first sighting):** `packages/server/src/backup/backup-core.ts` (`runRestore` steps 1 and 6), `packages/server/src/backup/backup-zip-format.ts` (`findEocdOffset`)
- **Symbol:** `runRestore`, `findEocdOffset`
- **Bug class:** Contract / Security (differential parsing)
- **Description:** `runRestore` reads the archive into one buffer and then parses it **twice, with two unrelated parsers**: Smudge's own central-directory walk at step 1 (which is what validates entry paths, declared sizes and free space) and `JSZip.loadAsync` at step 6 (which is what actually extracts). The two locate the end-of-central-directory record by different rules and **cannot be reconciled by editing Smudge's**, because the divergence is structural: jszip's `lastIndexOfSignature` scans the entire buffer starting at `length - 4`, while `findEocdOffset` starts at `length - 22` and stops after 64 KiB. Measured divergences: (a) a buffer under 22 bytes — jszip can locate a record, Smudge cannot; (b) a signature in the final 18 bytes — jszip sees it, Smudge structurally cannot; (c) **an archive with an over-long comment — jszip locates the record at offset 102 and `loadAsync` succeeds, while Smudge returns -1 and refuses, under the current rule and under every rule that has been tried** (verified with a 70 000-character comment; jszip's writer truncates the length field to 4 464 modulo 65 536, so a length-validating rule rejects it too).
  The name cross-check at step 6 (each validated name must resolve to a `zip.files` entry, bare or force-slashed, else abort) means a disagreement cannot write outside the validated path set. What it can still produce is **content substitution** (the bytes jszip's key maps to under jszip's directory, written to the path Smudge validated), **size substitution** (the byte budget is measured against Smudge's `declaredTotal`), and **silent omission** of entries jszip sees and Smudge's directory does not. Related to `fa8e879a`, which files the RAM-inflation half of the same step-6 gap.
- **Suggested fix:** Collapse to one parser. `JSZip.loadAsync` parses the central directory **without inflating anything** — entry metadata, including each entry's declared uncompressed size, is available off the loaded entries before any `.async()` call. So the order can become: load once with jszip, read declared sizes from its entries, run the existing `validateEntryPaths` / `checkDeclaredSizes` / free-space gates against *those*, then extract. The decompression-bomb defence is preserved (nothing is inflated until the gates pass) and the differential becomes impossible by construction rather than by hand-maintained agreement. This also closes `e8ba6c7b` as a side effect and removes the reason `findEocdOffset` exists in production at all — it would remain only as a test helper, or be deleted.
- **Why not now:** it restructures the step order of the one function that moves a user's data dir aside, and it changes which parser's view of the archive every safety gate is computed from. That deserves its own branch with the F-14 forged-archive and bomb tests re-pointed at the new source of truth, not a slot in a review-response session.
- **Confidence:** High — every divergence above was measured, not read.
- **Found by:** review 2026-08-23 follow-up (I3 verification), `claude-opus-5[1m]`
- **First seen:** 2026-08-23 on branch `ovid/backlog` at `55edd3e1`
- **Last seen:** 2026-08-23 on branch `ovid/backlog` at `55edd3e1`
- **Severity:** Important
---


## `9c2ad4e1` — the confirmed-status map is replaced wholesale by recovery snapshots that may have lost a race

- **File (at first sighting):** `packages/client/src/hooks/useProjectEditor.ts` (`replaceConfirmedStatusesFromProject`), callers in `packages/client/src/hooks/useChapterCrud.ts` (`handleCreateChapter` recovery arm) and `packages/client/src/hooks/useTrashManager.ts` (`handleRestore` recovery arm)
- **Symbol:** `replaceConfirmedStatusesFromProject`
- **Bug class:** Concurrency
- **Description:** `replaceConfirmedStatusesFromProject(p)` is `confirmedStatusRef.current = Object.fromEntries(p.chapters.map(...))` — a **whole-map replacement**. Two of its three callers run it from a post-await recovery arm, where the snapshot may describe a project the user has already left. In the queue-drain window that backlog `8b34a209` documents, the sibling `setProject` updater re-tests identity and bails, so the chapter LIST stays on project B while the status MAP is replaced with project A's pairs. Every one of B's chapter ids then reads `undefined`, and `handleStatusChange`'s local-revert fallback (`if (!reverted && previousStatus !== undefined)`) silently skips — leaving an optimistic status on screen the server never accepted, which is precisely what the C2/I21 seeds exist to prevent. Unlike the `setActiveChapter` residual, this one does not self-heal: project B's load has already run, so nothing re-seeds it.
- **Why the obvious fix does not work:** a statement-time identity re-check immediately before the call, mirroring `useTrashManager`'s S7 inner re-check, does **not** close it. `projectRef.current` is a render-body mirror (`useProjectEditor.ts`, `projectRef.current = project`), so during the drain window it still holds the OLD project and the re-check passes exactly when it needs to fail. (`useTrashManager`'s inner re-check is still worth having — it guards against a future `await` being inserted above it — but it is defence against a different hazard.) Review 2026-08-23 (I6) proposed that patch; it was measured and rejected.
- **Suggested fix:** make the write **additive** rather than a replacement — `for (const c of p.chapters) confirmedStatusRef.current[c.id] = c.status;` — and rename to `mergeConfirmedStatusesFromProject` so the name stays honest. A losing snapshot can then only add keys nobody reads (project A's chapter ids while on B), never evict the live project's baselines. Safe for every reader: the map is only ever consulted as a single-key lookup by chapter id (`useChapterMetadata.ts` `handleStatusChange`), nothing iterates it or depends on its size, and `loadProject` clears it outright (`confirmedStatusRef.current = {}`) before re-seeding, so stale keys cannot outlive a project switch. The lingering-entry cost is entries for chapters deleted server-side since load, which are never looked up.
- **Why not now:** it changes the semantics of shared state used by three flows (project load, create-recovery, trash-restore-recovery) and renames a field on the `ChapterCrudDeps` / `useTrashManager` options contracts. That is the class of change the receiving-code-review scope rule defers to a focused PR rather than folding into a review response.
- **Reachability caveat:** inherited from `8b34a209` — the drain window needs a project switch to land mid-POST, and review suggestion S6 argues it may be unreachable today because `useProjectEditor`'s render body advances `projectSlugRef.current` before the effect dispatches, so `makeStaleProjectGuard` check 2 bails first. Keep the guards regardless; the reachability argument rests on the current ordering of one render body.
- **Confidence:** Medium
- **Found by:** review 2026-08-23 I6 (Error Handling & Edge Cases, Concurrency & State, Spec Compliance), fix re-derived after the proposed one was measured and failed
- **First seen:** 2026-08-23 on branch `ovid/backlog` at `55edd3e1`
- **Last seen:** 2026-08-23 on branch `ovid/backlog` at `55edd3e1`
- **Severity:** Suggestion
---
# Closed — cited, kept as addresses

> **These entries are fixed.** They are here because live code, a test name, a
> commit message, or a decision log names their id, and an id must resolve to
> something — see §Entry lifecycle in the header. Each is a stub, not a full
> finding: enough to confirm the id is real, say what it was, and point at the
> commit that closed it. The original write-ups are in the review reports under
> `paad/code-reviews/`.
>
> **Filed retroactively 2026-08-23** during a backlog triage that found seven ids
> cited by the tree and resolving to nothing. The cause is visible in the diffstats:
> five of the seven commits below deleted the backlog entry in the same commit that
> fixed the code, while leaving the citation behind. That is what §Entry lifecycle
> now forbids.

## `4d5b9e81` — unmount cleanup PATCHed a locked editor
- **Was:** the Editor's unmount cleanup fired a fire-and-forget save without checking `isEditable`, so tearing down a locked editor could PATCH on-screen content over a server version the editor was not showing.
- **FIXED** by `26da4b5d` (`fix(client): [backlog 4d5b9e81] don't PATCH a locked editor on unmount`).
- **Cited by:** the guard's own comment in `packages/client/src/components/Editor.tsx`, and the test name "unmount cleanup does not PATCH a locked editor (backlog 4d5b9e81)" in `Editor.test.tsx`. That comment is also the load-bearing statement of why `flushSave` is exempt from the same guard — see backlog `7e2a9d41`.

## `1f9d4b27` — `latestContentRef` was not scoped to the active chapter
- **Was:** the latest-content ref could hold content belonging to a chapter other than the active one, letting a write land against the wrong chapter.
- **FIXED** by `525bb93f` (`fix(client): [backlog 1f9d4b27] scope the latest-content ref to the active chapter`).
- **Cited by:** the scoping comment in `packages/client/src/hooks/useProjectEditor.ts`.

## `767fdc1e` — `restoreChapter`'s post-commit `enrichChapterWithLabel` was unguarded
- **Was:** `enrichChapterWithLabel` ran unguarded after the restore transaction committed. Both siblings (`updateChapter`, `snapshots.service.restoreSnapshot`) wrapped the identical call in try/catch and degraded to status-as-label. On the `{max:1}` Knex pool a concurrent long transaction could make the call throw "Timeout acquiring a connection", turning a **committed** restore into a bare 500 — which `trash.restoreChapter`'s scope did not treat as possibly-committed, so the chapter stayed in the trash list and the user's retry answered 404 "no longer available".
- **FIXED** by `e24a4696` (`fix(chapters): [backlog 767fdc1e] guard enrichChapterWithLabel for every caller`) — guarded inside the helper, which closed the identically-shaped site in `projects.service.createChapter` at the same time.
- **Cited by:** regression-test comments in `chapters.service.test.ts` and `projects.service.test.ts`.

## `f858e66a` — double supersession onto an affected chapter did not escalate
- **Was:** when a second `reloadActiveChapter` also returned `"superseded"`, control fell through with no committed outcome, so the `finally` dispatched `MUTATION_SETTLED_SUPERSEDED` — re-enabling the editor without consulting `clearCacheFor`, the check the sibling committed path had grown. Reaching it needs two active-chapter changes inside one mutation.
- **FIXED** by `9232702e` (`fix(client): [OOSS1 f858e66a] double supersession onto an affected chapter escalates`).
- **Cited by:** the escalation comment in `packages/client/src/hooks/useEditorMutation.ts` and its test in `useEditorMutation.test.tsx`.

## `4485eebf` — find-and-replace safe-drift notice named no chapter
- **Was:** on the safe-drift arm the editor is re-enabled on a chapter the replace never wrote to, but the notice used the unattributed `STRINGS.findReplace.replaceSucceededReloadFailed` ("…reloading **the chapter** failed…") — false for the chapter on screen, and naming none.
- **FIXED** by `b0393d22` (`fix(client): [OOSS2 4485eebf, S6] name the chapter the replace actually wrote to`). The resulting per-scope rule — name the chapter when the mutation had exactly one, say what is true when it had many — is recorded in CLAUDE.md §"Editor operational state lives in one machine".
- **Cited by:** commit `b0393d22` and `docs/roadmap-decisions/2026-08-19-architecture-fix-session-pr-scope.md`.

## `04952dd1` — the `applyImageRefDiff` test asserted nothing about `applyImageRefDiff`
- **Was:** the test named "image reference counts adjusted via applyImageRefDiff" replaced `hello`→`goodbye` in a document whose only image node was untouched, so the diff was empty and `reference_count` read 1 whether or not the call ran. Confirmed by execution: deleting the call left this test green.
- **FIXED** by `ba27ed2c` (`test(search): [backlog 04952dd1] make the applyImageRefDiff test detect the call it is named for`).
- **Cited by:** commit `ba27ed2c`.

## `4ca1b901` — settings key allowlist was bypassable via `Object.prototype` names
- **Was:** `SETTING_VALIDATORS[key]` walked the prototype chain with `key` constrained only by `z.string().min(1)`. `toString` and `constructor` returned a truthy validator and **committed a junk settings row with 204**; `valueOf` / `hasOwnProperty` / `__proto__` threw inside the handler and surfaced as 500 for a client-caused failure, violating CLAUDE.md §API Design.
- **FIXED** by `b38c9328` (`fix(architecture): [backlog 4ca1b901] own-property guard on two client-keyed lookups`) — `Object.hasOwn(SETTING_VALIDATORS, key)`, applied to the twin lookup in `docx.renderer.ts` in the same pass, with Supertest cases for both arms.
- **Cited by:** commit `b38c9328`.
