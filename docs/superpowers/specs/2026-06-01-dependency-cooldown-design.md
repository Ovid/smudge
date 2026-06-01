# Dependency Cooldown Gate — Design

**Date:** 2026-06-01
**Status:** Approved (design, rev. 2 — incorporates adversarial pushback review); pending implementation plan
**Author:** Ovid (with Claude Code)

## Problem

Smudge pulls in a large npm dependency tree (direct + transitive). The
dominant npm supply-chain attack pattern is a freshly-published malicious
release of an otherwise-trusted package — typically caught and yanked by the
ecosystem within hours to days. Adopting a version the moment it ships maximizes
exposure to exactly this window.

This design adds an automated gate that refuses to let the project trust any
package version until it has been publicly available for at least **7 days**,
with an explicit, auditable escape hatch for urgent (e.g. security) adoptions.

## Threat model — what this defends, and what it does not

This control defends **one specific vector: a brand-new malicious version** of
an otherwise-trusted package. By measuring the *age* of every version in the
tree and refusing anything younger than 7 days (absent a waiver), it ensures a
compromised release has had a week of public exposure — long enough that the
ecosystem usually catches and yanks it — before Smudge adopts it.

It explicitly does **not** provide, and must not be presented as:

- **Integrity assurance.** Age is a *proxy*, not a hash. A long-existing version
  that is somehow served with a different payload still reads as old and would
  pass. The complementary defense already exists: `package-lock.json` records a
  Subresource-Integrity `integrity` hash per artifact, and `npm ci` refuses any
  tarball whose hash does not match. The cooldown gate and the lockfile
  `integrity` check are two distinct layers — age catches *new* malicious
  versions; `integrity` catches *tampered* artifacts of a pinned version. (npm
  also blocks republishing an identical version string after a short unpublish
  window, which closes most of the "republish same version with new payload"
  gap.) The spec deliberately keeps this gate focused on age and relies on the
  existing `integrity` enforcement for tamper detection.
- **Protection against a malicious package that lies low for >7 days.** A
  patient attacker who publishes a benign version and weaponizes a *later*
  version is still subject to the 7-day window on that later version, but a
  long-dormant payload in an already-aged version is out of scope.

The 7-day window is a risk-reduction measure against the common case, not a
guarantee.

## Policy

> No package version present in `package-lock.json` may be younger than
> **7 days** at check time, unless it has an explicit allowlist entry carrying
> a stated reason.

In the normal workflow — wait a week, *then* bump — adopted versions are
already older than 7 days and pass with **zero** allowlist entries. The
allowlist is the path for **every** sub-cooldown adoption, not only security
ones: any newly-added dependency (direct or transitive) that the team wants to
adopt before it is 7 days old — whether an urgent CVE fix or simply a new
feature dependency needed now — requires a waiver with a reason. The friction is
the point: a sub-cooldown adoption is always a conscious, recorded decision.

### Design decisions (and their rationale)

1. **Enforcement = CI/local gate on the lockfile** (not a Renovate/Dependabot
   cooldown). The repo updates dependencies manually today, and a lockfile gate
   catches *every* path a version can enter by — manual edits, future bot PRs,
   and transitive bumps — regardless of how it got there.
2. **Scope = direct + transitive.** The well-known real-world npm compromises
   (event-stream, ua-parser-js, etc.) were transitive: a trusted top-level
   package silently pulling a compromised child. A direct-only gate would have
   missed every one of them.
3. **Escape hatch = an auditable allowlist file.** Every bypass is a reviewable
   diff with a required reason — a deliberate, recorded decision, mirroring the
   existing license-audit paper trail. An override that leaves a record is
   itself a security control.
4. **Check evaluates the WHOLE lockfile every run** (not a diff vs. base).
   Simpler (no merge-base logic), self-healing (anything that slipped in stays
   flagged until it ages or is allowlisted), and it closes the blind spot a
   diff-based check would leave (a version adopted at age 0 never completing its
   cooldown).
5. **Runs as a dedicated CI job + an on-demand `make` target**, NOT inside
   `make all`. CI is where merges are blocked and always has network; keeping
   the check out of `make all` leaves the everyday offline local full-pass
   network-free.

## Components

### `scripts/dep-cooldown.mjs` (thin IO shell) + a covered core module

Following the established `scripts/native-cache.mjs` (pure, fully tested) vs.
`scripts/ensure-native.mjs` (thin IO shell) split, the logic is factored so the
coverage thresholds enforced on `scripts/` (95% statements / 85% branches / 90%
functions / 95% lines, per the root `vitest.config.ts` `scripts` project) are
met by testing pure logic directly:

