# Scratchpad / Outtakes (Phase 4c.2) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a per-project **Outtakes drawer** — a reference-panel tab that stores cut/stashed text as TipTap JSON, with non-destructive capture (copy-selection + manual), insert-back-to-editor, client-side filter, and hard-delete — excluded from word count, export, and search by table separation.

**Architecture:** Clone the existing `ChapterSnapshot` server stack into a new `outtakes/` domain scoped to `project_id` (migration 015, repository → `OuttakesStore` facade slice → service → routes). Add two shared helpers (`stripImageNodes`, `toPlainText`) and two Zod schemas. The client gets an `api.outtakes` block, error scopes, strings, an `OuttakesPanel` + `OuttakeCard`, a second reference-panel tab, and one non-destructive editor entry point (a toolbar "Send selection to outtakes" copy button) plus an insert-at-cursor action. **No** `word_count` column (client computes), **no** `deleted_at` (hard delete). The destructive one-click "cut" is explicitly out of scope (Phase 4c.2a).

**Tech Stack:** TypeScript monorepo (`shared`/`server`/`client`), better-sqlite3 + Knex, Zod, Express 4, React 18 + TipTap v2 + Vite, Vitest + Supertest, Playwright + aXe.

**Design:** `docs/plans/2026-07-19-scratchpad-outtakes-design.md` (read it — §14 lists the pushback resolutions this plan honors).

**Conventions (CLAUDE.md — non-negotiable):**
- RED-GREEN-REFACTOR every task; integration tests against real SQLite, never mocks.
- Coverage floors: 95% stmt / 85% branch / 90% fn / 95% line. Aim higher.
- Zero warnings in test output. Client console assertions **only** via `expectConsole()` (raw `vi.spyOn(console, …)` is ESLint-banned).
- All client UI strings in `packages/client/src/strings.ts` (ESLint-enforced; no word-bearing JSX/aria literals).
- Client API errors route through `mapApiError`/`applyMappedError` + a `scopes.ts` entry per surface.
- One PR = Phase 4c.2. Do **not** implement the destructive cut (4c.2a).

---

## Phase A — Shared package (`packages/shared`)

### Task A1: `OuttakeRow` wire type

**Files:**
- Modify: `packages/shared/src/types.ts` (near `SnapshotRow`, line ~77)

**Step 1 — Add the type** (no test needed; a pure interface is exercised by every consumer test downstream):

```ts
/** An outtake: cut/stashed text stored as TipTap JSON, per project. */
export interface OuttakeRow {
  id: string;
  project_id: string;
  label: string | null;
  content: Record<string, unknown>; // parsed TipTap doc on the wire
  created_at: string;
  updated_at: string;
}
```

> Note: the DB stores `content` as stringified JSON; the repository parses it on read so the wire type is a parsed object (mirrors how the server returns snapshot content). Confirm the read path parses (Task B3).

**Step 2 — Typecheck:** `npm run -w packages/shared typecheck` → PASS.

**Step 3 — Commit:** `git add -A && git commit -m "feat(4c.2): OuttakeRow wire type"`

---

### Task A2: `toPlainText(doc)` shared helper

TipTap-JSON → plain text with **newline** separation between block-level nodes (paragraphs), so (a) Copy preserves paragraph breaks and (b) the panel filter cannot match a phantom substring spanning a block boundary. This is a *new* walker — the existing `extractText` in `wordcount.ts` joins blocks with a single space and is private; do not reuse it verbatim.

**Files:**
- Create: `packages/shared/src/tiptap-plaintext.ts`
- Create: `packages/shared/src/__tests__/tiptap-plaintext.test.ts`
- Modify: `packages/shared/src/index.ts` (add `export { toPlainText } from "./tiptap-plaintext";`)

**Step 1 — Failing test:**

```ts
import { describe, it, expect } from "vitest";
import { toPlainText } from "../tiptap-plaintext";

const doc = (content: unknown[]) => ({ type: "doc", content });
const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

describe("toPlainText", () => {
  it("joins block-level nodes with a newline", () => {
    expect(toPlainText(doc([para("Hello"), para("World")]))).toBe("Hello\nWorld");
  });

  it("concatenates adjacent inline text without a separator", () => {
    expect(
      toPlainText(doc([{ type: "paragraph", content: [
        { type: "text", text: "foo" }, { type: "text", text: "bar" },
      ] }])),
    ).toBe("foobar");
  });

  it("does not produce a phantom cross-block match", () => {
    // 'oW' spans the para boundary; with newline separation it must not appear.
    expect(toPlainText(doc([para("Hello"), para("World")])).includes("oW")).toBe(false);
  });

  it("returns '' for null / empty doc", () => {
    expect(toPlainText(null)).toBe("");
    expect(toPlainText(doc([]))).toBe("");
  });

  it("caps recursion at MAX_TIPTAP_DEPTH without throwing", () => {
    let node: any = { type: "text", text: "deep" };
    for (let i = 0; i < 200; i++) node = { type: "paragraph", content: [node] };
    expect(() => toPlainText(doc([node]))).not.toThrow();
  });
});
```

**Step 2 — Run, expect FAIL:** `npm test -w packages/shared -- tiptap-plaintext` → module not found.

**Step 3 — Implement:**

