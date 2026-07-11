# Agentic Code Review: operational-backup-stopgap

**Date:** 2026-07-11 15:09:56
**Branch:** operational-backup-stopgap -> main
**Commit:** 03b1686eae135dc3b8552c699477f3c0f11e9462
**Files changed:** 28 | **Lines changed:** +4103 / -89
**Diff size category:** Large (code surface is small: `backup-core.ts` + 3 CLI scripts + a `getImagesDir` refactor; the bulk is docs/plans/tests)

## Executive Summary

The Phase 4b.14 backup/restore feature is well-engineered and already hardened
through two prior review rounds. Six specialists plus a verifier found **no
Critical issues and no data-loss paths** — every restore-side gap is caught by
the never-delete move-aside, which downgrades any failure to a
`RestorePartialError` with the operator's original data preserved. The
strongest findings are two related **free-space pre-check under-reservations**
(the guard can pass and still hit a mid-write `ENOSPC`) and a minor `.tmp`
orphan on rename failure. The remainder are contingent ceilings and doc-vs-code
drift. The `getImagesDir` refactor is behavior-preserving at all seven call
sites, and the one-feature-rule exception for bundling it is properly recorded.

## Critical Issues

None found.

## Important Issues

### [I1] External-DB free-space pre-check under-reserves on a shared partition
- **File:** `packages/server/src/backup/backup-core.ts:295-301`
- **Bug:** `dbIsExternal` (line 250) is a pure path-**prefix** test, not a
  partition test. When the DB is external, restore runs two independent
  `ensureFree` calls — `dbDeclared` against `dirname(dbPath)` and
  `declaredTotal - dbDeclared` against `dirname(dataDir)`. If both dirnames
  resolve to the **same physical partition** (external only means "outside
  dataDir", not "different disk" — e.g. `DATA_DIR=/srv/smudge/data`,
  `DB_PATH=/srv/smudge/db/smudge.db`), each half validates against the same
  free-bytes figure. The binding constraint becomes `max(dbDeclared,
  imagesTotal) + 100 MiB` instead of the true `declaredTotal + 100 MiB`.
- **Impact:** A partition with room for each half separately but not their sum
  passes the pre-check and then hits `ENOSPC` mid-extraction — exactly the
  failure the S-F2 pre-check exists to prevent. Bounded: the move-aside
  preserves the originals, so the operator gets a `RestorePartialError` (data
  intact), not a clean `RestorePreconditionError`.
- **Suggested fix:** Group needs by device before checking — `statfs`/`stat`
  the two dirnames, and when they share a device (`.dev`), `ensureFree` once
  with the summed `declaredTotal`. Or accept it with a `ponytail:` note naming
  the same-partition ceiling, since the safety net holds.
- **Confidence:** High (88 post-verify)
- **Found by:** Logic & Correctness, Contract & Integration (independently)

### [I2] Free-space pre-check omits the retained move-aside copy (~2× peak)
- **File:** `packages/server/src/backup/backup-core.ts:287-301`
- **Bug:** The pre-check reserves only `declaredTotal + 100 MiB` per partition.
  But restore never deletes: step 6 `rename(dataDir → movedAsideTo)` (line 313)
  keeps the old data on the **same partition** (`movedAsideTo` at line 312 is
  `${dataDir}.before-restore-…`, a sibling → same parent → same partition), and
  step 7 then extracts `declaredTotal` fresh bytes alongside it. Peak usage on
  that partition is `oldDataSize + declaredTotal ≈ 2 × declaredTotal` (backups
  are compact VACUUM'd DB + already-compressed images, so the archive is roughly
  current data size).
- **Impact:** For any install whose data exceeds ~100 MiB (plausible for a
  manuscript app with images), the guard can pass — e.g. 500 MiB data, 700 MiB
  free: needs `500 + 100 ≤ 700` → passes, then extraction needs ~1 GiB
  alongside the retained copy → `ENOSPC` mid-write. Same safety net as I1
  (`RestorePartialError`, no data loss). Same root class as I1 — both are
  pre-check accuracy gaps guarded by the never-delete move-aside.
- **Suggested fix:** Reserve `existingDataSize + declaredTotal + headroom` (stat
  the current data dir / DB before the move-aside), or document that the
  pre-check is best-effort and the true requirement is ~2× data size.
- **Confidence:** High (85 post-verify)
- **Found by:** Logic & Correctness

## Suggestions

