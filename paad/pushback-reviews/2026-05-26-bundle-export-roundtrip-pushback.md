# Pushback Review: Phase 8b Bundle Export + Phase 4b.14 Operational Backup Stopgap

**Date:** 2026-05-26
**Specs:**
- `docs/plans/2026-05-26-bundle-export-roundtrip-design.md`
- `docs/plans/2026-05-26-operational-backup-stopgap-design.md`
- `docs/roadmap.md` (Phase 8b expansion + new Phase 4b.14 entry)
**Commit:** `21d2bbbd78bc6918d964267056d9e9422ce03cb3`
**Branch:** `consumer-recovery-completeness`

## Source Control Conflicts (Phase 1 reality check)

Three spec-vs-reality gaps found; all three resolved before Phase 2 critique.

### Conflict 1 — DB filename

- **Spec assumed:** `data/smudge.sqlite`
- **Reality:** `packages/server/data/smudge.db` (per `packages/server/src/db/knexfile.ts:11`)
- **Resolution:** Both design docs and the roadmap 4b.14 entry updated to use the correct filename (`smudge.db`) and acknowledge `DB_PATH` env override.

### Conflict 2 — data directory location

- **Spec assumed:** `data/` at repo root
- **Reality:** `packages/server/data/` is the default (package-relative); `DB_PATH` env overrides
- **Resolution:** All path references updated; backup script sketch now resolves data dir from `DB_PATH` dirname or the package-relative default.

### Conflict 3 — `tar` npm package

- **Spec assumed:** "transitively present, verify and add if needed" (verification was deferred)
- **Reality:** `tar` is not a direct dep; only `tar-stream`/`tar-fs` transitively present (via build tooling). `jszip` IS a server devDep already.
- **Resolution:** Switched output format to `.zip` for consistency with Phase 8b's `.smg` and cross-platform portability. Library choice (`jszip` promoted, or `archiver` for streaming) deferred to implementation with criteria documented.

## Issues Reviewed

### [1] Zip-slip vulnerability
- **Category:** Security
- **Severity:** Critical
- **Issue:** Both 4b.14 restore and 8b import unzip an untrusted archive without specifying any defense against zip-slip (entries with `../` or absolute paths that cause extraction *outside* the target dir). For Smudge running locally as the user, this is arbitrary file write as the user — full host account compromise.
- **Resolution:** Applied Option A — spec'd the defense explicitly in both designs. Two-pass validation (validate all entry paths first, then extract). Reject entries with `..` segments, absolute paths, Windows drive letters, or null bytes. Added security test cases to both 4b.14 and 8b test plans. Failure-modes table updated.

### [2] Hash function evolution can brick old backups
- **Category:** Feasibility / contradiction
- **Severity:** Serious
- **Issue:** The 8b canonicalize function might need a bug fix in the future (non-deterministic sort, BLOB encoding fix, timestamp normalization). When that happens, the function produces different hashes for the same data. Old `.smg` bundles in the wild have manifest `content_hash` = old-hash; importer computes new-hash; mismatch → `BUNDLE_TAMPERED` refusal. **The user is locked out of their own backup by our bug fix.**
- **Resolution:** Applied Option A — added `content_hash_algorithm: "v1"` field to manifest. Importer dispatches on algorithm version. Each algorithm version is a separate frozen file (`canonical-hash-v1.ts`, `canonical-hash-v2.ts`, ...); bug fixes ship as new versions, never edit old ones. Adding new project-scoped data does NOT bump the algorithm version — only bug fixes to the transformation rules do. Updated the manifest spec, import flow, failure modes table, test plan (added frozen-implementation pin), and future-phase extension contract.

### [3] Timezone misalignment on cross-timezone restore
- **Category:** Omission
- **Severity:** Moderate
- **Issue:** `daily_snapshots.date` is interpreted in the writer's app-level `settings.timezone`. The 8b design deliberately excludes `settings` from the bundle, but daily_snapshots rows carry an *implicit* dependency on the source timezone. Cross-timezone restore silently misaligns past pace data and can cause day-boundary upsert collisions.
- **Resolution:** Applied Option A — added `source_timezone` to manifest (informational). On import, the response includes a `warnings: [...]` array; if timezone differs, a `timezone_mismatch` warning is attached (`{ code, source, target, message }`) and the UI surfaces it. No data conversion (calendar-day data has no clean cross-timezone conversion). Added §1.2.2 explaining the design choice.

