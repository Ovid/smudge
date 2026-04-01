# CI/CD Pipeline Design

**Date:** 2026-04-01
**Status:** Approved

## Goal

Automate testing, linting, and build verification on every push and pull request using GitHub Actions. Prevent broken code from being merged to `main`.

## Pipeline Overview

A single workflow file (`.github/workflows/ci.yml`) triggers on:
- Every push to any branch
- Every pull request targeting `main`

Three jobs run **in parallel**:

```
push / PR
  |
  +-- lint-format      (Node 22, ~30s)
  +-- test-build       (Node 20 + 22 matrix, ~1-2min)
  +-- e2e              (Node 22, ~2-4min)
```

Total wall-clock time is determined by the slowest job (E2E).

## Job 1: lint-format

Runs on `ubuntu-latest`, Node 22.

| Step | Command |
|------|---------|
| Checkout | `actions/checkout@v4` |
| Setup Node | `actions/setup-node@v4` (Node 22) |
| Install deps | `npm ci` |
| Lint | `npm run lint` |
| Format check | `npm run format:check` |

Uses `npm ci` (not `npm install`) for faster, reproducible installs that fail if `package-lock.json` is out of sync.

Single Node version only — linting is static analysis, not execution.

## Job 2: test-build

Runs on `ubuntu-latest`, **matrix** of Node 20 and Node 22 (two parallel runners).

| Step | Command |
|------|---------|
| Checkout | `actions/checkout@v4` |
| Setup Node | `actions/setup-node@v4` (from matrix) |
| Install deps | `npm ci` |
| Run tests | `npx vitest run --coverage` |
| Build client | `npm run build -w packages/client` |

**Coverage enforcement:** `vitest.config.ts` already defines thresholds (95% statements, 85% branches, 90% functions, 95% lines). Vitest exits non-zero when thresholds aren't met, which fails the CI job automatically.

**Build step** runs after tests. Catches TypeScript errors and Vite production-mode strictness issues. Skipped if tests fail (no wasted time).

**Database:** Tests use in-memory SQLite (`:memory:`) with automatic migrations via `setupTestDb()`. No CI-specific database setup needed.

## Job 3: e2e

Runs on `ubuntu-latest`, Node 22.

| Step | Command |
|------|---------|
| Checkout | `actions/checkout@v4` |
| Setup Node | `actions/setup-node@v4` (Node 22) |
| Install deps | `npm ci` |
| Install browsers | `npx playwright install --with-deps chromium` |
| Run E2E tests | `npx playwright test` |
| Upload artifacts | `actions/upload-artifact@v4` (on failure only) |

**Browser install:** `--with-deps` installs system-level dependencies (fonts, libraries) that Ubuntu runners don't have by default. Only Chromium is installed (matches current Playwright config).

**Server startup:** Handled by Playwright's `webServer` config — it starts both the API server (port 3456) and client dev server (port 5173) automatically.

**Artifact upload:** On failure, screenshots and traces are uploaded as downloadable artifacts (7-day retention). Makes debugging CI-only failures possible without reproducing locally.

Single Node version — E2E tests browser behavior, not Node compatibility.

## Supporting File Changes

### `.nvmrc` (new)

Contains `20`. Documents target Node LTS version and enables `nvm use` to pick it up automatically.

### `package.json` (modified)

Add `engines` field:

```json
"engines": {
  "node": ">=20"
}
```

Informational — documents minimum supported Node version. Relevant for future Electron packaging where different Electron versions bundle different Node runtimes.

## Branch Protection Setup

After the first successful pipeline run, configure in GitHub web UI:

1. Go to **repo > Settings > Branches**
2. Click **Add branch protection rule** (or **Add classic branch protection rule** if both options appear)
3. Set **Branch name pattern** to `main`
4. Enable **Require a pull request before merging**
   - Uncheck "Require approvals" (single-developer project)
5. Enable **Require status checks to pass before merging**
   - Search for and select: `lint-format`, `test-build (20)`, `test-build (22)`, `e2e`
   - Enable **Require branches to be up to date before merging**
6. Click **Create** (or **Save changes**)

After this, the merge button on PRs will be blocked unless all four checks pass.

## What's Excluded (YAGNI)

- **Docker build/push** — No Dockerfile exists yet
- **Deployment steps** — No deployment target defined
- **node_modules caching** — `npm ci` is fast enough at current project size; caching adds config complexity for marginal gain
- **Release automation** — Premature without a release process
- **Multi-browser E2E** — Single browser is sufficient for current testing needs

## Future Considerations (Electron)

When the project moves to Electron:

- **Electron bundles its own Node/Chromium** — the Node matrix (20 + 22) helps ensure server-side code stays compatible across versions that different Electron releases may use
- **Platform-specific builds** — Electron packaging will need CI jobs for Windows, macOS, and Linux. GitHub Actions supports all three via `runs-on: [ubuntu-latest, macos-latest, windows-latest]`
- **Code signing** — macOS and Windows require signed binaries for distribution. This will need secrets stored in GitHub Actions
- **The CI workflow designed here remains valid** — linting, testing, and coverage checking don't change when Electron is added. Electron packaging would be an additional job, not a replacement
