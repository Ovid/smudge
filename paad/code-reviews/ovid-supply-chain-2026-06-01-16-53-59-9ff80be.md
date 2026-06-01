# Agentic Code Review: ovid/supply-chain

**Date:** 2026-06-01 16:53:59
**Branch:** ovid/supply-chain -> main
**Commit:** 9ff80be3b50c75196f72f50dacd951a98e3ea282
**Files changed:** 11 | **Lines changed:** +2335 / -1
**Diff size category:** Large (code surface ~820 lines; remainder docs/plans)

## Executive Summary

This branch adds a dependency-cooldown supply-chain gate (pure core + thin IO shell, well-tested, faithful to its design spec). The architecture, error taxonomy, and test coverage of the pure core are strong. However, two **Critical** findings let the gate be slipped past by an attacker who can influence the lockfile — the exact threat the gate is built to defend: a host-blind registry-URL heuristic and a first-slash-only URL encoder both cause the gate to age-check a *different* (innocent, aged) package than the one actually installed. One **Important** finding is a test gap on the gate's fail-closed (infra exit 3 vs violation exit 1) path — the most security-load-bearing branch has zero coverage. Confidence in the findings is high for the two Criticals (exploit paths traced empirically by the verifier).

## Critical Issues

### [C1] First-slash-only URL encoding lets a crafted lockfile name fetch a different package's publish date
- **File:** `scripts/dep-cooldown.mjs:60-61` (`fetchMetadata`)
- **Bug:** `name.replace("/", "%2F")` replaces only the **first** slash (string argument, not a global regex). A crafted name such as `@scope/a/../../b` becomes `https://registry.npmjs.org/@scope%2Fa/../../b`, which `new URL()` normalizes to `https://registry.npmjs.org/b`. The gate then reads `b`'s publish times and applies them to the crafted entry. The docstring's "scoped names contain exactly one slash" assumption does not hold — the lockfile (and `entry.name`) is the untrusted input the gate exists to police.
- **Impact:** A malicious entry can borrow an unrelated, long-aged package's publish date and sail through the cooldown. Defeats the gate's core promise for a lockfile-influencing attacker.
- **Suggested fix:** Use `name.replaceAll("/", "%2F")` (or `.replace(/\//g, "%2F")`) and validate `name` against the npm package-name grammar before building the URL — reject `..`, reject more than one slash for a scoped name.
- **Confidence:** High
- **Found by:** Security, Spec Compliance (`claude-opus-4-8[1m]`)

### [C2] `isRegistryResolved` ignores the host, so the gate age-checks an unrelated npmjs artifact
- **File:** `scripts/dep-cooldown-core.mjs:54-56` (`isRegistryResolved`), consumed at `scripts/dep-cooldown.mjs:127`
- **Bug:** `isRegistryResolved` returns true for **any** `https?://…/-/…` URL regardless of host (e.g. `https://evil.example/foo/-/foo-1.0.0.tgz` → true). `fetchMetadata` then always fetches `https://registry.npmjs.org/<entry.name>`. A lockfile entry resolved to a non-npm host but named `foo@1.0.0` is age-checked against npmjs's real `foo@1.0.0`; if that is ≥7 days old, the off-registry (potentially malicious) version passes. `entry.name` — used as the fetched name — is itself attacker-controlled.
- **Impact:** The cooldown can be bypassed by pointing `resolved` at an attacker-controlled host whose tarball path matches the `/-/` heuristic, while the age check validates an innocent npmjs package. `npm ci`'s `integrity` hash remains a distinct layer, but the cooldown gate itself — the age defense the spec advertises — is circumvented.
- **Suggested fix:** Parse `resolved` with `new URL()` and require `host === "registry.npmjs.org"` (or an explicit allowed-registry list); skip or flag anything else rather than silently age-checking it. Cross-check the fetched name against the host-validated `resolved` URL rather than trusting `entry.name`.
- **Confidence:** High
- **Found by:** Security (`claude-opus-4-8[1m]`)

## Important Issues

