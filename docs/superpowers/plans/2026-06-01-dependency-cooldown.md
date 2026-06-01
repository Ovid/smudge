# Dependency Cooldown Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CI/local gate that refuses any package version in `package-lock.json` younger than 7 days unless it is explicitly allowlisted with a reason, shrinking the window in which a freshly-compromised npm release can reach Smudge.

**Architecture:** A pure, fully-unit-tested core (`scripts/dep-cooldown-core.mjs`) does all decision logic — lockfile parsing, package-name derivation, dedup/grouping, allowlist parsing, age classification, report formatting. A thin IO shell (`scripts/dep-cooldown.mjs`) wires the core to real `fetch` (npm registry full-metadata `time` field), an on-disk publish-time cache, and process exit codes. This mirrors the existing `native-cache.mjs` (covered core) / `ensure-native.mjs` (coverage-excluded shell) split. The gate runs as a dedicated CI job (authoritative, with `actions/cache`-persisted publish times) and an on-demand `make dep-cooldown` target — never inside `make all` (keeps the offline local full-pass network-free).

**Tech Stack:** Node 22 ESM (`.mjs`, `// @ts-check` + JSDoc, type-checked under `tsconfig.tooling.json`, linted `--max-warnings 0`), Vitest (scripts project), global `fetch`, GitHub Actions, Make.

**Spec:** `docs/superpowers/specs/2026-06-01-dependency-cooldown-design.md`

---

## File Structure

| File | Responsibility | Action |
| --- | --- | --- |
| `scripts/dep-cooldown-core.mjs` | Pure logic: name derivation, registry-version collection, grouping, allowlist parsing, classification, report formatting. No IO. **Under coverage.** | Create |
| `scripts/dep-cooldown.mjs` | Thin IO shell: read lockfile/allowlist/cache, fetch registry metadata with retry, persist cache, print report, set exit code. **Coverage-excluded** (per `ensure-native.mjs` precedent). | Create |
| `scripts/__tests__/dep-cooldown-core.test.mjs` | Unit tests for the core. | Create |
| `dependency-cooldown-allowlist.json` | Committed allowlist (starts `[]`). The auditable escape hatch. | Create |
| `.gitignore` | Ignore the local publish-time cache. | Modify |
| `vitest.config.ts` | Exclude the thin shell from coverage. | Modify (`:16-31`) |
| `Makefile` | `dep-cooldown` target + `.PHONY`. | Modify (`:6`, after `:74`) |
| `.github/workflows/ci.yml` | `dep-cooldown` job with `actions/cache`. | Modify |
| `CLAUDE.md` | "Dependency Cooldown" policy section. | Modify |

**Naming contract (used across tasks — keep consistent):**
- `versionId(name, version)` → `` `${name}@${version}` `` (the canonical dedup/cache/allowlist key, called an **id**).
- Core exports: `derivePackageName`, `versionId`, `isRegistryResolved`, `collectRegistryVersions`, `groupVersionsByName`, `parseAllowlist`, `isRetriableStatus`, `classify`, `buildReport`.
- `classify(...)` returns `{ violations: Array<{ id, ageDays: number|null, kind: "young"|"absent" }>, staleWaivers: string[], orphanedWaivers: string[] }`.

**Running scripts tests:** `npx vitest run --project scripts` (fallback: `cd scripts && npx vitest run`). Note the root `npm test` does **not** cover the `scripts` project — always use the command above for these tests.

---

## Task 1: Core module skeleton — `derivePackageName`, `versionId`, `isRegistryResolved`

**Files:**
- Create: `scripts/dep-cooldown-core.mjs`
- Test: `scripts/__tests__/dep-cooldown-core.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `scripts/__tests__/dep-cooldown-core.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import {
  derivePackageName,
  versionId,
  isRegistryResolved,
} from "../dep-cooldown-core.mjs";

describe("derivePackageName", () => {
  it("returns the name after the only node_modules/ segment", () => {
    expect(derivePackageName("node_modules/react")).toBe("react");
  });

  it("keeps the @scope/ prefix for a scoped package", () => {
    expect(derivePackageName("node_modules/@types/node")).toBe("@types/node");
  });

  // The bug a naive split would cause: for a NESTED scoped package the name is
  // everything after the LAST node_modules/, which still contains a slash.
  it("derives a nested scoped package from the last node_modules/ segment", () => {
    expect(
      derivePackageName("node_modules/@types/serve-static/node_modules/@types/send"),
    ).toBe("@types/send");
  });

  it("returns null for a workspace/own-code key with no node_modules/", () => {
    expect(derivePackageName("packages/server")).toBeNull();
    expect(derivePackageName("")).toBeNull();
  });
});

describe("versionId", () => {
  it("joins name and version with @", () => {
    expect(versionId("react", "18.3.1")).toBe("react@18.3.1");
    expect(versionId("@types/node", "22.0.0")).toBe("@types/node@22.0.0");
  });
});

