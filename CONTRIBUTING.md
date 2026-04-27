# Contributing to Smudge

Smudge is a writing app for long-form work. This doc is the practical guide to
working on the codebase: how to set up a dev environment, how to run the suite,
and what conventions the project holds itself to. Architectural invariants and
design decisions live in [`CLAUDE.md`](CLAUDE.md) — this file points to them
rather than duplicating them.

## Quick start

```bash
git clone https://github.com/Ovid/smudge.git
cd smudge
nvm install         # reads .nvmrc — installs and selects Node 22 LTS (Jod)
npm install
make dev            # server + client on http://localhost:3456
```

E2E tests need browser binaries installed once per machine:

```bash
npx playwright install
```

## Development environment

### Node version: 22 LTS (Jod)

`.nvmrc` is pinned to `22`, and `package.json` declares
`"engines": { "node": "22.x" }`. Smudge is supported on Node 22 LTS (Jod) and
runs its CI there. Node 20 (Iron) reaches end-of-life at the end of April 2026
— the project deliberately moved past it rather than pin to a runtime about to
leave the support window.

### The DEP0040 workaround

Two transitive dependencies still `require("punycode")` (the Node built-in,
promoted to a runtime deprecation warning on Node 21+):

- `jsdom → whatwg-url → tr46` — pulled in by client tests
- `eslint → ajv@6 → uri-js` — pulled in by lint and schema paths

Without mitigation, every forked Vitest worker prints a `DEP0040` line at
startup, violating Smudge's zero-warnings-in-test-output rule (see CLAUDE.md
§Testing Philosophy) and masking real warnings.

The Makefile sets:

```makefile
export NODE_OPTIONS := --disable-warning=DEP0040 ${NODE_OPTIONS}
```

That suppresses **only** the `DEP0040` code — every other deprecation warning
still prints — and only for Make-invoked commands (`test`, `dev`, `lint`,
`e2e`, etc.). Production Docker builds are unaffected because Docker does not
inherit Make's env.

If you run `npm test` or `npx vitest run` directly without going through the
Makefile, you will see `DEP0040` lines. Either prepend the flag yourself
(`NODE_OPTIONS='--disable-warning=DEP0040' npx vitest run`) or prefer
`make test`.

When `tr46` and `uri-js` ship releases that use the userland `punycode/`
specifier, remove the `NODE_OPTIONS` line from the Makefile. Tracked in
[`docs/TODO.md`](docs/TODO.md) under *Tech Debt → DEP0040 suppression*.

### Paths worth knowing

- App runs at `http://localhost:3456` (Express serves the API; Vite proxies
  the client in dev).
- SQLite DB: `packages/server/data/smudge.db`. `make clean` wipes it (and the
  WAL/SHM files) for a full reset — there is no automatic recovery.

## Everyday workflow

| Command | What it does |
|---|---|
| `make dev` | Start server + client dev servers |
| `make test` | Run the full Vitest suite, fast, no coverage |
| `make cover` | Run tests with coverage thresholds enforced |
| `make e2e` | Run Playwright e2e tests (boots its own dev servers) |
| `make e2e-clean` | Wipe the isolated e2e data dir (`os.tmpdir()/smudge-e2e-data-<UID>/`) so the next `make e2e` starts fresh — refuses to wipe while a live `make e2e` is running |
| `make lint` | ESLint with autofix |
| `make format` | Prettier write |
| `make all` | `lint` + `format-check` + `typecheck` + `cover` + `e2e` — the CI gate |
| `make ensure-native` | Probe better-sqlite3's `.node`; rebuild from source on dlopen failure |
| `make clean` | Delete the dev SQLite database |
| `make help` | List all targets |

`make ensure-native` is a prerequisite of `dev`/`test`/`cover`/`e2e`,
so you generally don't invoke it directly. It exists because
better-sqlite3 ships a precompiled `.node` keyed on
{platform, arch, node-abi}: switching between a macOS host and a
Linux VM/container that share `node_modules` (or installing under
a wrong-major Node) leaves a binary that won't `dlopen`. The
recipe detects that, rebuilds from source in place, and re-probes.
The rebuild path needs a C++ toolchain (`build-essential` on
Linux, Xcode Command Line Tools on macOS) and `python3` for
node-gyp; install those once per machine. No `.node` binary is
fetched from the network — compilation replaces network trust.

Per-package test runs, when working on one package:

