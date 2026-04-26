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

### 2. Use Red/Green/Refactor

All fixes must follow TDD discipline. Do not jump straight to changing production code.

```
FOR each fix:
  1. RED:    Write or update a test that exposes the problem (watch it fail)
  2. GREEN:  Write the minimal fix to make the test pass
  3. REFACTOR: Clean up without changing behavior
```

If a review item is a pure refactor with no behavioral change, existing passing tests serve as the "red" — confirm they pass before and after.

**Why:** The base `superpowers:receiving-code-review` skill does not enforce TDD. This project requires it (see CLAUDE.md). Red/green/refactor prevents fixes that accidentally break something else and provides regression coverage for every review item.

### 3. Pre-existing and Out-of-scope Issues Must Be Fixed

If a review item points out a valid problem that happens to be pre-existing behavior or technically "out of scope" for the current branch, **fix it anyway**.

```
IF reviewer flags a valid problem:
  Fix it. Period.

  "It was already like that" is not a reason to skip.
  "That's out of scope" is not a reason to skip.

  The ONLY reason to skip: the feedback is technically wrong.
```

**Why:** Valid bugs don't stop being bugs because they predate the current branch. Leaving known problems unfixed to preserve a clean diff is backwards.

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
3. After validating an item: search for wider occurrences of the same issue
4. Each fix follows red/green/refactor (include wider fixes if practical)
5. After each fix (or small group): commit immediately
6. Pre-existing or out-of-scope? Fix it if it's valid
7. After all items done: run make all
8. Fix any failures, commit fixes
9. Only report done when make all passes
```
