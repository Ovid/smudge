# Agentic Code Review: operational-backup-stopgap

**Date:** 2026-06-04 05:52:33
**Branch:** operational-backup-stopgap -> main
**Commit:** 4a058b9818178652662bc0cf5bb704c5e0b72ab8
**Files changed:** 19 | **Lines changed:** +3078 / -83
**Diff size category:** Large

## Executive Summary

Phase 4b.14 (operational backup/restore stopgap) is a well-tested, security-conscious
implementation: the zip-slip and decompression-bomb defenses are real and the move-aside
"never delete" discipline is sound. The one **Critical** issue is a correctness gap in
restore — it ignores `DB_PATH` when it points outside the data dir (a configuration the
design explicitly supports), so restore silently fails to recover in exactly the scenario
the feature exists for. Five Important findings cluster around error-path completeness
(move-aside contract, silent image loss), boundary parsing of env/CLI knobs, and
same-second backup-file collisions. Confidence is high on the Critical and on the
parsing/error-handling Importants; the concurrency findings are real but narrow given the
single-operator usage model.

## Critical Issues

### [C1] Restore ignores `DB_PATH` set outside the data dir — silent recovery failure
- **File:** `packages/server/src/backup/backup-core.ts:237` and `packages/server/scripts/restore.ts:64-66`
- **Bug:** `runRestore` writes every archive entry — including `smudge.db` — to `join(opts.dataDir, name)`, and `RestoreOptions` has no `dbPath` field. The server, however, opens the DB at `getDbPath()` (`db/knexfile.ts:12` → `DB_PATH ?? join(getDataDir(),"smudge.db")`), and both `paths.ts:24-25` and the design (lines 31-33, 146 "may live outside dataDir") explicitly support `DB_PATH` pointing outside the data dir. In that config: restore lands the DB at `dataDir/smudge.db`, the move-aside renames `dataDir` (which never held the live DB), and on next start the server still reads the **old/corrupt** DB at `DB_PATH`. The "Previous data preserved at …" message points at a dir that never held the DB.
- **Impact:** The single configuration where restore is reached after corruption is exactly where it silently fails to recover — data-loss masquerading as success. Backup honors `getDbPath()` (`backup-core.ts:310`); restore hardcodes `dataDir/smudge.db` — the two halves disagree about where the DB lives. The default config (`DB_PATH` unset) works, which is why every test passes and the gap is hidden.
- **Suggested fix:** Add a `dbPath` field to `RestoreOptions`; pass `getDbPath()` from `restore.ts`; when extracting the `smudge.db` entry, write it to `opts.dbPath` (and move the existing external DB file aside too, so it is preserved like the data dir). Alternatively, if out-of-dir `DB_PATH` is to remain unsupported by restore, detect `getDbPath()` outside `getDataDir()` and refuse with a `RestorePreconditionError` rather than silently mis-restoring.
- **Confidence:** High
- **Found by:** Logic & Correctness (`claude-opus-4-8[1m]`), Contract & Integration (`claude-opus-4-8[1m]`)

## Important Issues

### [I1] Move-aside contract broken when `mkdir(dataDir)` fails after the rename
- **File:** `packages/server/src/backup/backup-core.ts:211`
- **Bug:** `await mkdir(opts.dataDir, { recursive: true })` sits **between** the move-aside rename (206-210) and the wrapping `try` block (217). The block's comment promises "ANY failure after the move-aside … is surfaced as `RestorePartialError` carrying `movedAsideTo`," but a `mkdir` failure (ENOSPC, EACCES on the parent, EROFS, a path-reappears race) propagates as a **raw** fs error, not a `RestorePartialError`.
- **Impact:** `restore.ts:79-81` then prints the generic `Restore aborted: <message>` without telling the operator their live data is preserved one directory over. The operator finds `dataDir` empty/missing and panics — the exact partial-state-on-failure the move-aside design (§2 step 5/7) exists to eliminate.
- **Suggested fix:** Move the `mkdir(opts.dataDir, …)` inside the `try` block (before `JSZip.loadAsync`) so a recreate failure is wrapped in `RestorePartialError` with `movedAsideTo` like every other post-move failure.
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases (`claude-opus-4-8[1m]`)

