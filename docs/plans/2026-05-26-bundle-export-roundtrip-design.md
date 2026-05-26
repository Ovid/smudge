# Phase 8b — Bundle Export (`.smg`) Roundtrip & Versioning (Design)

**Date:** 2026-05-26
**Author:** Ovid / Claude (collaborative)
**Roadmap phase:** `docs/roadmap.md` — Phase 8b: Bundle Export (.smg)
**Sibling phase:** Phase 4b.14 (Operational Backup Stopgap) — see `2026-05-26-operational-backup-stopgap-design.md`
**Dependencies:** Phase 8a (per-project `.smudge/` folder layout)

---

## Goal

Specify Phase 8b's `.smg` bundle format with enough precision that the "export a project as backup, import it later with no change" promise is testable. The original roadmap entry for 8b was a one-paragraph sketch ("zip archive of the `.smudge/` project folder"); this design fills in the manifest, versioning policy, lossless guarantee, import logic, failure modes, and roundtrip-test contract.

The design deliberately does not change 8b's scope or dependencies. 8b still depends on 8a. The format is still zip-of-`.smudge/`-folder. The deliverables are still `POST /api/projects/import` and `GET /api/projects/{id}/bundle`. What this doc adds is the spec around those deliverables.

## Why Now (specifying ahead of implementation)

Phase 8b is months out — gated on 8a, which is gated on 7g. Specifying the format now, while the design conversation is fresh, has two payoffs:

1. The decisions made here (lossless backup, no share-time scrubbing, forward-only versioning, content-hash equality contract) are recorded so future-me doesn't re-litigate them when 8b is picked up.
2. The **future-phase extension contract** (every phase that adds project-scoped data must extend the roundtrip canonicalization) starts applying *now* — even before 8b is built, new phases can land knowing they'll owe a roundtrip test entry. The contract documented here is the source of truth.

## What this design is NOT

- **Not a change to 8b's scope.** Roundtrip semantics were always implied by "import it later with no change"; this just makes them explicit and testable.
- **Not a share-export design.** The brainstorm investigated this thoroughly (see §6 "Backup vs share — research"). The answer is: Smudge already has share-exports via Phase 3a/3b (PDF, DOCX, EPUB, etc.); `.smg` stays lossless.
- **Not a UI design.** The export/import UI follows from the format spec; that's an 8b-implementation concern, not a 8b-design concern.

---

## 1. Format spec

### 1.1 Zip layout

```
my-novel.smg  (zip):
  manifest.json
  project.sqlite
  assets/
    <uuid>.jpg
    <uuid>.png
    ...
  snapshots/
    <chapter-uuid>/<snapshot-uuid>.json
    ...
```

The structure inherits Phase 8a's `.smudge/` folder layout exactly — `.smg` is `zip(.smudge/)`. The `exports/` subdirectory from 8a's spec is **deliberately excluded** because generated artifacts are reproducible from the source content and would bloat the bundle.

**Why grouped `snapshots/<chapter-uuid>/<snapshot-uuid>.json` instead of flat `snapshots/<snapshot-uuid>.json`:** if a writer ever unzips a `.smg` and pokes around, the grouped layout makes the chapter-to-snapshot relationship visible without joining against the SQLite DB. This is a small ergonomic call that costs nothing.

### 1.2 Manifest

`manifest.json` at the root of the zip:

```json
{
  "format_version": 1,
  "schema_version": 47,
  "app_version": "0.7.2",
  "created_at": "2026-05-26T14:32:11Z",
  "source_timezone": "Europe/Malta",
  "project": {
    "title": "Bread, Circuses, and GPUs",
    "slug": "bread-circuses-and-gpus",
    "chapter_count": 23,
    "total_word_count": 41200
  },
  "content_hash_algorithm": "v1",
  "content_hash": "sha256:..."
}
```

Field-by-field:

