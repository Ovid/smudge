---
date: 2026-06-03
phase: "Phase 4b.14: Operational Backup Stopgap"
model: claude-opus-4-8
design_file: docs/plans/2026-05-26-operational-backup-stopgap-design.md
plan_file: docs/plans/2026-05-26-operational-backup-stopgap-plan.md
pushback:
  total: 6
  critical: 1
  important: 3
  minor: 2
alignment:
  total: 4
  critical: 0
  important: 1
  minor: 3
---

# Phase 4b.14: Operational Backup Stopgap — Decision Log

> Note: this phase was brainstormed earlier (design dated 2026-05-26) but never
> taken through pushback → plan → alignment. This /roadmap run, on 2026-06-03,
> completed the back half of the pipeline against the existing design. A mid-run
> design pivot (backup made automatic on `make dev` rather than a manual command
> the operator must remember) was introduced by the user during plan-writing and
> folded into the design before alignment; it is recorded in the Summary.

## Pushback Findings

### [1] Data-dir resolution re-derived from `dirname(DB_PATH)`, ignoring `DATA_DIR`
- **Severity:** Critical
- **Category:** Feasibility
- **Summary:** The design resolved the data dir as `dirname(DB_PATH)` with a package-relative fallback, but the server's real resolution (`config/paths.ts`) is `getDataDir()` = `DATA_DIR ?? default` and `getDbPath()` = `DB_PATH ?? join(dataDir, "smudge.db")`, where `DB_PATH` may legitimately point *outside* the data dir. The design's version ignores `DATA_DIR` entirely (the common Docker-volume override), so it would silently back up the wrong — likely empty — directory, the worst possible failure for a backup tool. It also re-introduced the duplication the F-5 invariant exists to prevent.
- **Resolution:** fixed-in-design — backup/restore now import and call `getDataDir()`/`getDbPath()` directly; the core takes resolved paths as parameters and never re-derives.

### [2] "Refuse if running" guard used an unreliable flock probe
- **Severity:** Important
- **Category:** Feasibility
- **Summary:** The design probed for a running server via a `flock` on the DB file "matching what better-sqlite3 does." SQLite uses transient POSIX byte-range (`fcntl`) locks held only during an active transaction — a different lock domain from `flock`, and absent entirely when the server is idle. The guard would report a false "safe" for the normal idle-server case, then clobber the live DB.
- **Resolution:** fixed-in-design — replaced with an HTTP port probe (default 3456, honoring `SMUDGE_PORT`, on `127.0.0.1` and `::1`), mirroring the proven `make e2e-clean` probe.