- **Core (pure, fully covered):** lockfile parsing → deduped set of
  `name@version`; package-name derivation; age computation against an
  **injected `now`**; allowlist matching (including orphaned/stale detection);
  violation formatting. No network, no `process.exit`.
- **Shell (`dep-cooldown.mjs`, thin):** wires the core to real `fetch`, the
  on-disk cache, `process.exitCode`, and console output. Kept minimal; covered
  via injection where practical, and any unavoidable residue documented rather
  than excluded ad hoc.

Constraints (the repo enforces these — design for them from the start):

- The file is type-checked under **`tsc --checkJs`** (`tsconfig.tooling.json`
  includes `scripts/**/*.mjs` with `allowJs`/`checkJs`) and linted with
  **`--max-warnings 0`**. It must be JSDoc-typed and lint-clean as written.
- The cooldown window is a named constant `COOLDOWN_DAYS = 7`, overridable via
  an environment variable for tests. `now` is likewise injectable (param/env)
  so tests are deterministic and do not depend on the wall clock. Neither is a
  config-file knob — YAGNI until a per-package window is actually needed.

### `dependency-cooldown-allowlist.json` (repo root, committed)
The auditable escape hatch. An array of entries:

```json
[
  {
    "package": "@scope/some-package",
    "version": "1.2.3",
    "reason": "CVE-2026-1234 security fix — adopted before cooldown",
    "added": "2026-06-01"
  }
]
```

- A waiver matches by **exact** `package` + `version` (the `package` name
  includes any `@scope/` prefix).
- `reason` is **required** and non-empty; a missing/empty reason makes the
  script error, so nothing can be waved through silently.
- `added` is an ISO date for human auditing.

### Publish-time cache
A cache file mapping `name@version → ISO publish date`. Publish times are
immutable, so entries never expire and the cache only grows. Two consumers:

- **Local dev:** the cache lives at a gitignored path; first run fetches, later
  runs are fast/offline.
- **CI (authoritative gate):** because CI checks out fresh, the cache is
  **persisted across runs via `actions/cache`** so the gate does not refetch the
  entire tree's full metadata documents (hundreds of MB) on every run. Keying:
  a **stable primary key plus `restore-keys` prefix** so the accumulated cache
  is restored and extended rather than invalidated whenever the lockfile changes
  (keying solely on the lockfile hash would discard the cache at exactly the
  moment new dependencies are added). Only genuinely-new `name@version` pairs
  trigger a fetch.

The cache is an optimization for *speed*, never the source of truth for a
*missing* lookup — a cache miss falls through to a live fetch, and a failed
lookup is handled per "Edge cases" below, not silently passed.

## Data flow

1. Parse `package-lock.json`; collect every `packages` entry that resolves to
   the npm registry (has a `resolved` registry URL and a `version`).
2. **Derive the package name** from each `packages` key (a path): strip
   everything up to and including the **final** `node_modules/` segment; the
   remainder is the name and may include an `@scope/` prefix
   (e.g. `node_modules/@types/serve-static/node_modules/@types/send` →
   `@types/send`). A naive last-path-segment split is wrong for scoped packages
   and is explicitly rejected. For npm **alias** dependencies the lockfile entry
   carries a `name` field holding the real registry package (the key is the
   alias); when present, `name` takes precedence over the path-derived name.
3. **Deduplicate** to a set of distinct `name@version` (the same package appears
   at multiple lockfile paths; the current tree has ~885 entries collapsing to
   ~850 distinct pairs). Resolve and report each distinct pair once.
4. For each `name@version`:
   - If present in the cache, use the cached publish date.
   - Otherwise fetch the package's **full** registry metadata document
     (`https://registry.npmjs.org/<name>`, scoped names URL-encoded) and read
     `time[<version>]`. The **full** (non-abbreviated) document is **required**:
     the abbreviated install-metadata document
     (`Accept: application/vnd.npm.install-v1+json`) omits `time` entirely, so
     no `Accept` header is sent. When reading the `time` object, skip the
     `created` / `modified` sentinel keys — only per-version keys are publish
     dates. Cache the result.
5. Compute `age = now − publishDate` (with injected `now`). If
   `age < COOLDOWN_DAYS` **and** the `name@version` is not allowlisted → record
   a violation.
6. Print a deduped table of violations
   (`name@version — published N days ago (min 7)`), then set a non-zero exit. If
   there are no violations, exit 0.

## Allowlist behavior