| Field | Purpose | Load-bearing? |
|---|---|---|
| `format_version` | The zip layout itself (file names, directory structure). Bumped only when the on-disk shape changes — e.g., adding a top-level `metadata/` directory, renaming `assets/`, moving snapshots to a different layout. New columns in `project.sqlite` do **not** bump this. | Yes — import gates on this. |
| `schema_version` | The Knex migration version of the embedded `project.sqlite`. Read by import to decide which forward migrations to run. | Yes — import runs migrations against this. |
| `app_version` | The Smudge version that wrote the bundle. Informational only; useful in bug reports. | No. |
| `created_at` | ISO-8601 UTC timestamp at export time. Informational. | No. |
| `source_timezone` | The exporting Smudge's `settings.timezone` at export time (e.g., `"Europe/Malta"`). Daily-snapshot dates are implicitly interpreted in this timezone; import warns the user if the target timezone differs (see §1.2.2 and §2.1 step 9.5). Informational only — no data conversion is performed. | No (warning-only). |
| `project.title` | The project's title at export time. Informational; lets a future "open recent" or `smg-inspect` UI show what's in the bundle without unpacking. | No. |
| `project.slug` | The slug at export time. Informational. | No. |
| `project.chapter_count` / `total_word_count` | Sanity-check display values. Informational. | No. |
| `content_hash_algorithm` | The canonicalization-function version used to compute `content_hash`. Read by import to dispatch to the correct verifier (see §1.2.1). Three-character versions: `v1`, `v2`, etc. Algorithm versions accumulate forever; old ones never get removed. | Yes — import dispatches on this. |
| `content_hash` | SHA-256 over a deterministic canonicalization of (all project-scoped tables) + (all referenced image bytes), computed via the algorithm named by `content_hash_algorithm`. This is the **testable lossless contract**. See §3. | Yes — roundtrip tests assert on it. |

#### 1.2.2 Why `source_timezone` is informational, not load-bearing

Daily-snapshot rows are dated as plain strings (e.g., `"2026-05-26"`) without explicit timezone context. They were grouped by whatever timezone was active when the underlying writing happened — read CLAUDE.md "Timezone handling" in Phase 2's §2.2 for the source-of-truth statement.

After a cross-timezone restore, those date strings remain bit-identical (the lossless contract holds) but are *interpreted* in the target's timezone. The result: past pace data and streaks can be skewed by up to one day at boundaries, and a writing session immediately after restore can collide on the daily-snapshot upsert. This is not introduced by 8b — the same drift happens if a user changes `settings.timezone` in the live app — but import is the natural moment to surface it.

