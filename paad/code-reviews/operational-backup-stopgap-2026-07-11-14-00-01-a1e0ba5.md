# Agentic Code Review: operational-backup-stopgap

**Date:** 2026-07-11 14:00:01
**Branch:** operational-backup-stopgap -> main
**Commit:** a1e0ba5d5b679eeddbe335837b0469d1723f0525
**Files changed:** 21 | **Lines changed:** +3629 / -83
**Diff size category:** Large (production code concentrated in `backup-core.ts` (444) + 3 thin script shells + tests; the bulk of the diff is docs/plan/tests)

## Executive Summary

Phase 4b.14 (`make backup` / `make restore` / auto-backup) is a well-defended,
heavily-reviewed stopgap. This is a *second* agentic pass at HEAD `a1e0ba5`,
after the prior review (`…2026-06-04-05-52-33-4a058b9.md`) whose S-series fixes
are all present and verified. **No Critical or data-loss issues were confirmed.**
The restore path's zip-slip, symlink-escape, injection, zip64-refusal, and
disk-side bomb defenses all hold. Two **Important** findings survived
verification: a live-backup abort on a concurrently-deleted image (F3), and a
hardcoded probe port that diverges from the shared `parsePort`/`DEFAULT_SERVER_PORT`
and can silently defeat the running-server guard (F6). The remaining findings are
Suggestions; the one Security finding (F7, RAM-side bomb bypass) is already
recorded and accepted as backlog **S1**.

## Critical Issues

None found.

## Important Issues

### [I1] Concurrently-deleted image aborts the entire live backup
- **File:** `packages/server/src/backup/backup-core.ts:426-428`
- **Bug:** The images loop does `zip.file(rel, await readFile(file))` with **no
  ENOENT guard**, while `walkFiles` (`:180-187`) deliberately narrows its
  `readdir` catch to ENOENT precisely because the tree can change mid-walk. If
  the server's image reaper or an image-delete unlinks a file between `readdir`
  listing it and this `readFile`, the read throws ENOENT and the **whole backup
  fails**.
- **Impact:** Contradicts the "safe while running" promise (CLAUDE.md §Build &
  Run — `make backup` "safe while running"; auto-backup runs on every `make dev`).
  No data loss — a manual `make backup` throws; auto-backup swallows it as
  `status:"failed"` — but a routine concurrent delete shouldn't abort a backup
  advertised as live-safe.
- **Suggested fix:** Wrap the per-file `readFile` in a try/catch that
  `continue`s on `err.code === "ENOENT"` and **re-throws** everything else.
  The discrimination matters: the I4 test asserts loud failure on `EACCES`
  inside `walkFiles` (readdir), so a plain ENOENT-tolerant read at `:428` does
  not break I4, but the fix must not swallow EACCES/other IO errors (that would
  silently omit real images from a "successful" backup).
- **Confidence:** High (CONFIRMED)
- **Found by:** Error Handling, Concurrency & State (2 specialists), verifier-confirmed

### [I2] Restore probe hardcodes port 3456 and uses raw `Number()`, diverging from the shared port parser
- **File:** `packages/server/scripts/restore.ts:23`
- **Bug:** `const port = Number(process.env.SMUDGE_PORT ?? 3456)` hardcodes the
  magic `3456` and uses raw `Number()`. The server itself (`packages/server/src/index.ts:16`)
  uses `parsePort(process.env.SMUDGE_PORT ?? String(DEFAULT_SERVER_PORT), "SMUDGE_PORT")`,
  and `DEFAULT_SERVER_PORT = 3456` lives in `@smudge/shared` (`packages/shared/src/constants.ts:18`).