```ts
import { MAX_TIPTAP_DEPTH } from "./tiptap-safety";

type Node = { type?: string; text?: string; content?: Node[] };

// Block-level node types that should be newline-separated in plain text.
const BLOCK_TYPES = new Set([
  "paragraph", "heading", "blockquote", "listItem", "codeBlock", "horizontalRule",
]);

function walk(node: Node, depth: number, out: string[]): void {
  if (depth > MAX_TIPTAP_DEPTH) return;
  if (typeof node.text === "string") {
    out.push(node.text);
    return;
  }
  const isBlock = node.type ? BLOCK_TYPES.has(node.type) : false;
  if (isBlock && out.length > 0 && !out[out.length - 1].endsWith("\n")) {
    out.push("\n");
  }
  for (const child of node.content ?? []) walk(child, depth + 1, out);
  if (isBlock && out.length > 0 && !out[out.length - 1].endsWith("\n")) {
    out.push("\n");
  }
}

/** TipTap JSON → plain text, blocks separated by "\n". Empty/null → "". */
export function toPlainText(doc: Record<string, unknown> | null): string {
  if (!doc) return "";
  const out: string[] = [];
  walk(doc as Node, 0, out);
  return out.join("").replace(/\n+/g, "\n").replace(/^\n|\n$/g, "");
}
```

**Step 4 — Run, expect PASS.** **Step 5 — Commit:** `feat(4c.2): shared toPlainText helper (newline-separated blocks)`

---

### Task A3: `stripImageNodes(doc)` shared helper

Removes `type: "image"` nodes from a TipTap doc. Used authoritatively in the service and best-effort on the client at capture, so an outtake can never retain an image (which the image GC/ref-counter — scanning only `chapters` — cannot see).

**Files:**
- Create: `packages/shared/src/tiptap-images.ts`
- Create: `packages/shared/src/__tests__/tiptap-images.test.ts`
- Modify: `packages/shared/src/index.ts` (`export { stripImageNodes } from "./tiptap-images";`)

**Step 1 — Failing test:**

```ts
import { describe, it, expect } from "vitest";
import { stripImageNodes } from "../tiptap-images";

describe("stripImageNodes", () => {
  it("drops image nodes but keeps surrounding content", () => {
    const doc = { type: "doc", content: [
      { type: "paragraph", content: [
        { type: "text", text: "before" },
        { type: "image", attrs: { src: "/api/images/x.png" } },
        { type: "text", text: "after" },
      ] },
    ] };
    const out = stripImageNodes(doc);
    const json = JSON.stringify(out);
    expect(json).not.toContain("image");
    expect(json).toContain("before");
    expect(json).toContain("after");
  });

  it("returns a doc even when everything was an image", () => {
    const doc = { type: "doc", content: [{ type: "image", attrs: { src: "/x" } }] };
    expect(stripImageNodes(doc)).toEqual({ type: "doc", content: [] });
  });

  it("caps recursion at MAX_TIPTAP_DEPTH without throwing", () => {
    let node: any = { type: "text", text: "x" };
    for (let i = 0; i < 200; i++) node = { type: "paragraph", content: [node] };
    expect(() => stripImageNodes({ type: "doc", content: [node] })).not.toThrow();
  });
});
```

**Step 2 — Run, expect FAIL.**

**Step 3 — Implement** (pure, returns a new doc; caps depth like the other walkers):

```ts
import { MAX_TIPTAP_DEPTH } from "./tiptap-safety";

type Node = { type?: string; content?: Node[]; [k: string]: unknown };

function strip(node: Node, depth: number): Node | null {
  if (node.type === "image") return null;
  if (depth > MAX_TIPTAP_DEPTH || !Array.isArray(node.content)) return node;
  const content = node.content
    .map((c) => strip(c, depth + 1))
    .filter((c): c is Node => c !== null);
  return { ...node, content };
}

/** Returns a copy of `doc` with all image nodes removed. */
export function stripImageNodes(doc: Record<string, unknown>): Record<string, unknown> {
  const result = strip(doc as Node, 0);
  return (result ?? { type: "doc", content: [] }) as Record<string, unknown>;
}
```

**Step 4 — Run, expect PASS.** **Step 5 — Commit:** `feat(4c.2): shared stripImageNodes helper`

---

### Task A4: Outtake Zod schemas

**Files:**
- Modify: `packages/shared/src/schemas.ts` (after `CreateSnapshotSchema`, line ~198)
- Modify: `packages/shared/src/index.ts` if schemas are re-exported there (check how `CreateSnapshotSchema` is exported and mirror it)
- Create/modify test: `packages/shared/src/__tests__/schemas.test.ts` (add a describe block)

**Step 1 — Failing test:**

```ts
import { CreateOuttakeSchema, UpdateOuttakeSchema } from "../schemas";

describe("CreateOuttakeSchema", () => {
  const doc = { type: "doc", content: [{ type: "paragraph" }] };
  it("accepts content with an optional label", () => {
    expect(CreateOuttakeSchema.safeParse({ content: doc }).success).toBe(true);
    expect(CreateOuttakeSchema.safeParse({ content: doc, label: "Cut scene" }).success).toBe(true);
  });
  it("rejects unknown keys (strict)", () => {
    expect(CreateOuttakeSchema.safeParse({ content: doc, word_count: 5 }).success).toBe(false);
  });
  it("rejects a non-TipTap content", () => {
    expect(CreateOuttakeSchema.safeParse({ content: 42 }).success).toBe(false);
  });
});

describe("UpdateOuttakeSchema", () => {
  it("accepts a label (string or null) and rejects other keys", () => {
    expect(UpdateOuttakeSchema.safeParse({ label: "x" }).success).toBe(true);
    expect(UpdateOuttakeSchema.safeParse({ label: null }).success).toBe(true);
    expect(UpdateOuttakeSchema.safeParse({ content: {} }).success).toBe(false);
  });
});
```

