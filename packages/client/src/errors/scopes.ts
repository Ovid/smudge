import type { ApiRequestError } from "../api/client";
import { STRINGS } from "../strings";
import {
  SEARCH_ERROR_CODES,
  SNAPSHOT_ERROR_CODES,
  OUTTAKE_ERROR_CODES,
  LABEL_MAX_UNITS,
} from "@smudge/shared";

// F-13: ScopeEntry lives here (with the SCOPES registry it types) rather
// than in apiErrorMapper.ts, so scopes.ts no longer type-imports from
// apiErrorMapper — removing the madge-flagged circular dependency. It
// depends only on ApiRequestError; apiErrorMapper.ts re-exports it for
// existing consumers.
export type ScopeEntry = {
  fallback: string;
  committed?: string;
  network?: string;
  byCode?: Partial<Record<string, string>>;
  byStatus?: Partial<Record<number, string>>;
  extrasFrom?: (err: ApiRequestError) => Record<string, unknown> | undefined;
  // S8 (review 2026-04-24): codes whose byCode hit also means "the
  // server committed the mutation but couldn't serialize the row" —
  // e.g. RESTORE_READ_FAILURE on trash.restoreChapter,
  // READ_AFTER_CREATE_FAILURE on chapter.create. Listing them here
  // lets the mapper surface possiblyCommitted=true for these codes
  // too, so call sites don't have to re-implement the inline ladder
  // `possiblyCommitted || err.code === "RESTORE_READ_FAILURE"`. Adding
  // a new committed-intent code in the future means updating the scope
  // alone rather than every call site.
  committedCodes?: string[];
  // S3/S7 (4b.3c.1): codes whose byCode hit means the save loop must
  // break and lock the editor without retrying. chapter.save's
  // BAD_JSON / UPDATE_READ_FAILURE / CORRUPT_CONTENT triple lives here
  // instead of inline in useProjectEditor.handleSave. Adding a fourth
  // terminal code is a single-line scope edit.
  terminalCodes?: string[];
  // S1 (agentic-review 2026-05-26): byStatus analogue of terminalCodes.
  // Lets a scope declare that certain HTTP statuses are terminal even
  // when no byCode entry matches (e.g. a reverse-proxy 404 with no
  // envelope). chapter.save's `terminalStatuses: [404]` closes the
  // structural asymmetry that previously forced
  // useProjectEditor.handleSave to hand-code `status === 404` alongside
  // the code-name list. Adding a new terminal status is now a one-line
  // scope edit, matching terminalCodes' promise on the byStatus axis.
  terminalStatuses?: number[];
};

// S4 (review 2026-04-25 round 3): surrogate-safe truncation that bounds
// work at `max` iterations rather than materializing the full string into
// an array. Iterates code points (not UTF-16 code units), so cannot split
// a surrogate pair into a lone surrogate (which the DOM would render as
// U+FFFD). Used by image.delete extrasFrom; safe to extend to other
// hostile-input boundaries that need the same guarantee.
function truncateCodePoints(s: string, max: number): string {
  let result = "";
  let count = 0;
  for (const cp of s) {
    if (count >= max) break;
    result += cp;
    count++;
  }
  return result;
}

// I3 (dedup review 2026-07-26): codes PATCH /api/chapters/:id can emit that
// mean "the write landed; only the read-back failed". chapters.service.ts
// throws UPDATE_READ_FAILURE UNCONDITIONALLY — it does not care which field was
// in the update — so it can reach ANY scope fronting that endpoint, not just
// chapter.save. (Contrast CORRUPT_CONTENT, correctly absent from rename and
// updateStatus because the service gates it on `content !== undefined`.)
//
// Shared here so a fourth caller of the endpoint cannot silently omit it; the
// forcing check is the CHAPTER_PATCH_SCOPES table in apiErrorMapper.test.ts.
// Each scope still supplies its OWN byCode copy — the policy is shared, the
// wording is not.
const CHAPTER_PATCH_COMMITTED_CODES = ["UPDATE_READ_FAILURE"];

export type ApiErrorScope =
  | "project.load"
  | "projectList.load"
  | "project.create"
  | "project.delete"
  | "project.updateTitle"
  | "project.updateFields"
  | "chapter.load"
  | "chapter.save"
  | "chapter.create"
  | "chapter.delete"
  | "chapter.flushBeforeNavigate"
  | "chapter.rename"
  | "chapter.reorder"
  | "chapter.updateStatus"
  | "chapterStatus.fetch"
  | "image.list"
  | "image.references"
  | "image.upload"
  | "image.delete"
  | "image.updateMetadata"
  | "snapshot.restore"
  | "snapshot.view"
  | "snapshot.list"
  | "snapshot.create"
  | "snapshot.delete"
  | "outtake.list"
  | "outtake.create"
  | "outtake.update"
  | "outtake.delete"
  | "findReplace.search"
  | "findReplace.replace"
  | "export.run"
  | "trash.load"
  | "trash.restoreChapter"
  | "settings.update"
  | "settings.get"
  | "dashboard.load"
  | "project.velocity";