### [I2] Negative `SMUDGE_BACKUP_KEEP` deletes every auto-backup, including the one just written
- **File:** `packages/server/scripts/auto-backup.ts:5` and `packages/server/src/backup/backup-core.ts:296`
- **Bug:** `Number(process.env.SMUDGE_BACKUP_KEEP ?? DEFAULT_KEEP) || DEFAULT_KEEP`: a negative value (e.g. `-5`) is truthy and survives the `|| DEFAULT_KEEP` guard, reaching `rotateAutoBackups`. There `Math.max(0, autos.length - (-5))` = `len + 5`, so `slice(0, len+5)` returns the **entire** auto-backup list — all autos including the one just created are deleted. Separately, `SMUDGE_BACKUP_KEEP=0` (a plausible "keep none") is falsy and is silently coerced to 10.
- **Impact:** A single mis-set env var wipes the very backups the run just made. Operator-tool misconfiguration, but the failure mode is severe (total loss of retained snapshots).
- **Suggested fix:** Validate to a non-negative integer in the shell (`const n = Number(...); keep = Number.isInteger(n) && n >= 0 ? n : DEFAULT_KEEP`) and/or clamp inside `rotateAutoBackups` (`const keep = Math.max(0, Math.floor(o.keep))`). Decide explicitly whether `0` means "keep none."
- **Confidence:** High
- **Found by:** Logic & Correctness (`claude-opus-4-8[1m]`)

### [I3] Same-second / same-mode backups collide on the non-pid temp file → torn archive
- **File:** `packages/server/src/backup/backup-core.ts:304,326`
- **Bug:** The `VACUUM INTO` staging file is pid-qualified (`${stamp}.${process.pid}.backup-staging.db`), but the published archive `outFile` and `tmpOut = ${outFile}.tmp` use only the 1-second stamp + mode prefix — no pid. Two concurrent same-mode backups in the same wall-clock second (two `make dev` autos, or two `make backup`) compute identical `tmpOut`/`outFile` paths and interleave their `writeFile(tmpOut)` calls, then both rename.
- **Impact:** The "atomic temp-then-rename" guarantee the design leans on (§1a) is defeated because the temp name itself collides — the published `smudge-<stamp>.zip` can be torn/partial or silently clobbered. A corrupt-but-present backup is the worst failure mode for a backup tool. (Manual vs auto differ by prefix, so the common make-dev-vs-make-backup race is safe; the exposure is two of the same mode in one second.)
- **Suggested fix:** Make `tmpOut` per-process (`${outFile}.${process.pid}.tmp`), mirroring the staging file. Optionally fold the pid into the archive basename so two distinct same-second backups don't clobber the final name either.
- **Confidence:** High
- **Found by:** Logic & Correctness (`claude-opus-4-8[1m]`), Concurrency & State (`claude-opus-4-8[1m]`)

### [I4] `walkFiles` swallows EACCES/EPERM → silent image loss in a "successful" backup
- **File:** `packages/server/src/backup/backup-core.ts:136-138`
- **Bug:** `catch { return; }` discards **all** `readdir` errors, but the comment justifies only the ENOENT ("images dir may not exist yet") case. A permission error (EACCES/EPERM) on the images root or on one per-project subdir during recursion is silently swallowed; because each recursive call has its own try/catch, one unreadable project folder drops just that project's images while the rest completes and `runBackup` reports success.
- **Impact:** The operator gets a "Backup written" with no indication images were omitted; on restore the images are missing — silent partial data loss in the one tool whose purpose is data safety.
- **Suggested fix:** In the catch, rethrow when `(err as NodeJS.ErrnoException).code !== "ENOENT"` so permission/IO errors fail the backup loudly instead of producing a silently-incomplete archive.
- **Confidence:** Medium
- **Found by:** Error Handling & Edge Cases (`claude-opus-4-8[1m]`)

