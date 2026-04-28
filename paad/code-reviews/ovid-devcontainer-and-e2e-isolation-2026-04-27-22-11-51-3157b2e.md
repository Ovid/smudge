# Agentic Code Review: ovid/devcontainer-and-e2e-isolation

**Date:** 2026-04-27 22:11:51
**Branch:** ovid/devcontainer-and-e2e-isolation -> main
**Commit:** 3157b2e91e9da252738d4e121ea4d5e04807d1cd
**Files changed:** 26 (in scope; 30 total — `.devcontainer/` excluded per CLAUDE.md)
**Lines changed:** +1988 / -184 (in scope)
**Diff size category:** Large

## Executive Summary

This is the **fourth** review of this branch. The prior three reviews live at
`paad/code-reviews/ovid-devcontainer-and-e2e-isolation-2026-04-27-{13-19-24-5b89539,18-27-06-8bac750,20-48-50-990bcb6}.md`.
Seventeen commits since `990bcb6` close C1, I1–I8, every Suggestion (S1–S15) within
the e2e-isolation scope, and add tests pinning the LAT1–3 latent edges. The Phase
4b.6 functional Definition-of-Done is met: e2e binds to test-only ports, isolates
the SQLite DB under `os.tmpdir()/smudge-e2e-data-<UID>/`, and exposes
`make e2e-clean` with a probe-and-allowlist guarded wipe.

Headline: the **steering documentation is out of sync with the new `make all`
recipe**. CLAUDE.md, `.github/copilot-instructions.md`, and CONTRIBUTING.md all
still describe `make all` as `lint + format + ...` (or partial variants of it);
the Makefile now runs `lint-check + format-check + ...` — the whole point of
commits `28867f0`/`1a05f85` is that `make all` no longer mutates the tree, and
that contract is encoded nowhere a contributor reading the steering will see.
Two related Important findings: the new `deleteProject` best-effort cleanup
pattern was applied to 4 of the 8 e2e specs (the other 4 still call
`await request.delete(...)` with no logging or recovery), and the
`e2e-data-dir-parity` NOLISTEN parity test asserts only substring presence,
which is also satisfied by the recipe's own narrative comment block — the test
does not enforce what its docstring claims. Twelve Suggestions and two new
Latent findings round out the list. No Critical issues. No out-of-scope
findings — every anchor lives on lines this branch authored or directly
caused (the steering-doc drift is reasoning-promoted in-scope: this branch's
Makefile change is what put the docs out of sync).

## Critical Issues

None found.

## Important Issues

### [I1] `make all` steering documentation drifted out of sync with the Makefile recipe (CLAUDE.md, copilot-instructions, CONTRIBUTING.md)
- **File:** `CLAUDE.md:80`, `.github/copilot-instructions.md:52`, `CONTRIBUTING.md:85`
- **Bug:** commit `1a05f85 fix(make): format-check is read-only, lint-check is the CI lint gate` and `28867f0 fix(make): wire :(glob) magic + tsconfig*.json into format-check pathspec` made `make all` invariantly read-only — it now runs `lint-check format-check typecheck cover e2e` and CI gates must not mutate. The three steering docs describe a different recipe:
  - `CLAUDE.md:80`: `make all                             # Full CI pass: lint + format + typecheck + coverage + e2e`
  - `.github/copilot-instructions.md:52`: `make all                             # Full CI pass: lint + format + typecheck + coverage + e2e`
  - `CONTRIBUTING.md:85`: `` `lint` + `format-check` + `typecheck` + `cover` + `e2e` `` (the table cell got the `format` → `format-check` migration in an earlier review pass but missed the parallel `lint` → `lint-check`)
  None of them name `lint-check`. CLAUDE.md and copilot-instructions also still claim `format` (which writes), not `format-check` (which checks). The `format-check-pathspec.test.ts` file pins the *Makefile-side* property; nothing pins the doc.