**Step 2 — Run, expect FAIL.**

**Step 3 — Implement** (reuse `TipTapDocSchema` and the existing `sanitizeSnapshotLabel` label sanitizer):

```ts
export const CreateOuttakeSchema = z
  .object({
    content: TipTapDocSchema,
    label: z.string().transform(sanitizeSnapshotLabel).nullish(),
  })
  .strict();

export const UpdateOuttakeSchema = z
  .object({
    label: z.string().transform(sanitizeSnapshotLabel).nullable(),
  })
  .strict();
```

> `sanitizeSnapshotLabel` already exists (line ~134) — its name is snapshot-flavored but the behavior (trim + cap graphemes + strip control chars) is a generic label sanitizer. Reusing it avoids a second sanitizer; if a reviewer objects to the name, a follow-up rename is trivial. Do not add a new sanitizer in this PR.

**Step 4 — Run, expect PASS.** **Step 5 — Commit:** `feat(4c.2): CreateOuttakeSchema + UpdateOuttakeSchema`

---

## Phase B — Server package (`packages/server`)

### Task B1: Migration `015_create_outtakes.js`

**Files:**
- Create: `packages/server/src/db/migrations/015_create_outtakes.js`
- Test: add to the migrations test suite (find how `014` is covered — likely a structural/migrations test; mirror it). If there is a `migrationStructuralCheck.test.ts`, add `outtakes` to the expected-tables assertion.

**Step 1 — Failing test** (assert the table + columns exist after migrate; mirror the snapshot migration test if one exists, else add an integration test that migrates a fresh in-memory DB and inspects the schema):

```ts
// packages/server/src/db/__tests__/migration-015-outtakes.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeTestDb } from "../../test-helpers/db"; // use the existing test-db helper; grep for it
import type { Knex } from "knex";

describe("migration 015 outtakes", () => {
  let db: Knex;
  beforeAll(async () => { db = await makeTestDb(); }); // runs all migrations
  afterAll(async () => { await db.destroy(); });

  it("creates the outtakes table with the expected columns", async () => {
    const cols = await db("outtakes").columnInfo();
    expect(Object.keys(cols).sort()).toEqual(
      ["content", "created_at", "id", "label", "project_id", "updated_at"].sort(),
    );
  });

  it("has no word_count or deleted_at column", async () => {
    const cols = await db("outtakes").columnInfo();
    expect(cols).not.toHaveProperty("word_count");
    expect(cols).not.toHaveProperty("deleted_at");
  });
});
```

> Grep for the existing test-DB helper (`makeTestDb` / `createTestDb` / a Knex fixture used by `snapshots.repository` tests) and use it verbatim — do NOT invent a new DB harness.

**Step 2 — Run, expect FAIL** (no such table).

**Step 3 — Implement** (clone `014`, swap FK to projects, drop `is_auto`/`word_count`, add `updated_at`):

```js
export async function up(knex) {
  await knex.schema.createTable("outtakes", (table) => {
    table.text("id").primary();
    table
      .text("project_id")
      .notNullable()
      .references("id")
      .inTable("projects")
      .onDelete("CASCADE");
    table.text("label");
    table.text("content").notNullable();
    table.text("created_at").notNullable();
    table.text("updated_at").notNullable();
    table.index(["project_id", "created_at"]);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists("outtakes");
}
```

**Step 4 — Run, expect PASS.** **Step 5 — Commit:** `feat(4c.2): migration 015 create outtakes table`

---

### Task B2: Server-internal insert shape

**Files:**
- Create: `packages/server/src/outtakes/outtakes.types.ts`

```ts
// Wire-shape type lives in @smudge/shared so client and server agree.
export type { OuttakeRow } from "@smudge/shared";

/** Server-internal insertion shape for the outtakes table. */
export interface CreateOuttakeData {
  id: string;
  project_id: string;
  label: string | null;
  content: string; // stringified TipTap JSON at the persistence boundary
  created_at: string;
  updated_at: string;
}
```

**Commit:** `feat(4c.2): outtakes server-internal insert type`

---

### Task B3: `outtakes.repository.ts`

**Files:**
- Create: `packages/server/src/outtakes/outtakes.repository.ts`
- Create: `packages/server/src/outtakes/__tests__/outtakes.repository.test.ts`

**Step 1 — Failing test** (real SQLite; mirror `snapshots.repository.test.ts` setup):

