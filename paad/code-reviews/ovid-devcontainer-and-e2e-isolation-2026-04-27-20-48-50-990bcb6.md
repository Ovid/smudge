# Agentic Code Review: ovid/devcontainer-and-e2e-isolation

**Date:** 2026-04-27 20:48:50
**Branch:** ovid/devcontainer-and-e2e-isolation -> main
**Commit:** 990bcb61b179150d70ed2c49608b03561442074e
**Files changed:** 27 | **Lines changed:** +1758 / -879
**Diff size category:** Large

## Executive Summary

This is the **third** review of this branch — the prior reviews at `5b89539`
(`paad/code-reviews/ovid-devcontainer-and-e2e-isolation-2026-04-27-13-19-24-5b89539.md`)
and `8bac750`
(`paad/code-reviews/ovid-devcontainer-and-e2e-isolation-2026-04-27-18-27-06-8bac750.md`)
are committed; thirteen follow-up commits since `8bac750` (HEAD `990bcb6`) close
nearly every prior finding scoped to non-`.devcontainer/` paths (C1, I1, I2, I3,
I6, I8, S1, S2, S3, S4, S12, S13, LAT1) and revert all `.devcontainer/`-targeted
deferred patches in `926e793` per CLAUDE.md §"Ignore .devcontainer/." This run
hunts for issues the prior reviews missed or that the post-`8bac750` commits
introduced.

Headline: **the I2 hardening at `Makefile:139` is partially broken**. The
expanded format-check git-pathspec includes `'e2e/**/*.ts'`, but git's pathspec
syntax treats `**` as `*` (a single segment) without `:(glob)` magic, so the
pattern matches **zero files** today (verified live: `git ls-files 'e2e/**/*.ts'`
returns empty; `git ls-files 'e2e/*.ts'` returns the eight specs). The
companion lint and typecheck gates work via direct file enumeration and DO
catch e2e drift; format-check silently does not — the entire purpose of
commit `d204950` ("bring playwright.config + e2e/ under lint/format/typecheck")
is partially defeated. Eight Important findings cluster around: a
`format-check` recipe that silently mutates the user's working tree (writes
instead of checks), an `ENOENT`/`ELOOP` gap in the playwright catch block (same
opaque-message regression class as the resolved C1), the new
`parsePort-body-parity` test's loose drift detection (`.match()` vs `matchAll`,
misleading anchor comment), root-level `tsconfig*.json` files outside the
format/lint scope, a probe-vs-rm shell-boundary race in `e2e-clean` that
widens the prior I4 window, the loose UID-namespace parity assertion,
log-injection via attacker-controllable filename in the playwright error
message, and TMPDIR-blind `rm -rf` in `e2e-clean`. Three Latent findings record
defense-in-depth gaps the helper introduces. No out-of-scope findings — every
anchor is on lines this branch authored.

## Critical Issues

### [C1] `Makefile:139` `format-check` git-pathspec `'e2e/**/*.ts'` matches zero files — `e2e/` formatting drift is silently un-gated by `make all`
- **File:** `Makefile:139`
- **Bug:** the `format-check` recipe ends with
  `git diff --quiet -- 'packages/**/*.ts' 'packages/**/*.tsx' 'packages/**/*.json' 'packages/**/*.css' 'e2e/**/*.ts' playwright.config.ts vitest.config.ts`.
  Git's default pathspec semantics treat `**` as `*` (a single path segment) unless `:(glob)` magic is used. `e2e/` contains files at depth 1 only (`e2e/dashboard.spec.ts`, `e2e/editor-save.spec.ts`, ...), so the pattern `e2e/**/*.ts` requires AT LEAST one intermediate component (`e2e/<seg>/<file>.ts`) and matches **zero files**. Verified live in the repo:
  ```
  $ git ls-files 'e2e/**/*.ts'   # → empty
  $ git ls-files 'e2e/*.ts'      # → 8 spec files
  $ # modify e2e/editor-save.spec.ts (uncommitted)
  $ git diff --quiet -- 'packages/**/*.ts' ... 'e2e/**/*.ts' ... ; echo $?  → 0  (no diff detected!)
  $ git diff --quiet -- 'e2e/*.ts' ; echo $?  → 1
  ```
  The companion `lint` and `typecheck` gates (`package.json:18-19,17`) enumerate `e2e/` directly via the shell — those work. The format-check guard at the end of the Makefile recipe is the only e2e-formatter sentinel and it is dead.
