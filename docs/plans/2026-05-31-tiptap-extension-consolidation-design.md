# Phase 4b.8: TipTap Extension Consolidation — Design

**Date:** 2026-05-31
**Phase:** 4b.8 (roadmap `docs/roadmap.md`)
**Author:** Ovid / Claude (collaborative)
**Status:** Approved — ready for implementation plan

---

## Problem

`packages/client/src/editorExtensions.ts` and
`packages/server/src/export/editorExtensions.ts` declare byte-for-byte
identical TipTap configuration:

- `StarterKit.configure({ heading: false })`
- `Heading.configure({ levels: [3, 4, 5] })`
- `Image.configure({ inline: false, allowBase64: false })`

Both file headers state the configs "must match," and a parity test
(`packages/server/src/__tests__/editorExtensions.test.ts`) renders a reference
TipTap document through both configs and asserts identical HTML output.

This is the parity-test smell: the maintenance contract lives in a test
asserting two literals are equal, not in the code itself. Adding or changing a
TipTap extension on one side silently diverges export rendering from editor
display until the parity test catches it after the fact. The duplication is the
defect; the test is a band-aid over it.

This is identified as the lowest-risk extraction in the dedup backlog
(`paad/duplicate-code-reports/ovid-experimental-dedup-2026-04-28-08-02-18-093074c.md`,
finding C1).

## Goal

One source of truth for the TipTap extension array, consumed directly by both
the client and server. Parity becomes structurally impossible (a single shared
array) rather than test-enforced. No behavior change, no user-visible change.

## Solution

### 1. New shared module + dedicated subpath export