describe("isRegistryResolved", () => {
  it("accepts an npm registry tarball URL (incl. scoped)", () => {
    expect(isRegistryResolved("https://registry.npmjs.org/react/-/react-18.3.1.tgz")).toBe(true);
    expect(
      isRegistryResolved("https://registry.npmjs.org/@types/node/-/node-22.0.0.tgz"),
    ).toBe(true);
  });

  it("rejects git, file, and missing resolved URLs", () => {
    expect(isRegistryResolved("git+ssh://git@github.com/x/y.git#abc123")).toBe(false);
    expect(isRegistryResolved("file:../local-pkg")).toBe(false);
    expect(isRegistryResolved(undefined)).toBe(false);
    expect(isRegistryResolved("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project scripts`
Expected: FAIL — `Failed to resolve import "../dep-cooldown-core.mjs"` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `scripts/dep-cooldown-core.mjs`:

```js
// @ts-check
/**
 * Pure logic for the dependency-cooldown gate. No IO of its own — the caller
 * (scripts/dep-cooldown.mjs) injects the lockfile object, publish dates, the
 * allowlist, and `now`, so every decision is unit-testable offline.
 *
 * See docs/superpowers/specs/2026-06-01-dependency-cooldown-design.md.
 */

/** Marker separating path segments in a package-lock v3 `packages` key. */
const NODE_MODULES = "node_modules/";

/**
 * Derive a package name from a package-lock v3 `packages` key (a path). The
 * name is everything after the FINAL `node_modules/` segment and may include an
 * `@scope/` prefix. A naive last-path-segment split is WRONG for scoped
 * packages (it would yield `send` from `@types/send`), so we slice from the
 * last marker instead. Keys without a `node_modules/` segment are the root
 * project or a workspace package — not a dependency — and return null.
 * @param {string} key
 * @returns {string | null}
 */
export function derivePackageName(key) {
  const idx = key.lastIndexOf(NODE_MODULES);
  if (idx === -1) return null;
  return key.slice(idx + NODE_MODULES.length);
}

/**
 * The canonical `name@version` identity used as the dedup, cache, and allowlist
 * key throughout the gate.
 * @param {string} name
 * @param {string} version
 * @returns {string}
 */
export function versionId(name, version) {
  return `${name}@${version}`;
}

/**
 * Is a lockfile entry's `resolved` URL an npm-registry tarball? Registry
 * tarballs are `https://<registry>/<name>/-/<name>-<version>.tgz` — the `/-/`
 * segment is characteristic and git (`git+…`) / file (`file:…`) sources lack
 * the `http(s)://…/-/` shape. Non-registry sources have no publish date and are
 * skipped by the gate.
 * @param {unknown} resolved
 * @returns {boolean}
 */
export function isRegistryResolved(resolved) {
  return typeof resolved === "string" && /^https?:\/\//.test(resolved) && resolved.includes("/-/");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --project scripts`
Expected: PASS (all three describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add scripts/dep-cooldown-core.mjs scripts/__tests__/dep-cooldown-core.test.mjs
git commit -m "feat(cooldown): core name derivation + registry-resolved detection"
```

---

## Task 2: Collect & group registry versions — `collectRegistryVersions`, `groupVersionsByName`

**Files:**
- Modify: `scripts/dep-cooldown-core.mjs` (append)
- Test: `scripts/__tests__/dep-cooldown-core.test.mjs` (append)

- [ ] **Step 1: Write the failing test**

Append to `scripts/__tests__/dep-cooldown-core.test.mjs`:

```js
import {
  collectRegistryVersions,
  groupVersionsByName,
} from "../dep-cooldown-core.mjs";

describe("collectRegistryVersions", () => {
  const lockfile = {
    packages: {
      "": { name: "smudge" }, // root project — ignored
      "packages/server": { name: "@smudge/server" }, // workspace — ignored
      "node_modules/react": {
        version: "18.3.1",
        resolved: "https://registry.npmjs.org/react/-/react-18.3.1.tgz",
      },
      "node_modules/@types/node": {
        version: "22.0.0",
        resolved: "https://registry.npmjs.org/@types/node/-/node-22.0.0.tgz",
      },
      // duplicate of react at a nested path — must dedupe to one entry
      "node_modules/some-dep/node_modules/react": {
        version: "18.3.1",
        resolved: "https://registry.npmjs.org/react/-/react-18.3.1.tgz",
      },
      // git dependency — counted as skipped, not checked
      "node_modules/git-dep": {
        version: "1.0.0",
        resolved: "git+ssh://git@github.com/x/y.git#abc123",
      },
      // workspace symlink — ignored entirely (not a registry dep, not skipped)
      "node_modules/@smudge/shared": { link: true, resolved: "packages/shared" },
    },
  };

  it("collects distinct registry name@version pairs and dedupes nested copies", () => {
    const { versions } = collectRegistryVersions(lockfile);
    const ids = versions.map((v) => v.id).sort();
    expect(ids).toEqual(["@types/node@22.0.0", "react@18.3.1"]);
  });

  it("counts non-registry (git/file) deps as skipped", () => {
    const { skipped } = collectRegistryVersions(lockfile);
    expect(skipped).toBe(1); // only git-dep; the link and workspace entries are not deps
  });

  it("tolerates a lockfile with no packages map", () => {
    expect(collectRegistryVersions({})).toEqual({ versions: [], skipped: 0 });
  });
});

describe("groupVersionsByName", () => {
  it("groups versions by package name so each metadata doc is fetched once", () => {
    const grouped = groupVersionsByName([
      { name: "react", version: "18.3.1", id: "react@18.3.1" },
      { name: "react", version: "18.2.0", id: "react@18.2.0" },
      { name: "@types/node", version: "22.0.0", id: "@types/node@22.0.0" },
    ]);
    expect([...grouped.keys()].sort()).toEqual(["@types/node", "react"]);
    expect(grouped.get("react")).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project scripts`
Expected: FAIL — `collectRegistryVersions is not a function` / no matching export.

- [ ] **Step 3: Write the minimal implementation**

Append to `scripts/dep-cooldown-core.mjs`:

```js
/**
 * @typedef {{ name: string, version: string, id: string }} RegistryVersion
 */

/**
 * Walk a parsed package-lock v3 and collect the distinct registry-resolved
 * `name@version` pairs. Workspace/own packages (no `node_modules/` segment) and
 * symlinked workspace deps (`link: true`) are ignored; non-registry deps
 * (git/file) are counted in `skipped` (they have no publish date to check).
 * @param {{ packages?: Record<string, { version?: string, resolved?: unknown, link?: boolean }> }} lockfile
 * @returns {{ versions: RegistryVersion[], skipped: number }}
 */
export function collectRegistryVersions(lockfile) {
  const packages = lockfile.packages ?? {};
  /** @type {RegistryVersion[]} */
  const versions = [];
  const seen = new Set();
  let skipped = 0;

  for (const [key, entry] of Object.entries(packages)) {
    if (key === "") continue; // the root project
    const name = derivePackageName(key);
    if (name === null) continue; // workspace/own package — not a dependency
    if (entry.link) continue; // symlink to a workspace package
    if (!entry.version || !isRegistryResolved(entry.resolved)) {
      skipped++;
      continue;
    }
    const id = versionId(name, entry.version);
    if (seen.has(id)) continue;
    seen.add(id);
    versions.push({ name, version: entry.version, id });
  }

  return { versions, skipped };
}

/**
 * Group versions by package name so the shell fetches each package's metadata
 * document at most once even when several versions of it are in the tree.
 * @param {RegistryVersion[]} versions
 * @returns {Map<string, RegistryVersion[]>}
 */
export function groupVersionsByName(versions) {
  /** @type {Map<string, RegistryVersion[]>} */
  const byName = new Map();
  for (const v of versions) {
    const group = byName.get(v.name);
    if (group) group.push(v);
    else byName.set(v.name, [v]);
  }
  return byName;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --project scripts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/dep-cooldown-core.mjs scripts/__tests__/dep-cooldown-core.test.mjs
git commit -m "feat(cooldown): collect + dedupe + group registry versions from lockfile"
```

---

## Task 3: Parse & validate the allowlist — `parseAllowlist`

**Files:**
- Modify: `scripts/dep-cooldown-core.mjs` (append)
- Test: `scripts/__tests__/dep-cooldown-core.test.mjs` (append)

- [ ] **Step 1: Write the failing test**

Append to the test file:

```js
import { parseAllowlist } from "../dep-cooldown-core.mjs";

describe("parseAllowlist", () => {
  it("maps each entry by its name@version id", () => {
    const map = parseAllowlist([
      { package: "react", version: "19.0.0", reason: "CVE fix", added: "2026-06-01" },
      { package: "@types/node", version: "22.9.0", reason: "needed now" },
    ]);
    expect(map.get("react@19.0.0")).toEqual({ reason: "CVE fix", added: "2026-06-01" });
    expect(map.get("@types/node@22.9.0")?.reason).toBe("needed now");
  });

  it("returns an empty map for an empty array", () => {
    expect(parseAllowlist([]).size).toBe(0);
  });

  it("throws when the top level is not an array", () => {
    // @ts-expect-error deliberately wrong type
    expect(() => parseAllowlist({})).toThrow(/must be a JSON array/);
  });

  it("throws when an entry is missing package or version", () => {
    expect(() => parseAllowlist([{ version: "1.0.0", reason: "x" }])).toThrow(/package/);
    expect(() => parseAllowlist([{ package: "p", reason: "x" }])).toThrow(/version/);
  });

  it("throws when reason is missing or blank (no silent waivers)", () => {
    expect(() => parseAllowlist([{ package: "p", version: "1.0.0" }])).toThrow(/reason/);
    expect(() => parseAllowlist([{ package: "p", version: "1.0.0", reason: "   " }])).toThrow(
      /reason/,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project scripts`
Expected: FAIL — `parseAllowlist is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Append to `scripts/dep-cooldown-core.mjs`:

```js
/**
 * @typedef {{ reason: string, added?: string }} Waiver
 */

/**
 * Parse and validate the allowlist file contents into an id→waiver map. A
 * waiver bypasses the cooldown for an EXACT `name@version`. `reason` is
 * mandatory and non-blank so nothing can be waved through silently — a missing
 * or blank reason is a hard error.
 * @param {unknown} entries
 * @returns {Map<string, Waiver>}
 */
export function parseAllowlist(entries) {
  if (!Array.isArray(entries)) {
    throw new Error("dependency-cooldown allowlist must be a JSON array");
  }
  /** @type {Map<string, Waiver>} */
  const byId = new Map();
  for (const e of entries) {
    const pkg = e && typeof e.package === "string" ? e.package : "";
    const version = e && typeof e.version === "string" ? e.version : "";
    if (!pkg) throw new Error(`allowlist entry is missing a "package": ${JSON.stringify(e)}`);
    if (!version) {
      throw new Error(`allowlist entry "${pkg}" is missing a "version"`);
    }
    if (!e || typeof e.reason !== "string" || e.reason.trim() === "") {
      throw new Error(`allowlist entry "${pkg}@${version}" is missing a non-empty "reason"`);
    }
    byId.set(versionId(pkg, version), {
      reason: e.reason,
      added: typeof e.added === "string" ? e.added : undefined,
    });
  }
  return byId;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --project scripts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/dep-cooldown-core.mjs scripts/__tests__/dep-cooldown-core.test.mjs
git commit -m "feat(cooldown): parse + validate allowlist (mandatory reason)"
```

---

## Task 4: The heart — `isRetriableStatus` + `classify`

**Files:**
- Modify: `scripts/dep-cooldown-core.mjs` (append)
- Test: `scripts/__tests__/dep-cooldown-core.test.mjs` (append)

- [ ] **Step 1: Write the failing test**

Append to the test file:

```js
import { isRetriableStatus, classify } from "../dep-cooldown-core.mjs";

describe("isRetriableStatus", () => {
  it("treats network (0), 408, 425, 429, and 5xx as retriable infra blips", () => {
    for (const s of [0, 408, 425, 429, 500, 502, 503, 504]) {
      expect(isRetriableStatus(s)).toBe(true);
    }
  });
  it("treats 404 and other 4xx as non-retriable", () => {
    for (const s of [400, 401, 403, 404]) {
      expect(isRetriableStatus(s)).toBe(false);
    }
  });
});

describe("classify", () => {
  // Fixed reference clock so fixtures are deterministic.
  const now = Date.parse("2026-06-01T00:00:00.000Z");
  const day = 24 * 60 * 60 * 1000;
  const iso = (msAgo) => new Date(now - msAgo).toISOString();
  const base = { now, cooldownDays: 7 };

  const mk = (id) => {
    const [name, version] = id.split(/@(?=[^@]+$)/);
    return { name, version, id };
  };

  it("flags a young, non-allowlisted version as a violation", () => {
    const { violations } = classify({
      ...base,
      versions: [mk("react@19.0.0")],
      publishDates: new Map([["react@19.0.0", iso(3 * day)]]),
      allowlist: new Map(),
    });
    expect(violations).toEqual([{ id: "react@19.0.0", ageDays: 3, kind: "young" }]);
  });

  it("passes a version at least cooldownDays old", () => {
    const { violations } = classify({
      ...base,
      versions: [mk("react@18.3.1")],
      publishDates: new Map([["react@18.3.1", iso(10 * day)]]),
      allowlist: new Map(),
    });
    expect(violations).toEqual([]);
  });

  it("passes a young version that is allowlisted", () => {
    const { violations } = classify({
      ...base,
      versions: [mk("react@19.0.0")],
      publishDates: new Map([["react@19.0.0", iso(1 * day)]]),
      allowlist: new Map([["react@19.0.0", { reason: "CVE" }]]),
    });
    expect(violations).toEqual([]);
  });

  it("flags a version absent from registry publish times as an 'absent' violation", () => {
    const { violations } = classify({
      ...base,
      versions: [mk("sketchy@9.9.9")],
      publishDates: new Map([["sketchy@9.9.9", null]]),
      allowlist: new Map(),
    });
    expect(violations).toEqual([{ id: "sketchy@9.9.9", ageDays: null, kind: "absent" }]);
  });

  it("reports a stale waiver (allowlisted but now old) without failing", () => {
    const result = classify({
      ...base,
      versions: [mk("react@18.3.1")],
      publishDates: new Map([["react@18.3.1", iso(30 * day)]]),
      allowlist: new Map([["react@18.3.1", { reason: "old CVE" }]]),
    });
    expect(result.violations).toEqual([]);
    expect(result.staleWaivers).toEqual(["react@18.3.1"]);
    expect(result.orphanedWaivers).toEqual([]);
  });

  it("reports an orphaned waiver (id no longer in the tree) without failing", () => {
    const result = classify({
      ...base,
      versions: [mk("react@18.3.1")],
      publishDates: new Map([["react@18.3.1", iso(30 * day)]]),
      allowlist: new Map([["gone@1.0.0", { reason: "left over" }]]),
    });
    expect(result.violations).toEqual([]);
    expect(result.orphanedWaivers).toEqual(["gone@1.0.0"]);
    expect(result.staleWaivers).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project scripts`
Expected: FAIL — `isRetriableStatus is not a function` / `classify is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Append to `scripts/dep-cooldown-core.mjs`:

```js
/**
 * Is an HTTP status (or 0 for a network/timeout error) a transient
 * infrastructure blip worth retrying, as opposed to a definitive answer? The
 * shell retries these; a non-retriable failure is surfaced as an infra error
 * (it cannot be silently treated as a pass — the gate fails closed).
 * @param {number} status
 * @returns {boolean}
 */
export function isRetriableStatus(status) {
  return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {{ id: string, ageDays: number | null, kind: "young" | "absent" }} Violation
 */

/**
 * Decide, for every registry version in the tree, whether it violates the
 * cooldown. A version violates if it is younger than `cooldownDays` and not
 * allowlisted ("young"), or if the registry returned no publish date for it
 * ("absent" — yanked/tampered/unexpected; only reached when the registry WAS
 * reachable, since infra failures are handled in the shell). Allowlist
 * diagnostics are non-failing: a waiver whose version is now old is "stale", a
 * waiver whose id is no longer in the tree is "orphaned" — both are hygiene
 * hints, not violations.
 * @param {{
 *   versions: RegistryVersion[],
 *   publishDates: Map<string, string | null>,
 *   allowlist: Map<string, Waiver>,
 *   now: number,
 *   cooldownDays: number,
 * }} args
 * @returns {{ violations: Violation[], staleWaivers: string[], orphanedWaivers: string[] }}
 */
export function classify({ versions, publishDates, allowlist, now, cooldownDays }) {
  const cooldownMs = cooldownDays * DAY_MS;
  /** @type {Violation[]} */
  const violations = [];
  /** @type {string[]} */
  const staleWaivers = [];
  const usedWaivers = new Set();

  for (const v of versions) {
    const waived = allowlist.has(v.id);
    if (waived) usedWaivers.add(v.id);

    const published = publishDates.get(v.id);
    if (published === null || published === undefined) {
      // Registry reachable but no publish time for this version.
      if (!waived) violations.push({ id: v.id, ageDays: null, kind: "absent" });
      continue;
    }

    const ageMs = now - Date.parse(published);
    if (ageMs >= cooldownMs) {
      if (waived) staleWaivers.push(v.id); // old enough now — waiver no longer needed
      continue;
    }
    if (!waived) violations.push({ id: v.id, ageDays: ageMs / DAY_MS, kind: "young" });
  }

  /** @type {string[]} */
  const orphanedWaivers = [];
  for (const id of allowlist.keys()) {
    if (!usedWaivers.has(id)) orphanedWaivers.push(id);
  }

  return { violations, staleWaivers, orphanedWaivers };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --project scripts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/dep-cooldown-core.mjs scripts/__tests__/dep-cooldown-core.test.mjs
git commit -m "feat(cooldown): classify versions (young/absent) + stale/orphaned waiver diagnostics"
```

---

## Task 5: Report formatting — `buildReport`

**Files:**
- Modify: `scripts/dep-cooldown-core.mjs` (append)
- Test: `scripts/__tests__/dep-cooldown-core.test.mjs` (append)

- [ ] **Step 1: Write the failing test**

Append to the test file:

```js
import { buildReport } from "../dep-cooldown-core.mjs";

describe("buildReport", () => {
  it("is non-blocking and lists info when there are no violations", () => {
    const { lines, blocking } = buildReport({
      violations: [],
      staleWaivers: ["react@18.3.1"],
      orphanedWaivers: ["gone@1.0.0"],
      skipped: 2,
      cooldownDays: 7,
    });
    expect(blocking).toBe(false);
    expect(lines.join("\n")).toMatch(/waiver for react@18\.3\.1 no longer needed/);
    expect(lines.join("\n")).toMatch(/waiver for gone@1\.0\.0 references a version no longer/);
    expect(lines.join("\n")).toMatch(/skipped 2 non-registry/);
  });

  it("is blocking and renders young + absent violations distinctly", () => {
    const { lines, blocking } = buildReport({
      violations: [
        { id: "react@19.0.0", ageDays: 3.25, kind: "young" },
        { id: "sketchy@9.9.9", ageDays: null, kind: "absent" },
      ],
      staleWaivers: [],
      orphanedWaivers: [],
      skipped: 0,
      cooldownDays: 7,
    });
    expect(blocking).toBe(true);
    const text = lines.join("\n");
    expect(text).toMatch(/react@19\.0\.0 — published 3\.3 days ago \(min 7\)/);
    expect(text).toMatch(/sketchy@9\.9\.9 — not found in registry publish times/);
  });

  it("uses singular phrasing for a single skipped entry", () => {
    const { lines } = buildReport({
      violations: [],
      staleWaivers: [],
      orphanedWaivers: [],
      skipped: 1,
      cooldownDays: 7,
    });
    expect(lines.join("\n")).toMatch(/skipped 1 non-registry dependency entry\b/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project scripts`
Expected: FAIL — `buildReport is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Append to `scripts/dep-cooldown-core.mjs`:

```js
/**
 * Render the human-readable report lines and decide whether the run blocks.
 * Only violations block; stale/orphaned waivers and the skipped count are
 * informational. Kept pure (returns strings) so the shell only prints.
 * @param {{
 *   violations: Violation[],
 *   staleWaivers: string[],
 *   orphanedWaivers: string[],
 *   skipped: number,
 *   cooldownDays: number,
 * }} args
 * @returns {{ lines: string[], blocking: boolean }}
 */
export function buildReport({ violations, staleWaivers, orphanedWaivers, skipped, cooldownDays }) {
  /** @type {string[]} */
  const lines = [];

  for (const v of violations) {
    if (v.kind === "absent") {
      lines.push(`✗ ${v.id} — not found in registry publish times (yanked or tampered?)`);
    } else {
      const age = (v.ageDays ?? 0).toFixed(1);
      lines.push(`✗ ${v.id} — published ${age} days ago (min ${cooldownDays})`);
    }
  }
  for (const id of staleWaivers) {
    lines.push(`note: waiver for ${id} no longer needed (now ≥ ${cooldownDays} days old); safe to remove.`);
  }
  for (const id of orphanedWaivers) {
    lines.push(`note: waiver for ${id} references a version no longer in the tree; safe to remove.`);
  }
  if (skipped > 0) {
    const noun = skipped === 1 ? "entry" : "entries";
    lines.push(`info: skipped ${skipped} non-registry dependency ${noun} (git/file/link — no publish date to check).`);
  }

  return { lines, blocking: violations.length > 0 };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --project scripts`
Expected: PASS. (Note: `3.25` renders as `3.3` via `toFixed(1)` — the test asserts this.)

- [ ] **Step 5: Confirm coverage thresholds on the core**

Run: `npx vitest run --project scripts --coverage`
Expected: PASS with `scripts/dep-cooldown-core.mjs` at/above 95/85/90/95. (If a branch is uncovered, add a focused test rather than lowering thresholds.)

- [ ] **Step 6: Commit**

```bash
git add scripts/dep-cooldown-core.mjs scripts/__tests__/dep-cooldown-core.test.mjs
git commit -m "feat(cooldown): build report lines + blocking decision"
```

---

## Task 6: Thin IO shell + committed allowlist + cache ignore + coverage exclusion

**Files:**
- Create: `scripts/dep-cooldown.mjs`
- Create: `dependency-cooldown-allowlist.json`
- Modify: `.gitignore`
- Modify: `vitest.config.ts` (`:30`, inside the coverage `exclude` array)

- [ ] **Step 1: Create the committed allowlist file**

Create `dependency-cooldown-allowlist.json`:

```json
[]
```

- [ ] **Step 2: Ignore the local publish-time cache**

Add to `.gitignore` (anywhere sensible, e.g. near other generated caches):

```gitignore
# Dependency-cooldown publish-time cache (gitignored locally; persisted in CI via actions/cache)
.dep-cooldown-cache.json
```

- [ ] **Step 3: Exclude the thin shell from coverage**

In `vitest.config.ts`, add to the `coverage.exclude` array (right after the `scripts/ensure-native.mjs` entry at `:30`):

```js
        // Thin IO shell for `make dep-cooldown`: registry fetch, fs cache,
        // process exit. The testable logic lives in scripts/dep-cooldown-core.mjs
        // (kept under coverage). Same precedent as ensure-native.mjs above.
        "scripts/dep-cooldown.mjs",
```

- [ ] **Step 4: Create the shell**

Create `scripts/dep-cooldown.mjs`:

```js
// @ts-check
/**
 * Entry point for `make dep-cooldown` and the CI dep-cooldown job. Thin IO
 * shell: reads the lockfile + allowlist + publish-time cache, resolves each
 * registry version's publish date (cache, else a live npm-registry fetch with
 * bounded retry), then delegates the age/allowlist decision to the pure,
 * unit-tested core in scripts/dep-cooldown-core.mjs.
 *
 * Plain ESM (.mjs) so the Makefile runs it directly with `node` — no build step.
 * Excluded from coverage (see vitest.config.ts), like ensure-native.mjs.
 *
 * The full (non-abbreviated) registry metadata document is required: the
 * abbreviated install metadata (Accept: application/vnd.npm.install-v1+json)
 * OMITS the `time` field. We send Accept: application/json to get the full doc.
 *
 * See docs/superpowers/specs/2026-06-01-dependency-cooldown-design.md.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectRegistryVersions,
  groupVersionsByName,
  parseAllowlist,
  classify,
  buildReport,
  isRetriableStatus,
} from "./dep-cooldown-core.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const COOLDOWN_DAYS = Number(process.env.DEP_COOLDOWN_DAYS ?? "7");
const CACHE_PATH = join(repoRoot, ".dep-cooldown-cache.json");
const ALLOWLIST_PATH = join(repoRoot, "dependency-cooldown-allowlist.json");
const LOCKFILE_PATH = join(repoRoot, "package-lock.json");
const REGISTRY = "https://registry.npmjs.org";
const MAX_ATTEMPTS = 4;

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {string} p @returns {any} */
function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

/** @param {unknown} err */
function describe(err) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Fetch a package's FULL registry metadata document, retrying transient infra
 * failures with exponential backoff. A non-retriable response (e.g. 404) or
 * exhausted retries throws — the caller surfaces it as an infrastructure error
 * (fail closed), distinct from a real policy violation.
 * @param {string} name
 * @returns {Promise<any>}
 */
async function fetchMetadata(name) {
  // Scoped names contain exactly one slash; encode it for the registry path.
  const url = `${REGISTRY}/${name.replace("/", "%2f")}`;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (res.ok) return await res.json();
      if (!isRetriableStatus(res.status)) {
        throw new Error(`registry responded ${res.status}`);
      }
      lastErr = new Error(`registry responded ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    if (attempt < MAX_ATTEMPTS) await sleep(500 * 2 ** (attempt - 1));
  }
  throw lastErr ?? new Error("unknown fetch failure");
}

async function main() {
  const lockfile = readJson(LOCKFILE_PATH);
  const { versions, skipped } = collectRegistryVersions(lockfile);

  // Allowlist — a missing file means "no waivers".
  let allowlist;
  try {
    const raw = existsSync(ALLOWLIST_PATH) ? readJson(ALLOWLIST_PATH) : [];
    allowlist = parseAllowlist(raw);
  } catch (err) {
    console.error(`✗ ${ALLOWLIST_PATH}: ${describe(err)}`);
    process.exitCode = 1;
    return;
  }

  // Publish-time cache (immutable entries; gitignored locally, actions/cache in CI).
  /** @type {Record<string, string>} */
  const cache = existsSync(CACHE_PATH) ? readJson(CACHE_PATH) : {};

  /** @type {Map<string, string | null>} */
  const publishDates = new Map();

  for (const [name, group] of groupVersionsByName(versions)) {
    const needFetch = group.some((g) => !(g.id in cache));
    if (!needFetch) {
      for (const g of group) publishDates.set(g.id, cache[g.id]);
      continue;
    }
    let doc;
    try {
      doc = await fetchMetadata(name);
    } catch (err) {
      console.error(
        `✗ infrastructure error: could not fetch registry metadata for ${name} (${describe(err)}).`,
      );
      console.error(
        "  This is npm being unreachable, not a policy violation — re-run when the registry is available.",
      );
      process.exitCode = 3;
      return;
    }
    const times = (doc && doc.time) || {};
    for (const g of group) {
      const iso = typeof times[g.version] === "string" ? times[g.version] : null;
      publishDates.set(g.id, iso);
      if (iso) cache[g.id] = iso; // cache positive dates only (immutable)
    }
  }

  // Persist the cache (optimization only — never fail the run on a write error).
  try {
    writeFileSync(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);
  } catch {
    /* best-effort */
  }

  const result = classify({
    versions,
    publishDates,
    allowlist,
    now: Date.now(),
    cooldownDays: COOLDOWN_DAYS,
  });
  const { lines, blocking } = buildReport({ ...result, skipped, cooldownDays: COOLDOWN_DAYS });
  for (const line of lines) console.log(line);

  if (blocking) {
    console.error(
      `\nDependency cooldown: ${result.violations.length} version(s) younger than ${COOLDOWN_DAYS} days and not allowlisted.`,
    );
    console.error(
      `Wait until they are ${COOLDOWN_DAYS} days old, or add an entry with a reason to dependency-cooldown-allowlist.json.`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `Dependency cooldown: OK — all ${versions.length} checked version(s) ≥ ${COOLDOWN_DAYS} days old or allowlisted.`,
    );
  }
}

await main();
```

- [ ] **Step 5: Verify the core tests still pass and types/lint are clean**

Run: `npx vitest run --project scripts`
Expected: PASS (the shell adds no tests; core tests unaffected).

Run: `npm run typecheck`
Expected: PASS. **Watch-point:** if `tsc --checkJs` flags `fetch` as undefined, confirm `@types/node` (Node 22) is providing the global; do NOT edit `.devcontainer` or broaden libs casually — if needed, resolve by adding a local JSDoc cast at the `fetch` call only, and note it. If it flags `2 ** (attempt - 1)` or `process.exitCode`, those are standard and should type-check; investigate any real error before proceeding.

Run: `npm run lint:check`
Expected: PASS (0 warnings).

- [ ] **Step 6: Commit**

```bash
git add scripts/dep-cooldown.mjs dependency-cooldown-allowlist.json .gitignore vitest.config.ts
git commit -m "feat(cooldown): IO shell, committed allowlist, cache ignore, coverage exclusion"
```

---

## Task 7: `make dep-cooldown` target

**Files:**
- Modify: `Makefile` (`.PHONY` at `:6`; new target near the other script targets)

- [ ] **Step 1: Add the target to `.PHONY`**

In `Makefile:6`, append `dep-cooldown` to the `.PHONY` list:

```make
.PHONY: all test cover e2e e2e-clean lint lint-check format format-check typecheck dev build clean loc help ensure-native dep-cooldown
```

- [ ] **Step 2: Add the target**

Add after the `loc` target (around `:75`), before `clean`:

```make
dep-cooldown: ## Supply-chain cooldown gate: fail if any package-lock version is <7 days old and not allowlisted (needs network; NOT part of `make all`)
	@# Authoritative gate runs in CI (dep-cooldown job) where the publish-time
	@# cache is persisted via actions/cache. This target is the on-demand local
	@# equivalent: first run fetches registry publish times (slow, ~1 doc per
	@# distinct package); later runs reuse .dep-cooldown-cache.json. Kept out of
	@# `make all` so the offline local full-pass stays network-free. See
	@# docs/superpowers/specs/2026-06-01-dependency-cooldown-design.md.
	@node scripts/dep-cooldown.mjs
```

- [ ] **Step 3: Verify the target is registered**

Run: `make help | grep dep-cooldown`
Expected: the `dep-cooldown` line appears in the help output.

- [ ] **Step 4: Commit**

```bash
git add Makefile
git commit -m "feat(cooldown): add make dep-cooldown target (not in make all)"
```

---

## Task 8: CI `dep-cooldown` job with persistent cache

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add the job**

Append a new job after the `e2e` job in `.github/workflows/ci.yml` (sibling of the existing jobs, same indentation level):

```yaml
  dep-cooldown:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      # Persist publish-time lookups across runs. Entries are immutable
      # (name@version -> publish date), so we want the cache to ACCUMULATE, not
      # reset whenever the lockfile changes. A stable prefix in restore-keys
      # restores the most recent prior cache; the hash-keyed `key` saves a fresh
      # superset at job end only when the lockfile changed.
      - name: Restore dependency-cooldown publish-time cache
        uses: actions/cache@v4
        with:
          path: .dep-cooldown-cache.json
          key: dep-cooldown-${{ hashFiles('package-lock.json') }}
          restore-keys: |
            dep-cooldown-
      - run: make dep-cooldown
```

- [ ] **Step 2: Validate the workflow is well-formed**

Run: `node -e "const y=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); if(!/^\s{2}dep-cooldown:/m.test(y)) throw new Error('job missing'); console.log('dep-cooldown job present')"`
Expected: prints `dep-cooldown job present`. (If `js-yaml` or another parser is available locally you may additionally lint it; the regex check is the minimum.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(cooldown): add dep-cooldown job with persistent publish-time cache"
```

---

## Task 9: Document the policy in `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` (add a new section after "Dependency Licenses")

- [ ] **Step 1: Add the policy section**

Add this section immediately after the "## Dependency Licenses" section in `CLAUDE.md`:

```markdown
## Dependency Cooldown (Supply-Chain)

**No package version in `package-lock.json` may be younger than 7 days unless
explicitly allowlisted with a reason.** Most malicious npm releases are caught
and yanked within days; a 7-day quarantine catches the common case before it
reaches Smudge. Enforced by the `dep-cooldown` CI job (authoritative) and the
on-demand `make dep-cooldown` target — never part of `make all` (the offline
local full-pass stays network-free).

- **Scope:** every registry-resolved version in the lockfile — **direct and
  transitive** (transitive is where real attacks land). Non-registry deps
  (git/file/link) are skipped (no publish date).
- **Escape hatch:** `dependency-cooldown-allowlist.json` (repo root, committed).
  Add `{ "package", "version", "reason", "added" }` to adopt a sub-cooldown
  version — for an urgent CVE fix **or** any new dep needed before it is 7 days
  old. `reason` is mandatory (a blank reason is a hard error). Every waiver is a
  reviewable diff — the paper trail is the point.
- **Hygiene:** the gate warns (without failing) when a waiver is no longer
  needed (its version is now ≥7 days old) or orphaned (its version left the
  tree). Remove those entries.
- **What it does NOT do:** age is a proxy, not integrity. Tamper detection is
  the lockfile `integrity` hashes that `npm ci` already enforces — a separate
  layer. See the spec for the full threat model:
  `docs/superpowers/specs/2026-06-01-dependency-cooldown-design.md`.
- **Implementation:** pure logic in `scripts/dep-cooldown-core.mjs` (unit-tested,
  under coverage); thin IO shell in `scripts/dep-cooldown.mjs` (coverage-excluded,
  per the `ensure-native.mjs` precedent).
```

- [ ] **Step 2: Verify formatting**

Run: `npm run format:check`
Expected: PASS (CLAUDE.md is not in the prettier globs, so this should be unaffected; if it errors on an unrelated file, stop and investigate).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(cooldown): document the dependency-cooldown policy in CLAUDE.md"
```

---

## Task 10: Integration smoke + final self-review

**Files:** none (verification only)

- [ ] **Step 1: Full scripts coverage gate**

Run: `npx vitest run --project scripts --coverage`
Expected: PASS, `scripts/dep-cooldown-core.mjs` ≥ 95/85/90/95, `scripts/dep-cooldown.mjs` absent from the coverage report (excluded).

- [ ] **Step 2: Typecheck + lint the whole tree**

Run: `npm run typecheck && npm run lint:check`
Expected: both PASS, 0 warnings.

- [ ] **Step 3: Live smoke against the real lockfile (needs network)**

Run: `make dep-cooldown`
Expected: the script runs to completion and prints either `Dependency cooldown: OK …` (exit 0) or a list of `✗ …` violations (exit 1).

**Important — this may legitimately fail on first introduction.** The lockfile may currently contain versions published within the last 7 days. That is the gate working, not a bug. If it does:
  - For each flagged `name@version`, decide: wait until it ages out, OR add an allowlist entry with a real reason to `dependency-cooldown-allowlist.json` (e.g. `"reason": "in-tree before cooldown gate introduced 2026-06-01"`).
  - Re-run `make dep-cooldown` until it exits 0.
  - Commit any allowlist entries separately: `git add dependency-cooldown-allowlist.json && git commit -m "chore(cooldown): allowlist pre-existing sub-cooldown versions"`.
  - Confirm `.dep-cooldown-cache.json` was created and is gitignored: `git status --porcelain .dep-cooldown-cache.json` should print nothing.

- [ ] **Step 4: Plan self-review against the spec**

Confirm each spec requirement maps to a task (no code change — just verify): whole-lockfile scan (Task 2/4), direct+transitive via lockfile walk (Task 2), name derivation incl. nested scoped (Task 1), dedupe + group (Task 2), allowlist with mandatory reason (Task 3), young + absent classification (Task 4), stale + orphaned waiver warnings (Task 4/5), full-metadata `time` fetch with infra-vs-violation split + retry (Task 6), persistent CI cache (Task 8), make target not in `make all` (Task 7), coverage split (Task 6), threat-model/policy docs (Task 9). Note any gap and add a task before finishing.

- [ ] **Step 5: Final commit (if the smoke produced an allowlist or no changes remain)**

Ensure the working tree is clean except intended files:

```bash
git status
```
Expected: clean, or only intended `dependency-cooldown-allowlist.json` changes already committed. The branch is ready for PR (single feature; references no roadmap phase — add one if it is to be tracked there).
