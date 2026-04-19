# TODO

## Architecture

### Consider splitting ProjectStore interface

`ProjectStore` (`packages/server/src/stores/project-store.types.ts`) currently has 31 methods spanning 5 domains: projects, chapters, chapter statuses, settings, and velocity. Phase 4a adds images as a separate module using `getDb()` directly rather than extending the store, which is the right call — but it raises the question of whether the existing store should be decomposed.

Potential split: `ProjectStore` (projects + chapters, since they share transactions), `StatusStore`, `SettingsStore`, `VelocityStore`. Each would be a thin interface over its repository, initialized alongside the current store. The transaction boundary is the key design constraint — only entities that participate in the same transactions need to share a store.

Not urgent. The current monolithic store works. Revisit when the interface exceeds ~40 methods or when a new domain needs transaction coordination with an existing one.

## Snapshots / find-and-replace follow-ups

From the 2026-04-18 agentic review (`paad/code-reviews/ovid-snapshots-find-and-replace-2026-04-18-17-17-06-9012c13.md`). Important finding I3 and Suggestions S3/S6/S9/S10/S11 were deferred because they're either architectural or span multiple modules.

### I3: Catastrophic `regex.exec()` can exceed the wall-clock deadline

`packages/shared/src/tiptap-text.ts` and `packages/server/src/search/search.service.ts`. The `REGEX_DEADLINE_MS` check runs between `re.exec()` iterations, so a single catastrophic-backtracking exec blocks the event loop for however long V8 explores the state space. The ReDoS heuristic (`assertSafeRegexPattern`) narrows the attack surface but is admittedly best-effort, and the walker-depth and lookaround-normalization mitigations already landed (S2, S5) don't close this path.

Proper fix options:
- **`node-re2`** — swap the user-pattern engine to a linear-time alternative. Adds a native dep with platform-specific builds; Docker image needs to handle it; licensing already permissive (BSD-3). Surface area is small — wrap `new RegExp(...)` in `buildRegex` behind a re2-or-RegExp abstraction.
- **Worker thread with hard kill** — run `searchInDoc`/`replaceInDoc` inside a worker with a setTimeout-terminate on deadline. Pure JS, no native deps, but adds per-request IPC overhead and complicates transaction handling for replace (the worker can't hold the SQLite tx).
- **Aggressive input caps** — tighten `MAX_QUERY_LENGTH` and cap per-chapter text length passed into `exec`. Reduces worst-case wall-clock without changing the engine. Cheapest, least complete.

Threat model: single-user local app, so the user would be wedging their own server — not a remote DoS vector. Worth doing before any future multi-user deployment.

### S3: `extractContext` splits surrogate pairs

`packages/shared/src/tiptap-text.ts:278-282`. `flat.slice(offset - R, offset + length + R)` slices by UTF-16 code unit, so an emoji at the context boundary becomes a lone surrogate rendered as U+FFFD. Cosmetic only (the find-panel preview), not the underlying match.

Fix: round start/end to code-point boundaries, or walk graphemes and slice by segment index. Low-priority — only visible on emoji-dense manuscripts.

### S6: Unify `canonicalize` / `canonicalJSON` implementations

`packages/server/src/snapshots/content-hash.ts:18-28` and `packages/shared/src/tiptap-text.ts:289-295` are near-duplicates that already differ subtly (only the content-hash copy has a depth cap; only the mark-comparison copy handles undefined values). Extract a single `canonicalStringify(value, { maxDepth? })` in `@smudge/shared` and route both callers through it.

Small refactor; the main risk is ensuring snapshot dedup hashes don't change for existing rows — keep the same key-sort and value-recurse semantics and add a test pinning a few known docs to their current hex digests.

### S9: Align cross-project image URL handling between PATCH and restore

`packages/server/src/chapters/chapters.service.ts:67-69` lets a chapter PATCH store arbitrary `/api/images/{foreign-uuid}` src URLs verbatim — `applyImageRefDiff` only skips the refcount update. `packages/server/src/snapshots/snapshots.service.ts:144-152` now refuses the same shape on restore (with the dedicated `CROSS_PROJECT_IMAGE_REF` code from S8). The two code paths disagree.

Policy decision needed: either allow cross-project refs on both paths (accept dangling-src after purge) or add a matching guard to the chapter PATCH. If the chosen policy is "refuse", export a shared `CrossProjectImageRefError` from `images.references.ts`, throw it from `applyImageRefDiff` on mismatch, and surface as 400 `CROSS_PROJECT_IMAGE_REF` in both chapter update and project replace paths.

### S10: Persist `content_hash` as a column with a partial unique index

`packages/server/src/db/migrations/014_create_chapter_snapshots.js`. Dedup for manual snapshots is enforced only in-application by `createSnapshot`'s transactional read-then-insert. better-sqlite3 serializes writes so this is effectively atomic today, but the invariant isn't encoded at the DB level — any future writer path bypasses the check.

Migration sketch: new column `content_hash TEXT NOT NULL` populated from existing rows via `canonicalContentHash(content)`, plus `CREATE UNIQUE INDEX idx_manual_hash ON chapter_snapshots (chapter_id, content_hash) WHERE is_auto = 0`. `createSnapshot` then inserts unconditionally and handles `SQLITE_CONSTRAINT_UNIQUE` as the duplicate sentinel. Needs a forward migration + a data-fill step; the hash-on-read cost in `getLatestSnapshotContentHash` goes away.

### S11: Scope `canonicalize` depth check to `content[]` only

`packages/server/src/snapshots/content-hash.ts:18-27` increments depth on every nested array or object, but `validateTipTapDepth` in `packages/shared/src/schemas.ts` only counts `content[]` descents. A doc with deeply nested `attrs` (e.g. a custom node storing a complex JSON config) passes the schema but trips the canonicalize cap and falls back to raw-byte hashing — dedup stops surviving re-serialization for those rows.

Fix: track depth only when descending into `content: []`, matching the write-side invariant. Couples to S6 if we unify the implementations.