### [4] 4b.14 archive forward-compatibility post-8a
- **Category:** Omission
- **Severity:** Moderate
- **Issue:** 4b.14 said "your backups remain readable by the Smudge version that wrote them" — a bounded guarantee. When 8a ships and changes the data layout from shared `smudge.db` to per-project `.smudge/` folders, old 4b.14 archives become unrestorable unless something keeps the restore path forward-compatible. The design punted on the restore side.
- **Resolution:** Applied Option A — added a "Forward-Compatibility Commitment" section to 4b.14 (design doc + roadmap entry) that hard-commits to "`make restore` reads any archive written by any prior Smudge version, indefinitely." Added Phase 8a §8a.4 that inherits the obligation to translate pre-8a layouts during restore (reusing 8a's live-upgrade migration logic for archive restore). 4b.14 itself does nothing special; 8a-at-8a-time keeps old snapshots readable.

### [5] Zip bomb + bundle size limit
- **Category:** Security + omission
- **Severity:** Moderate
- **Issue:** No upload size limit specified for `POST /api/projects/import`; no decompression-bomb defense (a small `.smg` can be crafted to decompress to gigabytes). Particularly relevant at the import-from-collaborator boundary (the only "untrusted bundle" path Smudge has).
- **Resolution:** Applied Option A — spec'd three defenses for both 8b and 4b.14: (1) upload size limit `SMUDGE_IMPORT_MAX_UPLOAD_BYTES` default 1 GiB, refused at body-parse boundary with `413`; (2) pre-extraction declared-size validation (`SMUDGE_IMPORT_MAX_UNCOMPRESSED_BYTES` default 2 GiB, `SMUDGE_IMPORT_MAX_COMPRESSION_RATIO` default 10×); (3) streaming watchdog during extraction (catches archives that lie about declared sizes). 4b.14 mirrors the same defenses with `--max-uncompressed` / `--max-ratio` CLI flags. Failure-modes tables updated in both designs and roadmap.

## Unresolved Issues

User wrapped up after Issue 5. The following smaller issues were identified but not reviewed and remain open for future iteration:

### [6] MIME type choice rationale
- **Category:** Ambiguity
- **Severity:** Minor
- **Issue:** The 8b spec says `Content-Type: application/x-smudge-bundle` without justification. There's no registered standard. `application/zip` is the technically-correct underlying type.
- **Suggested options:** (a) keep `application/x-smudge-bundle` and add one sentence of rationale (helps OS-level file association in 8b.6); (b) switch to `application/zip` with `Content-Disposition` carrying the filename; (c) defer to implementation.

### [7] Project UUID preservation cross-collision edge cases
- **Category:** Feasibility
- **Severity:** Minor
- **Issue:** 8b preserves UUIDs end-to-end. Re-importing the same backup creates a separate project at a different folder path with the same internal UUIDs. The post-8a layout makes UUIDs project-scoped so they can't collide *within* a project, but the project UUID itself could (in theory) collide in app-level tables (`recent_projects`).
- **Suggested options:** (a) generate a new project UUID on import (preserves chapter/snapshot/image UUIDs); (b) preserve project UUID and add an app-level uniqueness check that auto-suffixes (`-imported`, `-imported-2`); (c) refuse on collision with `409 PROJECT_UUID_EXISTS`. (a) is probably the right answer for low friction.

### [8] Atomic slug auto-suffix under concurrent import
- **Category:** Feasibility
- **Severity:** Minor
- **Issue:** §2.1 step 5 auto-suffixes `<slug>-2.smudge/` if `<slug>.smudge/` exists. Under concurrent imports, two requests could both decide on `-2`. Standard fix is `mkdir` with `O_EXCL` semantics, retry on collision.
- **Suggested options:** (a) spec the atomic-mkdir-with-retry pattern explicitly; (b) defer to implementation as standard concurrency hygiene. (b) is probably fine; brief mention in the design wouldn't hurt.

### [9] `allow_tampered=true` security note for non-localhost deployments
- **Category:** Security
- **Severity:** Minor
- **Issue:** §2.6 introduces `?allow_tampered=true` as an escape hatch for power users with intentionally-edited bundles. Today Smudge runs localhost-only, but post-7g it can be deployed behind a reverse proxy. If the import endpoint ever ends up internet-reachable without auth, `allow_tampered` becomes an attack vector ("inject arbitrary content into a project by hand-crafting a bundle and passing this flag").
- **Suggested options:** (a) document the deployment-scope caveat in the 8b design; (b) require an env-flag `SMUDGE_ALLOW_TAMPERED_BUNDLE_OVERRIDE` to even accept the query param; (c) remove the override entirely (force users to use `sqlite3` directly for surgery). (a) is sufficient short-term; (b) is the proper fix.

### [10] Soft-delete-on-import behavior
- **Category:** Ambiguity
- **Severity:** Minor
- **Issue:** A bundle can contain soft-deleted chapters (with `deleted_at` set) and even a soft-deleted project (the project itself was in trash when backed up). On import, what should the visibility be? Imported as soft-deleted (only visible in trash)? Auto-restored? Per CLAUDE.md, "Restoring a chapter whose project is deleted also restores the project" — does that rule apply on import?
- **Suggested options:** (a) preserve `deleted_at` as-is (soft-deleted on import); (b) clear `deleted_at` on the project, preserve on chapters; (c) clear all `deleted_at` on import (treat import as a "restore from trash" action). (a) preserves the lossless contract most cleanly.

### [11] Minimum supported version policy
- **Category:** Omission
- **Severity:** Minor
- **Issue:** Forward-only versioning means new Smudge reads old `.smg`. But how *old* of an export do we promise to import? Forever? A small spec gap.
- **Suggested options:** (a) commit to "any prior `format_version`, indefinitely" (matches the 4b.14 forward-compat policy applied in Issue 4); (b) commit to "N major versions back" with explicit deprecation windows; (c) leave unspecified. (a) is consistent with the rest of the design.

### [12] Snapshot storage rows-vs-files ambiguity (8b/8a entanglement)
- **Category:** Ambiguity
- **Severity:** Minor
- **Issue:** Phase 8a's spec says `.smudge/snapshots/` is a directory for "recovery checkpoints" but the current code has snapshots as rows in `chapter_snapshots`. The 8b design hedges by saying canonicalize hashes both tables AND files (so either model works) but doesn't *flaunt* that it handles either case.
- **Suggested options:** (a) keep the hedge, add one sentence explicitly naming it ("8b's canonicalize is agnostic to whether 8a stores snapshots as rows or files — both are hashed regardless"); (b) push 8a to decide before 8b is reviewed; (c) leave as is. (a) is the cheapest clarity win.

## Summary

- **Reality-check conflicts found:** 3
- **Reality-check conflicts resolved:** 3
- **Critique issues found:** 12
- **Critique issues resolved:** 5
- **Critique issues unresolved:** 7 (all minor; user wrapped up after the critical/serious ones)
- **Spec status:** Ready for implementation when picked up, with the unresolved smaller items as known follow-ups