```ts
// setup: makeTestDb(), insert a project row, then:
it("inserts and re-reads a row with parsed content", async () => {
  const row = await insert(db, {
    id: "11111111-1111-1111-1111-111111111111",
    project_id: projectId,
    label: "Cut scene",
    content: JSON.stringify({ type: "doc", content: [] }),
    created_at: NOW, updated_at: NOW,
  });
  expect(row.label).toBe("Cut scene");
  expect(row.content).toEqual({ type: "doc", content: [] }); // parsed, not string
});

it("lists by project newest-first", async () => { /* insert two, assert order */ });
it("updateLabel changes label + updated_at", async () => { /* ... */ });
it("remove hard-deletes", async () => { /* remove → findById null */ });
```

**Step 2 — Run, expect FAIL.**

**Step 3 — Implement:**

```ts
import type { Knex } from "knex";
import type { OuttakeRow, CreateOuttakeData } from "./outtakes.types";

const TABLE = "outtakes";

// DB stores content as text; the wire type is a parsed object.
function parseRow(row: Record<string, unknown>): OuttakeRow {
  return { ...(row as any), content: JSON.parse(row.content as string) };
}

export async function insert(db: Knex, data: CreateOuttakeData): Promise<OuttakeRow> {
  await db(TABLE).insert(data);
  const row = await db(TABLE).where({ id: data.id }).first();
  if (!row) throw new Error(`Outtake ${data.id} not found after insert`);
  return parseRow(row);
}

export async function findById(db: Knex, id: string): Promise<OuttakeRow | null> {
  const row = await db(TABLE).where({ id }).first();
  return row ? parseRow(row) : null;
}

export async function listByProject(db: Knex, projectId: string): Promise<OuttakeRow[]> {
  const rows = await db(TABLE)
    .where({ project_id: projectId })
    .orderBy([{ column: "created_at", order: "desc" }, { column: "id", order: "desc" }]);
  return rows.map(parseRow);
}

export async function updateLabel(
  db: Knex, id: string, label: string | null, updatedAt: string,
): Promise<OuttakeRow | null> {
  await db(TABLE).where({ id }).update({ label, updated_at: updatedAt });
  return findById(db, id);
}

export async function remove(db: Knex, id: string): Promise<number> {
  return db(TABLE).where({ id }).del();
}
```

**Step 4 — Run, expect PASS.** **Step 5 — Commit:** `feat(4c.2): outtakes repository`

---

### Task B4: `OuttakesStore` facade slice + delegation

**Files:**
- Modify: `packages/server/src/stores/project-store.types.ts` (add slice interface + add to `ProjectStore extends …`, line ~140)
- Modify: `packages/server/src/stores/sqlite-project-store.ts` (import `* as outtakesRepo`, add a `// --- Outtakes ---` block, ~line 259 near snapshots)

**Step 1 — Slice interface:**

```ts
export interface OuttakesStore {
  insertOuttake(data: CreateOuttakeData): Promise<OuttakeRow>;
  findOuttakeById(id: string): Promise<OuttakeRow | null>;
  listOuttakesByProject(projectId: string): Promise<OuttakeRow[]>;
  updateOuttakeLabel(id: string, label: string | null, updatedAt: string): Promise<OuttakeRow | null>;
  deleteOuttake(id: string): Promise<number>;
}
```
Add `OuttakesStore` to the `ProjectStore` composite interface's `extends` list, and import `CreateOuttakeData`/`OuttakeRow` from `../outtakes/outtakes.types`.

**Step 2 — Delegation** in `sqlite-project-store.ts`:

```ts
import * as outtakesRepo from "../outtakes/outtakes.repository";
// ...
// --- Outtakes ---
insertOuttake(data: CreateOuttakeData) { return outtakesRepo.insert(this.db, data); }
findOuttakeById(id: string) { return outtakesRepo.findById(this.db, id); }
listOuttakesByProject(projectId: string) { return outtakesRepo.listByProject(this.db, projectId); }
updateOuttakeLabel(id: string, label: string | null, updatedAt: string) {
  return outtakesRepo.updateLabel(this.db, id, label, updatedAt);
}
deleteOuttake(id: string) { return outtakesRepo.remove(this.db, id); }
```

**Step 3 — Typecheck:** `npm run -w packages/server typecheck` → PASS (TS forces all three edits to line up). **Step 4 — Commit:** `feat(4c.2): OuttakesStore facade slice + delegation`

---

### Task B5: `outtakes.service.ts`

**Files:**
- Create: `packages/server/src/outtakes/outtakes.service.ts`
- Create: `packages/server/src/outtakes/__tests__/outtakes.service.test.ts`

Behavior: create validates + **strips images** + inserts under a transaction, 404 if the parent project is soft-deleted (`findProjectById` filters `deleted_at IS NULL`); list/update/delete enforce the same parent-liveness. No word count, no chapter writes, no velocity calls.

**Step 1 — Failing tests** (real SQLite via the store; init the injectable store with a test DB — mirror how `snapshots.service.test.ts` sets up `initProjectStore`):

```ts
it("createOuttake strips image nodes and stores parsed content", async () => {
  const content = { type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "keep" }] },
    { type: "image", attrs: { src: "/api/images/x.png" } },
  ] };
  const out = await OuttakesService.createOuttake(projectId, content, "Label");
  expect(JSON.stringify(out!.content)).not.toContain("image");
  expect(JSON.stringify(out!.content)).toContain("keep");
});

it("createOuttake returns null when the project is soft-deleted", async () => {
  await softDeleteProject(projectId);
  expect(await OuttakesService.createOuttake(projectId, EMPTY_DOC)).toBeNull();
});

it("listOuttakes returns null for a soft-deleted project", async () => { /* ... */ });
it("updateOuttakeLabel bumps updated_at and returns the row", async () => { /* ... */ });
it("deleteOuttake hard-deletes and returns true; false for unknown id", async () => { /* ... */ });
```