- **Impact:** the entire purpose of commit `d204950 build(tooling): bring playwright.config + e2e/ under lint/format/typecheck` was to gate e2e on `make all`. The branch's claim is partially false; the prior review's I2 verification was incomplete on this point. A maintainer who hand-edits an `e2e/*.spec.ts` in a non-prettier form will see prettier rewrite it on `make format-check` (because `npm run format`'s prettier glob `"e2e/**/*.ts"` IS shell-glob and DOES recurse), but the trailing `git diff --quiet` guard sees no matches and exits 0 — change "succeeds" silently. Combined with [I1] below (the recipe writes instead of checking), the practical UX is "formatting drift in `e2e/` is silently fixed on disk and never reported." The `e2e/` blind spot also re-opens for `playwright.config.ts` and `vitest.config.ts` if their depth changes (today both are root-level, matching the literal globs at the end of the pathspec — unaffected).
- **Suggested fix:** change `'e2e/**/*.ts'` to `:(glob)e2e/**/*.ts` (git's glob magic enables real `**` recursion), or split into `'e2e/*.ts' 'e2e/**/*.ts'` to cover both depth-1 and deeper. Same fix should apply to `'packages/**/*.ts' 'packages/**/*.tsx'` etc. for safety — today they happen to match because all source is depth ≥2, but the pattern is fragile if anyone adds a top-level `packages/foo.ts`. Verify by reproducing the test scenario above and confirming the `git diff --quiet` exits 1 on a modified e2e file. **Pair with the [I1] fix below** — once `npm run format:check` is the inner command, the trailing git-diff guard becomes belt-and-suspenders rather than load-bearing.
- **Confidence:** High (verified live)
- **Found by:** Logic-A (`general-purpose (claude-opus-4-7[1m])`)

## Important Issues

### [I1] `Makefile:138` `format-check` runs `npm run format` (writes) instead of `npm run format:check` (read-only) — silently mutates the user's working tree
- **File:** `Makefile:137-139`
- **Bug:** the recipe is
  ```
  format-check: ## Format code, then fail if anything changed
  	npm run format
  	@git diff --quiet -- 'packages/**/*.ts' ... || { echo "Error: formatting changed files — commit before running make all"; exit 1; }
  ```
  `package.json:20` `format` runs `prettier --write`. There is a sibling `format:check` script at `package.json:21` running `prettier --check` (read-only). The Makefile recipe ignores it. Failure modes:
  1. **Mid-edit run:** a developer running `make format-check` (or `make all`) with WIP that happens to be in the format glob has prettier rewrite the WIP file. The git-diff then catches the combined change and emits "formatting changed files — commit before running make all" — misleading because it changed because of WIP, not because of formatting drift. The user is told to commit prettier's output (which they may not have wanted in this commit).
  2. **Already-clean WIP run:** if WIP files are formatter-clean, prettier no-ops, but the git-diff still includes the WIP and fails with the same misleading message.
  In neither case does the diff strictly verify "formatting check" — it includes whatever was modified before the recipe ran. Pre-existing scope; the branch widened the format glob (added `e2e/**/*.ts playwright.config.ts vitest.config.ts`) without fixing the underlying check semantic. Compounds with [C1]: writes ARE happening for `e2e/` files (prettier's shell glob recurses), but the trailing diff guard never fires for them, so the writes are silent.
- **Impact:** `make all` (the canonical pre-merge gate) silently rewrites the user's tree on every invocation; the failure message is the wrong root cause; combined with [C1], `e2e/` writes are completely unreported. Footgun severity: moderate — most users don't run `make format-check` mid-edit, but the few who do see confusing errors.
- **Suggested fix:** change line 138 to `npm run format:check`. The git-diff guard at line 139 then becomes belt-and-suspenders (could be dropped entirely, or kept as a sanity check that no `format:check`-passing file is somehow still dirty). Keep `format:check` as the inner command; that script already runs `prettier --check` against the same globs, so behavior is preserved minus the write. Pair with [C1]'s pathspec fix.
- **Confidence:** High (verified by reading `Makefile:138` and `package.json:20-21`)
- **Found by:** Errors-A, Logic-A (`general-purpose (claude-opus-4-7[1m])` × 2)

### [I2] `playwright.config.ts:78-95` catch block doesn't handle ENOENT or ELOOP — dangling/cyclic symlink falls through to opaque default message
- **File:** `playwright.config.ts:78-95`
- **Bug:** the catch block handles `errno.code === "ENOTDIR"` and `errno.code === "EEXIST"`, then `throw err`. Verified live on Node 22 in this container:
  ```
  $ ln -s /does/not/exist /tmp/.../dangling
  $ node -e "fs.mkdirSync('/tmp/.../dangling/sub', {recursive:true})"
  → errno.code = 'ENOENT', errno.path = '/tmp/.../dangling/sub'
  ```
  Control falls through to `throw err`; the user sees Node's default `ENOENT: no such file or directory, mkdir '/tmp/.../dangling/sub'` — exactly the opaque-path-message that the prior review's C1 was authored to replace. The new `findFirstNonDirectoryAncestor` helper (`packages/shared/src/findDirectoryConflict.ts`) already correctly flags dangling and cyclic symlinks at the link layer (verified via the new tests at `packages/shared/src/__tests__/findDirectoryConflict.test.ts:59-66`); the helper just isn't invoked for these errnos. ELOOP (cyclic symlink) is the same omission.
- **Impact:** the realistic origin of a dangling symlink in the e2e data dir is precisely a workflow this branch supports — `make e2e-clean` after a developer manually symlinked the data dir, or a target that got `rm`'d while the symlink remained. Recovery cost climbs back to "ls -la each ancestor" — same regression class as the prior C1, on a more obscure errno path.
- **Suggested fix:** extend the catch to handle `ENOENT` and `ELOOP` by calling `findFirstNonDirectoryAncestor(E2E_DATA_DIR)` and surfacing the result with a tailored message ("a missing-target symlink at..." / "a symlink loop at..."). The helper handles both cases; the wiring is missing. Three lines of code.
- **Confidence:** High (verified live)
- **Found by:** Concurrency & State (`general-purpose (claude-opus-4-7[1m])`)

### [I3] `parsePort-body-parity.test.ts` has multiple weaknesses in its drift detection — `.match()` not `matchAll`, misleading column-anchor comment, and brittle to nested-block formatting
- **File:** `packages/shared/src/__tests__/parsePort-body-parity.test.ts:27-38`
- **Bug:** the test is the canonical drift sentinel between the canonical `@smudge/shared/parsePort` and the inline copy in `vite.config.ts`. Three issues stack:
  1. **`.match()` vs `matchAll`.** `extractBody` uses `source.match(PARSE_PORT_BODY_RE)` (line 32) — non-global, returns first match. Sibling parity tests (`e2e-data-dir-parity.test.ts:50-64`, `vite-config-default-port.test.ts:35-44`) use `Array.from(source.matchAll(...))` plus `length === 1` precisely to detect duplicate matches (commented-out historical examples, dead-code copies). If a future change adds a second `function parsePort(...)` body in either file (an overload, a debug stub, a fixture string), only the first body is checked.
  2. **Misleading anchor comment.** Line 27-28 reads "Anchor on the closing-brace at column 0 so the `}` inside template-literal interpolations like `${JSON.stringify(raw)}` doesn't match." The regex is `/function parsePort\([^)]*\): number \{\n([\s\S]*?)\n\}/`. There is NO column-0 anchor (no `^`, no `m` flag). The non-greedy `[\s\S]*?` stops at the FIRST `\n}` regardless of indentation. The template-interpolation `}` happens to work because `}` inside `${...}` is preceded by non-newline characters, not because of column anchoring. The comment claims a safety property the regex does not enforce.
  3. **Brittle to inner blocks.** A future maintainer who adds a try/catch or any block whose `}` lands at column 0 (legal but unusual) silently truncates the comparison; both bodies could drift identically in the truncated tail and still match.
- **Impact:** the test is load-bearing — its correctness is what keeps the canonical and inline bodies in lockstep, in a ladder of S1/S9/I1/I8 fixes that the comment block at `vite.config.ts:46-67` carries. Each of the three weaknesses defeats a different failure mode the test was authored to catch.
- **Suggested fix:** mirror `findExactlyOne` from `e2e-data-dir-parity.test.ts`: make the regex global, use `matchAll`, assert `length === 1` per file. Fix the comment to match what the regex actually does (or change the regex to use the `m` flag and `^}` so the comment becomes correct). For the third issue, anchor on a sentinel — either require the closing brace to be followed by end-of-input/non-letter, or append a `// END parsePort` marker after each body and key on it. ~10 lines.
- **Confidence:** High
- **Found by:** Errors-A, Logic-A, Contract & Integration (`general-purpose (claude-opus-4-7[1m])` × 3)

### [I4] Root-level `tsconfig*.json` files (incl. new `tsconfig.tooling.json`) are outside `format`/`format-check`/lint scope
- **File:** `package.json:20-21` paired with `Makefile:139` and `tsconfig.tooling.json` (new this branch)
- **Bug:** the branch added `playwright.config.ts`, `vitest.config.ts`, and `e2e/**/*.ts` to format/lint/typecheck globs (closing the prior review's I2). However, `tsconfig.tooling.json` (new this branch) and `tsconfig.base.json` (pre-existing) are root-level `.json` files NOT matched by `"packages/**/*.{ts,tsx,json,css}"` and not enumerated explicitly. `npx prettier --check tsconfig.tooling.json tsconfig.base.json` currently passes, but a formatter drift in either is invisible to `make all`.
- **Impact:** the branch grew the static-gate surface to load-bearing config files. The new `tsconfig.tooling.json` directly governs whether `playwright.config.ts` typechecks; a hand-edit that breaks JSON shape (trailing comma, etc.) escapes both `format-check` and `lint`, and is only caught when the next person runs `make typecheck`. Same drift hazard the I2 fix closed for `playwright.config.ts`, reopened at one level up.
- **Suggested fix:** extend `format` and `format:check` globs in `package.json:20-21` to include `"*.{json,md}"` (or at minimum `"tsconfig*.json"`). Mirror in `Makefile:139` git-diff (after the [C1] pathspec fix). Three-line change.
- **Confidence:** High
- **Found by:** Contract & Integration, Logic-A (`general-purpose (claude-opus-4-7[1m])` × 2)

### [I5] `Makefile:e2e-clean` probe-and-rm run in **separate shell invocations** — wider TOCTOU window than the prior I4 documented
- **File:** `Makefile:211-246`
- **Bug:** the recipe has two `@`-prefixed shell lines. Line 211 spawns shell-A which runs the Node probe; shell-A exits. Make spawns shell-B at line 241 which executes the `rm -rf`. The OS-scheduler-visible gap between shell-A's exit and shell-B's `rm` syscall is non-trivial — fork/exec of a fresh `/bin/sh`, `bash` rc-file processing, plus the `node -p` invocation in the assignment. On a busy host this is easily 50–200ms.
  The prior review's I4 documented the conceptual probe-to-server-startup race; CLAUDE.md:107-111 also documents it. Neither calls out that the recipe's shell-step boundary itself adds wall time to that window. A developer who waits until `make e2e`'s server has fully bound and then Ctrl-C's it, then types `make e2e-clean` immediately, faces this window: the probe sees no listener (server has shut down enough to release the port), shell-A exits, shell-B forks, meanwhile in another terminal the user types `make e2e` to restart, and by the time shell-B runs `rm`, the new server is mid-Knex-migration. Same data-loss outcome as I4.
- **Impact:** the canonical "fresh slate" workflow is documented as safe but has a live, reproducible race window. Severity equal to the prior I4 (corrupt e2e DB) reachable from a more common workflow than "two terminals racing each other."
- **Suggested fix:** collapse probe + rm into a single shell invocation using `;` or `&&` continuation, so the `rm` runs in the same shell process the probe completed in. This shrinks the gap to a single fork/exec of `rm`. To actually CLOSE the race, wrap with `flock -n /tmp/smudge-e2e-clean-${UID}.lock` and have `make e2e` take the same lock for the duration of its server lifecycle (per the prior review's I4 suggestion). Single-shell collapse is the minimal mitigation; flock is the structural one.
- **Confidence:** Medium-High
- **Found by:** Concurrency & State (`general-purpose (claude-opus-4-7[1m])`)

### [I6] `e2e-data-dir-parity.test.ts:86-97` UID-namespace assertion uses loose `toMatch` — could pass with unrelated `process.getuid` and `"shared"` literals
- **File:** `packages/shared/src/__tests__/e2e-data-dir-parity.test.ts:86-97`
- **Bug:** the "namespaces the e2e data dir by UID" test asserts `process.getuid` AND `"shared"` each appear *somewhere* in playwright.config.ts and Makefile via two independent `toMatch` calls. The string `"shared"` already appears in unrelated comments in the codebase (and could appear in future ones); `process.getuid` could be moved to a different expression while leaving the literals semantically disconnected. The comment block at lines 87-92 anticipates this ("without binding to a specific syntax") but the loose binding is the gap. Sister assertions in the same file enforce strict regex+matchAll+exactly-one parity for the data-dir prefix and port — the UID-coalesce check is the weakest link in the same chain.
- **Impact:** the test was added precisely because the prior review's I6 flagged drift hazard between the two derivations. Loose pattern matching defeats the purpose. Today the two expressions ARE wired together; a future refactor could decouple them while the test still passes.
- **Suggested fix:** anchor on the full coalesce expression. For playwright: `/process\.getuid\?\.\(\)\s*\?\?\s*"shared"/`. For Makefile: `/process\.getuid\s*\?\s*process\.getuid\(\)\s*:\s*"shared"/`. Plus a `length === 1` assertion via the existing `findExactlyOne` helper. Catches drift in either form without false positives on prose comments.
- **Confidence:** Medium-High
- **Found by:** Contract & Integration (`general-purpose (claude-opus-4-7[1m])`)

### [I7] `playwright.config.ts:83-87` interpolates attacker-controllable filename into thrown Error message without sanitization — log-injection via shell metacharacters/ANSI escapes/newlines
- **File:** `playwright.config.ts:83-87` (paired with `packages/shared/src/findDirectoryConflict.ts:24-58`)
- **Bug:** when `mkdirSync` raises ENOTDIR, `findFirstNonDirectoryAncestor(E2E_DATA_DIR)` walks `/tmp` and returns the first non-directory ancestor's absolute path. The returned `offender` is interpolated directly into the Error message:
  ```ts
  throw new Error(
    `playwright.config: expected a directory at or above ${E2E_DATA_DIR}, but a non-directory exists at ${offender}. ` +
      `Remove the conflicting non-directory (e.g. \`rm ${offender}\`) and re-run \`make e2e\`.`,
  );
  ```
  POSIX permits any byte except `\0` and `/` in a filename — including `\n`, `\r`, ANSI escape sequences, and backticks. An attacker who can place a file in `/tmp` (any local user — `/tmp` is mode-1777 by definition) can craft a name that:
  1. Contains `\n[ok] tests passing` — fakes a green result inside the same log stream other tooling parses.
  2. Contains ANSI escapes (`\x1b[2K\x1b[1A`) that hide preceding lines.
  3. Contains backticks/`$()`. The message reads ``` `rm ${offender}` ```; if a downstream consumer pipes the message through a shell helper or `xargs`, command substitution executes.
  On a sticky `/tmp` (Linux default) the attacker can only inject names *they own*, but the I6-style cross-user case still applies on shared dev hosts without sticky `/tmp`, on macOS where `os.tmpdir()` resolves under `/var/folders/<uid>/T/` with weaker semantics than `/tmp`, and in CI where `/tmp` may not be sticky depending on runner config.
- **Impact:** local-user-only, requires a victim to copy the suggested `rm` into a shell. Severity is "info disclosure / log-injection / suggested-command injection." Realistic in CI logs (where many tools tail the log) and developer terminals.
- **Suggested fix:** before interpolating, sanitize. Option (a): `JSON.stringify(offender)` — renders control chars as `\n`/`\t` literals (safe to print, retains path info). Option (b): if `[...offender].some(c => c.charCodeAt(0) < 32)` is true OR `offender !== path.normalize(offender)`, surface a generic "a non-directory exists at or above `${E2E_DATA_DIR}` — inspect manually" message. Apply same sanitization to `E2E_DATA_DIR` for consistency. Two-line change.
- **Confidence:** Medium-High
- **Found by:** Security (`general-purpose (claude-opus-4-7[1m])`)

### [I8] `Makefile:241` `make e2e-clean` derives `DATA_DIR` from unvalidated `os.tmpdir()` — TMPDIR-blind `rm -rf` on operator-controlled prefix
- **File:** `Makefile:241-246`
- **Bug:** the recipe expands `DATA_DIR` via `node -p 'require("path").join(require("os").tmpdir(), "smudge-e2e-data-" + (process.getuid ? process.getuid() : "shared"))'`. `os.tmpdir()` returns the value of `TMPDIR` (Unix) / `TMP`/`TEMP` (Windows) verbatim, falling back to `/tmp` only if unset. Shell quoting `"$$DATA_DIR"` correctly prevents word-splitting and glob expansion; the literal leaf `smudge-e2e-data-<uid>` is fixed. **However**: there is no validation that the result lives under a sane prefix. If a developer (or CI) sets `TMPDIR=$HOME` (debugging another tool, etc.) or `TMPDIR=/`, `make e2e-clean` issues `rm -rf "$HOME/smudge-e2e-data-1000"` or `rm -rf "/smudge-e2e-data-1000"`. The first is a real fat-finger hazard; the second is no-op on a non-root account but full-blast on root. Neither matches user intent.
- **Impact:** not a remote-attacker vector — env-var is operator-controlled. But the recipe accepts the env-var with no upper-bound check, no allowlist (e.g. "must be under one of `/tmp`, `/var/folders`, `/var/tmp`"), and no confirmation. The `playwright.config.ts` side has the same blindness for writes — but only writes a `smudge.db` and image uploads (recoverable); `rm -rf` is not.
- **Suggested fix:** assert `DATA_DIR` matches a prefix allowlist before `rm -rf`. Cheap form:
  ```make
  case "$$DATA_DIR" in /tmp/*|/var/folders/*|/var/tmp/*) ;; *) echo "refusing: TMPDIR resolves outside the safe allowlist ($$DATA_DIR)"; exit 1 ;; esac
  ```
  Document the new `make e2e-clean` invariant in CLAUDE.md. The allowlist is conservative; a developer with a non-default TMPDIR can override.
- **Confidence:** Medium
- **Found by:** Security (`general-purpose (claude-opus-4-7[1m])`)

## Suggestions

- **[S1]** `Makefile:213` e2e-clean probe `NOLISTEN` set is `['ECONNREFUSED','EADDRNOTAVAIL','EAFNOSUPPORT','ENETUNREACH']`. Some Linux configs (and macOS in transient network states) emit `EHOSTUNREACH` on `connect()` to `::1`; `ECONNRESET` is also possible on a peer-side close-without-listener. Both currently classify as `'error'` and refuse to wipe — fail-closed, but operator-nuisance on transient routing flakes. Add both to `NOLISTEN`. Found by Logic-A.

- **[S2]** `playwright.config.ts:69-77` comment says "we walk ancestors with `lstatSync` via `findFirstNonDirectoryAncestor` and surface the real offender." The current helper at `packages/shared/src/findDirectoryConflict.ts:39` uses `statSync` first (the symlink-following call — needed for the macOS `/var → /private/var` regression fixed in commit `990bcb6`) and only falls back to `lstatSync` in the catch. Update the comment to match. Found by Logic-A.

- **[S3]** `Makefile:8` `all: lint format-check typecheck cover e2e`. `lint` runs `eslint --fix` (autofix), which can make formatter-relevant changes. If `lint` mutates a file in a way that violates prettier rules, `format-check` then mutates further; the user sees a confusing "format-check changed files" caused by the prior `lint --fix` step. Either run `format-check` before `lint --fix`, or use `lint:check` (no autofix) inside `make all`. Pre-existing scope but worsened by the wider format/lint surface. Found by Logic-A, Errors-A.

- **[S4]** `.github/copilot-instructions.md` Build & Run block doesn't mention `make e2e-clean` (added on this branch and now documented in CLAUDE.md and CONTRIBUTING.md). Mirror the documentation for consistency. Found by Logic-A.

- **[S5]** `findDirectoryConflict.test.ts` exercises happy paths plus dangling-symlink, symlink-to-file, symlink-to-dir, leaf-as-file, and deep-ancestor-as-file. Not tested: cyclic symlink (ELOOP), `chmod 000` ancestor (EACCES), empty-string input, multi-hop symlink chain (matters for the macOS `/var` regression fix). The helper handles all of these correctly today; tests would lock in the behavior. Found by Errors-A, Concurrency.

- **[S6]** `e2e/{editor-save,snapshots}.spec.ts` `afterEach` calls `expect(res.ok()).toBeTruthy()` inside `deleteProject`. If cleanup DELETE fails (transient blip, server crashed during test), the afterEach assertion competes with the test's own assertion in the report. Wrap the cleanup call in `try { ... } catch { console.warn(...) }` so the test outcome dominates. Found by Errors-A.

- **[S7]** `playwright.config.ts:81` casts `err as NodeJS.ErrnoException` unconditionally. If `err` is a non-Error throw (rare for mkdirSync but defensive code shouldn't presume), `errno.code` is `undefined`, both branches fall through, and the original `err` is rethrown — diagnostic message hardening bypassed. Narrow with `if (err instanceof Error && "code" in err)`. Found by Errors-A.

- **[S8]** `Makefile:211-227` Promise.all chain has no `.catch()`. Sync throws inside `net.createConnection` (theoretically reachable for malformed host args; today's hardcoded `'127.0.0.1'`/`'::1'` are safe) become `UnhandledPromiseRejection` to stderr — recipe still fails-closed (correct), but the curated "refusing to wipe" message is preceded by a Node stack trace. Add `.catch((e) => { console.error('e2e probe internal error:', e?.code ?? e?.message); process.exit(2); })`. Found by Logic-A, Errors-A.

- **[S9]** `playwright.config.ts:84-92` thrown messages embed `${offender}` and `${E2E_DATA_DIR}` but not the original `errno.code`. Including `\` (errno: ${errno.code})\`` preserves the diagnostic without changing the user-facing prose. Found by Concurrency.

- **[S10]** `Makefile:165-169` `command -v node` check at recipe start AND `Makefile:241-245` `test -n` check on the `node -p` output. The latter covers the empty-string failure mode of the former, so the line-165 check is redundant for protecting line 241. Consolidate to one check (drop the line-165 block, rely on `test -n`'s diagnostic) — or keep both with a comment explaining the redundant intent. Found by Concurrency.

- **[S11]** `playwright.config.ts:84-87` ENOTDIR branch suggests `rm ${offender}` even when `offender` is a symlink. `rm` works (removes the link), but the helper's docstring at `findDirectoryConflict.ts:21-22` recommends `unlink` for symlinks specifically — and `rm` versus `unlink` is a meaningful distinction in error copy. Pick the verb based on `lstatSync(offender).isSymbolicLink()`. Three lines. Found by Contract.

- **[S12]** No test asserts that `tsc --noEmit -p tsconfig.tooling.json` is actually invoked by `npm run typecheck` (`package.json:17`). If the second `tsc` invocation is removed in a refactor, the tooling typecheck silently disappears and only fires on manual invocation. A textual parity-test (read `package.json`'s `typecheck` script, assert both `tsc -b ...` and `tsc --noEmit -p tsconfig.tooling.json` appear) mirrors the existing parity-test pattern. Found by Contract.

- **[S13]** `parsePort` accepts `[1, 65535]`. No realistic Smudge dev/e2e use case binds below 1024; permitting privileged ports is a defense-in-depth gap. Raise the lower bound to 1024 in `parsePort.ts` and the inline `vite.config.ts` copy; the byte-equal parity test will then guard the change. Or accept and document the choice in the JSDoc. Pre-existing scope; the branch widens consumers (now playwright.config + Makefile). Found by Security.

- **[S14]** `playwright.config.ts:10` deep relative import `./packages/shared/src/findDirectoryConflict` defeats the `@smudge/shared` package boundary. A future helper added next to `findDirectoryConflict.ts` is implicitly importable from playwright with no review surface; any future ESLint `import/no-internal-modules` rule would have to carve out an exception for this exact path. Add a sub-path export to `packages/shared/package.json` (`"exports": { "./node-fs-helpers": "./src/findDirectoryConflict.ts" }`) and import via `@smudge/shared/node-fs-helpers`. Found by Security.

- **[S15]** `Makefile:212` `make e2e-clean` net-probe targets a literal port 3457 (parity-tested). Probe success criterion is "anything listens" — too coarse. A non-Smudge service binding 3457 would falsely block `make e2e-clean`; the reverse (e2e crashed but a different service has bound 3457) leads the user to `rm -rf` outside the safe path. Augment probe with HTTP GET to `/api/health` and check response shape — only refuse the wipe if the listener identifies as Smudge. Hardening, not a fix. Found by Security.

## Latent

> Findings on lines this branch authored where the bug is not currently
> reachable via any live code path, but the pattern itself is brittle or
> load-bearing for future work. **Not a merge-blocker** — record so the next
> change in this area is informed. Does not enter the OOS backlog.

### [LAT1] `findFirstNonDirectoryAncestor` swallows EACCES via the catch-and-skip path — defense-in-depth gap if reused outside playwright
- **File:** `packages/shared/src/findDirectoryConflict.ts:43-56`
- **Bug:** the catch treats statSync-fail then lstatSync-fail as "truly does not exist — keep walking." On real filesystems, an inaccessible ancestor (chmod 000) makes both calls fail with EACCES, not ENOENT — the helper continues, eventually returning `null`. The playwright caller's `?? E2E_DATA_DIR` fallback then names the leaf, which is wrong (the real failure is at the inaccessible ancestor).
- **Why latent:** today this isn't reachable through the playwright code path. The catch block at `playwright.config.ts:81-95` invokes the helper only on `ENOTDIR`/`EEXIST` (and would invoke it on `ENOENT`/`ELOOP` once [I2] is fixed). EACCES surfaces a different errno code that the catch doesn't handle, so the helper isn't called. The helper IS exported via the deep relative import path, though, and could be reused.
- **What would make it active:** any future consumer that invokes the helper on an EACCES-error mkdirSync result, or a future change that broadens the playwright catch to cover EACCES, or a refactor that moves the helper into the public package surface.
- **Suggested hardening:** in the inner catch, inspect the original err's `code`. If `EACCES`/`EPERM`, return the candidate as the offender (it's the path mkdir can't resolve). Add a unit test using `chmod 000` on a scratch dir + a non-root caller. Two lines plus the test.
- **Confidence:** Medium
- **Found by:** Logic-A, Errors-A, Contract & Integration (`general-purpose (claude-opus-4-7[1m])` × 3)

### [LAT2] `findFirstNonDirectoryAncestor` stat/lstat is a 2-syscall TOCTOU window with one false-positive vector
- **File:** `packages/shared/src/findDirectoryConflict.ts:37-58`
- **Bug:** statSync(candidate), then on failure lstatSync(candidate). Between calls, another process can mutate the path. Most outcomes are benign (false-negative; helper returns null; fallback names the leaf). One outcome is a false-positive that names the wrong path: statSync returns "non-directory" → return candidate → between return and user reading the error, the file is replaced with a directory → user runs the suggested `rm $candidate` and removes a fresh directory.
- **Why latent:** the helper runs only after mkdirSync has already failed, so the live path actually IS a non-directory at the moment mkdir tried. The realistic exposure window is "from helper's stat to user's rm" — a single user on a single workstation cannot race themselves between reading an error and typing `rm`. Multi-user/CI hosts could; the I6-mitigation (UID-namespacing) eliminates the relevant cross-user vector for the e2e data dir specifically.
- **What would make it active:** a future build-script consumer that reads the error and calls `rm`/`unlink` programmatically without prompting — feeding the result into automated removal opens the race.
- **Suggested hardening:** none required for current consumers. Note in the JSDoc: "The returned path reflects state at stat-time; concurrent FS mutations between this call and consumer action are not protected against." Programmatic consumers should re-stat under a directory FD or use openat-style atomic operations.
- **Confidence:** Medium
- **Found by:** Concurrency & State (`general-purpose (claude-opus-4-7[1m])`)

### [LAT3] `playwright.config.ts:79` `mkdirSync({recursive:true})` no-ops on an existing dir without verifying ownership — UID-namespacing closes most cases but not all
- **File:** `playwright.config.ts:79`
- **Bug:** I6 added the UID suffix, closing the cross-user pre-positioning case under sticky `/tmp`. `mkdirSync({recursive:true})` on an existing dir is a no-op — does not check ownership, does not reset permissions, does not chmod. If a stale `/tmp/smudge-e2e-data-1000/` exists with mode 0o777 and a UID that doesn't match the current process (left by an exited container, a previous user with same UID inside a different namespace, an ENOTDIR partially-cleaned-up state), the e2e server proceeds to write `smudge.db` and image uploads into a world-writable directory.
- **Why latent:** no current code path produces this state on a typical dev workstation; the I6 sticky-`/tmp`/UID-suffix combination is correct for the canonical case. Realistic on shared CI runners (UID 1000 = "the build user" across jobs) and in `docker-rootless` setups (mapped UIDs collide). The fallback `"shared"` literal on Windows-via-WSL or MinGW envs collides for everyone in the same env.
- **What would make it active:** any environment where the `smudge-e2e-data-<UID>` path can pre-exist with non-current ownership — CI matrix runners, container-rebuild flows, dev hosts after a UID change.
- **Suggested hardening:** after `mkdirSync`, `lstatSync(E2E_DATA_DIR)` and assert `stat.uid === process.getuid?.()` and `(stat.mode & 0o022) === 0` (no group/world write). Throw an actionable error naming the offending mode/UID. Or use `fs.mkdtempSync(prefix)` for a unique always-fresh dir (drops UID-namespacing but breaks `make e2e-clean`'s ability to predict the path).
- **Confidence:** Medium
- **Found by:** Security (`general-purpose (claude-opus-4-7[1m])`)

## Plan Alignment

Plan source: `docs/roadmap.md` Phase 4b.6 (E2E Test Isolation) lines 836-867; status row at line 37.

### Implemented since the second prior review (8bac750 → 990bcb6)
Every Important/Suggestion finding the prior review left for this round is verifiable in code:

- **C1** (ENOTDIR phantom path) — addressed by `c5a3804` + `bfa97c9` + `990bcb6`. New helper `findFirstNonDirectoryAncestor` at `packages/shared/src/findDirectoryConflict.ts:24-59`; wired in `playwright.config.ts:78-96`. Tests cover symlink-to-dir (the macOS `/var → /private/var` regression), dangling symlink, symlink-to-file. **Note:** [I2] above flags an ENOENT/ELOOP gap in the wiring — the helper is correct, the catch-block coverage is partial.
- **I1** (E2E_SERVER_PORT parity) — addressed by `abbfcfd` (port assertion in `e2e-data-dir-parity.test.ts:99-113`).
- **I2** (lint/format/typecheck on playwright + e2e) — addressed by `d204950` for lint and typecheck; **[C1] above flags that format-check is silently dead for `e2e/`** because of git-pathspec semantics.
- **I3** (server-coupled `mkdirSync(.../images)`) — addressed by `c5a3804`. `playwright.config.ts:79` is now `fs.mkdirSync(E2E_DATA_DIR, { recursive: true })`.
- **I4** (TOCTOU between e2e-clean probe and server startup) — addressed by documentation only at `Makefile:180-190` and `CLAUDE.md:107-111`. **[I5] above flags an additional shell-boundary race** wider than the prior I4 documentation.
- **I6** (UID-namespaced tmpdir) — addressed by `af263a7`. **[I6] above (this report) flags the parity test's loose UID assertion**; **[LAT3] flags an existing-dir ownership gap**.
- **I8** (parsePort drift) — addressed by `68476a3` (byte-equal parity test). **[I3] above (this report) flags weaknesses in that test**.
- **S1** (`rm -rf` empty-on-fail) — addressed by `bce9875`.
- **S2** (500ms timeout) — addressed by `bce9875` (T=2000).
- **S3** (regex first-match) — addressed by `abbfcfd` for two of three parity tests (parsePort body parity not — see [I3]).
- **S4** (vite.config DATA_DIR) — addressed by `e66a0f9`.
- **S12** (CLAUDE.md / CONTRIBUTING.md document `e2e-clean`) — addressed by `9d5d586`.
- **S13** (IPv4-only probe) — addressed by `bce9875` (dual-stack probe).
- **LAT1** (workers:1 mkdirSync race) — addressed by `9d5d586` (forward-looking note).

### Addressed by other means (revert)
`926e793` deleted four deferred patches that targeted `.devcontainer/`. Per CLAUDE.md §"Ignore .devcontainer/", every prior-review finding scoped to `.devcontainer/` (I5, I7, S5, S6, S7, S8, S9, S10, S11, S14) is **out of scope** and not reviewable from this position. The revert is the correct response per the steering rule.

### Not yet implemented
None. Every Phase 4b.6 DoD item is met; every prior-review finding inside the branch's review scope is either fixed or accepted-with-documentation (I4).

### Deviations
1. **One-Feature / Phase-Boundary rule still violated.** The branch bundles three themes: (a) Phase 4b.6 e2e isolation, (b) `.devcontainer/` scaffold (still present — `git diff --stat main..HEAD -- '.devcontainer/*'` shows +722 lines), (c) cross-cutting hardening (`make ensure-native`). The revert in `926e793` only dropped the *deferred patches* targeting `.devcontainer/`; the directory itself remains. Per CLAUDE.md §"Pull Request Scope" "each roadmap phase is a PR" — the devcontainer scaffold is not a roadmap phase.
2. **No design or plan document exists for the devcontainer scaffold.** `find docs/plans -iname '*devcontainer*'` and `grep -rl devcontainer docs/` both empty.
3. **`workers: 1` cap and `make e2e-clean`** are not in Phase 4b.6's documented Scope/DoD. Documenting them as part of the implementation in the roadmap would close the loop.
4. **`docs/roadmap.md:37` Phase 4b.6 row still reads "Planned"** — pre-merge state, but worth confirming convention.

## Review Metadata

- **Agents dispatched:** Logic & Correctness (Logic-A), Error Handling & Edge Cases (Errors-A), Contract & Integration, Concurrency & State, Security, Plan Alignment (6 specialists)
- **Scope:** changed files (Makefile, playwright.config.ts, packages/client/vite.config.ts, packages/shared/src/findDirectoryConflict.ts, packages/shared/src/index.ts, packages/shared/src/__tests__/{findDirectoryConflict,e2e-data-dir-parity,parsePort-body-parity,vite-config-default-port}.test.ts, e2e/editor-save.spec.ts, e2e/snapshots.spec.ts, package.json, tsconfig.tooling.json, CLAUDE.md, CONTRIBUTING.md, .github/copilot-instructions.md) + adjacent (packages/server/src/index.ts, packages/server/src/images/images.service.ts, packages/shared/src/{parsePort.ts,constants.ts,slugify.ts,types.ts}, packages/shared/package.json, tsconfig.base.json, eslint.config.js, docs/roadmap.md)
- **Excluded per CLAUDE.md §"Ignore .devcontainer/":** entire `.devcontainer/` directory (4 files)
- **Raw findings:** 31 (before verification + dedup)
- **Verified findings:** 18 (1 Critical, 8 Important, 15 Suggestions, 3 Latent — after dedup, threshold, and re-confirmation against the prior `8bac750` report so already-tracked items are not re-flagged)
- **Filtered out:** 13 (drops: duplicates of prior-review findings, claims contradicted by live verification, pure stylistic preference)
- **Latent findings:** 3 (Critical: 0, Important: 0, Suggestion: 0 — all 3 are categorized Latent by reachability, severity scale separate)
- **Out-of-scope findings:** 0 — all anchors are on lines this branch authored
- **Backlog:** 0 new entries, 0 re-confirmed (the 5b89539 → 8bac750 → 990bcb6 chain has surfaced no new OOS findings; backlog re-confirmation was last performed by the 8bac750 review)
- **Steering files consulted:** CLAUDE.md, .github/copilot-instructions.md, CONTRIBUTING.md
- **Plan/design docs consulted:** docs/roadmap.md (Phase 4b.6 lines 836-867); prior reviews ovid-devcontainer-and-e2e-isolation-2026-04-27-13-19-24-5b89539.md and ovid-devcontainer-and-e2e-isolation-2026-04-27-18-27-06-8bac750.md
- **Live verifications performed:** `git ls-files 'e2e/**/*.ts'` (empty — confirms [C1]); `git diff --quiet -- ... 'e2e/**/*.ts' ...` exits 0 on modified e2e file (confirms [C1] reachability); Node 22 `mkdirSync(symlink-to-nonexistent/sub, {recursive:true})` produces ENOENT (confirms [I2]); `Makefile:138` reads `npm run format` (confirms [I1])