### [I5] `--max-uncompressed=0` / `--max-ratio=0` and typos silently fall back to defaults
- **File:** `packages/server/scripts/restore.ts:70-71`
- **Bug:** `Number(arg("max-uncompressed")) || DEFAULT_BOMB_LIMITS.maxUncompressed`: because `0` is falsy, an operator passing `--max-uncompressed=0` (intending the strictest possible cap) silently gets the 2 GiB default — the opposite of what was asked. A non-numeric typo (`NaN`) is also falsy and silently defaults, so a mistyped cap is accepted as "use default" with no diagnostic. The plan specified `?? DEFAULT` (default only when the flag is absent).
- **Impact:** A security-tuning knob silently ignores the operator's explicit boundary input; the operator believes a stricter limit is in force than actually is. Deviation from the plan's stated parsing.
- **Suggested fix:** Distinguish "not provided" from "provided as 0/invalid": treat `arg(...) === undefined` as default, otherwise `Number(...)` and validate `Number.isFinite(n) && n >= 0`, erroring on NaN.
- **Confidence:** Medium
- **Found by:** Error Handling & Edge Cases (`claude-opus-4-8[1m]`), Spec Compliance (`claude-opus-4-8[1m]`)

## Suggestions

- **[S1]** `backup-core.ts:227-236` — `file.async("nodebuffer")` fully inflates a single entry into RAM **before** the post-write byte-budget check, so a lying central directory can OOM the host before the disk check fires. The design (§2b, inline comment 223-226) explicitly acknowledges per-entry RAM is unbounded and ships no mitigation — documented tradeoff, recorded for a future hardening pass (e.g. stream-decompress with a running counter, or bound per-entry declared size). *(Security, `claude-opus-4-8[1m]`)*
- **[S2]** `backup-core.ts:328-329` — the explicit `rm(outFile, {force:true})` before `rename` is redundant (POSIX `rename` atomically replaces) and opens a no-file window; under same-second concurrency one backup's `rm` can delete the other's just-published archive. Drop the `rm`. *(Concurrency & State, `claude-opus-4-8[1m]`)*
- **[S3]** `backup-core.ts:98` — `validateEntryPaths` rejects **any** path containing whitespace, a rule beyond design §2a's enumerated checks (null / absolute / drive-letter / `..` / escapes-root). On-disk image names are UUIDs so nothing triggers it today, but it contradicts the design's forward-compat "any old archive restorable" commitment and mislabels a benign name as `ZipSlipError`. Narrow to the enumerated rules. *(Logic & Correctness / Security / Spec Compliance, `claude-opus-4-8[1m]`)*
- **[S4]** `backup-core.ts:39-44` — the EOCD backward scan stops at the first `0x06054b50`; a zip comment containing those bytes after the true EOCD causes a mis-parse. Safe-failure (a valid archive is *refused*, never clobbered), low likelihood; validate the candidate EOCD's comment-length reaches end-of-buffer. *(Logic & Correctness / Security, `claude-opus-4-8[1m]`)*
- **[S5]** `backup-core.ts:185-211` — TOCTOU: a server binding between `probePort()===false` (186) and the move-aside rename (206) is not re-detected → split-brain. Inherent to probe-then-act; the move-aside is the deliberate backstop and restore is manual/confirmed/rare. Consider re-probing immediately before the rename, or document the residual window. *(Concurrency & State, `claude-opus-4-8[1m]`)*
- **[S6]** `backup-core.ts:204-206` — `movedAsideTo` uses a 1-second stamp with no pid; two same-second restores collide (rename ENOTEMPTY, or risks the never-delete guarantee). Add the pid as the staging file already does. *(Concurrency & State, `claude-opus-4-8[1m]`)*
- **[S7]** `backup-core.ts:285-298` — two concurrent `rotateAutoBackups` (two `make dev`) compute `toDelete` from independent listings; the positional slice can over-prune by one recent auto-backup. Already best-effort (`.catch`-wrapped) and bounded; prefer stamp-comparison deletion over positional slice, or serialize behind a lockfile. *(Concurrency & State, `claude-opus-4-8[1m]`)*
- **[S8]** `packages/server/scripts/restore.ts:37-52` — the port probe leaves the losing host's socket + 500 ms timer alive after an early success (no `unref`/`destroy`), delaying process exit up to ~500 ms. Cosmetic; track and destroy both sockets on settle. *(Error Handling / Concurrency, `claude-opus-4-8[1m]`)*
- **[S9]** `backup-core.test.ts:168-178` & `527-558` vs `backup-core.ts:34-69` — the EOCD/CEN byte-offset parsing is hand-rolled in the security-critical bomb tests as well as in production; the duplicated offsets will drift from the parser and give false confidence. Export a shared `findEocdOffset`/`walkCentralDirectory` helper consumed by both. Test-maintainability, not a runtime bug. *(Contract & Integration, `claude-opus-4-8[1m]`)*