### [I1] No test for the infra-failure path (retries exhausted → fail-closed exit 3)
- **File:** `scripts/__tests__/dep-cooldown-core.test.mjs` / `scripts/dep-cooldown.mjs:118-137` (vs spec §Testing, lines 242-243)
- **Bug:** The spec lists "registry infrastructure failure after retries → non-zero infra exit, distinct message" as a required TDD case. The fail-closed distinction (infra `exit 3` vs violation `exit 1`) — the gate's central safety property — lives entirely in the coverage-excluded shell and has zero tests. `isRetriableStatus` is unit-tested, but the retry-loop control and the exit-3 decision are not.
- **Impact:** A regression flipping the infra path to fail-open (e.g. `exit 0` on fetch failure) would pass CI silently. Fail-open is the worst failure mode for a security gate.
- **Suggested fix:** Extract the retry-loop control into an injectable pure core function and unit-test exit-3 on exhaustion; or add a shell integration test with a stubbed always-failing `fetch` asserting `process.exitCode === 3` and the distinct message.
- **Confidence:** Medium
- **Found by:** Spec Compliance (`claude-opus-4-8[1m]`)

## Suggestions

- **[S1]** `scripts/dep-cooldown.mjs:64-76` — Non-retriable HTTP status (e.g. 404) is `throw`n *inside* the `try` (line 68), caught at 71, and **retried** (3 more attempts + backoff) instead of failing fast, contradicting the function's own docstring. Still fails closed, but wastes ~3.5s/affected package and conflates "definitively absent" with "transient infra." Fix: branch on `!isRetriableStatus(res.status)` and re-throw past the catch (tag the error fatal, or check status before the retry loop). (Found by: Error Handling)
- **[S2]** `scripts/dep-cooldown.mjs:138-143` (+ `core:211-216`) — A valid 200 whose `time` object is missing entirely / non-object collapses via `(doc && doc.time) || {}` to `{}`, so every version becomes an "absent" violation (hard `exit 1`, no retry, not infra) — more plausibly a partial/stale CDN response than a yank. Per-version absence is spec-sanctioned; the whole-`time`-missing sub-case is not. Fix: treat a doc with absent/non-object `time` as an infra error (retry → exit 3); reserve absent-violation for a populated `time` lacking the specific version. (Found by: Error Handling)
- **[S3]** `scripts/__tests__/dep-cooldown-core.test.mjs` (vs spec line 245) — Missing the spec-mandated test that `time` sentinel keys (`created`/`modified`) are ignored. Correct-by-construction today (exact-key read at `dep-cooldown.mjs:140`), but the only code touching `time` is coverage-excluded, so a future `Object.entries(time)` regression is caught by neither test nor coverage. Fix: extract the `time`-read into the pure core and unit-test it, or add a shell integration test with `created`/`modified` in the stubbed `time`. (Found by: Error Handling, Spec Compliance)
- **[S4]** `scripts/dep-cooldown.mjs:31` — `Number(process.env.DEP_COOLDOWN_DAYS ?? "7")`: an empty string yields `0` (gate passes everything and reports "OK" — a silently disabled gate); non-numeric yields `NaN` (every version flagged young). The var is a test/override hook not wired into CI, so reachability is low. Fix: validate after coercion (`Number.isFinite(n) && n > 0`) and fail closed otherwise. (Found by: Logic & Correctness)
- **[S5]** `scripts/dep-cooldown.mjs:106-122` + `.github/workflows/ci.yml:80-86` — The publish-time cache is authoritative for present entries (when every id in a name-group is cached, no fetch occurs), with no integrity/provenance/bounds check; a forged entry makes a young version read as old. The broad `restore-keys: dep-cooldown-` prefix means a cache written by any branch/PR run can be restored onto main. Fix: tighten the CI cache key/restore scope so cross-branch caches aren't restored onto main; document the cache as a trust boundary; optionally re-validate near-boundary cached dates with a live fetch. (Found by: Security)
- **[S6]** `.github/workflows/ci.yml:74,87` (new `dep-cooldown` job only) — `npm ci` runs scripts-enabled *before* `make dep-cooldown`, so a fresh malicious dep's install/postinstall scripts execute on the runner (which holds `GITHUB_TOKEN`) before the gate can block the merge. The job needs only the lockfile. Fix: run the gate's install as `npm ci --ignore-scripts`, or gate before any scripts-enabled install; at minimum document the residual exposure. (The other jobs' pre-existing `npm ci` lines are out of this branch's scope and carved out.) (Found by: Security)