**Step 2 — Run, expect FAIL.**

**Step 3 — Implement:**

```ts
import { randomUUID as uuidv4 } from "node:crypto";
import { stripImageNodes } from "@smudge/shared";
import { getProjectStore } from "../stores/project-store.injectable";
import type { OuttakeRow } from "./outtakes.types";

/** Create an outtake for a live project. Returns null if the project is gone/trashed. */
export async function createOuttake(
  projectId: string,
  content: Record<string, unknown>,
  label?: string | null,
): Promise<OuttakeRow | null> {
  const store = getProjectStore();
  const stripped = stripImageNodes(content); // authoritative image strip
  return store.transaction(async (txStore) => {
    const project = await txStore.findProjectById(projectId);
    if (!project) return null;
    const now = new Date().toISOString();
    return txStore.insertOuttake({
      id: uuidv4(),
      project_id: projectId,
      label: label?.trim() || null,
      content: JSON.stringify(stripped),
      created_at: now,
      updated_at: now,
    });
  });
}

export async function listOuttakes(projectId: string): Promise<OuttakeRow[] | null> {
  const store = getProjectStore();
  const project = await store.findProjectById(projectId);
  if (!project) return null;
  return store.listOuttakesByProject(projectId);
}

export async function updateOuttakeLabel(
  id: string, label: string | null,
): Promise<OuttakeRow | null> {
  const store = getProjectStore();
  return store.transaction(async (txStore) => {
    const outtake = await txStore.findOuttakeById(id);
    if (!outtake) return null;
    const project = await txStore.findProjectById(outtake.project_id);
    if (!project) return null;
    return txStore.updateOuttakeLabel(id, label, new Date().toISOString());
  });
}

export async function deleteOuttake(id: string): Promise<boolean> {
  const store = getProjectStore();
  return store.transaction(async (txStore) => {
    const outtake = await txStore.findOuttakeById(id);
    if (!outtake) return false;
    const project = await txStore.findProjectById(outtake.project_id);
    if (!project) return false;
    return (await txStore.deleteOuttake(id)) > 0;
  });
}
```

**Step 4 — Run, expect PASS.** **Step 5 — Commit:** `feat(4c.2): outtakes service (validate, image-strip, parent-liveness)`

---

### Task B6: `outtakes.routes.ts` + registration

**Files:**
- Create: `packages/server/src/outtakes/outtakes.routes.ts`
- Modify: `packages/server/src/app.ts` (import + `app.use("/api/projects", projectOuttakesRouter()); app.use("/api/outtakes", outtakeDirectRouter());`)
- Create: `packages/server/src/outtakes/__tests__/outtakes.routes.test.ts` (Supertest against a real app + DB — mirror `snapshots.routes.test.ts`)

**Step 1 — Failing integration tests:**

```ts
it("POST /api/projects/:id/outtakes creates (201) and returns the row", async () => {
  const res = await request(app)
    .post(`/api/projects/${projectId}/outtakes`)
    .send({ content: { type: "doc", content: [] }, label: "Cut" });
  expect(res.status).toBe(201);
  expect(res.body.id).toBeDefined();
});
it("POST rejects invalid JSON body with 400", async () => {
  const res = await request(app).post(`/api/projects/${projectId}/outtakes`).send({ content: 42 });
  expect(res.status).toBe(400);
});
it("POST to an unknown project → 404", async () => { /* random uuid */ });
it("GET lists outtakes newest-first", async () => { /* ... */ });
it("PATCH /api/outtakes/:id updates the label (200)", async () => { /* ... */ });
it("DELETE /api/outtakes/:id → 204, then GET no longer lists it", async () => { /* ... */ });
it("DELETE unknown id → 404", async () => { /* ... */ });
// 413: send a body over MAX_CHAPTER_CONTENT_LIMIT_STRING → expect 413 (inherited from express.json)
```

**Step 2 — Run, expect FAIL.**

**Step 3 — Implement** (mirror `snapshots.routes.ts` — `UuidSchema`, `validateUuidParam`, `asyncHandler`, `AppError` throws, `respondValidationParse`/`validationError` if you prefer the helpers used elsewhere; either is fine since snapshots throws `BadRequestError` directly):

