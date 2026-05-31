# TipTap Extension Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the byte-for-byte duplicated TipTap extension config (in `packages/client/src/editorExtensions.ts` and `packages/server/src/export/editorExtensions.ts`) into one source of truth in `packages/shared/`, consumed by both packages through a dedicated subpath export.

**Architecture:** A new `packages/shared/src/editorExtensions.ts` exports the `editorExtensions` array. It is exposed via a `./editor-extensions` subpath in `shared/package.json` `exports` (NOT through the `index.ts` barrel, to keep TipTap/ProseMirror out of the shared barrel). Both local files are deleted; the ~5 consumers import the subpath directly. The server parity test is retired and replaced by a single render smoke test living in `shared`.

**Tech Stack:** TypeScript, npm workspaces, TipTap v2 (`@tiptap/starter-kit`, `extension-heading`, `extension-image`, `core`, `html`, `pm`), Vitest (`globals: false` in the shared package).

---

## Reference: design document

Full rationale lives in `docs/plans/2026-05-31-tiptap-extension-consolidation-design.md`. Two pushback-driven constraints this plan MUST honor:

1. **`make build` is a required verification gate** in addition to `make all`. `make all` does NOT run the Vite production build (`vite build`), and the new subpath has never resolved in that context. Task 6 runs it.
2. **`shared` declares the full TipTap dependency closure** — `@tiptap/core` is a direct dependency (peer of heading/image) and `@tiptap/pm` a devDependency (peer of `@tiptap/html`, used only by the smoke test), even though no source line imports them by name. Task 1 adds them.

---

## File Structure

**Created:**
- `packages/shared/src/editorExtensions.ts` — the single `editorExtensions` array declaration (the new source of truth).
- `packages/shared/src/__tests__/editorExtensions.test.ts` — render smoke test for the shared array.

**Modified:**
- `packages/shared/package.json` — add `./editor-extensions` subpath export; add TipTap deps.
- `packages/client/src/components/Editor.tsx` — repoint import.
- `packages/client/src/components/PreviewMode.tsx` — repoint import.
- `packages/client/src/hooks/useSnapshotController.ts` — repoint import.
- `packages/server/src/export/export.renderers.ts` — repoint import; `serverEditorExtensions` → `editorExtensions`.

**Deleted:**
- `packages/client/src/editorExtensions.ts`
- `packages/server/src/export/editorExtensions.ts`
- `packages/server/src/__tests__/editorExtensions.test.ts` (parity + smoke test; smoke test moves to shared).

---

## Task 1: Add TipTap deps + subpath export to the shared package

**Files:**
- Modify: `packages/shared/package.json`

- [ ] **Step 1: Add the `./editor-extensions` subpath to the `exports` map**

Open `packages/shared/package.json`. The `exports` block currently reads:

```json
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    },
    "./node-fs-helpers": {
      "types": "./src/findDirectoryConflict.ts",
      "default": "./src/findDirectoryConflict.ts"
    }
  },
```

Add a third entry so it becomes:

```json
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    },
    "./node-fs-helpers": {
      "types": "./src/findDirectoryConflict.ts",
      "default": "./src/findDirectoryConflict.ts"
    },
    "./editor-extensions": {
      "types": "./src/editorExtensions.ts",
      "default": "./src/editorExtensions.ts"
    }
  },
```

- [ ] **Step 2: Add the TipTap dependency closure**

Replace the `dependencies` and `devDependencies` blocks:

```json
  "dependencies": {
    "zod": "^3.24.3"
  },
  "devDependencies": {
    "vitest": "^3.1.1"
  }
```

with:

```json
  "dependencies": {
    "@tiptap/core": "^2.27.2",
    "@tiptap/extension-heading": "^2.27.2",
    "@tiptap/extension-image": "^2.27.2",
    "@tiptap/starter-kit": "^2.27.2",
    "zod": "^3.24.3"
  },
  "devDependencies": {
    "@tiptap/html": "^2.27.2",
    "@tiptap/pm": "^2.27.2",
    "vitest": "^3.1.1"
  }
```

> `@tiptap/core` is a direct dependency because `extension-heading` and `extension-image` peer-depend on it. `@tiptap/pm` is a devDependency because `@tiptap/html` (used only by the smoke test in Task 2) peer-depends on it. These are deliberate — see design §Rationale (dependency closure).

- [ ] **Step 3: Install so the workspace resolves the new declarations**

Run: `npm install`
Expected: completes without error; `package-lock.json` updated. No new packages are downloaded (all six TipTap packages already exist in the tree from client/server).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/package.json package-lock.json
git commit -m "build(4b.8): declare TipTap deps + editor-extensions subpath on shared"
```

---

## Task 2: Create the shared editorExtensions module (TDD)

**Files:**
- Create: `packages/shared/src/editorExtensions.ts`
- Test: `packages/shared/src/__tests__/editorExtensions.test.ts`

- [ ] **Step 1: Write the failing smoke test**

Create `packages/shared/src/__tests__/editorExtensions.test.ts`. The shared package sets `globals: false` (see `packages/shared/vitest.config.ts`), so `describe`/`it`/`expect` must be imported explicitly:

```typescript
import { describe, it, expect } from "vitest";
import { generateHTML } from "@tiptap/html";
import { editorExtensions } from "../editorExtensions";