```bash
npm test -w packages/shared
npm test -w packages/server
npm test -w packages/client
npx playwright test
```

These bypass `make ensure-native`. After a host↔guest crossing or
a Node-version switch, run `make ensure-native` once before the
per-package commands, or just use `make test` instead.

## Code quality bars

These are enforced rules, not guidelines. Full text in `CLAUDE.md`:

- **Zero warnings in test output.** No stray `console.warn`, `console.error`,
  or DEP-code noise. Spy and assert on deliberate error paths. (CLAUDE.md
  §Testing Philosophy)
- **Coverage thresholds** are enforced in `vitest.config.ts`: 95% statements,
  85% branches, 90% functions, 95% lines. Write more tests — don't lower the
  floor. (CLAUDE.md §Testing Philosophy)
- **Accessibility is WCAG 2.1 AA**, not optional. Semantic HTML, live regions,
  keyboard parity, reduced-motion, 200% zoom. aXe-core runs in Playwright.
  (CLAUDE.md §Accessibility)
- **Save-pipeline invariants** govern any server call that can overwrite
  editor state. New mutation flows route through `useEditorMutation`;
  sequence-gated flows through `useAbortableSequence`. Both are
  ESLint-enforced. (CLAUDE.md §Key Architecture Decisions)
- **Unified API error mapping.** Every user-visible error message routes
  through `mapApiError(err, scope)` in `packages/client/src/errors/`. No raw
  `err.message` in the UI. (CLAUDE.md §Key Architecture Decisions)
- **String externalization.** UI strings live in
  `packages/client/src/strings.ts`, never as raw literals in components.
- **Red-green-refactor.** Write the failing test first wherever feasible.

## Pull requests

Smudge enforces two PR rules that exist because of past pain. Full rationale in
CLAUDE.md §Pull Request Scope:

- **One-feature rule.** A PR delivers one feature *or* one refactor. Bug fixes
  related to the feature are fine; unrelated fixes aren't. When in doubt,
  split.
- **Phase-boundary rule.** Each phase in [`docs/roadmap.md`](docs/roadmap.md)
  is at most one PR. Splitting a phase into smaller PRs is welcome; merging
  two phases into one PR is not.

### Branch naming

`<owner>/<slug>` — e.g. `ovid/unified-error-mapper`,
`ovid/snapshots-find-and-replace`.

### Commit messages

Conventional commits, lowercase, scoped where helpful:

```
fix(test): pin eslint cwd to repo root in sequence-rule test
refactor(errors): replace instanceof ApiRequestError with type-guard helpers
docs(todo): capture deferred suggestions from unified-error-mapper review
```

Prefer several small commits over one swept-up commit. Reviewers read diffs,
not just the final state.

## Adding or updating dependencies

Every dependency must be compatible with commercial use. Before merging any
`package.json` change:

1. Read the license in `node_modules/<pkg>/package.json`.
2. Check against the allowlist in
   [`docs/dependency-licenses.md`](docs/dependency-licenses.md). MIT, ISC, BSD
   variants, Apache-2.0, OFL-1.1, 0BSD, and CC0-1.0 are clean. MPL-2.0 needs a
   note. GPL / AGPL / SSPL / EUPL are blockers — flag them.
3. Update `docs/dependency-licenses.md` with the new entry.
4. If the dependency is dual-licensed, record which license you elected.

`overrides` in the root `package.json` are fine for pinning transitive
versions (example: `@types/express`). Document non-obvious overrides with a
short comment in `docs/` explaining why.

## Where things live

```
packages/
  shared/       types, Zod schemas, countWords()
  server/       Express API, domain modules, Knex migrations
    src/projects/, chapters/, velocity/, settings/,
        chapter-statuses/, db/
  client/       React SPA, components/, hooks/, pages/, api/,
                errors/, strings.ts
e2e/            Playwright tests
docs/
  plans/                    Design specs per feature
  roadmap.md                Phases and what they unlock
  dependency-licenses.md    Dependency license audit
  TODO.md                   Revisit-later items
CLAUDE.md                   Architectural invariants and the
                            non-negotiable rules
```

## Reporting issues

Open a GitHub issue. For bugs, include reproduction steps, actual vs. expected
behavior, and — for UI issues — a screenshot or short video.

## License

Smudge is released under the [MIT License](LICENSE). Contributions are accepted
under the same license.
