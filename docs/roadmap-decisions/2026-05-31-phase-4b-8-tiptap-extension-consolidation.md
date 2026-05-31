---
date: 2026-05-31
phase: "Phase 4b.8: TipTap Extension Consolidation"
model: claude-opus-4-8
design_file: docs/plans/2026-05-31-tiptap-extension-consolidation-design.md
plan_file: docs/plans/2026-05-31-tiptap-extension-consolidation-plan.md
pushback:
  total: 2
  critical: 0
  important: 1
  minor: 1
alignment:
  total: 0
---

# Phase 4b.8: TipTap Extension Consolidation — Decision Log

## Pushback Findings

### [1] `make all` does not exercise the Vite production build
- **Severity:** Important
- **Category:** Feasibility
- **Summary:** The design named its one residual risk correctly — the new `@smudge/shared/editor-extensions` subpath has never resolved in the Vite client build, where all three new client consumers live — but gated that risk behind "`make all` green." Inspection of the Makefile showed `make all` runs `lint-check format-check typecheck cover e2e`: it typechecks (tsc), runs Vitest, and runs e2e against the Vite **dev** server, but never runs `vite build`. Since Vite's dev (esbuild) and production (Rollup) paths resolve `exports`-map subpaths differently, a fully green `make all` could still accompany a production build that cannot resolve the module. The verification did not cover the risk it claimed to cover.
- **Resolution:** fixed-in-design — added `make build` as a required Definition-of-Done verification gate (and a dedicated plan Task 6), and corrected the precedent framing (the existing `./node-fs-helpers` subpath is exercised under tsx/Node via `playwright.config.ts`, never under Vite).

### [2] `shared`'s TipTap dependency closure was incomplete
- **Severity:** Minor
- **Category:** Omission
- **Summary:** The design's dependency list for `shared/package.json` named `starter-kit`, `extension-heading`, `extension-image` (deps) and `html` (devDep), but omitted the peer-dependency closure: `extension-heading`/`extension-image` peer-depend on `@tiptap/core`, and `@tiptap/html` peer-depends on `@tiptap/core` and `@tiptap/pm`. It worked only by npm hoisting both to the root `node_modules` — non-deterministic and a latent gap for the package now designated the single source of truth. (The client already relies on the same hoisting, so the omission was defensible, but worth a conscious decision.)
- **Resolution:** fixed-in-design — `@tiptap/core` added to `dependencies` and `@tiptap/pm` to `devDependencies`, with a rationale noting the deliberate divergence from the client's looser, hoisting-reliant declaration. The client's declaration is left as-is (out of scope).

## Alignment Findings

Alignment raised no issues. Requirements: 13 total, 13 covered, 0 gaps. Tasks: 6 total, 6 in scope, 0 orphaned. The plan implements the design faithfully, both pushback resolutions are reflected (Task 1 dependency closure, Task 6 build gate), and the one new-behavior task (Task 2, the shared smoke test) is already in red/green format. The remaining tasks are build-config, behavior-preserving import repointing, deletions, and verification gates, which correctly stay out of red/green/refactor per the skill's guidance.

## Summary

- Pushback raised 2 issues; both resulted in design changes (1 Important: added the `make build` gate the verification strategy was missing; 1 Minor: completed the TipTap peer-dependency closure in `shared`). 0 dismissed.
- Alignment raised 0 issues; the plan was already aligned and appropriately TDD-formatted.
