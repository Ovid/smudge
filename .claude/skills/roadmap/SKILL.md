---
name: roadmap
description: Read the feature roadmap, find the next unplanned phase, brainstorm it, and update the roadmap with the resulting document name
---

## Start

Announce: **"Checking roadmap for next unplanned phase…"**

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

### 5b. Update the Phase Structure table status

In the **Phase Structure** table near the top of the roadmap, change the phase's Status from `Planned` to `Planned` (brainstorming alone doesn't mark a phase as Done). The valid statuses are:

- **Planned** — not yet started
- **In Progress** — implementation underway
- **Done** — shipped and merged to main

Only update the status if explicitly told to by the user (e.g., marking a phase Done after implementation). Otherwise leave it as-is.

## 6. Announce Completion

> **Roadmap updated.** Phase N: [Name] brainstormed → `docs/plans/[filename]`.
> Next unplanned phase: Phase M: [Name] (or "all phases planned").

Offer to move to implementing the new design, or to review the updated roadmap.