- **[S1] `.tmp` publish file leaks on rename failure** — `backup-core.ts:496-505`. If `writeFile(tmpOut)` succeeds but `rename(tmpOut, outFile)` throws, the `finally` rm's only `staging`, not `tmpOut`; the orphan ends in `.tmp`, and `rotateAutoBackups` only prunes `.zip` (line 443), so it accumulates in `backups/`. Extend the cleanup to `rm(tmpOut, { force: true })`. (Confirmed, 82.)
- **[S2] Silent skip of an entry whose JSZip-decoded name ≠ central-directory name, reported as success** — `backup-core.ts:342-343`. Validation reads names via raw `buf.toString("utf8", …)`; extraction does `zip.file(name)` with `if (!file) continue`, and `written` staying under budget returns success. Effectively unreachable for self-produced backups (`smudge.db` + `<uuid>.<ext>` are all ASCII), so no DB/image is ever lost in practice — but the "silent skip → success" shape is a latent smell. Consider asserting every validated `name` was extracted. (Confirmed-but-unreachable, 72.)
- **[S3] zip64 refusal vs. "restorable indefinitely" commitment** — `backup-core.ts:64-65,71` throw on zip64 sentinels. If JSZip's `generateAsync` ever emits a zip64 archive for a >4 GiB data dir, that backup becomes unrestorable by its own tool, contradicting the design's forward-compat "hard commitment". Contingent (unverified whether JSZip emits zip64; the 2 GiB `maxUncompressed` cap already refuses such archives on a second ground). Document the size ceiling in `docs/backup.md`. (Confirmed-contingent, 65.)
- **[S4] Doc says backup filenames use LOCAL time; code uses UTC** — design §1 (~lines 95-100) documents "Local time, not UTC", but `runBackup` uses `isoStampUtc` (line 460). The code is **correct** — this is the intentional S-F1 change (UTC → lexical == chronological rotation survives DST). Fix the stale doc, not the code. (Doc-only, 95.)
- **[S5] `rotateAutoBackups` idempotency comment overclaims** — `backup-core.ts:448-451` says concurrent rotations "can't over-prune a recent backup"; true only when both runs use the same `keep`. Two concurrent runs with divergent `SMUDGE_BACKUP_KEEP` produce different survivor sets. Near-zero reachability for a single operator; trim the comment to "same-`keep`". (Doc-only nit, 65.)

### Out of scope (flag for a separate ticket)

- **[O1] Torn/partial image blob captured in a live backup** — `images/images.fs.ts` `writeImageFile` is a non-atomic `writeFile`; `backup-core.ts:485` `readFile` only skips `ENOENT`, not a mid-write truncation, so a backup taken during an image upload can zip a short copy with no error. **`images.fs.ts` is untouched by this branch** (`git diff main...HEAD` is empty for it) — the non-atomic write is pre-existing. The new "safe while running" promise arguably inherits the gap, but the root-cause fix (make `writeImageFile` write-to-tmp-then-rename) lives outside this PR. Not a blocker for 4b.14. (Confirmed-but-out-of-scope, 80.)

## Plan Alignment

Design/plan docs consulted: `docs/plans/2026-05-26-operational-backup-stopgap-design.md`, `…-plan.md`, `docs/roadmap-decisions/2026-06-03-phase-4b-14-operational-backup-stopgap.md`, `docs/backup.md`.

- **Implemented:** All six In-Scope items + the 2026-06-03 auto-backup pivot — `make backup`, `make dev` auto-backup (all five behavior clauses), `make restore` (zip-slip + bomb + dual-stack port probe + typed-filename confirm + move-aside-never-delete), `docs/backup.md`, the test suite, `.gitignore` entries, CLAUDE.md updates, and the jszip devDep→dep promotion with MIT election. The §2b defense model (pre-load declared-size check → post-extraction cumulative budget → free-space pre-check) and §2a zip-slip rules are all present and correctly ordered.
- **Not yet implemented:** Nothing material to the stopgap scope. Out-of-Scope items (per-project export, format versioning, cron/daemon, offsite copy, UI, manual-archive pruning) are correctly absent.
- **Deviations:** Only S4 (design still documents local-time filenames; code intentionally uses UTC per S-F1). The lying-central-directory RAM-bomb residual is acknowledged as accepted in design §2b and backlog S1 — consistent, not a deviation. The external-`DB_PATH` move-aside handling is an *addition* required by pushback Issue 1, not a contradiction.
- **One-feature-rule status:** **SATISFIED.** The backup feature + S-F9 `getImagesDir` refactor bundle is authorized by a recorded exception in `docs/roadmap-decisions/2026-06-03-phase-4b-14-operational-backup-stopgap.md` (APPROVED by Ovid 2026-07-11), and the refactor touched exactly the four claimed sites, each now routing through `getImagesDir()`.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment; then a single Verifier.
- **Scope:** `packages/server/src/backup/backup-core.ts`, `scripts/{backup,auto-backup,restore}.ts`, `config/paths.ts`, `db/purge.ts`, `images/{images.paths,images.reaper}.ts` (refactor callers), `images/images.service.ts`, `export/{epub.renderer,image-resolver}.ts` (adjacent `getImagePath` callers), `Makefile`, `.gitignore`, `vitest.config.ts`, `package.json`, and the four adjacent test files.
- **Raw findings:** 9 (one duplicated across two specialists)
- **Verified findings:** 8 kept (2 Important, 5 Suggestion, 1 out-of-scope); 0 rejected — the security "RAM-bomb via lying CD" finding is a pre-accepted residual (design §2b / backlog S1), not a new issue.
- **Filtered out:** 1 (RAM-bomb residual folded into existing acceptance)
- **Steering files consulted:** CLAUDE.md (backup/one-feature-rule sections); no contradictions except the S4/S5 doc-vs-code drift noted above.
- **Plan/design docs consulted:** the four listed under Plan Alignment, plus the two prior review reports on this branch (`…-2026-06-04-…`, `…-2026-07-11-14-00-01-…`) and `paad/code-reviews/backlog.md`.
