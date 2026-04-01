# CI/CD Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Set up GitHub Actions CI pipeline that runs linting, tests, and E2E checks on every push and PR.

**Architecture:** Single workflow file with three parallel jobs (lint-format, test-build matrix, e2e). Prerequisite changes to Playwright config and package.json support the pipeline.

**Tech Stack:** GitHub Actions, Node 20+22, Vitest, Playwright, ESLint, Prettier

**Design doc:** `docs/plans/2026-04-01-ci-cd-design.md`

**Already completed** (during pushback review):
- `.nvmrc` — created with `22`
- `lint:check` script — added to root `package.json` (read-only lint for CI; `lint` does `--fix` for local use)

---

### Task 1: Configure Playwright for Chromium only

The current `playwright.config.ts` has no `projects` array, so Playwright defaults to all three browsers. CI only installs Chromium, so we need to make this explicit.

**Files:**
- Modify: `playwright.config.ts`

**Step 1: Add `devices` import and `projects` array to `playwright.config.ts`**

Change the import to:
```ts
import { defineConfig, devices } from "@playwright/test";
```

Add `projects` inside the `defineConfig` call, after the `use` block:
```ts
projects: [
  { name: "chromium", use: { ...devices["Desktop Chrome"] } },
],
```

**Step 2: Verify E2E tests still pass with the explicit config**

Run: `npx playwright test`
Expected: All tests pass (same as before — they were already running on Chromium by default).

**Step 3: Commit**

```bash
git add playwright.config.ts
git commit -m "config: restrict Playwright to Chromium only"
```

---

### Task 2: Add `engines` field to root `package.json`

**Files:**
- Modify: `package.json`

**Step 1: Add `engines` field**

Add after the `"type": "module"` line:
```json
"engines": {
  "node": ">=20"
},
```

**Step 2: Verify nothing breaks**

Run: `npm install`
Expected: No errors. The `engines` field is informational by default.

**Step 3: Commit**

```bash
git add package.json
git commit -m "config: add engines field documenting Node >=20 requirement"
```

---

### Task 3: Create GitHub Actions workflow

This is the main deliverable. One file, three parallel jobs.

**Files:**
- Create: `.github/workflows/ci.yml`

**Step 1: Create the workflow file**

```yaml
name: CI

on:
  push:
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint-format:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run lint:check
      - run: npm run format:check

  test-build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
      - run: npm ci
      - name: Run tests with coverage
        if: matrix.node-version == 22
        run: npx vitest run --coverage
      - name: Run tests
        if: matrix.node-version == 20
        run: npx vitest run
      - run: npm run build -w packages/client

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: |
            e2e/test-results/
            playwright-report/
          retention-days: 7
```

**Step 2: Validate the YAML syntax**

Run: `node -e "const fs = require('fs'); const yaml = require('yaml'); yaml.parse(fs.readFileSync('.github/workflows/ci.yml', 'utf8')); console.log('Valid YAML')"`

If `yaml` package is not available, use: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('Valid YAML')"`

If neither is available, just visually confirm the indentation is correct.

**Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow with lint, test, and e2e jobs"
```

---

### Task 4: Verify locally before pushing

Run all the same checks CI will run, in order:

**Step 1: Lint check (read-only)**

Run: `npm run lint:check`
Expected: No errors (exit 0).

**Step 2: Format check**

Run: `npm run format:check`
Expected: No errors (exit 0).

**Step 3: Tests with coverage**

Run: `npx vitest run --coverage`
Expected: All tests pass, coverage thresholds met.

**Step 4: Client build**

Run: `npm run build -w packages/client`
Expected: Build succeeds.

**Step 5: E2E tests**

Run: `npx playwright test`
Expected: All tests pass on Chromium.

If any step fails, fix before pushing. These are the exact checks CI will run.

---

### Task 5: Push and verify CI

**Step 1: Push the branch**

Run: `git push origin ovid/ci-cd`

**Step 2: Check the workflow run**

Go to the repo's Actions tab or run: `gh run list --limit 1`

Wait for all three jobs to complete. All should pass green.

If any job fails, read the logs (`gh run view <run-id> --log-failed`), fix, and push again.

---

### Task 6: Configure branch protection (manual — GitHub UI)

After at least one successful CI run, configure branch protection so `main` can't receive broken code.

**Step 1: Open branch protection settings**

Go to **repo > Settings > Branches**. Click **Add branch protection rule** (or **Add classic branch protection rule** if both options appear).

**Step 2: Configure the rule**

- Set **Branch name pattern** to `main`
- Enable **Require a pull request before merging**
  - Uncheck "Require approvals" (single-developer project)
- Enable **Require status checks to pass before merging**
  - Search for and select: `lint-format`, `test-build (20)`, `test-build (22)`, `e2e`
  - Enable **Require branches to be up to date before merging**
- Click **Create** (or **Save changes**)

**Step 3: Verify**

Open a PR. The merge button should be blocked until all four checks pass.