- **Impact:** Two defects. (a) **Drift:** if `DEFAULT_SERVER_PORT` ever changes,
  the running server binds the new port but `restore` keeps probing 3456, wrongly
  concludes "not running," and proceeds to overwrite data under a live server.
  (b) **Weaker validation:** `Number("3456abc")` → `NaN` → the probe fails on
  both hosts → `probePort` returns `false` → the running-server guard is silently
  defeated, where `parsePort` would have hard-failed. The typed-token confirm and
  move-aside remain as backstops, so this degrades a *secondary* guard rather than
  causing direct data loss.
- **Suggested fix:** `import { DEFAULT_SERVER_PORT, parsePort } from "@smudge/shared"`
  and `const port = parsePort(process.env.SMUDGE_PORT ?? String(DEFAULT_SERVER_PORT), "SMUDGE_PORT");`
  — matching `index.ts`. (restore.ts already imports transitively from shared, so
  this is feasible.)
- **Confidence:** High (CONFIRMED)
- **Found by:** Contract & Integration, verifier-confirmed

## Suggestions

- **[S-F2] External-DB free-space check on the wrong partition** — `backup-core.ts:256`. Free-space pre-check tests only `dirname(dataDir)`; when `dbIsExternal` the DB is written to `dbPath` on a possibly-different partition, so a tight dataDir partition can false-trigger `RestorePreconditionError` and a full external partition escapes the pre-check (→ ENOSPC mid-write → `RestorePartialError`). Both outcomes preserve data. Requires `DB_PATH` on a different partition than `DATA_DIR`. *(Logic + Error-handling, 2 specialists.)*
- **[S-F1] DST/backward-clock sort inversion in rotation** — `backup-core.ts:392` (with `:157-162`, `:266`, `:409`). `isoStampLocal` uses local wall-clock; `rotateAutoBackups` treats lexical order as chronological. During the once-a-year DST fall-back (or any backward clock step), a newer auto-backup can sort before an older one, so rotation prunes the wrong file and a same-second rename can overwrite. Needs >`keep` (default 10) `make dev` restarts inside the 1-hour overlap. Fix: UTC/epoch-sortable stamp (keep local-time for display) or sort by mtime.
- **[S-F4] `arg()` truncates values containing `=`** — `restore.ts:14`. `hit?.split("=")[1]` keeps only the segment after the first `=`, so `--max-ratio==10` yields `""`, which `resolveBombLimit` treats as absent and silently returns the default — the exact "operator thinks a stricter cap is in force" failure the function's doc claims to prevent. Requires a double-`==` typo. Fix: `hit.slice(hit.indexOf("=") + 1)`.
- **[S-F5] `rotateAutoBackups` readdir catch swallows all errors** — `backup-core.ts:388-390`. `catch { return {deleted:[]} }` masks EACCES/EIO as "nothing to prune," unlike `walkFiles` which narrows to ENOENT. Low impact in practice: the sole caller already wraps it in `.catch(()=>{})` (best-effort), so narrowing changes no observable behavior today — consistency nit.
- **[S-F8] pid-only concurrency disambiguation** — `backup-core.ts:411,434,266`. Staging/tmpOut/move-aside paths disambiguate concurrent runs via `process.pid` only; two containers on separate PID namespaces sharing one data volume could both be pid 1 → identical paths → torn-file race. Out-of-scope for the single-container target; add a random suffix or document the assumption.
- **[S-F9] `join(dataDir,"images")` is a 4th copy** — `backup-core.ts:425`. The images subdir name is hardcoded here alongside `images/images.paths.ts`, `images/images.reaper.ts`, `db/purge.ts`. `config/paths.ts` bills itself the "single owner of data locations" (F-5) but has no `getImagesDir()`. Pre-existing duplication this phase extends; add `getImagesDir()` and route all four sites through it.
- **[S-F10] Dual-stack probe reimplemented** — `restore.ts:24-67` vs the `make e2e-clean` Makefile probe (different timeout, 500 ms vs 2000 ms, no shared source). Duplication spans the TS/Makefile boundary so extraction is awkward; a cross-reference comment is the pragmatic fix.

