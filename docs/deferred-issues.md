# Deferred Issues

Issues identified during code review that need follow-up work. Each was verified but deferred because it requires design decisions or larger refactoring.

## From agentic review 2026-03-31 (ovid/architecture branch)

Source: `paad/code-reviews/ovid-architecture-2026-03-31-15-42-00-589336c.md`

### Corrupt chapter triggers misleading full-page error overlay

**Severity:** Important
**Files:** `packages/client/src/pages/EditorPage.tsx:324-342`, `packages/client/src/hooks/useProjectEditor.ts:143`

When a user clicks a chapter with corrupt content, the server returns 500 `CORRUPT_CONTENT`. The client catch block sets `error` state, which renders a full-page "Project not found" overlay hiding the sidebar. The user cannot navigate to other healthy chapters and the error message is misleading.

**What's needed:** Separate per-chapter errors from project-level errors. For `CORRUPT_CONTENT`, show an inline error in the editor area while keeping the sidebar navigable. Requires:
- A new error state (e.g., `chapterError`) distinct from the project-level `error`
- Client-side detection of the `CORRUPT_CONTENT` error code from the API response
- An editor-area error view that replaces the editor but not the sidebar

### handleSave discards 4xx server error messages

**Severity:** Important
**Files:** `packages/client/src/hooks/useProjectEditor.ts:92-104`

When a save attempt receives a 4xx response (e.g., 400 VALIDATION_ERROR), the retry loop correctly breaks immediately. However, the specific error message from the server is discarded. The user sees only the generic "Unable to save" message with no indication of what went wrong.

**What's needed:** Capture the error message from the 4xx response and surface it in the UI. Requires:
- Storing the server error message in state (e.g., `saveErrorMessage`)
- Updating the save status display in EditorPage to show the specific message
- Deciding whether to show a dismissible banner vs replacing the status text

### Status label enrichment duplicated across 6 call sites

**Severity:** Suggestion
**Files:** `packages/server/src/routes/chapters.ts`, `packages/server/src/routes/projects.ts`

The `{ ...chapter, status_label: ... }` pattern is repeated 6 times across two route files using two different lookup strategies (`getStatusLabel` for single chapters, `getStatusLabelMap` for arrays). Adding a field to the enrichment (e.g., status color) would require updating all 6 sites.

**What's needed:** An `enrichChapter(chapter, labelMap)` utility, or extend `queryChapter`/`queryChapters` to accept a label map and enrich in one step.

### Project detail and trash endpoints include corrupt chapters silently

**Severity:** Suggestion
**Files:** `packages/server/src/chapters/chapters.repository.ts` (`queryChapters`), `packages/server/src/chapters/chapters.types.ts` (`stripParseFailedFlag`)

`GET /api/projects/:slug` and `GET /:slug/trash` return chapter arrays. A chapter whose stored JSON does not parse is flagged internally as `content_parse_failed`, but that flag is stripped before the row crosses into a wire type, so the chapter arrives with `content: null` and nothing distinguishing it from a genuinely empty chapter. There is no HTTP-level error either — the 500 `CORRUPT_CONTENT` route fires only for single-chapter `GET` and `PATCH`. The client sidebar therefore lists corrupt chapters without warning.

**What's needed:** A wire-visible signal, under a name that is **not** `content_corrupt`. That name already belongs to `OuttakeRow` in `packages/shared/src/types.ts` and carries a different contract there: a corrupt outtake is returned with a substituted empty doc and the flag as the only way to tell, whereas a corrupt chapter is not returned at all. Architecture finding F-22 renamed the chapter-side flag to end exactly that collision, so re-introducing the shared name would undo it — and worse than before, since the client branches on bare truthiness of `content_corrupt` in `OuttakeCard.tsx` and `EditorPage.tsx`. Alternatively, strip content from project-level responses entirely: the client fetches individual chapters via `GET` anyway, and would then hit the existing `CORRUPT_CONTENT` route.

(An earlier entry here asked to add `content_corrupt?: boolean` to the shared `Chapter` interface so the client could detect corrupt chapters. That premise no longer holds — a corrupt single-chapter fetch is a 500 `CORRUPT_CONTENT`, which the client already maps as a terminal code, and the misleading-overlay half is tracked by the first entry in this file.)

## From agentic review 2026-03-31-13-11-39 (ovid/architecture branch)

Source: `paad/code-reviews/ovid-architecture-2026-03-31-13-11-39-5d46d5b.md`

### No security headers (helmet) or CORS configuration

**Severity:** Important
**Files:** `packages/server/src/app.ts`