// A reference TipTap document exercising every node type the shared
// extension config is expected to render: bold mark, heading (level 3),
// bullet list, and blockquote.
const referenceTipTapDoc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Hello " },
        { type: "text", marks: [{ type: "bold" }], text: "world" },
      ],
    },
    {
      type: "heading",
      attrs: { level: 3 },
      content: [{ type: "text", text: "A heading" }],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Item one" }],
            },
          ],
        },
      ],
    },
    {
      type: "blockquote",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "A quote" }],
        },
      ],
    },
  ],
};

describe("shared editor extensions", () => {
  it("renders a reference TipTap document to valid HTML", () => {
    const html = generateHTML(referenceTipTapDoc, editorExtensions);
    expect(html).toContain("<strong>world</strong>");
    expect(html).toContain("<h3>A heading</h3>");
    expect(html).toContain("<li>");
    expect(html).toContain("<blockquote>");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w packages/shared`
Expected: FAIL — `Cannot find module '../editorExtensions'` (the module does not exist yet).

- [ ] **Step 3: Create the module**

Create `packages/shared/src/editorExtensions.ts` with the canonical config (identical to the config the two deleted files shared):

```typescript
import StarterKit from "@tiptap/starter-kit";
import Heading from "@tiptap/extension-heading";
import Image from "@tiptap/extension-image";

/**
 * The single source of truth for Smudge's TipTap extension configuration.
 *
 * Consumed by the client (Editor component, preview mode, snapshot render)
 * and the server (export's generateHTML) via the
 * `@smudge/shared/editor-extensions` subpath export. Keeping one declaration
 * makes editor display and export rendering structurally impossible to
 * diverge — replacing the parity test that previously enforced it by hand.
 *
 * Exposed only through the subpath, NOT the package barrel (index.ts), so
 * importing `@smudge/shared` for a pure utility does not drag in
 * TipTap/ProseMirror. See design 2026-05-31-tiptap-extension-consolidation.
 */
export const editorExtensions = [
  StarterKit.configure({
    heading: false,
  }),
  Heading.configure({
    levels: [3, 4, 5],
  }),
  Image.configure({
    inline: false,
    allowBase64: false,
  }),
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w packages/shared`
Expected: PASS. No `console.warn`/`console.error` in output (zero-warnings rule).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/editorExtensions.ts packages/shared/src/__tests__/editorExtensions.test.ts
git commit -m "feat(4b.8): add shared editorExtensions array + render smoke test"
```

---

## Task 3: Repoint client consumers and delete the client-local file

**Files:**
- Modify: `packages/client/src/components/Editor.tsx:6`
- Modify: `packages/client/src/components/PreviewMode.tsx:5`
- Modify: `packages/client/src/hooks/useSnapshotController.ts:11`
- Delete: `packages/client/src/editorExtensions.ts`

- [ ] **Step 1: Repoint `Editor.tsx`**

Change the import on line 6 from:

```typescript
import { editorExtensions } from "../editorExtensions";
```

to:

```typescript
import { editorExtensions } from "@smudge/shared/editor-extensions";
```

(The `...editorExtensions` spread usage further down is unchanged.)

- [ ] **Step 2: Repoint `PreviewMode.tsx`**

Change the import on line 5 from:

```typescript
import { editorExtensions } from "../editorExtensions";
```

to:

```typescript
import { editorExtensions } from "@smudge/shared/editor-extensions";
```

- [ ] **Step 3: Repoint `useSnapshotController.ts`**

Change the import on line 11 from:

```typescript
import { editorExtensions } from "../editorExtensions";
```

to:

```typescript
import { editorExtensions } from "@smudge/shared/editor-extensions";
```

- [ ] **Step 4: Delete the client-local file**

Run: `git rm packages/client/src/editorExtensions.ts`
Expected: file staged for deletion.

- [ ] **Step 5: Verify nothing else references the old path**

Run: `git grep -n "from \"../editorExtensions\"\|from \"./editorExtensions\"" packages/client/src`
Expected: NO output (all references repointed). If any line prints, repoint it to `@smudge/shared/editor-extensions` before continuing.

> Note: `packages/client/src/sanitizer.ts` mentions `editorExtensions` in comments as a *concept*, not an import path — leave those comments unchanged.

- [ ] **Step 6: Typecheck and run the client suite**

Run: `npm test -w packages/client`
Expected: PASS, no new warnings.

Run: `npx tsc -p packages/client/tsconfig.json --noEmit`
Expected: no errors (confirms the subpath resolves under `moduleResolution: "bundler"`).

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/components/Editor.tsx packages/client/src/components/PreviewMode.tsx packages/client/src/hooks/useSnapshotController.ts
git commit -m "refactor(4b.8): client imports editorExtensions from shared subpath"
```

---

## Task 4: Repoint the server consumer and delete the server-local file + parity test

**Files:**
- Modify: `packages/server/src/export/export.renderers.ts:3,36`
- Delete: `packages/server/src/export/editorExtensions.ts`
- Delete: `packages/server/src/__tests__/editorExtensions.test.ts`

- [ ] **Step 1: Repoint the import in `export.renderers.ts`**

Change line 3 from:

```typescript
import { serverEditorExtensions } from "./editorExtensions";
```

to:

```typescript
import { editorExtensions } from "@smudge/shared/editor-extensions";
```

- [ ] **Step 2: Update the usage site in `export.renderers.ts`**

In `chapterContentToHtml`, change:

```typescript
    return generateHTML(content, serverEditorExtensions);
```

to:

```typescript
    return generateHTML(content, editorExtensions);
```

- [ ] **Step 3: Confirm there are no other `serverEditorExtensions` references**

Run: `git grep -n "serverEditorExtensions" packages/server/src`
Expected: NO output. If any line prints (outside the file being deleted in Step 4), update it to `editorExtensions`.

- [ ] **Step 4: Delete the server-local file and the parity test**

Run:
```bash
git rm packages/server/src/export/editorExtensions.ts
git rm packages/server/src/__tests__/editorExtensions.test.ts
```
Expected: both files staged for deletion. (The parity assertion is now structurally impossible to violate — single source — and the smoke test moved to `shared` in Task 2.)

- [ ] **Step 5: Typecheck and run the server suite**

Run: `npm test -w packages/server`
Expected: PASS, no new warnings.

Run: `npx tsc -p packages/server/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/export/export.renderers.ts
git commit -m "refactor(4b.8): server imports editorExtensions from shared; retire parity test"
```

---

## Task 5: Full test + lint + format gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full CI pass**

Run: `make all`
Expected: green — `lint-check`, `format-check`, `typecheck`, `cover` (coverage ≥ 95/85/90/95), and `e2e` all pass. No warnings in test output.

- [ ] **Step 2: If `format-check` or `lint-check` flags the new/changed files, fix and re-run**

Run (only if needed): `make format && make lint`
Then re-run: `make all`
Expected: green.

- [ ] **Step 3: Commit any formatting fixups**

```bash
git add -A
git commit -m "style(4b.8): formatting fixups"
```
(Skip if there was nothing to commit.)

---

## Task 6: Vite production build gate (required — `make all` does not cover this)

**Files:** none (verification only)

- [ ] **Step 1: Run the client production build**

Run: `make build`
Expected: `vite build` completes successfully and emits the production bundle without module-resolution errors. This is the gate that proves `@smudge/shared/editor-extensions` resolves under Vite's Rollup production path — the one context `make all` (typecheck + Vitest + dev-server e2e) never exercises.

- [ ] **Step 2: If the build fails to resolve the subpath**

This is the residual risk the design flagged. If `vite build` cannot resolve `@smudge/shared/editor-extensions`, do NOT work around it by reverting to the barrel. Diagnose Vite's `exports`-map resolution (confirm the `./editor-extensions` key matches the import specifier exactly, and that Vite is reading `package.json` `exports`). Fix the `exports` entry, re-run `npm install`, and repeat Step 1. Re-run `make all` afterward.

- [ ] **Step 3: Final confirmation**

Run: `git status`
Expected: clean working tree (all changes committed). The branch is ready for PR.

---

## Self-Review (completed during authoring)

**Spec coverage:**
- Single shared declaration → Task 2. ✓
- Subpath export, not barrel → Task 1 Step 1 + module header comment. ✓
- Full dependency closure (`core` dep, `pm` devDep) → Task 1 Step 2. ✓
- Shared smoke test asserting `<strong>`/`<h3>`/`<li>`/`<blockquote>` → Task 2 Step 1. ✓
- Delete both local files → Task 3 Step 4, Task 4 Step 4. ✓
- Repoint all 4 consumers (3 client + 1 server) → Task 3, Task 4. ✓
- `serverEditorExtensions` → `editorExtensions` rename → Task 4 Steps 1–2. ✓
- Retire server parity test → Task 4 Step 4. ✓
- `make all` gate → Task 5. ✓
- `make build` required gate (pushback) → Task 6. ✓
- License gate → no-op, all MIT and already documented; no task needed (confirmed in design). ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases" — every code step shows the exact code. ✓

**Type/name consistency:** The shared export is named `editorExtensions` everywhere (module, test, all consumers). The server's old `serverEditorExtensions` is fully eliminated (Task 4 Steps 1–3). ✓

**No behavior change:** The extension array is byte-identical to the two deleted declarations; only its location and the import specifiers change. ✓
