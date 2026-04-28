---
name: roadmap
description: Read the feature roadmap, find the next unplanned phase, brainstorm it, and update the roadmap with the resulting document name
---

## Start

Announce: **"Checking roadmap for next unplanned phase…"**

Read @CLAUDE.md.

## 1. Read the Roadmap

Read `docs/roadmap.md` in full. Each phase heading (## Phase N: …) may have a `<!-- plan: filename.md -->` comment on the line immediately after the `---` separator that follows that phase's section. This comment marks the phase as already brainstormed.

Example of a completed phase:

```markdown
---

## Phase 2: Goals & Velocity
<!-- plan: 2026-04-01-goals-velocity-design.md -->
```

Example of an incomplete phase (no comment, or no `<!-- plan: … -->` line):

```markdown
---

## Phase 3: Export
```

## 2. Identify the Next Unplanned Phase

Scan phases in order (Phase 1, 2, 3, … 7). The first phase whose section does **not** have a `<!-- plan: … -->` comment is the target.

If **all** phases have plan comments, announce:
> **All roadmap phases have been brainstormed.** Nothing to do.

…and stop.

## 2a. Suggest a Working Branch (if on `main`)

Run `git branch --show-current`. If the current branch is not `main`, skip this
step — the working branch is already chosen, and the rest of this skill will
commit its outputs there.

If the current branch **is** `main`, do not start brainstorming yet. The
artifacts produced by the rest of this skill (design doc, implementation plan,
decision log, and any phase commits) should land on a feature branch, not on
`main`. Propose one and let the user accept or rename it before continuing.

### Derive a candidate slug

From the target phase heading, take the title text (everything after the
`Phase N:` or `Phase Na:` prefix), then:

1. Lowercase the title.
2. If the trailing word is `implementation`, `impl`, or `feature`, drop it —
   it adds nothing to a branch name.
3. Replace any run of non-`[a-z0-9]` characters with a single hyphen.
4. Strip leading and trailing hyphens.

Examples:

| Phase heading                                  | Candidate slug         |
|------------------------------------------------|------------------------|
| `Phase 1: Backend Foundation`                  | `backend-foundation`   |
| `Phase 3a: Movie Data Cleaning`                | `movie-data-cleaning`  |
| `Phase 7: User Authentication implementation`  | `user-authentication`  |

The slug is bare — no `feat/`, no `<username>/` prefix. If the user's
convention adds a prefix, let them apply it via the override path below.

### Present the suggestion and wait

Show the user the candidate name and ask them to accept or override:

> Currently on `main`. Before brainstorming, I'd like to create a feature
> branch so the design doc, plan, and decision log land off `main`.
>
> Suggested branch: `<candidate-slug>`. Accept, or give me a different name?

Then:

- **Accept** (`yes`, `ok`, "looks good") → run
  `git checkout -b <candidate-slug>`.
- **Override** with a name → run `git checkout -b <user-supplied-name>`.
- **Explicit "stay on `main`"** → continue on `main`, but warn the user that
  every commit produced by this skill will land directly on `main`.

Only proceed to step 3 after the branch decision is made.

## 3. Extract the Phase Context

Collect the full text of the target phase section from the roadmap (everything between its `## Phase N` heading and the next `## Phase` heading or end of file). This is the spec input for brainstorming.

Also note:
- Which earlier phases it depends on (listed under ### Dependencies).
- The current date (for the plan filename).

## 4. Brainstorm

Invoke the `superpowers:brainstorming` skill. When the brainstorming skill asks what you're building, provide:

- The phase name and goal from the roadmap.
- The full phase section text as context.
- That the output should be a **design document** saved to `docs/plans/`.

Follow the brainstorming skill's process completely. It will explore requirements, ask the user questions, and produce a design document. Also, think of the design from the standpoint of a writer. Is it truly useful for them? If you think it could be more useful, discuss this with the user.

When brainstorming, apply the PR scope rules in CLAUDE.md (§Pull Request Scope) — flag to the user if this phase bundles more than one feature or refactor and should be split before a plan is written.

## 5. Record the Plan Filename

After brainstorming produces a document in `docs/plans/`, update `docs/roadmap.md` in **two places**:

### 5a. Insert the plan comment

Insert a plan comment on the line immediately after the `---` separator that precedes the phase heading:

**Before:**
```markdown
---

## Phase 3a: Export Foundation
```

**After:**
```markdown
---

## Phase 3a: Export Foundation
<!-- plan: 2026-04-01-export-foundation-design.md -->
```

The filename is whatever the brainstorming skill created (it follows the pattern `YYYY-MM-DD-<topic>-design.md`).

### 5b. Update the Phase Structure table statuses

In the **Phase Structure** table near the top of the roadmap, make two updates:

1. **Mark the current phase as "In Progress"** — change its status from `Planned` to `In Progress`.
2. **Mark the previous phase as "Done"** — if the phase immediately before the current one has status `In Progress`, change it to `Done` (it must have been completed if we're moving on to brainstorm the next phase).

The valid statuses are:

- **Planned** — not yet started
- **In Progress** — brainstorming or implementation underway
- **Done** — shipped and merged to main

## 6. Pushback Review

Invoke the `paad:pushback` skill against the design document just created in `docs/plans/`. If English is the new programming language, pushback is code review for the plan — catch contradictions, feasibility issues, scope problems, and ambiguity before any implementation begins.

After pushback completes, discuss the findings with the user and update the design document to address any valid concerns before moving on.

**Instrumentation for the decision log.** While the pushback discussion happens, mentally track each issue presented so you can write it to the decision log in step 10:

- Title (one line, taken from how pushback presented the issue)
- Severity (Critical / Important / Minor — pushback assigns these)
- Category (Contradiction / Feasibility / Scope / Omission / Ambiguity / Security / Other — taken from which check fired)
- One-paragraph summary in your own words
- Resolution after discussion with the user — exactly one of: `fixed-in-design`, `fixed-in-plan`, `dismissed-invalid`, `dismissed-out-of-scope`, `accepted-as-is`, `deferred`
- One-sentence resolution detail (what was changed, or why it was dismissed)

If pushback raises zero issues, record that — a clean pushback is itself evidence.

## 7. CLAUDE.md Review

Before announcing completion, evaluate whether `CLAUDE.md` needs updating to reflect this phase.

Re-read `CLAUDE.md` with the final design in mind and check each section for drift:

- **§Key Architecture Decisions** — does the phase introduce a new invariant, source-of-truth rule, or cross-cutting pattern that belongs here? (e.g. a new helper that codifies existing invariants should be referenced so future developers route through it.)
- **§API Design** — new endpoints, new error codes, or a new shape for an error envelope?
- **§Data Model** — new tables, new columns, or a change to soft-delete/UUID conventions?
- **§Testing Philosophy** — a new test layer, fixture convention, or coverage requirement?
- **§Target Project Structure** — a new top-level folder or package?
- **§Accessibility / §Visual Design** — a new a11y primitive or visual token worth documenting at the root level?
- **§Pull Request Scope** — does the phase reveal a new PR-scope hazard worth codifying?

If any section needs updating, discuss the proposed change with the user and fold the `CLAUDE.md` edit into the design document as an explicit deliverable of the phase (a task in the plan, not an afterthought). If no section needs updating, state that explicitly so the check is visible.

## 8. Write the Implementation Plan

Invoke the `superpowers:writing-plans` skill against the finalized design document. The writing-plans skill will produce a bite-sized TDD task list that turns the design into concrete, reviewable commits.

When invoking writing-plans, provide:

- The path to the finalized design document from step 4.
- The constraints captured during steps 6 and 7 (pushback findings, any CLAUDE.md edits that must land as part of the phase).
- Repository-specific constraints from `CLAUDE.md` (§Testing Philosophy coverage floors, §Pull Request Scope one-refactor / one-feature rule, zero-warnings rule).
- That the plan should be saved alongside the design in `docs/plans/` with filename pattern `YYYY-MM-DD-<topic>-plan.md`.

The plan must honor the PR scope rules: a single roadmap phase is a single PR. If the plan would naturally span multiple PRs (for example, a refactor followed by a feature), split at the phase boundary in the roadmap first and re-run this skill against each sub-phase.

## 9. Alignment Check

Invoke the `paad:alignment` skill against the implementation plan just produced. Alignment catches coverage gaps, scope creep, and design-vs-plan mismatches — it verifies that every requirement in the design is traced to at least one task, every task maps back to a requirement, and every task is expressed in TDD red/green/refactor format.

Pass the alignment skill both documents:

- The design document from step 4 (the source of truth for requirements).
- The implementation plan from step 8 (the breakdown being aligned).

After alignment completes, discuss any findings with the user and update the plan (and occasionally the design) to close the gaps. Do not proceed to announcement until the plan and design are aligned, or the user explicitly accepts any remaining gaps.

**Instrumentation for the decision log.** Same as step 6: mentally track each alignment issue (title, severity, category, one-paragraph summary, resolution from the closed vocabulary, one-sentence resolution detail). Alignment categories are: `missing-coverage`, `out-of-scope`, `design-gap`, `tdd-format`. If alignment raises zero issues, record that.

## 10. Write the Decision Log Entry

Write a single Markdown file to `docs/roadmap-decisions/YYYY-MM-DD-<phase-slug>.md` capturing this run.

**Filename slug rule:** lowercase the phase heading, replace any run of non-`[a-z0-9]` characters with a single hyphen, strip leading/trailing hyphens. `Phase 7: Editor's Polish & Polish` → `phase-7-editor-s-polish-polish`. Combine with today's date in `YYYY-MM-DD` form.

**Model field:** read from your own system context (the system prompt always identifies the model you are running on, e.g., `claude-opus-4-7`). Use the bare model ID, no version suffixes.

Follow the schema in §Appendix: Decision Log Entry Schema (at the bottom of this skill) exactly — YAML frontmatter, then the body sections.

Then update `docs/roadmap-decisions/INDEX.md` by **prepending** one row to the `## Entries` table (newest entry on top). The row contains: date, phase title, model, pushback C/I/M counts, alignment C/I/M counts, and a relative link to the entry file just written.

If a /roadmap run produced zero pushback issues *and* zero alignment issues, still write the entry and the index row — a clean run is evidence too.

## 11. Announce Completion

> **Roadmap updated.** Phase N: [Name] brainstormed and planned.
> - Design: `docs/plans/<filename>-design.md`
> - Plan: `docs/plans/<filename>-plan.md`
> - Decision log: `docs/roadmap-decisions/<filename>.md`
> Next unplanned phase: Phase M: [Name] (or "all phases planned").

Offer to move to implementing the plan (via `superpowers:subagent-driven-development` or `superpowers:executing-plans` in a separate session), or to review the updated roadmap.

## Appendix: Decision Log Entry Schema

The decision log captures, for every /roadmap run, what `paad:pushback` and `paad:alignment` caught and how each finding was resolved. Each entry is one Markdown file with YAML frontmatter and a structured body. The purpose is evidence — a body of receipts that the upstream skills (brainstorming, writing-plans) miss real things even when run by the most capable model.

### File location

- Entries: `docs/roadmap-decisions/YYYY-MM-DD-<phase-slug>.md` (one per /roadmap run)
- Index: `docs/roadmap-decisions/INDEX.md` (one row per entry, newest on top)

If a phase is brainstormed more than once on different days, each run produces its own dated entry — the history is preserved.

### Frontmatter

```yaml
---
date: 2026-04-26
phase: "Phase 3a: Export Foundation"
model: claude-opus-4-7
design_file: docs/plans/2026-04-26-export-foundation-design.md
plan_file: docs/plans/2026-04-26-export-foundation-plan.md
pushback:
  total: 5
  critical: 1
  important: 2
  minor: 2
alignment:
  total: 3
  critical: 0
  important: 1
  minor: 2
---
```

All fields are required. Severity counts under `pushback` and `alignment` must sum to `total`. For a clean run with no findings, set `total: 0` and omit the severity fields.

### Body sections

```markdown
# <Phase title> — Decision Log

## Pushback Findings

### [N] <issue title>
- **Severity:** Critical | Important | Minor
- **Category:** Contradiction | Feasibility | Scope | Omission | Ambiguity | Security | Other
- **Summary:** <one paragraph in your own words>
- **Resolution:** <one of the resolution values below> — <one sentence: what was changed, or why it was dismissed>

(Repeat per issue. If pushback raised no issues, replace this whole section with the single line: "Pushback raised no issues.")

## Alignment Findings

### [N] <issue title>
- **Severity:** Critical | Important | Minor
- **Category:** missing-coverage | out-of-scope | design-gap | tdd-format
- **Summary:** <one paragraph in your own words>
- **Resolution:** <one of the resolution values below> — <one sentence: what was changed, or why it was dismissed>

(Repeat per issue. If alignment raised no issues, replace this whole section with the single line: "Alignment raised no issues.")

## Summary

- Pushback raised N issues; M resulted in design changes, K dismissed as invalid, ... .
- Alignment raised N issues; M resulted in plan changes, ... .
```

### Resolution vocabulary (closed set)

- `fixed-in-design` — the design document was edited to address the issue
- `fixed-in-plan` — the implementation plan was edited to address the issue
- `dismissed-invalid` — the user disagreed; the issue was a false positive
- `dismissed-out-of-scope` — valid concern but explicitly deferred to a future phase
- `accepted-as-is` — valid concern, no change needed (e.g., known limitation that does not need addressing)
- `deferred` — valid concern that needs work but cannot be addressed in this run

### INDEX.md format

```markdown
# Roadmap Decision Log Index

This index lists every /roadmap run in reverse chronological order. Each entry
captures issues found by /pushback (after the design) and /alignment (after the
plan), along with how each was resolved.

## Entries

| Date       | Phase                          | Model              | Pushback (C/I/M) | Alignment (C/I/M) | Entry |
|------------|--------------------------------|--------------------|------------------|-------------------|-------|
| 2026-04-26 | Phase 3a: Export Foundation    | claude-opus-4-7    | 1/2/2            | 0/1/2             | [link](2026-04-26-phase-3a-export-foundation.md) |
```

Prepend new rows to the table so the newest entry is always at the top.

### Slug rule

Lowercase the phase heading, replace any run of non-`[a-z0-9]` characters with a single hyphen, strip leading and trailing hyphens. Examples:

- `Phase 3a: Export Foundation` → `phase-3a-export-foundation`
- `Phase 7: Editor's Polish & Polish` → `phase-7-editor-s-polish-polish`

### Why this schema

The single `model` field assumes one model per /roadmap run (true ~99% of the time). Per-issue resolution tracking is what makes this evidence rather than a list of complaints — "pushback caught N important issues, M of which became design changes" is a much stronger argument than "pushback raised N things." Severity counts in the index let a year of entries be skimmed at a glance for patterns. Closed-set vocabularies (categories, resolutions) keep entries comparable across runs and trivially aggregatable by future tooling.