- **Impact:** AI agents reading `.github/copilot-instructions.md` (Copilot, Claude Code, Cursor) will propose `make all` as if it were safe to run mid-edit and could rewrite the user's tree. Human contributors trusting CLAUDE.md will think the recipe still autofixes — and may either commit unintended formatter/eslint diffs they didn't author, or be confused when `make all` does NOT re-run `format` against their unsaved drift. Three steering surfaces drifting in lockstep multiplies the likelihood the next contributor reverts `Makefile:8` to `lint format-check ...` thinking the docs are authoritative.
- **Suggested fix:** update all three lines to match `Makefile:8`. Concrete edits:
  - `CLAUDE.md:80`: `make all                             # Full CI pass: lint-check + format-check + typecheck + cover + e2e (read-only)`
  - `.github/copilot-instructions.md:52`: same line (and remove the now-obsolete `make e2e` row that's missing — see also: the file omits `make e2e` from the `# Testing & Quality` block).
  - `CONTRIBUTING.md:85`: `` `lint-check` + `format-check` + `typecheck` + `cover` + `e2e` ``
  Add a follow-up: extend `format-check-pathspec.test.ts` (or a new `steering-doc-parity.test.ts`) with a textual assertion that each steering file's `make all` description names `lint-check`, not `lint`. Mirrors the existing parity-test pattern.
- **Confidence:** High (verified by reading the three files at the cited lines plus `Makefile:8`)
- **Found by:** Contract & Integration (`general-purpose (claude-opus-4-7[1m])`)

### [I2] e2e `deleteProject` best-effort pattern applied to only 4 of 8 specs — partial migration, asymmetric observability
- **File:** updated 4 of 8: `e2e/editor-save.spec.ts:22-39`, `e2e/find-replace.spec.ts:28-42`, `e2e/sanitizer-snapshot-blob.spec.ts:32-46`, `e2e/snapshots.spec.ts:22-36`
- **Bug:** commit `3d33c1e fix(e2e): make deleteProject best-effort + log on failure` added a try/catch around `request.delete` plus a `console.warn` on non-OK responses to four specs (the four that exercise the save pipeline / snapshots / find-and-replace). The other four specs that have a `deleteProject` helper — `e2e/dashboard.spec.ts:28-30`, `e2e/export.spec.ts`, `e2e/images.spec.ts`, `e2e/velocity.spec.ts` — were not touched and still read:
  ```ts
  async function deleteProject(request: APIRequestContext, slug: string) {
    await request.delete(`/api/projects/${slug}`);
  }
  ```
  Verified live: `for f in /workspace/e2e/*.spec.ts; do grep -A2 "async function deleteProject" "$f"; done` shows 4 with the new comment header and 4 with the bare one-liner. The result is asymmetric observability — a transient cleanup blip surfaces a `console.warn` from the four "fixed" specs and is silently swallowed by the four others (the unchecked `Response` is just discarded).
- **Impact:** the next time fixtures pile up in the e2e DB, the developer will only see warnings from half the suite, leading to misdiagnosis ("only the save-pipeline specs are flaky on cleanup" — when actually all eight are, half just stay quiet). Logic-duplication compound: the same helper is now copy-pasted in eight files (also `createTestProject` is identically duplicated in all eight). A single extracted helper closes the partial-migration AND collapses the maintenance liability.
- **Suggested fix:** extract `createTestProject` and `deleteProject` into `e2e/helpers/projectFixtures.ts` (with the best-effort `deleteProject` body); replace the eight in-spec definitions with imports. If extraction is out of scope for this PR, at minimum mirror the try/catch + warn pattern into the four unmodified specs so all eight are observably consistent. Either path closes the bug; the extraction is the durable answer.
- **Confidence:** High (verified live)
- **Found by:** Errors-A, Contract & Integration (`general-purpose (claude-opus-4-7[1m])` × 2)

### [I3] `e2e-data-dir-parity.test.ts:114-124` NOLISTEN parity assertion is satisfied by the recipe's prose comment block — does not actually enforce the Set's contents
- **File:** `packages/shared/src/__tests__/e2e-data-dir-parity.test.ts:114-124`
- **Bug:** the "S1 NOLISTEN coverage" test reads:
  ```ts
  expect(makefileText).toMatch(/EHOSTUNREACH/);
  expect(makefileText).toMatch(/ECONNRESET/);
  ```
  Both tokens appear *twice* in the Makefile: in the prose comment block at lines 245-246 (`EHOSTUNREACH (transient IPv6 stack reset by NetworkManager), and ECONNRESET (peer-side close-without-listener)`) AND in the actual `NOLISTEN=new Set([...])` assignment at line 273. A future "fix" that removed `EHOSTUNREACH`/`ECONNRESET` from the Set but left the long-lived narrative comment intact (a plausible drift — comments are documentation, the Set is "code") still passes this test. The same gap that motivated the third review's I3 (parsePort body parity using `.match()` returning the first hit) lives in this neighbor parity test, with prose-vs-code instead of first-match-vs-all-match.
- **Impact:** the test was added as the second-pass review's S1 fail-closed-vs-fail-open guard; if it stops enforcing the Set's contents, the recipe could regress to refusing-to-wipe on transient routing flakes, the operator-nuisance the fix was authored to prevent. The same finding's pattern applies to the I8 allowlist test at lines 140-159 (extracts the recipe block with one regex, then asserts unrelated tokens elsewhere in the block, including in prose).
- **Suggested fix:** anchor on the literal `NOLISTEN=new Set([...])` assignment specifically:
  ```ts
  const noListenSet = makefileText.match(/NOLISTEN\s*=\s*new Set\(\[([^\]]*)\]\)/);
  expect(noListenSet).toBeTruthy();
  expect(noListenSet![1]).toMatch(/'EHOSTUNREACH'/);
  expect(noListenSet![1]).toMatch(/'ECONNRESET'/);
  ```
  Mirror the `findExactlyOne` pattern from the same file. For the I8 allowlist test, capture the `case "$$DATA_DIR" in ... esac` body and assert each prefix appears within that capture, not anywhere in the recipe.
- **Confidence:** High
- **Found by:** Logic-A, Contract & Integration (`general-purpose (claude-opus-4-7[1m])` × 2)

## Suggestions

- **[S1]** `packages/shared/src/index.ts:38-44` comment is stale after the subpath-export landed. The block guarding the deliberate non-re-export tells the reader `playwright.config.ts` "imports it directly from `./packages/shared/src/findDirectoryConflict` instead." Commit `65df33b` changed that import to `import { ... } from "@smudge/shared/node-fs-helpers"` (defined in `packages/shared/package.json:13-16`). The comment also names only `findFirstNonDirectoryAncestor` while the same subpath also exports `formatMkdirDataDirError`. Update to match. Found by Logic-A, Contract & Integration.

- **[S2]** `playwright.config.ts:141-148` EEXIST branch passes `offender: E2E_DATA_DIR` to `formatMkdirDataDirError`, but the formatter's EEXIST path (`packages/shared/src/findDirectoryConflict.ts:90-97`) ignores the `offender` field — it references only `quotedDataDir` and `verb`. Mild contract dead-data; a future refactor consolidating the two formatter branches could mistakenly assume EEXIST's `offender` is an ancestor (it's the leaf). Pass `offender: null` for EEXIST or document the contract explicitly in the formatter JSDoc. Found by Logic-A.

- **[S3]** `Makefile:273` `NOLISTEN` set still missing `ETIMEDOUT` and `EHOSTDOWN`. `ETIMEDOUT` is the canonical symptom of localhost firewall/iptables drops on hardened CI runners and seccomp-bound containers; `EHOSTDOWN` is BSD-historical, mapped from ICMP host-unreachable. Both currently classify as `'error'` and refuse the wipe — fail-closed but operator-nuisance on transient routing flakes (same justification as the second-pass S1 that added `EHOSTUNREACH`/`ECONNRESET`). Add both, plus a parity test assertion mirroring the existing pattern. Found by Errors-A.

- **[S4]** `Makefile:264-269` TMPDIR allowlist is a *lexical* glob match — it doesn't `realpath` the path before comparing. If a system has a symlink at one of the allowlist roots that points outside the allowlist (e.g. `/var/tmp -> /home/build/scratch` on a customized base image), `DATA_DIR=/var/tmp/smudge-e2e-data-1000` passes the case, but `rm -rf` follows the symlink and wipes the link target. Threat model: operator misconfiguration, not active attacker. Mitigation: `DATA_DIR_REAL=$(node -p 'require("fs").realpathSync(...)')` before the case, OR document the limitation. Found by Errors-A, Concurrency, Security.

- **[S5]** Neither the `playwright.config.ts:107-152` mkdir catch nor the `findFirstNonDirectoryAncestor` helper distinguishes `EACCES` from "truly missing". (a) The catch routes only `ENOTDIR`/`ENOENT`/`ELOOP`/`EEXIST` through the formatter; `EACCES` (a parent dir lacks search permission) falls through to the bare `throw err` and surfaces Node's opaque default — the same regression class the catch was authored to close. (b) The helper's inner-catch on `lstatSync` (`packages/shared/src/findDirectoryConflict.ts:48-52`) treats *any* error as "truly does not exist — keep walking", silently swallowing `EACCES`/`EPERM`. Both gaps are unreachable on `os.tmpdir()`-rooted paths today (`/tmp` is mode 1777; `/var/folders/<uid>/T/` is owned by the current user) but matter once the helper is reused via the new `@smudge/shared/node-fs-helpers` subpath. Distinguish `ENOENT` from other errnos in the inner catch and add `EACCES` to the routed set in `playwright.config.ts`. Found by Logic-A, Errors-A.

- **[S6]** `formatMkdirDataDirError` (`packages/shared/src/findDirectoryConflict.ts:80-118`) sanitizes via `JSON.stringify`, which neutralizes newlines/ANSI/control chars/`"`/`\` but NOT backticks (`` ` ``), `$`, `(`, `)`, or `${...}`. A filename like `/tmp/$(touch /tmp/pwned)` survives as a JSON-quoted literal, which is safe for terminal display but unsafe inside downstream contexts that perform shell expansion (CI log forwarders piping through `eval`, `xargs`-driven log helpers) or JS template-literal interpolation. The I7-test at lines 241-263 only verifies JSON-quoting; it doesn't assert `${`/`` ` `` are escaped. Either add `.replace(/[`$]/g, "\\$&")` after `JSON.stringify` (and a matching test) or document the formatter's safe-context boundary in the JSDoc. Found by Security.

- **[S7]** `Makefile:267` echoes `$$DATA_DIR` unsanitized in the "refusing to wipe" diagnostic, which is the same log-injection class the I7 fix closed for `playwright.config.ts`. The operator-set `TMPDIR=/tmp/$'\e[2K\e[1A...'` reaches the echo with the raw bytes intact. Threat model is narrower (the operator set their own TMPDIR), but pipelines that route this stderr to a CI dashboard could see ANSI-faked output. Mirror the I7 sanitization (a small `node -e 'console.error(JSON.stringify(...))'`) for consistency. Found by Security.

- **[S8]** `e2e-data-dir-parity.test.ts:140-159` allowlist test extracts the recipe block, then asserts `/tmp/`, `/var/folders/`, `/var/tmp/` and `case "$$DATA_DIR" in` are present *anywhere* in the block. The token regex would also pass on the long prose comment at lines 213-223 (`/tmp/                    — Linux default`). A maintainer who "simplifies" the case arms to `*) ;;` (universal accept) but leaves the comment intact still passes the test. Capture the case body explicitly (`case ... in [\s\S]*? esac`) and assert each prefix appears within the captured body. Same fix shape as I3. Found by Logic-A, Security.

- **[S9]** `Makefile:259-292` `e2e-clean` and `playwright.config.ts:43` both call `os.tmpdir()` independently — TMPDIR is read at separate process invocations. Under the canonical workflow they agree (same shell, same env). If a developer changes TMPDIR mid-session and runs `make e2e-clean` from a different shell, the recipe wipes a different path than the live e2e server is using. Latent under canonical use; matters under exotic workflows (per-project `.envrc` files that mutate TMPDIR). Pin the resolved DATA_DIR by writing a small marker file (`<E2E_DATA_DIR>/.smudge-e2e-marker`) at config-load time; have `make e2e-clean` prefer the marker over re-deriving. Found by Concurrency.

- **[S10]** `console.warn` calls in the new `deleteProject` (`e2e/editor-save.spec.ts:32,35` and three siblings) tension against CLAUDE.md §"Testing Philosophy" line 197: "Tests must not produce noisy `console.warn`, `console.error`, or logger output in stderr." The rule was authored for vitest output; whether it extends to Playwright is undocumented. Either (a) replace `console.warn` with `test.info().annotations.push({ type: "cleanup-warning", ... })` so the diagnostic appears in the Playwright HTML report instead of stderr, or (b) add an explicit Playwright exception in CLAUDE.md. Found by Errors-A.

- **[S11]** Best-effort `deleteProject` cleanup (commit `3d33c1e`) combined with the explicit non-wipe of `E2E_DATA_DIR` at `playwright.config.ts:48-57` and the soft-delete-with-30-day-purge model (CLAUDE.md "Soft delete everywhere") creates cross-run shared state: every cleanup blip permanently leaves a soft-deleted fixture in the persistent SQLite DB. Successive `make e2e` runs are no longer hermetic — specs that filter on `deleted_at IS NULL` are unaffected, but specs that count rows or list trash entries become coupled to history. Counter-mitigation: a Playwright `globalTeardown` that hard-deletes any `Test ...`-prefixed fixture on suite end. Or document the workflow: "after a cleanup-warning, run `make e2e-clean` before the next run." Found by Concurrency.

- **[S12]** `packages/client/vite.config.ts:82-101` inline `parsePort` carries no rationale comment for the `[1, 65535]` range — only the body. The canonical `packages/shared/src/parsePort.ts:21-32` documents the privileged-port choice and instructs maintainers to mirror any range change in BOTH files. The byte-equal parity test (`parsePort-body-parity.test.ts`) catches body drift but not JSDoc drift; a future doc-only relaxation in shared/parsePort.ts would silently disagree with the inline copy's intent. Add a one-line reference comment above the inline copy: `// Port range and rationale documented at packages/shared/src/parsePort.ts. Mirror any change there here too.` Found by Security.

- **[S13]** `findFirstNonDirectoryAncestor("")` resolves to `process.cwd()` and returns `null` (the test at `findDirectoryConflict.test.ts:110-115` locks this in). The function's docstring (lines 4-23) doesn't document the empty-input semantics. A future caller that passes `""` from a coalesced env var (e.g. `process.env.DATA_DIR ?? ""`) will hit the helper-returns-null branch in `formatMkdirDataDirError`, which surfaces the unhelpful "mkdir failed at or above ...". Either document the empty-input behavior in the JSDoc or reject `""` with a thrown error so misuse is loud. Found by Logic-A.

- **[S14]** `make all` ordering still runs `lint-check` before `format-check`. ESLint and Prettier *agree* on most formatting today (eslint-config-prettier disables overlapping rules), but the order means a future ESLint rule that touches whitespace would still produce diff that format-check might or might not see. Mostly cosmetic now that both are read-only; consider running `format-check` first (cheaper, fails earlier) for ergonomics. Found by Logic-A.

## Latent

> Findings on lines this branch authored where the bug is not currently
> reachable via any live code path, but the pattern itself is brittle or
> load-bearing for future work. **Not a merge-blocker** — record so the next
> change in this area is informed. Does not enter the OOS backlog.

### [LAT1] EEXIST catch-block lstat is itself a TOCTOU window for verb selection
- **File:** `playwright.config.ts:135-140`
- **Bug:** the EEXIST branch lstat's `E2E_DATA_DIR` to choose `rm` vs `unlink` for the diagnostic verb. Between the failing `mkdirSync` and this lstat, another process (concurrent worker, external user, automated cleanup) can replace the conflicting non-directory with a different file type — symlink replaced with regular file or vice versa — making the verb in the error message incorrect.
- **Why latent:** `workers: 1` (line 176) means no concurrent worker is racing. The error message verb is advisory ("rm" vs "unlink"); a wrong verb is mildly confusing, not data-destructive. The inner-catch already swallows any error from the lstat with a comment acknowledging this concurrency case (`packages/shared/src/findDirectoryConflict.ts:117-123` for the helper-side; the EEXIST-side comment at lines 137-139 acknowledges it explicitly).
- **What would make it active:** `workers > 1` (closes the LAT1-prior path) without per-worker E2E_DATA_DIR sharding, or a concurrent cleanup script in another terminal during a mkdir-failed e2e startup.
- **Suggested hardening:** none — the helper-side and EEXIST-side comments already document the race. If `workers > 1` ever lands, adopt per-worker DATA_DIR sharding and route the verb decision through a single resilient helper.
- **Confidence:** Medium
- **Found by:** Concurrency & State (`general-purpose (claude-opus-4-7[1m])`)

### [LAT2] `findFirstNonDirectoryAncestor("")` accepts empty input as a no-op (resolves to cwd, returns null)
- **File:** `packages/shared/src/findDirectoryConflict.ts:24-59` (and test at `__tests__/findDirectoryConflict.test.ts:110-115`)
- **Bug:** `path.resolve("")` returns `process.cwd()`. The helper walks cwd's ancestry (always existing directories) and returns `null`. The test locks this in as "no-throw, returns null." Today's call site (`playwright.config.ts:112`) constructs `E2E_DATA_DIR` via `path.join(...)` so it cannot pass `""`.
- **Why latent:** no live code path reaches the empty-string input; the helper IS now exposed via the `@smudge/shared/node-fs-helpers` subpath, so a future consumer could.
- **What would make it active:** any future caller passing a coalesced env-var directly into the helper (e.g. `findFirstNonDirectoryAncestor(process.env.DATA_DIR ?? "")`).
- **Suggested hardening:** document the empty-input behavior in the JSDoc, OR reject `""` upfront with `throw new Error("findFirstNonDirectoryAncestor: empty path")`. The test would then flip from `toBeNull()` to `toThrow()`. Two-line change.
- **Confidence:** Medium
- **Found by:** Logic-A (`general-purpose (claude-opus-4-7[1m])`)

> Note: **LAT-prior1 (per-worker mkdirSync race), LAT-prior2 (helper stat→lstat
> 2-syscall TOCTOU), LAT-prior3 (mkdirSync-existing-dir ownership/permission)**
> from the third review remain correctly latent on this commit. `workers: 1` is
> unchanged at `playwright.config.ts:176`; the helper still has the documented
> 2-syscall window with no programmatic consumer; `mkdirSync({recursive:true})`
> still no-ops on an existing dir without ownership verification. Re-confirmed,
> not re-flagged.

## Plan Alignment

Plan source: `docs/roadmap.md` Phase 4b.6 (lines 836-867); status row at line 37.

### Implemented since the third prior review (`990bcb6` → `3157b2e`)

Every Critical and Important from the third review is closed. Mapping:

- **C1** (format-check git-pathspec dead for `e2e/`) — `28867f0`. Pathspec now uses `:(glob)` and includes `tsconfig*.json`, closing **C1** + **I4** together.
- **I1** (`format-check` runs `format` writes) — `1a05f85`. Inverts to `format:check` (read-only) and adds a separate `lint-check` target, closing **I1** + **S3** (lint-fix-then-format-check).
- **I2** (mkdir catch missing ENOENT/ELOOP) and **I7** (log-injection) — `dd500e8`. Extends ANCESTOR_CODES, routes through `formatMkdirDataDirError` with `JSON.stringify` sanitization, narrows the errno cast (S7), adds the verb pick (S11) and errno code in the message (S9).
- **I3** (parsePort body-parity weaknesses) — `556cb51`. matchAll + length === 1 + tighter regex anchor.
- **I5** (probe-and-rm shell-boundary race) and **I8** (TMPDIR-blind `rm -rf`) — `f873123`. Single-shell collapse via backslash-continuation + allowlist + expanded NOLISTEN errno set (S1) + `.catch()` on Promise.all (S8).
- **I6** (loose UID parity) — `1d0597d`. Anchors on the full `process.getuid?.() ?? "shared"` coalesce expression.
- **S2** (helper-comment-vs-code mismatch about lstat vs stat) — addressed by `dd500e8`'s rewrites.
- **S4** (copilot-instructions missing `make e2e-clean`) — `8dc6943`.
- **S5** (cycle/multi-hop tests) — `0b99470`.
- **S6** (best-effort `deleteProject`) — `3d33c1e` (partial — see [I2] above).
- **S12** (typecheck script pinning) — `1f102f0`.
- **S13** (parsePort range JSDoc) — `45615d4`.
- **S14** (deep relative import bypassing package boundary) — `65df33b` (subpath export). See [S1] for the residual stale comment.
- Recordkeeping: `8dfbeed` (third-pass review report committed); `919b637` (prettier reformat after recent test additions); `3157b2e` (roadmap-ideas TODO additions).

### Not yet implemented

Phase 4b.6 functional Definition-of-Done items (`docs/roadmap.md:858-862`) are all met. Remaining gaps are documentation-shaped:

- **`docs/roadmap.md:37` Phase 4b.6 status row** still reads "Planned" though the work has shipped on this branch (the third review flagged this; unchanged). [PA1 below]
- **Phase 4b.6 Scope/DoD does not document `workers: 1` or `make e2e-clean`** — both load-bearing artifacts of the implementation. [PA2 below]
- **No design or plan document for the `.devcontainer/` scaffold** still on the branch. `find docs/plans -iname '*devcontainer*'` is empty. [PA3 below]

### Deviations

#### [PA1] `docs/roadmap.md:37` Phase 4b.6 status row still reads "Planned"
- **File:** `docs/roadmap.md:37`
- **What:** every other shipped phase in the table reads "Done." 4b.6 is materially complete on this branch.
- **Why it matters:** convention bookkeeping; the third review flagged it and the row is unchanged. Whether the flip happens pre-merge or as part of merge is a maintainer call.
- **Suggested fix:** flip 4b.6 to "Done" in the summary table (and any narrative status line in the Phase 4b.6 block). Three-character edit.
- **Confidence:** High

#### [PA2] Phase 4b.6 Scope/DoD does not mention `workers: 1` or `make e2e-clean`
- **File:** `docs/roadmap.md:846-862`
- **What:** the `workers: 1` cap at `playwright.config.ts:176` underwrites the single-port test serialization the phase establishes. The `make e2e-clean` recipe with TMPDIR allowlist (`Makefile:172-292`, documented at `CLAUDE.md:100-109`) is the only operator path back to a fresh DB. Neither is mentioned in the phase's Scope or DoD.
- **Why it matters:** the third review flagged this as deviation #3. A future contributor reading the plan to understand the contract will not find these load-bearing pieces.
- **Suggested fix:** add to Scope: "Cap `workers: 1` so the single-port harness serializes test runs"; "Provide `make e2e-clean` to wipe the isolated data dir between runs." Add to DoD: "`make e2e-clean` refuses to wipe while a live e2e server is bound on `E2E_SERVER_PORT`." Three lines.
- **Confidence:** High

#### [PA3] One-Feature / Phase-Boundary rule still violated — `.devcontainer/` scaffold remains on the branch
- **File:** `.devcontainer/{.zshrc, Dockerfile, devcontainer.json, post_install.py}` (722 added lines vs `main`); branch shape as a whole.
- **What:** the branch still bundles three independent themes: (a) Phase 4b.6 e2e isolation (the claimed roadmap phase), (b) `.devcontainer/` scaffold (722 lines, no roadmap entry, no design doc — see PA4), (c) cross-cutting hardening (`make ensure-native`, `tsconfig.tooling.json`, `findDirectoryConflict` shared helper). The third review's deviation #1 flagged this exact bundling. The post-`990bcb6` work cleared every Important inside the e2e-isolation theme but did not split the branch. Commit `926e793` reverted only the deferred *patches that targeted* `.devcontainer/`, not `.devcontainer/` itself. Per CLAUDE.md §"Pull Request Scope": "each roadmap phase is a PR; never two features."
- **Why it matters:** the phase-boundary rule was the explicit lesson from the 16-round `ovid/snapshots-find-and-replace` PR. Bundling defeats that lesson; rollback of just Phase 4b.6 is no longer atomic; review surface is doubled (the third review excluded `.devcontainer/` per CLAUDE.md, leaving 722 lines of branch content unreviewed).
- **Suggested fix:** split `.devcontainer/` into a separate branch, OR drop those four files from this branch (the maintainer can land them upstream of the template per CLAUDE.md). If the bundle is intentional, document the override in the PR description with the maintainer's rationale.
- **Confidence:** High

#### [PA4] No design / plan document for the `.devcontainer/` scaffold
- **File:** absent — `find docs/plans -iname '*devcontainer*'` and `grep -rl devcontainer docs/` both empty.
- **What:** every other Phase has a plan-doc surface under `docs/plans/`. 722 lines of operational tooling (Dockerfile, post_install.py, devcontainer.json, .zshrc) ship with no design surface and no roadmap entry.
- **Why it matters:** the hybrid status — committed to the repo but declared unreviewable per CLAUDE.md §"Ignore .devcontainer/" — is the inconsistency. CLAUDE.md's ignore rule is about ongoing template-managed churn; an initial design doc explaining the scaffold's invariants is still appropriate (and would be the artifact a future maintainer queries before editing the template upstream).
- **Suggested fix:** either remove `.devcontainer/` from the branch (the PA3 path) or add `docs/plans/<date>-devcontainer.md` documenting the design and link it from the roadmap.
- **Confidence:** High

#### [PA5] `docs/TODO.md` six new lines describe items that may not belong in a product backlog
- **File:** `docs/TODO.md:1-6` (added on this branch; commit `3157b2e` extended with three of them)
- **What:** the six lines are meta-questions about the review process: "Need to look at agentic code simplification in the agentic review?", "How to prevent fan out on receiving a code review?", "If something is out of scope, can it be added as 'next phase in roadmap'?". The rest of `TODO.md` is product-shaped (data-loss invariants, format spec, image alignment).
- **Why it matters:** mixing skill / process notes into a product backlog dilutes both. A product backlog signals what work is owed to *users*; process meta belongs in skill or `paad/` notes.
- **Suggested fix:** move the three meta lines into `paad/notes/` or a dedicated `docs/process-todo.md`. Or accept that `TODO.md` is a maintainer catch-all and document the broader scope in its header.
- **Confidence:** Medium (judgment call — the maintainer may intentionally use `TODO.md` as a catch-all)

## Review Metadata

- **Agents dispatched:** Logic & Correctness (Logic-A), Error Handling & Edge Cases (Errors-A), Contract & Integration, Concurrency & State, Security, Plan Alignment (6 specialists)
- **Scope:** changed files (Makefile, playwright.config.ts, packages/client/vite.config.ts, packages/shared/src/findDirectoryConflict.ts, packages/shared/src/index.ts, packages/shared/src/parsePort.ts, packages/shared/package.json, packages/shared/src/__tests__/{findDirectoryConflict,e2e-data-dir-parity,format-check-pathspec,parsePort-body-parity,vite-config-default-port}.test.ts, e2e/{editor-save,find-replace,sanitizer-snapshot-blob,snapshots}.spec.ts, package.json, tsconfig.tooling.json, CLAUDE.md, CONTRIBUTING.md, .github/copilot-instructions.md, docs/TODO.md, docs/roadmap.md) + adjacent (the four unmodified e2e specs `e2e/{dashboard,export,images,velocity}.spec.ts`, `tsconfig.base.json`, `packages/server/src/index.ts`, `packages/server/src/images/images.service.ts`)
- **Excluded per CLAUDE.md §"Ignore .devcontainer/":** entire `.devcontainer/` directory (4 files, 722 lines)
- **Raw findings:** 31 (across 6 specialists; before dedup + verification)
- **Verified findings:** 19 (3 Important + 14 Suggestions + 2 Latent — after dedup, threshold, and re-confirmation against the prior `990bcb6` report so already-tracked items are not re-flagged)
- **Filtered out:** 12 (drops: cross-specialist duplicates, claims not reproducible against current code, pure stylistic preference, withdrawn-during-verification by specialists themselves)
- **Latent findings:** 2 (Important: 0, Suggestion: 0 — categorized Latent by reachability, severity scale separate). Three prior latents (LAT1 per-worker mkdir, LAT2 stat/lstat TOCTOU, LAT3 mkdirSync-existing-dir ownership) re-confirmed unchanged.
- **Out-of-scope findings:** 0 — every anchor is on a line this branch authored, OR the bug is reasoning-promoted in-scope because this branch's diff is what introduced it (steering-doc drift caused by the Makefile change). The pre-filtered backlog slice (entries with `File (at first sighting)` in Makefile / CLAUDE.md / package.json) was checked against new findings; no specialist flagged any of the four pre-existing items (`afcaee1c`, `ca84e075`, `b7e3d042`, `f3b8201a`) on this commit.
- **Backlog:** 0 new entries, 0 re-confirmed, 17 total active (unchanged from prior review)
- **Steering files consulted:** CLAUDE.md, .github/copilot-instructions.md, CONTRIBUTING.md
- **Plan/design docs consulted:** docs/roadmap.md (Phase 4b.6 lines 836-867); prior reviews ovid-devcontainer-and-e2e-isolation-2026-04-27-{13-19-24-5b89539,18-27-06-8bac750,20-48-50-990bcb6}.md
- **Live verifications performed:**
  - `for f in /workspace/e2e/*.spec.ts; do grep -A2 "async function deleteProject" "$f"; done` — confirms 4 of 8 specs have new pattern (Important [I2])
  - Read of `CLAUDE.md:80`, `.github/copilot-instructions.md:52`, `CONTRIBUTING.md:85` against `Makefile:8` — confirms three-way steering drift (Important [I1])
  - Read of `packages/shared/src/index.ts:38-44` against `playwright.config.ts:13-16` — confirms stale comment after subpath-export (Suggestion [S1])
  - `git diff main..HEAD --stat -- '.devcontainer/'` — confirms `.devcontainer/` scaffold still on branch (Plan PA3)