`source_timezone` is informational: import compares it against the target's `settings.timezone` and, on mismatch, attaches a warning to the success response and logs it server-side. **No data conversion** — calendar-day data cannot be cleanly converted between timezones (there's no single moment to anchor the conversion to), so the only honest options are (a) preserve as-is and warn, or (b) refuse the import. (a) wins because the user often legitimately wants to import even with the mismatch (e.g., they're moving machines and will switch timezones anyway).

#### 1.2.1 Why `content_hash_algorithm` is separate from `format_version` and `schema_version`

Three orthogonal evolution axes, three orthogonal version numbers:

- **`format_version`** bumps when the on-disk zip shape changes.
- **`schema_version`** bumps every time a Knex migration is added.
- **`content_hash_algorithm`** bumps when we **change how content is hashed** for a reason other than adding new data — fixing a non-deterministic sort, switching BLOB encoding, normalizing timestamps differently, etc.

The hidden brittleness this protects against: if canonicalize were single-versioned, fixing a bug in (say) the timestamp normalization would change the hash for the same data. Old `.smg` bundles in the wild would have manifest hashes computed with the buggy code; on import, the recomputed hash would use the fixed code; the hashes would mismatch; the importer would refuse with `BUNDLE_TAMPERED`. **The user would be locked out of their own backup by our bug fix.** That's not a contract a backup format can hold.

Versioning the algorithm lets us fix bugs without bricking past exports. Each `content_hash_algorithm` version pins a single canonicalize implementation forever. Old implementations live alongside new ones in source (`canonical-hash-v1.ts`, `canonical-hash-v2.ts`, ...). The total source-code cost of one extra algorithm version is small (~100-200 lines of locked code) and pays for unlimited future bug fixes.

**Adding new data does NOT bump the algorithm version** — it just grows what `canonical-hash-v2` (or whatever's latest) hashes over. The algorithm version bumps only when the *transformation rules* change. This is the load-bearing distinction.

**Versioning is forward-only.** A v4-format bundle imports into v7 Smudge by running Knex migrations 5, 6, 7 against the embedded SQLite. A v7-format bundle does *not* import into v4 Smudge — it's refused with a clear "this backup was made by Smudge vN, you're running vM; upgrade to open" message. This matches how Knex migrations already work and is appropriate for a single-user app where the user controls what version is installed.

### 1.3 What's inside `project.sqlite`

The full per-project DB as defined by Phase 8a:

- `projects` row (one — the project itself, including soft-delete state)
- `chapters` rows (all, **including soft-deleted ones** — `deleted_at` is preserved)
- `chapter_snapshots` rows (all manual + automatic snapshots; or if 8a moves snapshots out of the DB to `snapshots/<uuid>.json` files, the rows reflect that)
- `daily_snapshots` rows (full velocity history)
- Any future per-project tables (characters, citations, scenes, etc.) added in Phase 5/6 land here automatically

The per-project DB does **not** contain:

- `chapter_statuses` — seed data, shared across projects. The importer re-applies the seed if the importing Smudge's seed differs (this is an edge case; document it in the import behavior).
- `settings` — app-level (timezone, default export format). Not project-scoped.
- `recent_projects` — app-level (per Phase 8a's spec).

### 1.4 What's inside `assets/`

Every image file referenced by any chapter in this project. Files are named by their image-UUID (`<uuid>.<ext>`), matching how they're referenced from TipTap image nodes after Phase 8a's per-project asset model lands.

Walking the chapter content (TipTap JSON) to find image references is the export-time responsibility. The shared `extractImageRefs` helper from Phase 4a (or its post-8a successor) is reused.

---

## 2. Import logic

### 2.1 Happy-path flow

1. Open the uploaded `.smg` as a zip.
2. Read and parse `manifest.json`. Reject early on schema-validation failure (see failure-modes table in §2.3).
3. **Validate every zip entry's path against zip-slip** before any extraction begins (see §2.4). Reject the entire bundle on first violation, without writing anything.
3a. **Validate declared uncompressed sizes against the bomb-defense limits** (see §2.5). Reject if the declared total exceeds the absolute cap or the compression-ratio cap, without writing anything.
4. Verify `format_version` and `schema_version` are within the importing Smudge's known range. Reject early if either is newer.
5. Extract to a fresh `.smudge/` folder (under the data dir). The folder name is `<slug>.smudge/`; if the folder already exists, auto-suffix to `<slug>-2.smudge/`, `<slug>-3.smudge/`, etc. No prompt.
6. If `schema_version` < current, run Knex migrations forward against the extracted `project.sqlite` in place.
7. Recompute `content_hash` over the (now-migrated) DB + assets **using the algorithm version named in the manifest's `content_hash_algorithm` field** (dispatch to `canonical-hash-v1.ts`, `canonical-hash-v2.ts`, etc.). Compare to manifest's `content_hash`. **If mismatch, refuse and clean up the extracted folder** (default behavior — see §2.6 for the override case). If the algorithm version is unknown (newer than this Smudge knows), refuse with the same shape as `BUNDLE_TOO_NEW`.
8. Register the project in `recent_projects` (per Phase 8a).
9. Compare manifest's `source_timezone` to the target's `settings.timezone`. If they differ, attach a `timezone_mismatch` warning to the response (see §4). Log it server-side. **Do not refuse**; the import succeeds.
10. Return the new project's ID and any warnings to the caller.

The zip-slip check is step 3 — *before* any version/schema check that would imply we've "accepted" the bundle for processing. Validation never writes to disk, so a malicious bundle is refused before any side effect occurs.

### 2.2 UUID handling

**UUIDs are preserved** end-to-end (chapter IDs, snapshot IDs, image IDs, the project ID itself). Because the post-8a layout is per-project SQLite + per-project asset directory, UUIDs are project-scoped — there's no shared UUID namespace that two projects could collide in. Preserving UUIDs means:

- Re-importing the same backup creates a *separate* project at a different folder path, with the same internal UUIDs. The two projects coexist without conflict.
- TipTap image references inside chapter content (which embed image URLs by UUID) need no rewriting — the UUIDs still resolve, because they resolve within this project's `assets/`.

The only thing that might "collide" is the project folder name on disk, which is handled by §2.1 step 4's auto-suffix.

### 2.3 Failure modes

The import endpoint owes precise behavior for every failure mode. The table below is the contract:

| Condition | Behavior | Response shape |
|---|---|---|
| Upload is not a valid zip | Refuse | `400 BAD_REQUEST { code: "INVALID_BUNDLE", message: "The backup file is corrupt or unreadable" }` |
| Missing `manifest.json` | Refuse | `400 INVALID_BUNDLE { message: "This is not a valid Smudge backup" }` |
| `manifest.json` fails schema validation | Refuse | `400 INVALID_BUNDLE { message: "The backup's manifest is malformed" }` |
| Any zip entry path fails zip-slip validation (see §2.4) | Refuse, write nothing | `400 INVALID_BUNDLE { message: "The backup contains an unsafe file path: <offending-entry>" }` |
| Upload body exceeds `SMUDGE_IMPORT_MAX_UPLOAD_BYTES` (default 1 GiB) | Refuse at body-parse boundary | `413 PAYLOAD_TOO_LARGE { message: "The backup file is too large (max <N> GiB)." }` |
| Declared total uncompressed size exceeds `SMUDGE_IMPORT_MAX_UNCOMPRESSED_BYTES` (default 2 GiB) or compression ratio > `SMUDGE_IMPORT_MAX_COMPRESSION_RATIO` (default 10) | Refuse, write nothing | `400 INVALID_BUNDLE { message: "The backup appears to be a decompression bomb." }` |
| Actual streamed bytes during extraction exceed the declared total | Abort extraction, clean up | `400 INVALID_BUNDLE { message: "The backup's declared size doesn't match its contents." }` |
| `format_version` > known | Refuse | `409 BUNDLE_TOO_NEW { message: "This backup was made by Smudge vN, you're running vM. Upgrade Smudge to open it.", manifest: { ... } }` |
| `schema_version` > known | Refuse | `409 BUNDLE_TOO_NEW` (same shape) |
| `content_hash_algorithm` unknown | Refuse | `409 BUNDLE_TOO_NEW` (same shape) — the bundle was hashed with an algorithm version we don't ship yet. |
| `schema_version` < current | Migrate forward, continue | (continues to success path) |
| `content_hash` mismatch on recompute | Refuse, clean up extracted folder | `409 BUNDLE_TAMPERED { message: "This backup's contents don't match its manifest. It may have been modified or corrupted." }` |
| Project folder name collision | Auto-suffix `<slug>-N.smudge/` | (continues to success path) |
| Asset file referenced by manifest is missing from zip | Refuse | `400 INVALID_BUNDLE { message: "The backup is missing one or more referenced files" }` |
| Knex migration fails | Refuse, clean up extracted folder | `500 MIGRATION_FAILED { message: "...", migrationVersion: N }` |

**HTTP status codes:** all responses use codes already in the CLAUDE.md allowlist (400, 409, 500). `BUNDLE_TOO_NEW` and `BUNDLE_TAMPERED` are 409 because they're well-formed requests violating a constraint the client needs to resolve — same shape rationale as the existing "delete image still in use" 409.

### 2.4 Zip-slip defense (security contract)

`POST /api/projects/import` extracts an untrusted archive uploaded by a user. Without explicit path validation, a crafted entry like `../../Users/ovid/.ssh/authorized_keys` causes naive extractors to write *outside* the intended `.smudge/` folder — arbitrary file write as the Smudge server process. This is a well-known CVE class (zip-slip / path-traversal). Validation must happen before any extraction.

**Validation rule** (applied to every entry before any byte is written to disk):

1. Compute `targetRoot = path.resolve(dataDir, <slug>.smudge)` (or the auto-suffixed name if one was already taken — but the *path validation* uses the chosen target).
2. For each entry, compute `entryDest = path.resolve(targetRoot, entry.path)`.
3. Require `entryDest === targetRoot || entryDest.startsWith(targetRoot + path.sep)`.
4. Additionally reject entries whose declared path is absolute, contains a Windows drive letter, contains `..` as any segment after normalization, or contains null bytes.
5. On the first violation, refuse the entire bundle with `400 INVALID_BUNDLE` (see §2.3). No directory is created, no bytes are written.

The validation runs as a separate first pass over the zip directory — read every entry's declared name, validate the full set, then begin extraction. Two-pass discipline avoids the "extracted 80% then aborted, partial state on disk" failure mode.

`jszip` (a current server devDep) does *not* validate entry paths by default. Whatever library is selected for production unzip in 8b must either validate by default or have this validation layer added explicitly. The selection criterion is "validates by default, or admits a small validation wrapper" — not "decompresses fastest."

The same defense applies to the **Phase 4b.14 stopgap's `make restore`** — its design doc spells out the same validation rule (`docs/plans/2026-05-26-operational-backup-stopgap-design.md` §2a). Both share the contract; the implementations will differ only because they extract into different target roots.

### 2.5 Decompression-bomb defense (security contract)

A small `.smg` (a few hundred KB) can be crafted to decompress to gigabytes — overlapping entries, deeply repeated patterns, nested archives. Naive extraction streams every byte to disk, exhausting space and possibly bricking Smudge. This is a less-famous CVE class than zip-slip but real (`42.zip` is the canonical demonstration: ~42 KB → 4.5 PB).

The 8b import path applies three defenses in order:

1. **Upload size limit.** The multipart body parser enforces `SMUDGE_IMPORT_MAX_UPLOAD_BYTES` (default 1 GiB). Bodies larger than this are rejected at the boundary with `413 PAYLOAD_TOO_LARGE` before any zip parsing happens. Configurable for power users with genuinely large image-heavy projects.
2. **Declared-size validation, pre-extraction.** After zip-slip validation but before extraction, sum every entry's *declared* uncompressed size. Refuse with `400 INVALID_BUNDLE` if:
   - the sum exceeds `SMUDGE_IMPORT_MAX_UNCOMPRESSED_BYTES` (default 2 GiB), or
   - the sum divided by the compressed body size exceeds `SMUDGE_IMPORT_MAX_COMPRESSION_RATIO` (default 10). A 10× compression ratio is comfortably above what JSON + image projects achieve in practice (typically 2-4×) while well below what crafted bombs need.
3. **Streaming watchdog, during extraction.** While extracting, track bytes-written cumulatively. If it exceeds the declared total by more than a small slack (the zip format allows minor discrepancies), abort extraction immediately, clean up the partial extracted folder, refuse with `400 INVALID_BUNDLE`. This catches bundles that lie in their declared sizes.

All three limits are env-configurable (`SMUDGE_IMPORT_*` prefix) so a writer with a genuinely large archive can raise them. Defaults are tuned for typical Smudge usage (a manuscript with images is well under 100 MB).

The same three defenses apply to **Phase 4b.14's `make restore`** — its design doc references this section. Defaults are the same; CLI flags (`--max-uncompressed=N`, `--max-ratio=N`) substitute for env vars.

### 2.6 The `content_hash` override case

There is exactly one legitimate reason for a `content_hash` mismatch on import: the user has deliberately modified the bundle (e.g., extracted, edited the SQLite directly with `sqlite3`, re-zipped). For that case, the import endpoint accepts an optional `?allow_tampered=true` query parameter that converts the `BUNDLE_TAMPERED` refusal into a warning logged to the server console + a flag set on the imported project (`tampered_on_import: true`). The UI surfaces this on the project's settings page.

This is a power-user escape hatch. The default behavior remains "refuse" so that an actually-corrupted bundle can't silently introduce data integrity issues.

---

## 3. Roundtrip-test contract

### 3.1 Equality definition: `content_hash`

The roundtrip equality contract is single-line:

> `content_hash_vN(original) == content_hash_vN(import_and_re_export(original))`

where `vN` is the algorithm version current at the time of the test.

`content_hash_v1` is computed by a deterministic canonicalization function in `packages/server/src/bundle/canonical-hash-v1.ts` (created by 8b's implementation):

1. For each project-scoped table (in a fixed table-order list), `SELECT *` ordered by primary key, serialize each row to a canonical JSON (sorted keys, normalized timestamps to UTC-ISO-8601, normalized BLOBs to base64), append to a running hash input.
2. For each file in `assets/` (in name order), append the file's raw bytes.
3. For each file in `snapshots/` (in path-sorted order), append the file's raw bytes.
4. SHA-256 the combined input.

Each algorithm version is a separate file (`canonical-hash-v1.ts`, `canonical-hash-v2.ts`, ...). Once an algorithm version is shipped, its implementation is **frozen** — never modified, never deleted. New algorithm versions ship as new files; the dispatcher in `canonical-hash.ts` switches on the version string.

The current-latest function is exported and used by both export-time (to compute the manifest field, always at the latest version) and roundtrip-test code (to verify import preserves what export wrote). All historical versions are kept reachable by the dispatcher so import can verify any bundle ever produced.

### 3.2 Test surface

Three layers:

**Unit (`packages/server/src/bundle/__tests__/canonical-hash-v1.test.ts`, plus one file per future algorithm version):**
- Same project hashed twice → same hash (determinism).
- Project with different timestamp string format → same hash (normalization).
- Project with reordered table rows → same hash (sort discipline).
- Project with a single byte changed in an asset → different hash (sensitivity).
- Frozen-implementation pin: a fixture project's bytes-on-disk produce a specific hash value, hardcoded in the test (e.g., `expect(hash(fixture)).toBe("sha256:abc123...")`). If anyone changes `canonical-hash-v1.ts`, this test fails — which is the point. Bug fixes go in `canonical-hash-v2.ts`, not by editing v1.

**Integration (`packages/server/src/bundle/__tests__/roundtrip.test.ts`):**
For each of the following project shapes, assert `hash(orig) == hash(roundtripped)`:
- Empty project (just the row, no chapters).
- Single-chapter text-only project.
- Multi-chapter project with all five `chapter_status` values represented.
- Project with soft-deleted chapters.
- Project with referenced images.
- Project with snapshots (manual + automatic).
- Project with `daily_snapshots` history.
- Project with target word count and deadline set.
- A "kitchen sink" project that combines all of the above.

**Security (`packages/server/src/bundle/__tests__/security.test.ts`):**
Construct three malicious bundles — one with a `../../etc/passwd`-style entry, one with an absolute path entry (`/etc/passwd`), one with a `..` segment after normalization (`a/../../etc/passwd`). For each, POST to `/api/projects/import` and assert: (a) the response is `400 INVALID_BUNDLE` with the offending entry name in the message, (b) no `.smudge/` folder is created anywhere under the data dir, (c) no file is written outside the test data dir (snapshot the surrounding tmpfs before and after).

**E2e (`e2e/bundle-roundtrip.spec.ts`):**
- Export a project from the running app, re-import via the UI, assert the new project's content matches.

### 3.3 Future-phase extension contract

This is the part that makes "lossless across phases" a real guarantee instead of an aspiration.

**Every future phase that adds project-scoped data takes on three obligations:**

1. **Update the current-latest canonicalization function** (e.g., `canonical-hash-v1.ts` while v1 is current; if v2 has shipped, `canonical-hash-v2.ts`) to include the new field/table in its hash input. The fixed table-order list grows; new columns flow through `SELECT *` automatically. **Do not edit a non-latest algorithm version** — those are frozen so historical bundles still verify.
2. **Add a roundtrip-test case** for the new data shape (a new character sheet, a new citation, a new scene card — whatever the phase introduces). The case lives in the integration test suite and goes in the kitchen-sink project too.
3. **Bump `format_version`** *only* if the zip layout itself changes — a new top-level directory, a renamed file, snapshots stored differently. New columns inside `project.sqlite` do **not** bump `format_version`; they flow through `schema_version` via Knex migrations.

**Adding new data does NOT bump `content_hash_algorithm`.** The current-latest algorithm function just hashes more stuff. Bumping the algorithm version is reserved for *fixing a bug in the transformation rules* — a non-deterministic sort, an incorrect timestamp normalization, a BLOB encoding issue, anything where the same input data would now hash to a different output. When that happens, the bug fix lands in a new `canonical-hash-vN+1.ts` file; the buggy `canonical-hash-vN.ts` stays frozen so old bundles still verify against their original manifest hash.

This contract is reproduced in the Phase 8b roadmap entry so it's visible to every future phase author.

---

## 4. API surface

The two endpoints already noted in the roadmap, with full spec:

### `GET /api/projects/{id}/bundle`

- Response: `Content-Type: application/x-smudge-bundle`, `Content-Disposition: attachment; filename="<slug>.smg"`. Body is the zip bytes.
- Errors: `404 NOT_FOUND` if project doesn't exist or is soft-deleted; `500` on internal failure.
- Export is **always lossless** — there are no query parameters to scrub content. See §6 for why.

### `POST /api/projects/import`

- Request: `multipart/form-data` with a single `bundle` file field.
- Optional query param: `allow_tampered=true` (see §2.6).
- Success: `201 { project: { id, slug, title, ... }, warnings: [...] }` — the newly-created project's metadata plus a (possibly empty) warnings array. Warnings are non-fatal advisories the UI should surface. Defined warning codes:
  - `timezone_mismatch` — `{ code: "timezone_mismatch", source: "Europe/Malta", target: "America/New_York", message: "This backup was made with timezone Europe/Malta; you're configured for America/New_York. Daily-pace data may be off by up to one day at boundaries." }`
  Future warnings (e.g., from new app-level dependencies) follow the same `{ code, message, ...details }` shape.
- Errors: per the failure-modes table in §2.3.

---

## 5. Out of scope (deferred to later phases or never)

- **Share-time scrubbing.** Not in v1. See §6. If demand emerges, a future phase can add an export dialog with `Include snapshots`, `Include trash`, `Include daily history` checkboxes — all defaulting ON, mirroring Word's Document Inspector pattern. None of that changes the format spec.
- **Reverse migrations** (newer bundle into older Smudge). Forward-only is sufficient for single-user.
- **Multi-project bundles.** A `.smg` is one project. "Back up everything" is what the Phase 4b.14 stopgap is for; once 8b lands, "back up everything" can either stay with the stopgap or land as a separate "export all projects" UI that produces N `.smg`s.
- **Encryption.** Single-user app on the user's host; no auth; encryption adds key-management burden without a real threat-model gain.
- **Signing.** Same rationale.
- **`.smg` diff or merge.** Bundles are atomic — import creates a new project, never updates an existing one.
- **Cloud sync / offsite copy.** That's a deployment concern, not a format concern.

---

## 6. Backup vs share — research summary

Brainstorm session investigated whether `.smg` should support a "scrub for sharing" mode that strips soft-deleted chapters, snapshots, and daily history. The answer, after surveying four established writing tools, is **no — keep `.smg` lossless**.

**What established tools do:**

| Tool | Backup | Share-export |
|---|---|---|
| **Scrivener** | Full `.scriv` archive — includes Trash folder, all snapshots, all metadata. Explicitly "very different from compiling." | Separate Compile pipeline → PDF/DOCX/EPUB. Trash isn't compiled. |
| **Microsoft Word** | The `.docx` is both; Word relies on the user explicitly running Document Inspector to strip personal info, comments, revisions before sharing. | Same `.docx`, post-Inspector. |
| **Google Docs** | Version history kept in the original. | "Make a Copy" with checkboxes: `Copy comments and suggestions` (default OFF). Version history never carries to a copy. |
| **Ulysses** | All sheets including "material" sheets persist. | Per-sheet `Material` flag excludes from export; comments/annotations configurable at export. |

The pattern is universal: **backup = lossless including history/trash; share-export = lossy by design, defaulting to deletion of private content.** They are different operations with different defaults.

**Why this means `.smg` stays lossless for Smudge:** Smudge already has the share-export side covered by **Phase 3a/3b** — PDF, DOCX, EPUB, HTML, Markdown, plain text. These formats *physically can't* carry trash, snapshots, or daily-velocity data; there's no slot for them. They're inherently sanitized.

The only "share a `.smg`" case is collaboration with another Smudge user — and in that case, the collaborator usually wants the full history (snapshots are valuable context for a co-author). For "share the manuscript without history," the answer is "use Phase 3a/3b's DOCX or PDF."

If `.smg`-with-scrubbing ever becomes a real ask, it can land as a follow-up phase. The format spec in §1 doesn't need to change to accommodate it (scrubbing happens before zipping; the zip layout is identical).

---

## 7. Open questions deferred to 8b implementation

These are intentionally not resolved here — they're implementation-time calls:

- The exact Knex migration runner code path for the embedded SQLite (in-place vs. copy-to-temp). Probably in-place; doesn't matter to the format spec.
- Whether `manifest.json` should include a hash of the manifest itself (chicken-and-egg). Leaning no — the bundle is a single artifact and the `content_hash` covers everything substantive.
- Whether the import UI should show a preview ("This bundle contains N chapters, M images, was created on …") before committing. Probably yes; it's a UI call, not a format call.
- Whether `created_at` is local-time or UTC. Leaning UTC (manifest is machine-readable; local-time goes in the filename per §1 of the stopgap design). Decide at implementation time.