```ts
import { Router, type Request } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler";
import { CreateOuttakeSchema, UpdateOuttakeSchema } from "@smudge/shared";
import { BadRequestError, NotFoundError } from "../errors/appError";
import * as OuttakesService from "./outtakes.service";

const UuidSchema = z.string().uuid();
function uuidParam(req: Request, label: string): string {
  const parsed = UuidSchema.safeParse(req.params.id);
  if (!parsed.success) throw new BadRequestError(`Invalid ${label} id.`);
  return parsed.data;
}

export function projectOuttakesRouter(): Router {
  const router = Router();
  router.post("/:id/outtakes", asyncHandler(async (req, res) => {
    const projectId = uuidParam(req, "project");
    const parsed = CreateOuttakeSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? "Invalid request body.");
    const outtake = await OuttakesService.createOuttake(projectId, parsed.data.content, parsed.data.label ?? null);
    if (!outtake) throw new NotFoundError("Project not found.");
    res.status(201).json(outtake);
  }));
  router.get("/:id/outtakes", asyncHandler(async (req, res) => {
    const projectId = uuidParam(req, "project");
    const list = await OuttakesService.listOuttakes(projectId);
    if (list === null) throw new NotFoundError("Project not found.");
    res.json(list);
  }));
  return router;
}

export function outtakeDirectRouter(): Router {
  const router = Router();
  router.patch("/:id", asyncHandler(async (req, res) => {
    const id = uuidParam(req, "outtake");
    const parsed = UpdateOuttakeSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? "Invalid request body.");
    const outtake = await OuttakesService.updateOuttakeLabel(id, parsed.data.label);
    if (!outtake) throw new NotFoundError("Outtake not found.");
    res.json(outtake);
  }));
  router.delete("/:id", asyncHandler(async (req, res) => {
    const id = uuidParam(req, "outtake");
    const deleted = await OuttakesService.deleteOuttake(id);
    if (!deleted) throw new NotFoundError("Outtake not found.");
    res.status(204).send();
  }));
  return router;
}
```

> **Route ordering:** mount `projectOuttakesRouter()` at `/api/projects` alongside `exportRouter`/`imagesRouter`/`searchRouter` (all already share that base). The `/:id/outtakes` path is specific enough not to collide with `projectsRouter`'s `/:slug` routes; verify the existing project-scoped routers register without a catch-all conflict (they do).

**Step 4 — Run, expect PASS.** **Step 5 — Commit:** `feat(4c.2): outtakes routes + app registration`

---

### Task B7: Exclusion guarantee tests

**Files:**
- Create: `packages/server/src/outtakes/__tests__/outtakes.exclusion.test.ts`

**Step 1 — Tests** (real SQLite + real services):

```ts
it("creating an outtake does not change the manuscript word count / velocity total", async () => {
  const before = await VelocityService.getVelocity(projectId); // grep exact fn name
  await OuttakesService.createOuttake(projectId, docWithWords("one two three"));
  const after = await VelocityService.getVelocity(projectId);
  expect(after.current_total).toBe(before.current_total);
});

it("export output contains no outtake text", async () => {
  await OuttakesService.createOuttake(projectId, docWithWords("SECRET_OUTTAKE_MARKER"));
  const exported = await ExportService.exportProject(projectId, { format: "plaintext", /* ... */ });
  expect(exported.body ?? exported).not.toContain("SECRET_OUTTAKE_MARKER");
});
```

> Grep for the exact velocity + export service entry points (`velocity.service.ts`, `export.service.ts`) and their signatures; adapt the calls. The point is behavioral: a separate table is invisible to chapter-only aggregations.

**Step 2–4 — These should PASS immediately** (no production code change — they *prove* the structural exclusion). If either fails, something is wrong; fix the production code, not the test. **Step 5 — Commit:** `test(4c.2): outtakes excluded from word count + export`

---

## Phase C — Client API, scopes, strings

### Task C1: `api.outtakes` client block

**Files:**
- Modify: `packages/client/src/api/client.ts` (add an `outtakes: { … }` block mirroring `snapshots:` at line ~518)
- Modify/create test: `packages/client/src/api/__tests__/client.test.ts` (mirror snapshot fetch tests)

**Step 1 — Failing test** (mock `apiFetch`/`fetch` per existing pattern): assert `list` GETs `/api/projects/:id/outtakes`, `create` POSTs body, `updateLabel` PATCHes `/api/outtakes/:id`, `delete` DELETEs and resolves `undefined` on 204.

**Step 3 — Implement:**

```ts
outtakes: {
  list: (projectId: string, signal?: AbortSignal) =>
    apiFetch<OuttakeRow[]>(`/api/projects/${enc(projectId)}/outtakes`, { ...(signal ? { signal } : {}) }),
  create: (projectId: string, body: { content: unknown; label?: string | null }, signal?: AbortSignal) =>
    apiFetch<OuttakeRow>(`/api/projects/${enc(projectId)}/outtakes`, {
      method: "POST", body: JSON.stringify(body), ...(signal ? { signal } : {}),
    }),
  updateLabel: (id: string, body: { label: string | null }, signal?: AbortSignal) =>
    apiFetch<OuttakeRow>(`/api/outtakes/${enc(id)}`, {
      method: "PATCH", body: JSON.stringify(body), ...(signal ? { signal } : {}),
    }),
  delete: (id: string, signal?: AbortSignal) =>
    apiFetch<void>(`/api/outtakes/${enc(id)}`, { method: "DELETE", ...(signal ? { signal } : {}) }),
},
```

**Step 5 — Commit:** `feat(4c.2): api.outtakes client`

---

### Task C2: Error scopes + strings

**Files:**
- Modify: `packages/client/src/errors/scopes.ts` (add `outtake.list|create|update|delete` to the `ApiErrorScope` union ~line 82 and to `SCOPES` ~line 412)
- Modify: `packages/client/src/strings.ts` (add `STRINGS.outtakes` group + `STRINGS.error.*` fallbacks)
- Modify/create test: `packages/client/src/errors/__tests__/mapApiError.test.ts` (assert each scope maps to its fallback; a NETWORK error is `transient`)

