# Dependency Cooldown Gate — Design

**Date:** 2026-06-01
**Status:** Approved (design); pending implementation plan
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

## Policy

> No package version present in `package-lock.json` may be younger than
> **7 days** at check time, unless it has an explicit allowlist entry carrying
> a stated reason.

In the normal workflow — wait a week, *then* bump — adopted versions are
already older than 7 days and pass with **zero** allowlist entries. The
allowlist is touched only for deliberate young adoptions.

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

### `scripts/dep-cooldown.mjs`
Node ESM script, following the existing `scripts/ensure-native.mjs` /
`scripts/native-cache.mjs` conventions. Responsibilities:
- Read and parse `package-lock.json`.
- For each registry-sourced version, resolve its publish date.
- Apply the allowlist.
- Print violations and exit non-zero on any; exit 0 when clean.

The cooldown window is a single named constant `COOLDOWN_DAYS = 7`, overridable
via an environment variable for tests. It is intentionally **not** a config-file
knob — YAGNI until a per-package window is actually needed.

### `dependency-cooldown-allowlist.json` (repo root, committed)
The auditable escape hatch. An array of entries:

```json
[
  {
    "package": "some-package",
    "version": "1.2.3",
    "reason": "CVE-2026-1234 security fix — adopted before cooldown",
    "added": "2026-06-01"
  }
]
```

- A waiver matches by **exact** `package` + `version`.
- `reason` is **required** and non-empty; a missing/empty reason makes the
  script error, so nothing can be waved through silently.
- `added` is an ISO date for human auditing.

### Publish-time cache (gitignored)
A local cache file (in the spirit of `.native-cache`) mapping
`name@version → ISO publish date`. Publish times are immutable, so entries never
expire. Makes repeat and local runs fast and offline-friendly after the first
fetch. The cache is an optimization only — never the source of truth for a
*missing* lookup.

## Data flow

1. Parse `package-lock.json`; collect every `packages` entry that resolves to
   the npm registry (has a `resolved` registry URL and a `version`).
2. For each `name@version`:
   - If present in the cache, use the cached publish date.
   - Otherwise fetch the package's registry metadata
     (`https://registry.npmjs.org/<name>`), read `time[version]`, and cache it.
     Scoped packages (`@scope/name`) are URL-encoded correctly.
3. Compute `age = now − publishDate`. If `age < COOLDOWN_DAYS` **and** the
   `name@version` is not allowlisted → record a violation.
4. Print a table of violations
   (`name@version — published N days ago (min 7)`), then exit 1. If there are no
   violations, exit 0.

## Allowlist behavior

- Exact `name@version` match bypasses the cooldown.
- **Required reason:** empty/missing reason → script errors (non-zero exit).
- **Stale-entry warning (non-failing):** if an allowlisted version is now
  ≥ `COOLDOWN_DAYS` old, the script prints "waiver no longer needed, safe to
  remove" but still passes. This keeps the allowlist from silently accreting
  dead entries without blocking anyone. (A future lint could promote this to a
  failure; out of scope here.)

## Edge cases & error handling

- **Non-registry deps** (git, `file:`, `link:`, workspace packages) have no
  registry publish date → skipped, with an informational count reported. They
  cannot be cooldown-checked.
- **Registry unreachable, or package/version missing from registry metadata** →
  **hard error** (non-zero exit). A lookup failure must not be a free pass: a
  gate that opens when it cannot verify is not a gate. The cache makes transient
  failures rare in practice.
- **Scoped packages** handled via proper URL-encoding of the metadata request.

## Testing (TDD — red/green/refactor)

Vitest tests under `scripts/__tests__/` (existing pattern), with the registry
fetch injected/mocked so tests are deterministic and offline. Cases:

- Young version, not allowlisted → **fails** (non-zero exit).
- Old version (≥ 7 days) → **passes**.
- Young version + matching allowlist entry → **passes**.
- Allowlisted version that is now ≥ 7 days old → **passes**, emits stale-entry
  warning.
- Allowlist entry with missing/empty reason → **errors**.
- Non-registry dep (git/file/link/workspace) → **skipped**, counted.
- Registry lookup failure / version absent from metadata → **non-zero exit**.

All tests must run without real network access and produce no stray
console noise (per the project's zero-warnings testing rule).

## Integration

- **`Makefile`:** add a `dep-cooldown:` target invoking
  `node scripts/dep-cooldown.mjs`. **Not** added to `make all`.
- **`.github/workflows/ci.yml`:** add a `dep-cooldown` job (checkout →
  `setup-node@v4` (node 22) → `npm ci` → `make dep-cooldown`), running in
  parallel with the existing `lint-format`, `test-build`, and `e2e` jobs. This
  job is the authoritative gate.
- **`.gitignore`:** ignore the publish-time cache file.
- **Docs:** add a "Dependency Cooldown" policy section to `CLAUDE.md`
  (alongside the existing "Dependency Licenses" policy), describing the 7-day
  rule, the allowlist file, and how to add/remove a waiver.

## Out of scope (deliberately)

- Adopting Renovate/Dependabot (a separate decision; the lockfile gate works
  independently of any bot).
- Per-package or per-ecosystem cooldown windows.
- Auto-removing stale allowlist entries / lint-failing on them (warning only,
  for now).

## PR scope note

This is a single feature and fits one PR under the project's one-feature rule.
It references no existing roadmap phase; if it is to be tracked there, add a
phase entry per the phase-boundary rule before opening the PR.