- Create `packages/shared/src/editorExtensions.ts` exporting `editorExtensions`
  (the array — named to match today's client export).
- Update `packages/shared/package.json`:
  - Add an `exports["./editor-extensions"]` subpath pointing at
    `./src/editorExtensions.ts`. This mirrors the existing `./node-fs-helpers`
    subpath pattern, which exists precisely to keep environment-/dependency-heavy
    code out of the main barrel.
  - Add to `dependencies`: `@tiptap/starter-kit`, `@tiptap/extension-heading`,
    `@tiptap/extension-image`, and `@tiptap/core` (all `^2.27.2`).
  - Add to `devDependencies`: `@tiptap/html` and `@tiptap/pm` (both `^2.27.2`,
    for the smoke test).
- The array is **not** re-exported from `index.ts`. This keeps
  TipTap/ProseMirror out of the main `@smudge/shared` barrel, so server modules
  that import only `countWords()` or a Zod schema do not transitively reference
  ProseMirror.

**Rationale (export surface):** A subpath export keeps the heavy editor-stack
dependency graph (StarterKit → ProseMirror) out of the shared barrel that pure
utilities live in. The repo already established this pattern with
`./node-fs-helpers` (consumed by `playwright.config.ts` under tsx/Node).
The architectural signal is honest: "importing this pulls in the editor stack."
Bundlers tree-shake, so the runtime cost of putting it in the barrel would
usually be nil — but the boundary-clarity cost is real, and a subpath entry is
cheap.

**Rationale (dependency closure):** `shared` declares the full closure of what
its editor-extension code imports, not just the directly-`import`ed packages.
`@tiptap/extension-heading` and `@tiptap/extension-image` peer-depend on
`@tiptap/core`, and the smoke test's `@tiptap/html` peer-depends on
`@tiptap/core` and `@tiptap/pm` — so `core` is a direct dependency and `pm` a
devDependency, even though no source line `import`s them by name. This is a
deliberate divergence from `packages/client/package.json`, which omits
`@tiptap/core` and relies on workspace hoisting to resolve it. `shared` is now
the single authoritative home for the editor config; the package that owns the
source of truth should declare a self-contained dependency set rather than lean
on the accident of npm's (non-deterministic) hoisting layout. The client's
looser declaration is pre-existing and out of scope for this phase.

### 2. Delete local files, repoint consumers

- Delete `packages/client/src/editorExtensions.ts`.
- Delete `packages/server/src/export/editorExtensions.ts`.
- Repoint each consumer to
  `import { editorExtensions } from "@smudge/shared/editor-extensions"`:
  - Client:
    - `packages/client/src/components/Editor.tsx`
    - `packages/client/src/components/PreviewMode.tsx`
    - `packages/client/src/hooks/useSnapshotController.ts`
  - Server:
    - `packages/server/src/export/export.renderers.ts` — the
      `serverEditorExtensions` name disappears; the call site uses
      `editorExtensions`.
- `packages/client/src/sanitizer.ts` contains comments referencing
  `editorExtensions` as a concept (the bound on the HTML it sanitizes). These are
  conceptual, not path references, and remain valid. Touch them only if a path
  reference is now stale.

**Rationale (delete vs. re-export shim):** The roadmap's literal wording is
"both packages become one-line re-exports." With a subpath in place, a
re-export shim (`export { editorExtensions } from "@smudge/shared/editor-extensions"`)
removes the *duplication* but keeps a *pass-through indirection* whose only job
is forwarding an import. This phase is about collapsing to a single source of
truth; deletion achieves that cleanly. The consumer churn is ~5 import lines,
all caught by the typechecker, so the risk that a shim would avoid is near zero.
This is a deliberate deviation from the roadmap's literal "re-exports" wording —
the roadmap is a guide, not a contract.

### 3. Test changes

- Delete `packages/server/src/__tests__/editorExtensions.test.ts`. Both of its
  tests retire:
  - The **parity test** (`serverHtml === clientHtml`) is meaningless against a
    single source — it can now only fail if the import machinery breaks, not if
    the config drifts (drift is impossible).
  - The **smoke test** moves (see below) rather than being lost.
- Add `packages/shared/src/__tests__/editorExtensions.test.ts` with the
  render-a-reference-doc smoke assertion: render a reference TipTap document
  through the shared `editorExtensions` and assert the HTML contains
  `<strong>`, `<h3>`, `<li>`, and `<blockquote>`.

**Rationale (test fate):** The test should follow the code. Once the array is
owned by `shared`, a `shared` smoke test is its honest home. It preserves a real
"does this config still render valid HTML?" regression guard for TipTap upgrades,
while the *parity* concern dissolves into the single-source design — which is the
entire point of the phase.

## Risks and Verification

- **Subpath resolution in the Vite production build.** The existing
  `./node-fs-helpers` subpath proves the `exports`-map pattern resolves under
  **tsx/Node** (it is consumed by `playwright.config.ts`) and under
  `moduleResolution: "bundler"` (tsc). It has **never** been resolved in the
  **Vite client build**, which is exactly where the three new client consumers
  (`Editor.tsx`, `PreviewMode.tsx`, `useSnapshotController.ts`) live. Vite's dev
  server (esbuild) and its production build (Rollup) resolve workspace-package
  `exports` subpaths through different code paths, so a subpath that resolves in
  typecheck + dev-server + Vitest can still fail `vite build`.

  Critically, `make all` (`lint-check format-check typecheck cover e2e`) does
  **not** run the production build — `cover` is Vitest and `e2e` runs against
  the Vite **dev** server. Therefore `make build` (`vite build`) is a **required
  verification gate** for this phase, separate from `make all` (see Definition
  of Done). Running only `make all` would leave this risk untested.
- **`serverEditorExtensions` rename.** The only server consumer
  (`export.renderers.ts`) switches from `serverEditorExtensions` to
  `editorExtensions`. The typechecker catches any missed reference.

## License Gate (CLAUDE.md §Dependency Licenses)

Confirmed no-op. All four packages added to `shared/package.json`
(`@tiptap/starter-kit`, `@tiptap/extension-heading`, `@tiptap/extension-image`,
`@tiptap/html`) are **MIT**, already used elsewhere in the repo, and already
documented in `docs/dependency-licenses.md` (lines 42–47, 64–70). Adding them to
a third workspace's `package.json` is a new declaration of an existing
dependency, not new third-party code entering the project. No new license-audit
entry is required. This is recorded here so the check is visible rather than
silently skipped.

## CLAUDE.md Impact

No CLAUDE.md update required. This phase introduces no new invariant,
source-of-truth rule, API surface, error code, data-model change, test layer, or
top-level folder. The change is a mechanical consolidation behind existing
patterns (the `./node-fs-helpers` subpath precedent already documents the
shared-package boundary discipline). The §Key Architecture Decisions note that
TipTap JSON is the source of truth and HTML is generated via `generateHTML()`
remains accurate; this phase only unifies *where* the extension config that
drives `generateHTML()` lives.

## Scope / PR Shape

Single refactor, no behavior change, no user-visible change. Satisfies the
CLAUDE.md §Pull Request Scope one-feature rule. The change spans three packages
(`shared`, `client`, `server`) but is one cohesive consolidation, not multiple
features.

## Definition of Done

- One source declaration of the TipTap extension array
  (`packages/shared/src/editorExtensions.ts`).
- Both client and server import it from `@smudge/shared/editor-extensions`; the
  two local `editorExtensions.ts` files are deleted.
- The server parity test is retired; a smoke test lives in `shared`.
- `make all` green at PR close.
- **`make build` (Vite production build) green at PR close** — required gate, as
  `make all` does not exercise the Vite production build where the new subpath's
  one residual resolution risk lives.
- No behavior change visible to the user.