**Step 1 — Failing test** for the mapping. **Step 3 — Implement** scopes:

```ts
"outtake.list": { fallback: STRINGS.error.loadOuttakesFailed },
"outtake.create": { fallback: STRINGS.error.createOuttakeFailed },
"outtake.update": { fallback: STRINGS.error.updateOuttakeFailed },
"outtake.delete": { fallback: STRINGS.error.deleteOuttakeFailed },
```

Strings group (fill copy — writer-facing, warm/plain tone):

```ts
outtakes: {
  tab: "Outtakes",
  empty: "No outtakes yet. Stash cut text here to find it later.",
  newFromSelection: "Send selection to outtakes",
  newBlank: "New outtake",
  filterPlaceholder: "Filter outtakes…",
  untitled: "Untitled outtake",
  fromChapterPrefix: "From ", // + chapter title
  insert: "Insert into editor",
  copy: "Copy",
  delete: "Delete",
  confirmDeleteTitle: "Delete this outtake?",
  confirmDeleteBody: "This can't be undone.",
  labelPlaceholder: "Label (optional)",
},
```

**Step 5 — Commit:** `feat(4c.2): outtakes error scopes + strings`

---

## Phase D — Panel + card components

### Task D1: `OuttakeCard`

**Files:**
- Create: `packages/client/src/components/OuttakeCard.tsx`
- Create: `packages/client/src/components/__tests__/OuttakeCard.test.tsx`

Renders: label (inline-editable input; blur/Enter → `onUpdateLabel`), a preview from `toPlainText(content)` with expand, `created_at`, a word count via `countWords(content)`, and buttons Insert / Copy / Delete. Delete opens `ConfirmDialog` (via `useDialogLifecycle`). Copy writes `toPlainText(content)` to `navigator.clipboard`. All labels from `STRINGS.outtakes`.