## Out-of-Scope Additions

> **Handoff instructions for any agent processing this report:** The entries below are code this branch added that the spec did not promise. They may be legitimate "while I'm here" fixes for issues exposed by this work, or scope creep that should live in a separate PR. Do **not** assume they should stay on this branch, and do **not** assume they should be reverted. Present them to the user **as a single batched ask**: "These additions weren't promised by the spec — keep, split into a separate PR, or revert?" The user decides per item.
>
> Out-of-scope additions are flagged for this PR only — they do not persist to `paad/code-reviews/backlog.md`.

### [OOSA1] Extra exported error types + `freeBytes` seam beyond the design's named-type list
- **File:** `packages/server/src/backup/backup-core.ts:14-26,160`
- **Addition:** The branch exports `RestorePreconditionError` and `RestorePartialError extends DecompressionBombError` (carrying `movedAsideTo`), plus an injectable `freeBytes?` option on `RestoreOptions`. The plan's "Shared type/function names" list named only `ZipSlipError` and `DecompressionBombError`. The behaviors they support (free-space check, "preserve original on partial extraction," typed precondition refusals) **are** in design §2b — so this is a refinement of stated intent and richer operator diagnostics, not a new feature.
- **Suggested intent source:** Plan doc (`docs/plans/2026-05-26-operational-backup-stopgap-plan.md`) named-type list vs. design §2b error-handling intent.
- **Confidence:** Medium
- **Found by:** Spec Compliance (`claude-opus-4-8[1m]`)

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Spec Compliance (parallel) + Verifier
- **Scope:** `packages/server/src/backup/backup-core.ts`, `packages/server/scripts/{backup,auto-backup,restore}.ts`, `packages/server/src/backup/__tests__/backup-core.test.ts`, `packages/server/src/__tests__/backup-cli.test.ts`, `Makefile`, `.gitignore`, `vitest.config.ts`, `packages/server/package.json` (changed); `packages/server/src/config/paths.ts`, `packages/server/src/db/knexfile.ts` (adjacent)
- **Raw findings:** 24 (before verification, incl. duplicates)
- **Verified findings:** 16 (1 Critical, 5 Important, 9 Suggestions, 1 out-of-scope addition)
- **Filtered out:** 8 (5 duplicate merges + S4 VACUUM-escaping non-bug + L2 free-space false-positive + SC4 cosmetic ordering)
- **Out-of-scope findings:** 0 (Critical: 0, Important: 0, Suggestion: 0)
- **Out-of-scope additions:** 1
- **Backlog:** 0 new entries added, 0 re-confirmed (see `paad/code-reviews/backlog.md`)
- **Steering files consulted:** `CLAUDE.md`
- **Intent sources consulted:** `docs/plans/2026-05-26-operational-backup-stopgap-design.md`, `docs/plans/2026-05-26-operational-backup-stopgap-plan.md`, `docs/roadmap-decisions/2026-06-03-phase-4b-14-operational-backup-stopgap.md`, recent commit messages, branch name
- **Verifier warnings:** none