- Exact `name@version` match (scope included) bypasses the cooldown.
- **Required reason:** empty/missing reason → script errors (non-zero exit).
- **Stale-entry warning (non-failing):** if an allowlisted version is still in
  the tree but now ≥ `COOLDOWN_DAYS` old, the script prints "waiver no longer
  needed, safe to remove" and still passes — keeping the allowlist from silently
  accreting dead entries.
- **Orphaned-waiver warning (non-failing):** if an allowlisted `name@version` is
  **no longer present** in the lockfile at all (common for transitive deps,
  whose resolved versions float on any `npm install`/dedupe), the script prints
  "waiver references a version no longer in the tree, safe to remove" and still
  passes. It does **not** hard-fail on an orphaned waiver — a stale escape-hatch
  entry is hygiene, not a security violation. (A future lint could promote
  either warning to a failure; out of scope here.)

## Edge cases & error handling

- **Non-registry deps** (git, `file:`, `link:`, workspace packages) have no
  registry publish date → skipped, with an informational count reported. They
  cannot be cooldown-checked.
- **Two distinct failure classes, handled differently** (the gate must not
  conflate "can't verify" with "found a violation"):
  - **Infrastructure failure** — registry unreachable, timeout, 5xx, or 429
    rate-limit. The fetch is retried with bounded exponential backoff. If it
    still fails, the run exits non-zero as an **infrastructure error** with a
    distinct message — the gate fails closed (an unverifiable run is not a
    pass), but the message makes clear this is npm being unavailable, not a
    tampered/young package. The persistent CI cache (above) keeps the cold-fetch
    surface — and thus exposure to transient outages — small in steady state.
  - **Version genuinely absent** — registry reached successfully but the
    resolved version has no `time[<version>]` entry (yanked/tampered/unexpected)
    → treated as a real **violation**, not an infra error.
- **Scoped packages** (`@scope/name`) handled via proper URL-encoding of the
  metadata request and correct name derivation (data flow step 2).

## Testing (TDD — red/green/refactor)

Vitest tests under `scripts/__tests__/` (existing pattern), exercising the pure
core directly with an injected `fetch`/clock so tests are deterministic and
offline. Cases:

- Young version, not allowlisted → **fails** (non-zero exit).
- Old version (≥ 7 days) → **passes**.
- Young version + matching allowlist entry → **passes**.
- Allowlisted version still in tree but now ≥ 7 days old → **passes**, emits
  stale-entry warning.
- Allowlisted `name@version` not present in the lockfile → **passes**, emits
  orphaned-waiver warning.
- Allowlist entry with missing/empty reason → **errors**.
- **Nested scoped package** name derivation
  (`…/@types/serve-static/node_modules/@types/send` → `@types/send`, not
  `send`) → resolves the correct package.
- Same `name@version` at two lockfile paths → exactly **one** violation row
  (dedupe).
- Non-registry dep (git/file/link/workspace) → **skipped**, counted.
- Registry **infrastructure failure** (timeout/5xx/429) after retries →
  non-zero **infra** exit, distinct message.
- Version **absent from `time`** on a reachable registry → **violation**.
- `time` object containing `created`/`modified` keys → those are ignored.

All tests must run without real network access and produce no stray console
noise (per the project's zero-warnings testing rule).

## Integration

- **`Makefile`:** add a `dep-cooldown:` target invoking
  `node scripts/dep-cooldown.mjs`. **Not** added to `make all`.
- **`.github/workflows/ci.yml`:** add a `dep-cooldown` job (checkout →
  `setup-node@v4` (node 22) → `npm ci` → restore/save the publish-time cache via
  `actions/cache` (stable key + `restore-keys`) → `make dep-cooldown`), running
  in parallel with the existing `lint-format`, `test-build`, and `e2e` jobs.
  This job is the authoritative gate.
- **`.gitignore`:** ignore the local publish-time cache path.
- **Docs:** add a "Dependency Cooldown" policy section to `CLAUDE.md`
  (alongside the existing "Dependency Licenses" policy), describing the 7-day
  rule, the threat model's age-vs-integrity boundary, the allowlist file, and
  how to add/remove a waiver.

## Out of scope (deliberately)

- Adopting Renovate/Dependabot (a separate decision; the lockfile gate works
  independently of any bot).
- Per-package or per-ecosystem cooldown windows.
- Auto-removing stale/orphaned allowlist entries / lint-failing on them
  (warnings only, for now).
- Artifact-integrity checking beyond the `integrity` hashes `npm ci` already
  enforces (see Threat model).

## PR scope note

This is a single feature and fits one PR under the project's one-feature rule.
It references no existing roadmap phase; if it is to be tracked there, add a
phase entry per the phase-boundary rule before opening the PR.
