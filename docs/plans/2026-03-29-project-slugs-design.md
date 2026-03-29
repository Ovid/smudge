# Project Slugs: Replace UUIDs in URLs

## Goal

Replace UUID-based project URLs (`/projects/0c0e478b-...`) with human-readable slugs (`/projects/my-novel`). Single-user app, no two projects may share a name, so slugs are unique by definition.

## Key Decisions

- **Projects only.** Chapters remain internal state, no URL change.
- **Slug always mirrors title.** Renaming a project updates the slug. No redirect history.
- **Transliterate accents.** `cafe` not `café` in URLs.
- **API uses slugs too.** All project endpoints switch from `:id` to `:slug`.
- **UUID stays as internal PK.** Slug is a separate unique indexed column. Foreign keys unchanged.

## Data Layer

New migration adds `slug TEXT NOT NULL UNIQUE` to the `projects` table with an index. Backfills existing projects by generating slugs from current titles.

Uniqueness is enforced at both DB level (unique constraint) and application level (check before create/rename, return `PROJECT_TITLE_EXISTS` error).

UUIDs remain the primary key. `chapters.project_id` still references UUIDs. Slugs are purely external-facing.

## Slug Generation

`generateSlug(title: string): string` lives in `packages/shared`.

Algorithm:

1. `normalize('NFD')` to decompose accented characters, strip combining marks (`\u0300-\u036f`)
2. Lowercase
3. Replace any non-alphanumeric character with a hyphen
4. Collapse consecutive hyphens
5. Trim leading/trailing hyphens
6. If result is empty, fall back to `"untitled"`

No external dependencies. Built-in string methods and regexes only.

## Server API Changes

All project endpoints switch from `:id` (UUID) to `:slug`:

- `GET /api/projects/:slug`
- `PATCH /api/projects/:slug` — regenerates slug on title change, returns new slug
- `DELETE /api/projects/:slug`
- `GET /api/projects/:slug/trash`
- `POST /api/projects/:slug/chapters`
- `PUT /api/projects/:slug/chapters/order`

`POST /api/projects` (create) returns the new `slug` in the response.

On rename, if the new title conflicts: `400 { "error": { "code": "PROJECT_TITLE_EXISTS", "message": "A project with that title already exists" } }`.

Chapter endpoints remain UUID-based (`/api/chapters/:id`).

## Client Changes

**Routing:** `/projects/:slug` replaces `/projects/:projectId` in `App.tsx`.

**API client:** All `api.projects.*` methods that accept a project identifier switch from UUID to slug.

**Navigation:** `HomePage` navigates to `/projects/${project.slug}`. `EditorPage` extracts `slug` from `useParams` and calls `api.projects.get(slug)`.

**Rename handling:** `PATCH` response includes new slug. Client calls `navigate('/projects/${newSlug}', { replace: true })` to update URL without adding a history entry.

**Shared types:** Add `slug: string` to the `Project` interface in `packages/shared`.

## Scope

- 1 new migration (add slug column, backfill existing projects)
- 1 new shared utility (`generateSlug`)
- Update shared types (add `slug` to `Project`)
- Update server routes (swap `:id` for `:slug` on project endpoints)
- Update client (routing, API client, navigation, rename handling)
- Tests for all of the above