The Express app sets no security-related HTTP headers (no `helmet()`, CSP, X-Frame-Options, X-Content-Type-Options). There is also no CORS middleware. The app is exposed via Docker on port 3456. For a no-auth app on a network port, DNS rebinding can bypass same-origin policy, allowing a malicious page to read/modify/delete all data.

**What's needed:** Install and configure `helmet` middleware for standard security headers. Add CORS middleware restricting `Origin` to expected values (e.g., `localhost:5173` in dev, the served origin in production). Consider `Host` header validation to defend against DNS rebinding.

**Resolved 2026-08-22 (architecture report F-02).** All three parts are now closed, by three separate changes over time:

- **Security headers** — `helmet()` has been mounted in `createApp()` since an earlier phase, with an explicit CSP. Pinned by `health.test.ts`.
- **DNS rebinding** — closed by `Host` validation rather than by CORS, and the substitution is deliberate. In a rebinding attack the malicious page is same-origin with the target from the browser's point of view, so a `GET` carries **no `Origin` header at all**; only `Host` names the attacker's domain. An `Origin` allowlist would inspect a header the attack does not send. See `packages/server/src/config/loopback.ts` and the middleware in `app.ts`.
- **Network exposure** — the server binds `127.0.0.1` rather than every interface.

No `Origin`/CORS allowlist was added. It would need to cover the dev, production and e2e origins in both `localhost` and `127.0.0.1` spellings — four-plus entries, each a way to break `make dev` on a port change — to defend against an attack `Host` validation already blocks.

### Post-update corrupt check can misrepresent outcome to client

**Severity:** Suggestion
**Files:** `packages/server/src/chapters/chapters.service.ts` (`updateChapter`), `packages/server/src/chapters/chapters.routes.ts` (the `PATCH /:id` handler)

After PATCH successfully commits an update transaction, the service re-reads the chapter and tests it with `isCorruptChapter` (the internal `content_parse_failed` flag). If the re-parsed content is flagged as corrupt (e.g., due to a bug in the JSON roundtrip or DB layer), the endpoint returns 500 even though the update committed. The client would show a save error for a save that actually succeeded.

**What's needed:** Consider constructing the response from the known-valid `parsed.data` merged with the DB row's metadata, or at minimum log a critical error if this path is hit (since it would indicate a serious bug, not user-facing content corruption).

### CORRUPT_CONTENT triggers pointless save retries

**Severity:** Suggestion
**Files:** `packages/client/src/hooks/useProjectEditor.ts:92-98`

The save retry logic breaks immediately on 4xx errors but retries on 5xx. A `CORRUPT_CONTENT` 500 response triggers 3 retries with 14s total backoff even though the content hasn't changed and retrying is futile.

**What's needed:** Either break on specific 5xx error codes like `CORRUPT_CONTENT`, or have the server return 4xx for corrupt content (since the issue is with the stored data, not a transient server failure).

### handleStatusChange throws unlike sibling handlers

**Severity:** Suggestion
**Files:** `packages/client/src/hooks/useProjectEditor.ts:278`

After reverting the optimistic update on failure, `handleStatusChange` re-throws the error. Every other handler in the hook (`handleSave`, `handleCreateChapter`, `handleDeleteChapter`, etc.) catches internally and calls `setError`. The single call site wraps it in `handleStatusChangeWithError`, but the inconsistent API is a footgun for future callers.

**What's needed:** Either handle the error internally (consistent with siblings) or document the throw contract clearly.

### TipTapDocSchema accepts arbitrary nested content

**Severity:** Suggestion
**Files:** `packages/shared/src/schemas.ts:16-21`

`TipTapDocSchema` uses `.passthrough()` and validates `content` as `z.array(z.record(z.unknown()))`. Any JSON structure with `type: "doc"` is accepted. Malformed-but-valid JSON is silently stored and `countWords` returns 0. If content is rendered via `generateHTML()` for preview/export, unknown node types or unexpected attributes could be a concern.

**What's needed:** Add minimal structural validation (e.g., check that content array items have a `type` field matching known TipTap node types). Consider a max depth/size check on the content JSON. Verify that `generateHTML()` only renders known node types (implicit sanitization).

### resolveUniqueSlug uses sequential queries

**Severity:** Suggestion
**Files:** `packages/server/src/routes/resolve-slug.ts:18-25`

The slug resolution loop issues up to 1000 individual SELECT queries to find a unique suffix. Each runs inside a transaction (called from project creation and chapter restore). With SQLite this is fast (in-process), but a single `SELECT slug FROM projects WHERE slug LIKE 'base-slug%' AND deleted_at IS NULL` query computing the next suffix in application code would be more efficient.

**What's needed:** Replace the loop with a single prefix-match query. Low priority since slug collisions beyond a handful are rare in practice.