## Out-of-Scope Additions

> **Handoff instructions for any agent processing this report:** The entries below are code this branch added that the spec did not promise. They may be legitimate "while I'm here" fixes for issues exposed by this work, or scope creep that should live in a separate PR. Do **not** assume they should stay on this branch, and do **not** assume they should be reverted. Present them to the user **as a single batched ask**: "These additions weren't promised by the spec — keep, split into a separate PR, or revert?" The user decides per item.
>
> Out-of-scope additions are flagged for this PR only — they do not persist to `paad/code-reviews/backlog.md`.

### [OOSA1] Defensive behaviors beyond the literal spec data-flow
- **File:** `scripts/dep-cooldown-core.mjs:209-216`, `scripts/dep-cooldown-core.mjs:29`, `scripts/dep-cooldown.mjs:79-87`, `scripts/dep-cooldown.mjs:106-114`
- **Addition:** Four defensive behaviors the spec's data-flow did not describe: (a) treating an **unparseable (NaN) publish date** as an "absent" violation (`core:209-216`) — the spec defines "absent" as a missing `time` entry only; a garbage-but-present date string is a new sub-case folded into the same guard; (b) corrupt/unreadable **cache → warn + refetch** (`dep-cooldown.mjs:106-114`); (c) **lockfile-read try/catch** for a friendly diagnostic (`dep-cooldown.mjs:79-87`); (d) **empty-name null guard** in `derivePackageName` (`core:29`). (The npm-alias `entry.name` precedence is *spec-sanctioned* per spec lines 164-165 and is therefore **not** an addition.)
- **Suggested intent source:** `docs/superpowers/specs/2026-06-01-dependency-cooldown-design.md` (design spec) + the implementation plan + branch commits.
- **Confidence:** Medium
- **Found by:** Spec Compliance (`claude-opus-4-8[1m]`)
- **Recommendation (verifier):** Keep — all four are harmless, fail-closed, and covered; (a) specifically closes a real "garbage date reads as young" trap.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Spec Compliance (6 specialists, parallel) + 1 Verifier
- **Scope:** `scripts/dep-cooldown-core.mjs`, `scripts/dep-cooldown.mjs`, `scripts/__tests__/dep-cooldown-core.test.mjs`, `dependency-cooldown-allowlist.json`, `.github/workflows/ci.yml` (new `dep-cooldown` job), `Makefile` (new target), `vitest.config.ts` (coverage exclusion), `.gitignore` (cache entry); adjacent: `package-lock.json` shape, `scripts/vitest.config.ts`
- **Raw findings:** 13 (before verification)
- **Verified findings:** 9 (after verification; 2 Critical, 1 Important, 6 Suggestion) + 1 out-of-scope addition
- **Filtered out:** 4 (S3 derivePackageName non-finding dropped; 2 Contract below-bar observations not carried; duplicate merges E3≡S1, SEC2≡S4)
- **Out-of-scope findings:** 0 (Critical: 0, Important: 0, Suggestion: 0)
- **Out-of-scope additions:** 1
- **Backlog:** 0 new entries added, 0 re-confirmed (see `paad/code-reviews/backlog.md`) — every confirmed bug is on new/touched code, so all are in-scope
- **Steering files consulted:** `CLAUDE.md` (no contradictions with the implementation)
- **Intent sources consulted:** `docs/superpowers/specs/2026-06-01-dependency-cooldown-design.md`, `docs/superpowers/plans/2026-06-01-dependency-cooldown.md`, recent commit messages, branch name
- **Verifier warnings:** none