export const SCOPES = {
  "project.load": {
    fallback: STRINGS.error.loadProjectFailed,
    network: STRINGS.error.loadProjectFailedNetwork,
  },
  "projectList.load": {
    fallback: STRINGS.error.loadFailed,
    network: STRINGS.error.loadFailedNetwork,
  },
  "project.create": {
    fallback: STRINGS.error.createFailed,
    // I12 (review 2026-04-24): add the transient-retry copy so NETWORK
    // errors get the "check your connection" hint instead of the
    // generic fallback. Applies to all mutation scopes that declare
    // committed: — siblings below mirror this.
    network: STRINGS.error.createFailedNetwork,
    committed: STRINGS.error.possiblyCommitted,
    byCode: { PROJECT_TITLE_EXISTS: STRINGS.error.projectTitleExists },
  },
  "project.delete": {
    fallback: STRINGS.error.deleteFailed,
    network: STRINGS.error.deleteFailedNetwork,
    committed: STRINGS.error.possiblyCommitted,
  },
  "project.updateTitle": {
    fallback: STRINGS.error.updateTitleFailed,
    network: STRINGS.error.updateTitleFailedNetwork,
    committed: STRINGS.error.updateTitleResponseUnreadable,
    byCode: { PROJECT_TITLE_EXISTS: STRINGS.error.projectTitleExists },
    // S4 (review 2026-04-24): the rename endpoint and project.updateFields
    // hit the same PATCH /projects/:slug handler — mirror the 404 string
    // so a project-was-deleted race between rename and save gets the
    // same notFound copy here as sibling field saves.
    byStatus: { 404: STRINGS.projectSettings.saveNotFound },
  },
  "project.updateFields": {
    fallback: STRINGS.projectSettings.saveError,
    network: STRINGS.projectSettings.saveNetworkError,
    committed: STRINGS.projectSettings.saveResponseUnreadable,
    byCode: { VALIDATION_ERROR: STRINGS.projectSettings.saveInvalid },
    byStatus: { 404: STRINGS.projectSettings.saveNotFound },
  },
  "chapter.load": {
    fallback: STRINGS.error.loadChapterFailed,
    network: STRINGS.error.loadChapterFailedNetwork,
  },
  "chapter.save": {
    fallback: STRINGS.editor.saveFailed,
    // I2 (Phase 4b.3a): NETWORK is transient and gets the
    // "check your connection" hint so the user knows a retry is
    // worthwhile. Mirrors sibling mutation scopes — pre-I2 this
    // surfaced the generic saveFailed fallback.
    network: STRINGS.editor.saveFailedNetwork,
    // I5: chapter.save is the app's most load-bearing mutation, so the
    // committed UX gets a save-specific banner (not the generic
    // possiblyCommitted default) that explicitly warns against typing
    // before refresh — continued edits would overwrite the server-
    // committed content.
    committed: STRINGS.editor.saveCommittedUnreadable,
    // I2 (Phase 4b.3a): 404 means the chapter was deleted between
    // auto-save fires (purge, hard-delete, or another tab). Generic
    // saveFailed copy invited a retry that would deterministically
    // 404 again; the chapter-gone copy directs the user to reload.
    // I3 (review 2026-04-26): bare 500 INTERNAL_ERROR exhausts the
    // 4-attempt retry loop in handleSave. Pre-fix, the post-loop
    // fallback surfaced "Save failed. Try again." after ~14s of
    // retries — telling the user to do the thing the client already
    // did 4 times. Map 500 to a server-trouble specific copy so the
    // user sees an accurate signal. Terminal codes
    // (BAD_JSON / UPDATE_READ_FAILURE / CORRUPT_CONTENT) keep their
    // own copy via byCode, which takes precedence over byStatus.
    // S7 (review 2026-04-26): a reverse proxy in front of Smudge can
    // emit 502 (Bad Gateway), 503 (Service Unavailable), or 504
    // (Gateway Timeout) when the upstream is down or overloaded.
    // Same UX as a bare 500 — the server is having trouble. Without
    // these entries, gateway statuses fell through to the generic
    // saveFailed fallback ("Save failed. Try again."), defeating
    // I3's intent the moment Smudge ran behind any reverse proxy.
    byStatus: {
      413: STRINGS.editor.saveFailedTooLarge,
      404: STRINGS.editor.saveFailedChapterGone,
      500: STRINGS.editor.saveFailedServer,
      502: STRINGS.editor.saveFailedServer,
      503: STRINGS.editor.saveFailedServer,
      504: STRINGS.editor.saveFailedServer,
    },
    byCode: {
      VALIDATION_ERROR: STRINGS.editor.saveFailedInvalid,
      // UPDATE_READ_FAILURE is a 500 where the server updated the row
      // but could not re-read it: the save actually committed. Same
      // committed/lock UX as 2xx BAD_JSON.
      UPDATE_READ_FAILURE: STRINGS.editor.saveCommittedUnreadable,
      CORRUPT_CONTENT: STRINGS.editor.saveFailedCorrupt,
    },
    // S8: UPDATE_READ_FAILURE means the server persisted the row but
    // couldn't serialize the response. Surface possiblyCommitted so
    // callers route through the committed/lock path.
    committedCodes: [...CHAPTER_PATCH_COMMITTED_CODES],
    // S3/S7 (4b.3c.1): UPDATE_READ_FAILURE and CORRUPT_CONTENT are 5xx
    // codes the server emits when a chapter PATCH cannot be served
    // safely (the write may have landed; the read-back failed; or the
    // existing content is corrupt). The save loop must break and lock
    // the editor — retrying cannot fix it. Hoisted here so adding a
    // fourth terminal code is a one-line scope edit. BAD_JSON is NOT
    // listed: the mapper's 2xx BAD_JSON branch returns early before
    // byCode-matching, so `terminalCodes: ["BAD_JSON"]` would be dead.
    // The consumer's `mapped.terminal || mapped.possiblyCommitted` OR
    // catches 2xx BAD_JSON via possiblyCommitted instead.
    terminalCodes: ["UPDATE_READ_FAILURE", "CORRUPT_CONTENT"],
    // S1 (agentic-review 2026-05-26): 404 is terminal on the byStatus
    // axis — the chapter is gone server-side (purge, hard-delete, or
    // another tab), retry will deterministically 404 again, and the
    // editor must lock so debounced auto-saves stop firing into a
    // chapter the server has rejected. Covers both the coded NOT_FOUND
    // path AND the bare 404 path (proxy chains that strip the
    // envelope), since byStatus matches regardless of err.code.
    // useProjectEditor.handleSave reads `mapped.terminal` instead of
    // hand-coding the status check — see lock-banner block.
    terminalStatuses: [404],
  },
  "chapter.create": {
    fallback: STRINGS.error.createChapterFailed,
    network: STRINGS.error.createChapterFailedNetwork,
    committed: STRINGS.error.createChapterResponseUnreadable,
    byCode: { READ_AFTER_CREATE_FAILURE: STRINGS.error.createChapterReadAfterFailure },
    // I13 (review 2026-04-24): project soft-deleted between sidebar
    // render and click. Sibling image.upload has the same 404 branch
    // (uploadProjectGone); chapter.create was missing it and surfaced
    // the generic "Failed to create chapter" that invites retry.
    // Backlog 3c4e8f72: the 5xx set mirrors chapter.save's I3 (bare 500)
    // and S7 (reverse-proxy 502/503/504). Without it those statuses fell
    // through to the createChapterFailed fallback, which reads like a
    // client-side problem the user can fix by clicking again.
    byStatus: {
      404: STRINGS.error.createChapterProjectGone,
      500: STRINGS.error.createChapterFailedServer,
      502: STRINGS.error.createChapterFailedServer,
      503: STRINGS.error.createChapterFailedServer,
      504: STRINGS.error.createChapterFailedServer,
    },
    // S8 (review 2026-04-24): the server inserted the row but could
    // not re-read it — treat as committed so consumers surface the
    // committed UX and avoid duplicate-create retries.
    committedCodes: ["READ_AFTER_CREATE_FAILURE"],
  },
  "chapter.delete": {
    fallback: STRINGS.error.deleteChapterFailed,
    network: STRINGS.error.deleteChapterFailedNetwork,
    committed: STRINGS.error.possiblyCommitted,
  },
  "chapter.flushBeforeNavigate": {
    fallback: STRINGS.editor.flushBeforeNavigateFailed,
    network: STRINGS.editor.flushBeforeNavigateFailedNetwork,
  },
  "chapter.rename": {
    fallback: STRINGS.error.renameChapterFailed,
    network: STRINGS.error.renameChapterFailedNetwork,
    committed: STRINGS.error.renameChapterResponseUnreadable,
    // I3: without these, a 500 UPDATE_READ_FAILURE fell through to the
    // retry-inviting fallback while the DB already held the new title —
    // the sidebar kept the old one and nothing reconciled them. The
    // `committed:` copy above was unreachable for this code, since the
    // mapper's 2xx-BAD_JSON early return cannot fire for a 500.
    byCode: { UPDATE_READ_FAILURE: STRINGS.error.renameChapterResponseUnreadable },
    committedCodes: [...CHAPTER_PATCH_COMMITTED_CODES],
  },
  "chapter.reorder": {
    fallback: STRINGS.error.reorderFailed,
    network: STRINGS.error.reorderFailedNetwork,
    committed: STRINGS.error.reorderResponseUnreadable,
    // I1 (Phase 4b.3a): server emits 400 REORDER_MISMATCH when the chapter
    // ID list submitted to PUT /projects/:id/chapters/order doesn't match
    // the current set (count or values — typical cause is a stale list
    // racing a concurrent create/delete). Without a byCode entry the user
    // saw the generic reorderFailed copy that invited retry of the same
    // stale list; the mapped copy tells them to refresh.
    byCode: { REORDER_MISMATCH: STRINGS.error.reorderMismatch },
  },
  "chapter.updateStatus": {
    fallback: STRINGS.error.statusChangeFailed,
    network: STRINGS.error.statusChangeFailedNetwork,
    committed: STRINGS.error.statusChangeResponseUnreadable,
    // I3: same endpoint, same committed-intent code. The status handler's
    // revert branch already self-heals in the common case (its recovery
    // GET adopts the server's truth, which for this code IS the newly
    // written status), but the local-revert arm — reached when that GET
    // also fails — would otherwise fight the committed server state.
    byCode: { UPDATE_READ_FAILURE: STRINGS.error.statusChangeResponseUnreadable },
    committedCodes: [...CHAPTER_PATCH_COMMITTED_CODES],
  },
  "chapterStatus.fetch": {
    fallback: STRINGS.error.statusesFetchFailed,
    network: STRINGS.error.statusesFetchFailedNetwork,
  },
  "image.list": {
    fallback: STRINGS.imageGallery.loadFailed,
    network: STRINGS.imageGallery.loadFailedNetwork,
  },
  "image.references": {
    fallback: STRINGS.imageGallery.referencesLoadFailed,
    // S5 (review 2026-04-24): add the transient-retry copy so a NETWORK
    // error gets a "check your connection" message instead of the
    // generic fallback. Mirrors image.list and other GET scopes.
    network: STRINGS.imageGallery.referencesLoadFailedNetwork,
  },
  "image.upload": {
    fallback: STRINGS.imageGallery.uploadFailedGeneric,
    // I3 (2026-04-24 review): 2xx BAD_JSON means the server stored the
    // image but the client couldn't read the row. Generic possiblyCommitted
    // copy left consumers guessing — callers (ImageGallery, Editor paste
    // path) branch on possiblyCommitted to either refresh the gallery
    // (so duplicate uploads on retry don't sneak in) or direct the user
    // to it. The scope-level string tells them what to do.
    committed: STRINGS.imageGallery.uploadCommittedRefresh,
    // F-12: the upload insert runs OUTSIDE a transaction, so a
    // READ_AFTER_INSERT_FAILURE means the row auto-committed and only the
    // confirming re-read failed — the image really is stored and a retry would
    // mint a duplicate. This is the ONE read-after-insert site that earns
    // committed treatment; the outtake and snapshot inserts sit inside
    // transactions and roll back, so their scopes deliberately omit this code.
    // See packages/server/src/errors/readAfterInsert.ts.
    committedCodes: ["READ_AFTER_INSERT_FAILURE"],
    byStatus: {
      413: STRINGS.imageGallery.fileTooLarge,
      // I1 (2026-04-24 review): project was deleted between gallery-open
      // and upload request landing. The generic fallback blamed the
      // network, which is misleading — the request deterministically
      // fails until a new project is selected.
      404: STRINGS.imageGallery.uploadProjectGone,
    },
    byCode: {
      // I1 (agentic review 2026-08-17): `committedCodes` only takes effect on
      // a byCode match — the byStatus and fallback arms of
      // `_resolveErrorInternal` hard-code possiblyCommitted to false. Without
      // this entry the F-12 code above was inert: the 500 fell through to
      // `uploadFailedGeneric`, which invites the retry that mints the
      // duplicate row + blob F-12 exists to prevent (uploads are
      // non-idempotent, CLAUDE.md §F-8). Both entries are required.
      READ_AFTER_INSERT_FAILURE: STRINGS.imageGallery.uploadCommittedRefresh,
      PAYLOAD_TOO_LARGE: STRINGS.imageGallery.fileTooLarge,
      // S2 (code review 2026-08-22): the 413 byStatus arm above says "file too
      // large", which is the wrong advice for a request rejected on part count
      // rather than byte count. The server now discriminates the two.
      // Unreachable from this client today — it posts exactly one part — and
      // live the day a form field is added to the upload.
      UPLOAD_TOO_MANY_PARTS: STRINGS.imageGallery.uploadMalformed,
      MALFORMED_UPLOAD: STRINGS.imageGallery.uploadMalformed,
      // I1 (2026-04-24 review): server 400 for missing file, unsupported
      // MIME, MIME/content mismatch, and empty file. Without a byCode
      // entry the user sees "Check your connection" — which has nothing
      // to do with why the server rejected their file.
      VALIDATION_ERROR: STRINGS.imageGallery.uploadInvalidFile,
    },
  },
  "image.delete": {
    fallback: STRINGS.imageGallery.deleteFailedGeneric,
    network: STRINGS.imageGallery.deleteFailedNetwork,
    committed: STRINGS.error.possiblyCommitted,
    byCode: { IMAGE_IN_USE: STRINGS.imageGallery.deleteBlockedInUse },
    // S8 (4b.3c.1, 2026-05-26): drop-only-malformed. The server contract
    // is the authoritative defense against hostile envelopes; scopes.ts is
    // the second line. Showing 49 valid chapter titles when the server
    // returned 50 (one with a corrupted title) is materially better UX
    // than the generic deleteBlocked fallback with no list. The cap+1
    // window still bounds work at 51 elements; a hostile envelope of
    // [N valid, M bogus] truncates rather than rejects.
    //
    // Earlier review comments referencing I1's all-or-nothing intent are
    // superseded by this trade-off. The cap-boundary case (invalid at
    // index 50 in a 51-entry array) now falls through to the valid filter
    // and returns the 50-entry valid slice rather than rejecting outright.
    // S5 (2026-04-23 review): validate per-element shape, not just that
    // `chapters` is an array. ImageGallery casts elements to
    // {title: string; trashed?: boolean} — a hostile or malformed
    // envelope with array-but-wrong-shape elements would otherwise slip
    // through this narrowing and propagate to the UI via cast.
    // S21 (security review): bound the list against a hostile or malformed
    // server payload — cap at 50 entries and truncate each title at 200
    // chars so a runaway response cannot blow up the UI. Truncation is
    // silent by design; the cap is defense-in-depth (real-world delete
    // envelopes are built in `images.service.ts` `deleteImage`, which
    // calls `listAllChapterContentByProject` for the image's project and
    // includes both active and trashed chapters; >50 referencing chapters
    // is unreachable in normal Smudge use).
    // S3 (review 2026-04-25): construct an explicit allowlisted shape per
    // entry. The previous spread propagated every non-allowlisted server
    // field — a hostile `description` field bypassed the API client's
    // per-key MAX_EXTRAS_KEYS cap because that cap does not recurse into
    // `chapters[i]`.
    // S4 (review 2026-04-25): code-point slice via for...of so the cap
    // cannot split a surrogate pair into a lone surrogate (which the DOM
    // would render as U+FFFD). ASCII inputs are unaffected.
    // S4 (review 2026-04-25 round 3): use a for...of loop with an early
    // break instead of Array.from(...).slice(...).join("") so a hostile
    // multi-megabyte title cannot force allocation of an N-element array
    // before the 200-codepoint cap is applied. Bounds work at O(200).
    // I1 + S2 (review 2026-04-25 round 2): drop `id` entirely from the
    // output. ImageGallery only reads `title` and `trashed`, so `id` was
    // dead plumbing. Leaving it in left an unbounded copy-through that
    // bypassed S21's "30KB max" intent (only `title` was length-capped).
    // The input still validates `id` as string-or-undefined for
    // defense-in-depth — a wrong-type `id` is now silently dropped from
    // the output rather than rejecting the envelope (S8 trade-off above).
    // I2 (review 2026-04-25 round 2): reject `chapters: []` outright. An
    // empty array passes shape narrowing (`Array.isArray` is true) but
    // produces a malformed `S.deleteBlocked([])` announcement
    // ("This image is used in: . Remove..."). Server contract only emits
    // the envelope when `referencingChapters.length > 0`, so this is
    // hostile/malformed territory — but the validator is the right
    // gatekeeper. Post-S8 the same guard fires when every entry is
    // malformed (valid filter empties the list).
    // S1 (review 2026-04-26 round 3 follow-up): also reject any chapter
    // whose `title` is `""`. Empty-string titles pass the round-2
    // empty-array guard (length is non-zero) but produce the same
    // malformed announce — `[{title:""},{title:""}]` →
    // "This image is used in: , . Remove it from those chapters first."
    // Server schema enforces `z.string().trim().min(1)` on chapter titles,
    // so this only fires for hostile envelopes; the validator is still
    // the right gatekeeper.
    // S4 (review 2026-04-26 inline): broaden the empty-string guard to
    // reject whitespace-only titles (e.g. `" "`, `"\t\n"`, U+00A0, etc.).
    // The server's `z.string().trim().min(1)` rejects them on PATCH, so
    // legitimate envelopes never carry them — but a hostile/malformed
    // envelope of `[{title: " "}]` would otherwise reach
    // `S.deleteBlocked([" "])` and produce the same malformed
    // "This image is used in:  . Remove..." announcement that S1 was
    // added to prevent. Use `trim().length === 0` to mirror the server
    // schema; titles whose interior contains whitespace pass through
    // verbatim (no normalization at this layer).
    extrasFrom: (err: ApiRequestError) => {
      const chapters = (err.extras as { chapters?: unknown } | undefined)?.chapters;
      if (!Array.isArray(chapters)) return undefined;
      // S* (review 2026-04-25 round 3): bound input processing at cap+1
      // entries so a hostile envelope of N items cannot drive O(N) filter
      // work. Slicing to 51 before validating bounds the work even before
      // S8 dropped the all-or-nothing reject — under S8 the surplus index
      // (cap+1) only matters for the empty-list fallback (if 51 candidates
      // all fail the per-element shape, we still emit undefined).
      const candidates: unknown[] = chapters.slice(0, 51);
      const valid = candidates.filter(
        (c): c is { id?: string; title: string; trashed?: boolean } => {
          if (!c || typeof c !== "object") return false;
          const obj = c as Record<string, unknown>;
          if (obj.id !== undefined && typeof obj.id !== "string") return false;
          if (typeof obj.title !== "string" || obj.title.trim().length === 0) return false;
          if (obj.trashed !== undefined && typeof obj.trashed !== "boolean") return false;
          return true;
        },
      );
      if (valid.length === 0) return undefined;
      const bounded = valid.slice(0, 50).map((c) => ({
        title: truncateCodePoints(c.title, 200),
        ...(c.trashed !== undefined ? { trashed: c.trashed } : {}),
      }));
      return { chapters: bounded };
    },
  },
  "image.updateMetadata": {
    fallback: STRINGS.imageGallery.saveFailed,
    network: STRINGS.imageGallery.saveFailedNetwork,
    committed: STRINGS.error.possiblyCommitted,
    // S2 (review 2026-08-16): the server emits UPDATE_READ_FAILURE when the
    // metadata UPDATE committed but the read-after-write came back empty —
    // same taxonomy as chapters' PATCH. Without these two entries it fell to
    // `fallback` ("Your changes have not been saved."), which is the opposite
    // of what happened, and possiblyCommitted stayed false so the committed-UX
    // path never fired. `committedCodes` only takes effect on a byCode match,
    // so both are required.
    byCode: { UPDATE_READ_FAILURE: STRINGS.imageGallery.saveCommittedUnreadable },
    committedCodes: ["UPDATE_READ_FAILURE"],
  },
  "snapshot.restore": {
    fallback: STRINGS.snapshots.restoreFailed,
    network: STRINGS.snapshots.restoreNetworkFailed,
    committed: STRINGS.snapshots.restoreResponseUnreadable,
    byCode: {
      [SNAPSHOT_ERROR_CODES.CORRUPT_SNAPSHOT]: STRINGS.snapshots.restoreFailedCorrupt,
      [SNAPSHOT_ERROR_CODES.CROSS_PROJECT_IMAGE_REF]:
        STRINGS.snapshots.restoreFailedCrossProjectImage,
    },
    byStatus: { 404: STRINGS.snapshots.restoreFailedNotFound },
  },
  "snapshot.view": {
    fallback: STRINGS.snapshots.viewFailed,
    network: STRINGS.snapshots.viewFailedNetwork,
    byCode: {
      [SNAPSHOT_ERROR_CODES.CORRUPT_SNAPSHOT]: STRINGS.snapshots.viewFailedCorrupt,
    },
    byStatus: { 404: STRINGS.snapshots.viewFailedNotFound },
  },
  "snapshot.list": {
    // I19 (review 2026-04-24): the old listFailed copy ("Try opening the
    // panel again.") is more actionable than the sibling
    // listFailedGeneric ("Try again.") and was dead after the scope
    // migration. Reuse it here — deleting it would lose the actionable
    // hint that tells the user what to do.
    fallback: STRINGS.snapshots.listFailed,
    // S5: transient-retry copy on NETWORK — mirrors sibling GET scopes.
    network: STRINGS.snapshots.listFailedNetwork,
  },
  "snapshot.create": {
    fallback: STRINGS.snapshots.createFailedGeneric,
    network: STRINGS.snapshots.createFailedNetwork,
    committed: STRINGS.error.possiblyCommitted,
    // F-34: by CODE, not by status — .strict(), validateUuidParam and a
    // non-string label all produce 400 here, so a byStatus[400] arm would put
    // cap copy on three failures that are not the cap. That is the exact
    // mistake S8 had to undo for outtake.update.
    //
    // Unlike outtake.update, this consumer does NOT revert the label field on a
    // definite failure (SnapshotPanel keeps createLabel and only clears it on
    // success or on the committed path), so the harm here is the doomed retry,
    // not vanishing text. Same treatment, different reason — worth stating,
    // because the report's F-34 entry borrows the outtake rationale verbatim
    // and that half of it does not transfer.
    byCode: {
      [SNAPSHOT_ERROR_CODES.LABEL_TOO_LONG]:
        STRINGS.snapshots.createFailedLabelRejected(LABEL_MAX_UNITS),
    },
  },
  "snapshot.delete": {
    fallback: STRINGS.snapshots.deleteFailed,
    network: STRINGS.snapshots.deleteFailedNetwork,
    committed: STRINGS.error.possiblyCommitted,
  },
  "outtake.list": {
    fallback: STRINGS.error.loadOuttakesFailed,
  },
  // Writes: mirror snapshot.create/snapshot.delete — a 2xx BAD_JSON means
  // the server likely committed but the row couldn't be serialized, so the
  // shared possiblyCommitted copy routes callers through the committed UX.
  // No network: override (unlike snapshots) — a NETWORK error is still
  // transient via the fallback message; keeping copy to the four fallbacks
  // the phase specified.
  "outtake.create": {
    fallback: STRINGS.error.createOuttakeFailed,
    committed: STRINGS.error.possiblyCommitted,
    // S1: an oversized capture that trips the express.json limit 413s; the
    // generic fallback invites a doomed retry, so give the same "too large"
    // hint the sibling write scopes carry. Near-unreachable (a captured
    // selection is a subset of a chapter that already fit) — and more so since
    // the blank-note form, the other producer this arm once named, was removed.
    // S3: 404 has exactly one producer on this route (the project was
    // soft-deleted while the editor was open), so a status-keyed arm is safe
    // here — unlike the 400 case that S8 had to move to byCode. The fallback
    // read as transient and invited a retry that 404s identically, forever.
    byStatus: {
      404: STRINGS.error.createOuttakeProjectGone,
      413: STRINGS.error.createOuttakeTooLarge,
    },
  },
  "outtake.update": {
    fallback: STRINGS.error.updateOuttakeFailed,
    committed: STRINGS.error.possiblyCommitted,
    // S5: commitLabel REVERTS the field on a definite failure, so generic copy
    // meant the writer's text vanished with no cause named and a retry
    // reproduced it.
    //
    // S8 (agentic-review 2026-08-04): by CODE, not by status. The premise for
    // byStatus[400] was "the label cap is the only 400 this endpoint emits",
    // and it was wrong twice over — validateUuidParam throws 400 before the
    // schema runs, and UpdateOuttakeSchema.strict() is a second producer. Those
    // reverted the field under copy naming a cause that was not the cause.
    byCode: {
      [OUTTAKE_ERROR_CODES.LABEL_TOO_LONG]:
        STRINGS.error.updateOuttakeLabelRejected(LABEL_MAX_UNITS),
    },
  },
  "outtake.delete": {
    fallback: STRINGS.error.deleteOuttakeFailed,
    // S10: DELETE answers 204, and apiFetch short-circuits before reading a
    // body, so the 2xx-BAD_JSON path that sets possiblyCommitted cannot fire
    // here. Kept deliberately, mirroring snapshot.delete: it is the scope's
    // declaration of what SHOULD happen if the endpoint ever stops being
    // body-less, not a live path. OuttakeCard's onCommitted arm is defensive
    // for the same reason.
    committed: STRINGS.error.possiblyCommitted,
  },
  "findReplace.search": {
    fallback: STRINGS.findReplace.searchFailed,
    network: STRINGS.findReplace.searchNetworkFailed,
    byCode: {
      [SEARCH_ERROR_CODES.MATCH_CAP_EXCEEDED]: STRINGS.findReplace.tooManyMatches,
      [SEARCH_ERROR_CODES.REGEX_TIMEOUT]: STRINGS.findReplace.searchTimedOut,
      [SEARCH_ERROR_CODES.CONTENT_TOO_LARGE]: STRINGS.findReplace.contentTooLarge,
      [SEARCH_ERROR_CODES.INVALID_REGEX]: STRINGS.findReplace.invalidRegex,
    },
    byStatus: {
      400: STRINGS.findReplace.invalidSearchRequest,
      413: STRINGS.findReplace.contentTooLarge,
      404: STRINGS.findReplace.searchProjectNotFound,
    },
  },
  "findReplace.replace": {
    fallback: STRINGS.findReplace.replaceFailed,
    network: STRINGS.findReplace.replaceNetworkFailed,
    committed: STRINGS.findReplace.replaceResponseUnreadable,
    byCode: {
      [SEARCH_ERROR_CODES.MATCH_CAP_EXCEEDED]: STRINGS.findReplace.tooManyMatches,
      [SEARCH_ERROR_CODES.REGEX_TIMEOUT]: STRINGS.findReplace.searchTimedOut,
      [SEARCH_ERROR_CODES.CONTENT_TOO_LARGE]: STRINGS.findReplace.contentTooLarge,
      [SEARCH_ERROR_CODES.INVALID_REGEX]: STRINGS.findReplace.invalidRegex,
      [SEARCH_ERROR_CODES.SCOPE_NOT_FOUND]: STRINGS.findReplace.replaceScopeNotFound,
    },
    byStatus: {
      400: STRINGS.findReplace.invalidReplaceRequest,
      413: STRINGS.findReplace.contentTooLarge,
      404: STRINGS.findReplace.replaceProjectNotFound,
    },
  },
  "export.run": {
    fallback: STRINGS.export.errorFailed,
    // I2 (review 2026-04-25): mirror sibling scopes — NETWORK gets a
    // "check your connection" hint, 413 gets a "too large" hint with
    // recovery guidance. Without these, both paths surfaced the
    // generic errorFailed and the user had no actionable next step.
    network: STRINGS.export.errorFailedNetwork,
    byStatus: { 413: STRINGS.export.errorTooLarge },
  },
  "trash.load": {
    fallback: STRINGS.error.loadTrashFailed,
    network: STRINGS.error.loadTrashFailedNetwork,
  },
  "trash.restoreChapter": {
    fallback: STRINGS.error.restoreChapterFailed,
    network: STRINGS.error.restoreChapterFailedNetwork,
    // I2 (2026-04-24 review): restore-committed UX. 2xx BAD_JSON and 500
    // RESTORE_READ_FAILURE both mean "the chapter was actually restored,
    // the client just can't see the hydrated row." Generic
    // possiblyCommitted copy left users thinking the restore had failed;
    // they retried and hit 409 RESTORE_CONFLICT (slug already present)
    // while the chapter silently came back on reload. A restore-specific
    // string tells them to refresh.
    committed: STRINGS.error.restoreChapterCommitted,
    byCode: {
      PROJECT_PURGED: STRINGS.error.restoreChapterProjectPurged,
      CHAPTER_PURGED: STRINGS.error.restoreChapterAlreadyPurged,
      RESTORE_CONFLICT: STRINGS.error.restoreChapterSlugConflict,
      // Same committed UX as 2xx BAD_JSON — the server did commit the
      // restore; it just couldn't re-read the row for the response body.
      RESTORE_READ_FAILURE: STRINGS.error.restoreChapterCommitted,
    },
    // S1 (review 2026-04-26): a bare 404 (server emits {status:404,
    // code:"NOT_FOUND"} when the deleted chapter row can't be located —
    // e.g. malformed/unknown id, or bulk-purged between trash-list
    // fetch and click) routes here. byCode resolves first, so
    // CHAPTER_PURGED/PROJECT_PURGED keep their dedicated copy.
    // S4 (review 2026-04-26): use the softer "no longer available"
    // copy here rather than restoreChapterAlreadyPurged. The latter
    // claims permanence ("permanently deleted") which is accurate
    // only for CHAPTER_PURGED — stale-URL and never-existed cases
    // surface the same bare 404 with no discriminating code, so a
    // copy that doesn't make a permanence claim is correct across
    // all of them. Distinct STRINGS key so a future regression that
    // accidentally swaps the byStatus copy back to the byCode copy
    // would be caught by the test below.
    byStatus: { 404: STRINGS.error.restoreChapterUnavailable },
    // S8: RESTORE_READ_FAILURE surfaces possiblyCommitted so
    // useTrashManager doesn't need the inline code check.
    committedCodes: ["RESTORE_READ_FAILURE"],
  },
  "settings.update": {
    fallback: STRINGS.error.settingsUpdateFailedGeneric,
    network: STRINGS.error.settingsUpdateFailedNetwork,
    committed: STRINGS.error.possiblyCommitted,
  },
  "settings.get": {
    fallback: STRINGS.error.settingsLoadFailed,
    network: STRINGS.error.settingsLoadFailedNetwork,
  },
  "dashboard.load": {
    fallback: STRINGS.error.loadDashboardFailed,
    network: STRINGS.error.loadDashboardFailedNetwork,
  },
  "project.velocity": {
    fallback: STRINGS.velocity.loadError,
    network: STRINGS.velocity.loadErrorNetwork,
  },
} satisfies Record<ApiErrorScope, ScopeEntry>;