### Already-accepted (not new)

- **[F7] Decompression-bomb RAM bypass via a lying central directory** —
  `backup-core.ts:296-325`. CONFIRMED but **duplicates backlog S1**
  (`paad/code-reviews/backlog.md:287-291`, accepted residual, ship no mitigation).
  A CD that under-declares uncompressed sizes passes `checkDeclaredSizes` and the
  free-space check, but `file.async("nodebuffer")` (`:304`) fully inflates the real
  bomb stream into RAM *before* the disk-side `written > declaredTotal + 1MiB`
  assertion (`:306`) fires; `Buffer.MAX_LENGTH` (2^53−1) gives no ~2 GiB guardrail
  → host OOM (local DoS, operator's own machine, deliberate `make restore`).
  **One documentation action worth taking:** the design doc
  (`docs/plans/2026-05-26-operational-backup-stopgap-design.md:268`) claims the
  key property is "reject the bomb *before* loading, not during," which the code
  comment at `:300-303` already admits is false for the lying-CD case. Reconcile
  the doc's claim with the accepted-residual framing so the contradiction doesn't
  ship unreconciled.

## Plan Alignment

Design/plan docs consulted: `docs/plans/2026-05-26-operational-backup-stopgap-design.md`,
`…-plan.md`, `docs/roadmap-decisions/2026-06-03-phase-4b-14-operational-backup-stopgap.md`,
`paad/code-reviews/backlog.md`.

- **Implemented:** All six design In-Scope items present — `make backup` (VACUUM
  INTO → jszip, nested images, staging cleaned in `finally`), auto-backup on
  `make dev` (best-effort `|| true`, rotation, all skip branches), `make restore`
  (full guard chain), `docs/backup.md` (all 7 sections), tests (1007-line core
  suite + CLI wiring/probe smoke), `.gitignore`, CLAUDE.md. Core/shell coverage
  split honored; jszip promoted devDep→dep with MIT election recorded.
- **Not yet implemented (correctly descoped, backlog-recorded):** S1 (per-entry
  RAM — see F7 above), S4 (`findEocdOffset` comment-length validation — safe-failure),
  S5 (no re-probe between probe and move-aside — TOCTOU, move-aside is backstop).
- **Deviations:** All divergences from the *plan* are enhancements that restore or
  refine *design* intent (the prior review's C1/I1–I5/S2–S9 fixes): external
  `DB_PATH` handling, the free-space check, extra exported symbols, pid-suffixed
  paths, Makefile `MAX_UNCOMPRESSED`/`MAX_RATIO` knobs. No code contradicts the
  design's stated behavior.
- **Steering (CLAUDE.md) contradictions:** None. §API status codes N/A (CLI tooling,
  no HTTP); coverage/zero-warning honored; one-feature PR rule satisfied (single
  feature + its own fixes); jszip license/cooldown clean.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases,
  Contract & Integration (incl. dedup), Concurrency & State, Security, Plan
  Alignment; plus a single Verifier pass. (A separate ponytail over-engineering
  pass was run inline — see the conversation.)
- **Scope:** `packages/server/src/backup/backup-core.ts`, `packages/server/scripts/{backup,auto-backup,restore}.ts`, `packages/server/src/config/paths.ts`, `packages/shared/src/constants.ts`, tests under `packages/server/src/backup/__tests__/` and `packages/server/src/__tests__/`, Makefile targets, `vitest.config.ts`, `.gitignore`.
- **Raw findings:** 13 (before verification)
- **Verified findings:** 10 confirmed (2 Important, 7 Suggestion, 1 already-accepted/F7); 0 rejected outright, F7 downgraded as duplicate of backlog S1.
- **Steering files consulted:** `CLAUDE.md`
- **Plan/design docs consulted:** design + plan + roadmap-decision + backlog (listed above); prior review `…2026-06-04-05-52-33-4a058b9.md`