### [3] Monolithic `backup.ts` collides with the coverage floor
- **Severity:** Important
- **Category:** Omission
- **Summary:** The design put all logic — including the security-critical zip-slip and bomb defenses — in one script invoked only via child-process, which vitest does not instrument. That either drops below the 95/85/90/95 coverage floor or needs an unmentioned exclusion, leaving the highest-risk code uncovered. The project already solved this once (dep-cooldown's pure-core-under-coverage + thin-IO-shell-excluded split).
- **Resolution:** fixed-in-design — pure `backup-core.ts` under coverage; thin `scripts/*.ts` shells coverage-excluded (per the `dep-cooldown.mjs` precedent); a single child-process test covers the wiring seam.

### [4] Runner `node --experimental-strip-types` diverges from the repo's `tsx`
- **Severity:** Important
- **Category:** Feasibility
- **Summary:** The Makefile sketch ran the script via `node --experimental-strip-types`, which is experimental on Node 22 (emits an `ExperimentalWarning` every run, erasable-syntax-only) and has zero precedent in the repo, where `tsx` is the standard TS runner. It would also fail to resolve the server module imports the path-resolution fix (Issue 1) requires.
- **Resolution:** fixed-in-design — run via `tsx` (already a devDependency); documented that this makes the targets developer-run-from-checkout tools.

### [5] `.gitignore` omission makes manuscript backups committable
- **Severity:** Minor
- **Category:** Security
- **Summary:** `make backup` writes a full manuscript copy to repo-root `backups/` and a `.backup-staging.db` into the data dir, but nothing in the design git-ignored them — a `git add -A` would commit the writer's entire manuscript into history.
- **Resolution:** fixed-in-design — added a `.gitignore` deliverable (`backups/` + `*.backup-staging.db`; verify `data/` already ignored).

### [6] Image-layout example misdescribed as flat
- **Severity:** Minor
- **Category:** Ambiguity
- **Summary:** The design's archive sketch showed flat `images/<uuid>.jpg`, but images are stored per-project (`images/<projectId>/<file>`, per `db/purge.ts`). Functionally harmless (the tree is zipped recursively), but the wrong illustration could steer test fixtures and reviewers toward a flat-layout assumption.
- **Resolution:** fixed-in-design — corrected the example to the nested layout and noted recursive walking; fixtures must mirror the real shape.

## Alignment Findings

### [1] No `runRestore`-level tests for zip-slip / bomb archives
- **Severity:** Important
- **Category:** missing-coverage
- **Summary:** The plan tested `validateEntryPaths` and `checkDeclaredSizes` as isolated units, but never drove a malicious archive through `runRestore` to assert it refuses AND leaves the data dir untouched (design test plan #4/#5 want this at the orchestration level). An implementation that validated *after* moving the data dir aside would pass every plan test yet violate the security contract.
- **Resolution:** fixed-in-plan — added two `runRestore`-level tests (zip-slip archive, declared-size-bomb archive) to Task 7, each asserting refusal and an untouched data dir (no move-aside sibling, original DB intact).

### [2] No rollback of partial extraction on a post-extraction bomb trip
- **Severity:** Minor
- **Category:** design-gap
- **Summary:** Design §2b said to "clean up the partial extraction" if the written-bytes watchdog trips, but `runRestore` throws without rolling back, leaving a half-written live data dir. This only fires for an archive whose central directory lies about sizes (rare; never for self-produced archives), and the move-aside backstop means no data loss.
- **Resolution:** accepted-as-is — the move-aside path preserves the original, so there is no data-loss risk on a stopgap; the design §2b wording was softened to match and a code comment added in `runRestore`. No rollback machinery added.

### [3] Stale `*.tmp` zip never cleaned after a crash mid-write
- **Severity:** Minor
- **Category:** design-gap
- **Summary:** The design's delta self-review claimed a crash-leftover temp file is "cleaned next run," but the plan never implements that and rotation only matches `smudge-auto-*.zip`. The leftover is gitignored, under `backups/`, and never counted as a valid archive — harmless disk litter, not a correctness issue.
- **Resolution:** accepted-as-is — corrected the design's overstated "cleaned next run" wording to reflect that the `*.tmp` is harmless and operator-cleanable; the load-bearing guarantee (atomic rename ⇒ no half-written valid archive) already holds.

### [4] CLI smoke-test snippet contained convoluted/incorrect code
- **Severity:** Minor
- **Category:** tdd-format
- **Summary:** Task 12's smoke test read the backups directory via `(await readFile) && (await import("node:fs/promises")).readdir(...)` — an accidental truthiness check plus a redundant dynamic import that limps to the right value but violates the writing-plans "complete, real code" rule.
- **Resolution:** fixed-in-plan — imported `readdir` directly and replaced both occurrences with a clean `await readdir(...)`.

## Summary

- Pushback raised 6 issues (1 Critical, 3 Important, 2 Minor); **all 6 resulted in design changes** (fixed-in-design). The Critical one (data-dir resolution) would have made the tool silently back up the wrong directory under the supported `DATA_DIR` override — the worst failure mode for a backup feature.
- Alignment raised 4 issues (1 Important, 3 Minor); 2 resulted in plan changes (fixed-in-plan: the missing `runRestore`-level security tests, and a code-quality fix), and 2 were accepted-as-is as known, no-data-loss limitations with the design wording corrected to be honest about them.
- **Mid-run design pivot (not a pushback/alignment finding):** during plan-writing the user noted that a manual `make backup` they must remember to run is worthless for a project worked in bursts. The trigger was inverted — backup is now automatic on `make dev` (best-effort, rotated, skippable), while restore stays a deliberate manual command. The audience was also reframed honestly: these are operator/dev tools run from a source checkout (interim until Phase 8b's writer-facing per-project export), not end-user-writer tools. Both were folded into the design before the alignment pass. The zip library was fixed to `jszip` (already present; MIT elected from its dual license), with the bomb-defense adapted to its in-memory model (declared-size pre-check read from the central directory before `loadAsync`).
