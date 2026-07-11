# AbortController ESLint Rule (Phase 4b.17) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the file-level `PHASE_4B_3B_ALLOWLIST` structural check with an ESLint `no-restricted-syntax` rule that bans hand-rolled `useRef<AbortController>` allocations, with the 6 justified survivors carrying inline `eslint-disable` comments.

**Architecture:** One esquery selector appended to the client block in `eslint.config.js` (same home as the seq-ref and raw-strings rules). A contract test written **RED first** proves the selector matches TypeScript type nodes before any disable is added. Then the 6 survivors get inline disables, the dead detection is deleted from `migrationStructuralCheck.test.ts`, and CLAUDE.md Rule 4 is updated.

**Tech Stack:** ESLint 9 flat config, `typescript-eslint` parser, esquery selectors, Vitest, the existing `eslintRuleHarness` test helper.

**Source design:** `docs/plans/2026-07-11-abortcontroller-eslint-rule-design.md`

**Load-bearing constraints (read before starting):**

- **RED-FIRST.** The contract test's "fires on `useRef<AbortController>`" assertion must fail *before* the rule exists, then pass once the selector lands — this is the only proof that esquery matches TS type nodes (no in-repo precedent). Add the 6 inline disables **only after** the rule is confirmed firing; otherwise each disable is an *unused directive* and fails `--max-warnings 0` (ESLint 9 flat config defaults `reportUnusedDisableDirectives` to `"warn"`).
- **Selector (try first):** `CallExpression[callee.name='useRef'] > TSTypeParameterInstantiation TSTypeReference[typeName.name='AbortController']`
- **Fallback** (if the `>` child edge to `TSTypeParameterInstantiation` doesn't resolve): `CallExpression[callee.name='useRef'] TSTypeReference[typeName.name='AbortController']`
- **Scope:** 6 allocations / 5 files (roadmap's "4/4" is stale — post F-2 split). One PR, single refactor.

---

### Task 1: Contract test (RED) → add the rule (GREEN)

**Files:**
- Create: `packages/client/src/__tests__/eslintAbortControllerRule.test.ts`
- Modify: `eslint.config.js` (append one selector to the client-block `no-restricted-syntax` array, after the raw-string selectors)

**Step 1: Write the failing contract test (fires + negative cases only)**

Mirror `packages/client/src/__tests__/eslintSequenceRule.test.ts`. Do **not** include the disabled-fixture case yet (added in Step 6, once the rule exists — otherwise it triggers an unused-directive warning in the RED run).

```ts
import { beforeAll, describe, it, expect } from "vitest";
import { lintCode } from "./eslintRuleHarness";

// esquery+typescript-eslint init is several seconds cold; warm once.
beforeAll(async () => {
  await lintCode("export {};");
}, 30_000);

function restrictedSyntaxMessages(results: Awaited<ReturnType<typeof lintCode>>) {
  expect(results).toHaveLength(1);
  return results[0]!.messages.filter((m) => m.ruleId === "no-restricted-syntax");
}

describe("no-restricted-syntax useRef<AbortController> rule", () => {
  it("fires on the plain useRef<AbortController> allocation", async () => {
    const code = `
      import { useRef } from "react";
      export function x() {
        const r = useRef<AbortController>(null);
        return r;
      }
    `;
    const msgs = restrictedSyntaxMessages(await lintCode(code));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.message).toMatch(/useAbortableAsyncOperation/);
  });

  it("fires on the `| null` union form (the shape all 6 survivors use)", async () => {
    const code = `
      import { useRef } from "react";
      export function x() {
        const r = useRef<AbortController | null>(null);
        return r;
      }
    `;
    expect(restrictedSyntaxMessages(await lintCode(code))).toHaveLength(1);
  });

  it("fires on a nested generic (future per-key cancellation)", async () => {
    const code = `
      import { useRef } from "react";
      export function x() {
        const r = useRef<Record<string, AbortController>>(null);
        return r;
      }
    `;
    expect(restrictedSyntaxMessages(await lintCode(code))).toHaveLength(1);
  });

  it("fires on a multi-line generic form", async () => {
    const code = `
      import { useRef } from "react";
      export function x() {
        const r = useRef<
          AbortController | null
        >(null);
        return r;
      }
    `;
    expect(restrictedSyntaxMessages(await lintCode(code))).toHaveLength(1);
  });

  it("does NOT fire on a same-prefix wrapper type", async () => {
    const code = `
      import { useRef } from "react";
      type AbortControllerWrapper = { c: AbortController | null };
      export function x() {
        const r = useRef<AbortControllerWrapper>(null);
        return r;
      }
    `;
    expect(restrictedSyntaxMessages(await lintCode(code))).toHaveLength(0);
  });

  it("does NOT fire on an unrelated ref type", async () => {
    const code = `
      import { useRef } from "react";
      export function x() {
        const r = useRef<string>(null);
        return r;
      }
    `;
    expect(restrictedSyntaxMessages(await lintCode(code))).toHaveLength(0);
  });

  it("does NOT fire on a plain string mention (matches AST calls, not text)", async () => {
    const code = `
      export const doc = "use useRef<AbortController>(null) only with a disable";
    `;
    expect(restrictedSyntaxMessages(await lintCode(code))).toHaveLength(0);
  });
});
```

**Step 2: Run the test to verify the "fires" cases FAIL**

Run: `npm test -w packages/client -- eslintAbortControllerRule`
Expected: the four "fires" tests FAIL (received 0 messages — no rule yet); the three "does NOT fire" tests PASS. This is the RED proof the selector is needed.

**Step 3: Add the selector to `eslint.config.js`**

Append this object to the client-block `no-restricted-syntax` array (after the last raw-string selector, before the array closes). Keep the comment — it documents the load-bearing descendant combinator and the deliberate `React.useRef` gap.

```js
{
  // Phase 4b.17: ban hand-rolled useRef<AbortController> allocations.
  // Cancellation belongs in useAbortableAsyncOperation (network) /
  // useAbortableSequence (staleness). The DESCENDANT combinator (space)
  // after TSTypeParameterInstantiation is load-bearing: it covers the
  // union (`AbortController | null`), nested (`Record<string,
  // AbortController>`), and multi-line generic forms in one selector, and
  // the exact typeName rejects `AbortControllerWrapper`/`MyAbortController`.
  // Justified survivors carry an inline
  // `// eslint-disable-next-line no-restricted-syntax -- <reason>`.
  //
  // DELIBERATE GAP (same "add a selector when it shows up" discipline as
  // the seq-ref/raw-string rules): keys on `callee.name='useRef'`, so a
  // `React.useRef<AbortController>` MemberExpression callee would slip
  // through. Zero such calls exist today (all 75 useRef< sites are bare).
  selector:
    "CallExpression[callee.name='useRef'] > TSTypeParameterInstantiation TSTypeReference[typeName.name='AbortController']",
  message:
    "Hand-rolled useRef<AbortController> is banned. Route network cancellation through useAbortableAsyncOperation (packages/client/src/hooks/useAbortableAsyncOperation.ts) or response-staleness through useAbortableSequence. A justified second-tier-recovery survivor uses `// eslint-disable-next-line no-restricted-syntax -- <reason>` (the separator is two hyphens).",
},
```

**Step 4: Run the test to verify GREEN**

Run: `npm test -w packages/client -- eslintAbortControllerRule`
Expected: ALL tests PASS. This proves esquery matches the TS type nodes.

**If the four "fires" tests still fail** (child combinator did not resolve): swap the selector string for the fallback `CallExpression[callee.name='useRef'] TSTypeReference[typeName.name='AbortController']`, re-run Step 4. Do not proceed until GREEN.

**Step 5: Add the disabled-fixture assertion (now that the rule exists)**

Append to the `describe` block. The disable sits on the line **directly above** the matching allocation, so it is a *used* directive (no unused-directive warning).

```ts
  it("is suppressed by an inline eslint-disable on the matching line", async () => {
    const code = `
      import { useRef } from "react";
      export function x() {
        // eslint-disable-next-line no-restricted-syntax -- test fixture: documented survivor
        const r = useRef<AbortController | null>(null);
        return r;
      }
    `;
    const results = await lintCode(code);
    expect(results).toHaveLength(1);
    const messages = results[0]!.messages;
    // Two precise guarantees, immune to ambient rules-of-hooks /
    // react-refresh noise on the `export function x()` wrapper (which is
    // why we do NOT assert messages.length === 0 — react-hooks/rules-of-hooks
    // fires on a hook called in a non-component/non-hook function):
    //   (a) the rule is suppressed — zero no-restricted-syntax messages
    expect(messages.filter((m) => m.ruleId === "no-restricted-syntax")).toHaveLength(0);
    //   (b) the directive is USED — no unused-disable-directive report
    //       (reportUnusedDisableDirectives defaults to "warn"; an unused
    //       directive would fail --max-warnings 0 at the real call sites).
    expect(messages.filter((m) => /unused eslint-disable/i.test(m.message))).toHaveLength(0);
  });
```

**Step 6: Run to verify GREEN**

Run: `npm test -w packages/client -- eslintAbortControllerRule`
Expected: ALL PASS.

**Step 7: Commit**

```bash
git add eslint.config.js packages/client/src/__tests__/eslintAbortControllerRule.test.ts
git commit -m "feat(4b.17): ESLint rule banning hand-rolled useRef<AbortController> — green"
```

---

### Task 2: Add the 6 inline disables + reconcile stale comments

The rule now flags all 6 survivors. Add an inline disable directly above each allocation. Three sites carry a stale *"Phase 4b.4 replaces this file-level allowlist entry…"* forward-reference — replace that sentence with the actual disable (the promise is now fulfilled). Two sites (`useChapterCrud`, `useChapterMetadata`) have no such sentence; just add the disable above the allocation.

**Files (modify):**
- `packages/client/src/hooks/useChapterCrud.ts` — `createRecoveryAbortRef`
- `packages/client/src/hooks/useChapterMetadata.ts` — `statusRecoveryAbortRef`, `titleRecoveryAbortRef`
- `packages/client/src/hooks/useSnapshotState.ts` — `restoreFollowupAbortRef`
- `packages/client/src/hooks/useTrashManager.ts` — `restoreRecoveryAbortRef`
- `packages/client/src/pages/HomePage.tsx` — `createRecoveryAbortRef`

**Step 1: `useChapterCrud.ts`** — insert directly above `const createRecoveryAbortRef = useRef<AbortController | null>(null);`:

```ts
  // eslint-disable-next-line no-restricted-syntax -- second-tier create-recovery: must outlive createOp's auto-abort (see comment above)
  const createRecoveryAbortRef = useRef<AbortController | null>(null);
```

**Step 2: `useChapterMetadata.ts`** — the two refs are adjacent; each gets its own disable line:

```ts
  // eslint-disable-next-line no-restricted-syntax -- second-tier status-recovery: must outlive the status mutation's auto-abort (see comment above)
  const statusRecoveryAbortRef = useRef<AbortController | null>(null);
  // eslint-disable-next-line no-restricted-syntax -- second-tier title-recovery: must outlive the title mutation's auto-abort (see comment above)
  const titleRecoveryAbortRef = useRef<AbortController | null>(null);
```

**Step 3: `useSnapshotState.ts`** — replace the stale forward-reference sentence. Change:

```ts
  // instances loses the entangled-lifecycle context documented at the
  // existing I8 comment block above. Phase 4b.4 replaces this
  // file-level allowlist entry with an inline `// eslint-disable-next-line`
  // on the line below.
  const restoreFollowupAbortRef = useRef<AbortController | null>(null);
```

to:

```ts
  // instances loses the entangled-lifecycle context documented at the
  // existing I8 comment block above.
  // eslint-disable-next-line no-restricted-syntax -- simultaneously-live controller: entangled restore-followup lifecycle (see I8 block above)
  const restoreFollowupAbortRef = useRef<AbortController | null>(null);
```

**Step 4: `useTrashManager.ts`** — replace the stale forward-reference sentence. Change:

```ts
  // one). Routing this through restoreOp would cause the next restore
  // to cancel the previous restore's recovery refresh — exactly the
  // case where the previous error's user-visible state most needs the
  // refresh to land. Phase 4b.4 replaces this file-level allowlist
  // entry with inline `// eslint-disable-next-line` on the line below.
  const restoreRecoveryAbortRef = useRef<AbortController | null>(null);
```

to:

```ts
  // one). Routing this through restoreOp would cause the next restore
  // to cancel the previous restore's recovery refresh — exactly the
  // case where the previous error's user-visible state most needs the
  // refresh to land.
  // eslint-disable-next-line no-restricted-syntax -- second-tier restore-recovery: must outlive restoreOp's auto-abort (see comment above)
  const restoreRecoveryAbortRef = useRef<AbortController | null>(null);
```

**Step 5: `HomePage.tsx`** — replace the stale forward-reference sentence. Change:

```tsx
  // project create). Routing this through createOp would auto-abort the
  // recovery refresh whenever the user kicks off another create —
  // exactly the case where the previous error's recovery still needs to
  // run to completion. Phase 4b.4 replaces this file-level allowlist
  // entry with an inline `// eslint-disable-next-line` on the same line.
  const createRecoveryAbortRef = useRef<AbortController | null>(null);
```

to:

```tsx
  // project create). Routing this through createOp would auto-abort the
  // recovery refresh whenever the user kicks off another create —
  // exactly the case where the previous error's recovery still needs to
  // run to completion.
  // eslint-disable-next-line no-restricted-syntax -- second-tier create-recovery: must outlive createOp's auto-abort (see comment above)
  const createRecoveryAbortRef = useRef<AbortController | null>(null);
```

**Step 6: Verify lint is clean — rule fires nowhere unexpected, no unused directives**

Run: `npm run lint:check`
Expected: exit 0, zero errors and zero warnings. (A failure here means either a survivor was missed, a disable is misplaced onto a non-matching line — unused directive — or the rule flagged a site not in the 6.)

**Step 7: Commit**

```bash
git add packages/client/src/hooks/useChapterCrud.ts packages/client/src/hooks/useChapterMetadata.ts packages/client/src/hooks/useSnapshotState.ts packages/client/src/hooks/useTrashManager.ts packages/client/src/pages/HomePage.tsx
git commit -m "refactor(4b.17): inline eslint-disable on the 6 justified useRef<AbortController> survivors"
```

---

### Task 3: Delete the dead detection from `migrationStructuralCheck.test.ts`

**Files (modify):** `packages/client/src/__tests__/migrationStructuralCheck.test.ts`

**Step 1: Delete these four things:**

1. The `USE_REF_ABORT_CONTROLLER_PATTERN` const (and its leading S2/S1 comment block).
2. The `it("no file in packages/client/src … contains raw useRef<AbortController>", …)` test.
3. The `it("Phase 4b.3b allowlist entries actually contain useRef<AbortController>", …)` test.
4. The `PHASE_4B_3B_ALLOWLIST` `Set` (and its leading comment block).
5. The `it("useRef<AbortController> regex catches all realistic drift forms (S1)", …)` test.

**KEEP untouched:** the `*SeqRef` naming check, the `useAbortableSequence` import check, and every `.run()`-binding / helper test (`extractAbortableAsyncOperationBindings`, `importPatternFor`, `stripCommentsFromTsSource`, the delegation-helper test). `HOOK_FILE` was only used by deleted test #2 — remove it too if it becomes unused (TypeScript `no-unused-vars` will flag it in Step 2 if missed).

**Step 2: Run the file to verify still green**

Run: `npm test -w packages/client -- migrationStructuralCheck`
Expected: PASS, with the surviving `*SeqRef` / import / `.run()` tests still present. No reference to `PHASE_4B_3B_ALLOWLIST` or `USE_REF_ABORT_CONTROLLER_PATTERN` remains:

Run: `grep -n "PHASE_4B_3B_ALLOWLIST\|USE_REF_ABORT_CONTROLLER_PATTERN" packages/client/src/__tests__/migrationStructuralCheck.test.ts`
Expected: no output.

**Step 3: Commit**

```bash
git add packages/client/src/__tests__/migrationStructuralCheck.test.ts
git commit -m "refactor(4b.17): delete allowlist + regex structural check now owned by the ESLint rule"
```

---

### Task 4: Update CLAUDE.md Rule 4

**Files (modify):** `CLAUDE.md` (§Key Architecture Decisions → Save-Pipeline Invariants, Rule 4)

**Step 1: Replace the final sentence of Rule 4.** Change:

> Hand-rolled `useRef<AbortController>` allocations at consumer call sites are banned, enforced by `migrationStructuralCheck.test.ts` — which also owns the short allowlist of justified second-tier-recovery survivors (consult the test; don't duplicate its census here).

to:

> Hand-rolled `useRef<AbortController>` allocations at consumer call sites are banned by an ESLint `no-restricted-syntax` rule (`eslint.config.js`), proven by `packages/client/src/__tests__/eslintAbortControllerRule.test.ts`. The justified second-tier-recovery survivors each carry an inline `// eslint-disable-next-line no-restricted-syntax -- <reason>` at their allocation — the disable comment is the audit record; there is no central allowlist.

**Step 2: Verify no other CLAUDE.md reference to the old mechanism**

Run: `grep -n "PHASE_4B_3B_ALLOWLIST\|owns the short allowlist" CLAUDE.md`
Expected: no output.

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(4b.17): CLAUDE.md Rule 4 — enforcement is the ESLint rule + inline disables"
```

---

### Task 5: Full verification

**Step 1: Run the full pass**

Run: `make all`
Expected: lint, format, typecheck, coverage, and e2e all green. Coverage stays at/above the floors (95% statements, 85% branches, 90% functions, 95% lines) — the new contract test adds coverage; the deleted tests only exercised test-file-local helpers, so no production coverage is lost.

**Step 2: Confirm Definition of Done**

- [ ] Rule fires on a new `useRef<AbortController>` — proven by `eslintAbortControllerRule.test.ts`.
- [ ] The 6 survivors pass lint with inline disables (`npm run lint:check` exit 0, zero warnings).
- [ ] `migrationStructuralCheck.test.ts` no longer references `PHASE_4B_3B_ALLOWLIST` or `USE_REF_ABORT_CONTROLLER_PATTERN`.
- [ ] CLAUDE.md Rule 4 updated.
- [ ] `make all` green.
- [ ] No user-visible behavior change (pure tooling/refactor).

**Step 3: Correct the stale roadmap count.** The Phase 4b.17 description in `docs/roadmap.md` still says *"each of the 4 surviving allocation sites."* Update it to "each of the 6 surviving allocation sites across 5 files (post F-2 split)" so the shipped roadmap matches reality. This is a firm step, not optional — it's a one-line doc edit tightly coupled to the phase.

Run: `grep -n "4 surviving allocation" docs/roadmap.md`
Expected (after the edit): no output.

```bash
git add docs/roadmap.md
git commit -m "docs(4b.17): correct stale 4-site count to 6 allocations / 5 files"
```
```
