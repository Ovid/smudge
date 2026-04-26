---
name: ovid-receive-code-review
description: Use when receiving code review feedback from a reviewer or when the user pastes review comments to act on - wraps superpowers:receiving-code-review with commit-as-you-go discipline and scope rules
---

# Receiving Code Review (Ovid)

## Overview

Wraps `superpowers:receiving-code-review` with four additional rules. **Load and follow that skill first**, then layer these on top.

Read @CLAUDE.md.

**REQUIRED:** Invoke `superpowers:receiving-code-review` before proceeding.

## Additional Rules

### 1. Commit as You Go

After each review item (or small logical group) is fixed and tests pass, **create a git commit immediately**. Do not batch all fixes into one commit at the end.

```
FOR each review item (or small related group):
  1. Implement the fix
  2. Run relevant tests to confirm
  3. git add + git commit with a message describing the fix
  4. Move to next item
```

**Why:** Small commits make it easy to revert individual fixes, simplify re-review, and prevent losing work if something goes wrong mid-session.

### 2. Use Red/Green/Refactor (with contract analysis prerequisite)

All fixes must follow TDD discipline. Do not jump straight to changing production code.

```
FOR each fix:
  0. CONTRACT ANALYSIS (prerequisite — see below)
  1. RED:      Write or update a test that exposes the problem (watch it fail)
  2. GREEN:    Write the minimal fix to make the test pass
  3. REFACTOR: Clean up without changing behavior
```

**Step 0 — Contract Analysis (mandatory before writing the test):**

Before writing the failing test, enumerate every caller of the function/state/flag you are about to constrain, and confirm the contract you are pinning is correct for *each* caller. The test you write encodes your understanding of the contract; if your understanding is wrong, the test pins the bug as a feature.

```
BEFORE writing the test:
  1. grep for callers of the function/method/state-flag you'll constrain
  2. For each caller, name the meaning the caller relies on
  3. If the same name carries DIFFERENT meanings in different callers,
     STOP — the bug is semantic-overload, not the surface symptom
  4. Only proceed to RED once every caller's contract is enumerated and consistent
```

If a review item is a pure refactor with no behavioral change, existing passing tests serve as the "red" — confirm they pass before and after.

**Why:** TDD by itself does not validate that a test asserts *correct* behavior — only that the test passes. A fix to `Editor.flushSave` (review-cycle 2026-04-26) added an `isEditable === false` guard with a green test pinning the new behavior — but `isEditable === false` carried two meanings in the codebase (persistent failure lock vs in-flight mutation lock), and the guard collided with the second. A 30-second `grep "setEditable(false)"` would have surfaced the collision before the test was written. Contract analysis is the missing prerequisite that prevents TDD from encoding misunderstandings into green tests.

### 3. Pre-existing and Out-of-scope Issues Must Be Fixed (with semantic-blast-radius escape hatch)

If a review item points out a valid problem that happens to be pre-existing behavior or technically "out of scope" for the current branch, **fix it anyway** — unless the fix changes the semantics of shared state used across multiple flows.

```
IF reviewer flags a valid problem:
  Fix it. Period.

  "It was already like that" is not a reason to skip.
  "That's out of scope" is not a reason to skip.

  Reasons to skip:
    1. The feedback is technically wrong, OR
    2. The fix would change the semantics of a shared flag/state/contract
       used by multiple callers (see contract analysis in rule 2).
       In that case: file as a separate ticket / next-PR work, do not
       expand this PR. Note the deferral and rationale in the PR
       description and in paad/code-reviews/backlog.md.
```

**Why:** Valid bugs don't stop being bugs because they predate the current branch. But OOS items that require changing semantics of shared state are exactly the class of fix that contract-analysis (rule 2) protects against — and squeezing them into the current PR multiplies blast radius. The OOS tier itself is the signal: the reviewer judged it could wait. Honor that signal when the fix would touch semantics across multiple flows; defer to a focused PR where the contract change can be reviewed properly.

### 3a. Check for Wider Occurrences

After validating a review item, **check whether the same issue exists elsewhere in the codebase**. A review comment about one file often reveals a pattern problem.

```
AFTER validating a review item (before implementing the fix):
  1. SEARCH: Grep/search the codebase for the same pattern the reviewer flagged
  2. ASSESS: Is this a one-off, or does it appear in other files/modules?
  3. IF wider concern AND practical to fix:
     - Fix all occurrences, not just the one the reviewer pointed at
     - Group the wider fix into the same commit (it's the same logical change)
  4. IF wider concern BUT impractical (e.g., massive refactor, risky scope):
     - Fix the flagged instance
     - Report the wider occurrences to the user so they can decide
```

**Why:** Fixing one instance while leaving ten identical problems elsewhere defeats the purpose of code review. If the reviewer caught a real issue, the same issue in other files is just as real.

### 4. Not Done Until `make all` Passes

The review response is **not complete** until `make all` runs successfully. This is the final gate.

```
AFTER all review items are addressed:
  1. Run: make all
  2. IF it fails: fix the failures, commit the fix
  3. Repeat until make all passes
  4. ONLY THEN report completion
```

**Do not** claim the review is addressed if `make all` has not passed. Do not skip this step.

## Process Summary

```
1. Invoke superpowers:receiving-code-review (follow it fully)
2. Work through review items per that skill's process
3. For each item:
   a. Validate the finding
   b. CONTRACT ANALYSIS: enumerate callers of the function/state you'd touch.
      If the same name carries different meanings across callers, STOP —
      the bug is semantic-overload; trace the data flow before proceeding.
   c. WIDER OCCURRENCES: grep for the same pattern elsewhere in the codebase.
      Fix all instances if practical; otherwise fix the flagged one and
      report the rest to the user.
   d. SCOPE CHECK: if the item is OOS AND the fix would change the semantics
      of shared state used in multiple flows, defer to a separate ticket.
      Note the deferral in the PR description.
   e. RED / GREEN / REFACTOR with the contract you confirmed in (b).
   f. Commit immediately.
4. After all items done: run make all
5. Fix any failures, commit fixes
6. Only report done when make all passes
```