**Step 1 — Failing tests:** renders label + word count; clicking Insert calls `onInsert(outtake)`; clicking Copy calls `navigator.clipboard.writeText` with the plain text; Delete → confirm → `onDelete(id)`; editing the label calls `onUpdateLabel(id, next)`. Use `expectConsole` if any path warns (it shouldn't).

**Step 3 — Implement**, **Step 5 — Commit:** `feat(4c.2): OuttakeCard component`

---

### Task D2: `OuttakesPanel`

**Files:**
- Create: `packages/client/src/components/OuttakesPanel.tsx`
- Create: `packages/client/src/components/__tests__/OuttakesPanel.test.tsx`

Props: `{ projectId, onInsert, registerCapture? }` (or accept a `captureSelection` callback from the parent — see Phase F). Loads the list on mount via `api.outtakes.list` wrapped in `useAbortableAsyncOperation`; renders a filter `<input>` (case-insensitive substring over `label + toPlainText(content)`), the "New outtake" (textarea → `api.outtakes.create`) control, and the newest-first list of `OuttakeCard`. Errors route through `mapApiError(err, "outtake.list")` → `applyMappedError`. Prepends on create; removes on delete.

**Step 1 — Failing tests:** list renders; filter narrows; empty state shows `STRINGS.outtakes.empty`; create-from-textarea posts and prepends; a failed load surfaces the mapped message (assert via `expectConsole` that no raw warning leaks). **Step 3 — Implement.** **Step 5 — Commit:** `feat(4c.2): OuttakesPanel component`

---

## Phase E — Tab wiring

### Task E1: Add the Outtakes tab

**Files:**
- Modify: `packages/client/src/components/EditorMainContent.tsx` (the `tabs={[…]}` array, line ~384 — add a second entry)
- Modify test: `packages/client/src/components/__tests__/EditorMainContent.test.tsx` (assert two tabs render; selecting "outtakes" shows the panel)

**Step 3 — Implement:** add after the images entry:

```tsx
{
  id: "outtakes",
  label: STRINGS.outtakes.tab,
  panel: <OuttakesPanel projectId={project.id} onInsert={onInsertOuttake} /* + capture wiring, Phase F */ />,
},
```

(No `useReferencePanelState` change — `text` codec + unknown-tab degrade already handle a new id.)

**Step 5 — Commit:** `feat(4c.2): wire Outtakes reference-panel tab`

---

## Phase F — Editor entry points (non-destructive)

### Task F1: Insert-at-cursor action (`EditorPage` → panel)

**Files:**
- Modify: `packages/client/src/pages/EditorPage.tsx` (add `onInsertOuttake` handler; thread to `EditorMainContent` → `OuttakesPanel`/`OuttakeCard`)
- Modify: `packages/client/src/pages/__tests__/EditorPageFeatures.test.tsx` (insert behavior + edge cases)

**Step 1 — Failing tests:** inserting an outtake calls the editor with the **block array** (`content.content`), not the doc node; disabled/no-op when `!editor.isEditable` or the mutation machine is busy/locked; edge cases: insert at an inline cursor (splits block), into an empty doc, over a non-empty selection (replaces it).

**Step 3 — Implement:**

```ts
const handleInsertOuttake = useCallback((outtake: OuttakeRow) => {
  if (!editor || !editor.isEditable || machine.busy) return; // grep the exact busy/locked accessor
  const blocks = Array.isArray((outtake.content as any).content) ? (outtake.content as any).content : [];
  if (blocks.length === 0) return;
  editor.chain().focus().insertContent(blocks).run();
}, [editor, machine.busy]);
```

**Step 5 — Commit:** `feat(4c.2): insert outtake at cursor (block array, guarded)`

---

### Task F2: "Send selection to outtakes" toolbar button (non-destructive copy)

**Files:**
- Modify: `packages/client/src/components/EditorToolbar.tsx` (add a button; new `onSendSelectionToOuttakes` prop)
- Modify: `packages/client/src/pages/EditorPage.tsx` (implement the capture handler; pass down)
- Modify: `packages/client/src/__tests__/editorEntryPointSurface.test.ts` (**forcing-pause snapshot** — add the new entry point consciously)
- Modify tests: `EditorToolbar.test.tsx`, `EditorPageFeatures.test.tsx`

Capture handler (reads the current selection, strips images, POSTs — **no chapter mutation**):

```ts
const handleSendSelectionToOuttakes = useCallback(async () => {
  if (!editor) return;
  const { from, to } = editor.state.selection;
  if (from === to) return; // nothing selected
  const slice = editor.state.doc.slice(from, to);
  const content = stripImageNodes({ type: "doc", content: slice.content.toJSON() ?? [] });
  const label = `${STRINGS.outtakes.fromChapterPrefix}${currentChapterTitle}`;
  const op = captureOp.run(({ signal }) => api.outtakes.create(project.id, { content, label }, signal));
  try {
    await op.promise;
    // trigger panel refresh (lift a refresh signal or re-fetch in the panel)
  } catch (err) {
    applyMappedError(mapApiError(err, "outtake.create"), { onMessage: setToast /* existing */ });
  }
}, [editor, project.id, currentChapterTitle]);
```

> `captureOp` = a `useAbortableAsyncOperation()` instance in `EditorPage`. The selection persists across focus change (ProseMirror keeps `state.selection` on blur), so a toolbar click is safe. This entry point is **non-destructive** (no `setEditable(false)`, no `markClean`, no save-pipeline invariants) — it only reads the selection and POSTs. Document that in the `editorEntryPointSurface` snapshot rationale so the guard-axis choice ("none — non-destructive read+POST") is explicit.

**Step 1 — Failing tests:** the button appears; clicking with a selection POSTs the stripped selection; with no selection it no-ops; the entry-point snapshot test fails until updated, then passes. **Step 3 — Implement.** **Step 5 — Commit:** `feat(4c.2): send-selection-to-outtakes toolbar entry point`

---

## Phase G — Documentation

### Task G1: CLAUDE.md §Data Model update

**Files:**
- Modify: `CLAUDE.md` (§Data Model)

Add an `outtakes` bullet to the five-tables list and a short note:

```
- **outtakes** — id, project_id (FK), label, content (TipTap JSON, images
  stripped on capture), created_at, updated_at. Per-project store of cut/stashed
  text. **Hard delete (no `deleted_at`)** — a documented exception to "soft delete
  everywhere", matching ChapterSnapshot (a safety-net TipTap-JSON table). Images
  are stripped on capture because outtake JSON is invisible to the image
  reference-counter/reaper (which scans only `chapters`), so an image referenced
  only by an outtake would be GC'd. Outtakes are excluded from the manuscript word
  count, export, preview, and find-and-replace **by table separation** — any future
  "all project content" iteration must consciously opt them in, and must never do
  so for images without extending ref-tracking.
```

Verify the roadmap reconciliation from the design's §11 already landed (it did, in commit `5da4c9b`): `docs/roadmap.md` 4c.2 no longer promises `deleted_at`/`word_count`/soft-delete/images-in-outtakes.

**Commit:** `docs(4c.2): CLAUDE.md §Data Model — outtakes table + invariants`

---

## Phase H — End-to-end

### Task H1: e2e happy path + a11y

**Files:**
- Create: `e2e/outtakes.spec.ts`

**Flow:** create a project + chapter with text → open the reference panel → Outtakes tab → select text in the editor → click "Send selection to outtakes" → assert the outtake appears in the panel (chapter text unchanged) → click "Insert into editor" → assert the text is inserted → delete the outtake (confirm) → assert it's gone. Run an aXe-core scan on the panel and assert no violations.

**Commit:** `test(4c.2): e2e outtakes capture/insert/delete + aXe`

---

## Final verification (before opening the PR)

1. `make all` (or the closest available: `make lint && make format && npm run -w packages/{shared,server,client} typecheck && make cover && make e2e`). All green.
2. Coverage floors held (95/85/90/95) — check the `make cover` report; add tests for any uncovered branch in the new files rather than lowering thresholds.
3. Zero warnings in test output.
4. PR description references **roadmap Phase 4c.2**, and states the destructive cut is deferred to **4c.2a**.
5. Confirm no code path adds outtakes to `search.service.ts`, `export.service.ts`, `velocity.service.ts`, or the image reaper.
```

**Out of scope reminder (do NOT build):** the destructive one-click "cut selection to outtakes" (delete-from-chapter + persist), in-panel content editing, images-in-outtakes, soft-delete/trash, server-side/global search. All are Phase 4c.2a or later.
