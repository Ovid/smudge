import { describe, it, expect } from "vitest";
import {
  derivePackageName,
  versionId,
  isRegistryResolved,
  isValidRegistryName,
  isV3Lockfile,
  sanitizeCache,
  collectRegistryVersions,
  groupVersionsByName,
  parseAllowlist,
  parseCooldownDays,
  isRetriableStatus,
  fetchPublishTimes,
  publishDateFromTime,
  classify,
  buildReport,
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
    expect(derivePackageName("node_modules/@types/serve-static/node_modules/@types/send")).toBe(
      "@types/send",
    );
  });

  it("returns null for a workspace/own-code key with no node_modules/", () => {
    expect(derivePackageName("packages/server")).toBeNull();
    expect(derivePackageName("")).toBeNull();
  });

  it("returns null for a malformed key that ends in node_modules/ with no name", () => {
    expect(derivePackageName("node_modules/@scope/x/node_modules/")).toBeNull();
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
    expect(isRegistryResolved("https://registry.npmjs.org/@types/node/-/node-22.0.0.tgz")).toBe(
      true,
    );
    expect(isRegistryResolved("http://registry.npmjs.org/x/-/x-1.0.0.tgz")).toBe(true);
  });

  it("rejects git, file, and missing resolved URLs", () => {
    expect(isRegistryResolved("git+ssh://git@github.com/x/y.git#abc123")).toBe(false);
    expect(isRegistryResolved("file:../local-pkg")).toBe(false);
    expect(isRegistryResolved(undefined)).toBe(false);
    expect(isRegistryResolved("")).toBe(false);
  });

  // C2: a /-/ tarball path on a NON-npmjs host must NOT be treated as a
  // registry dep — otherwise the gate fetches registry.npmjs.org/<name> and
  // age-checks an unrelated npmjs artifact instead of the off-host one.
  it("rejects a /-/ tarball URL whose host is not registry.npmjs.org", () => {
    expect(isRegistryResolved("https://evil.example/foo/-/foo-1.0.0.tgz")).toBe(false);
    expect(isRegistryResolved("http://evil.example/foo/-/foo-1.0.0.tgz")).toBe(false);
    // a look-alike host (suffix attack) must not match
    expect(isRegistryResolved("https://registry.npmjs.org.evil.com/foo/-/foo-1.0.0.tgz")).toBe(
      false,
    );
    // a custom registry that does not even use the /-/ convention, off-host
    expect(isRegistryResolved("https://npm.pkg.github.com/@scope/foo")).toBe(false);
  });

  it("rejects a non-URL string that merely contains the /-/ marker", () => {
    expect(isRegistryResolved("not a url /-/ but has the marker")).toBe(false);
  });
});

describe("isValidRegistryName", () => {
  it("accepts plain, scoped, and dotted package names", () => {
    expect(isValidRegistryName("react")).toBe(true);
    expect(isValidRegistryName("@types/node")).toBe(true);
    expect(isValidRegistryName("string-width")).toBe(true);
    expect(isValidRegistryName("lodash.merge")).toBe(true);
    expect(isValidRegistryName("@scope/some-package")).toBe(true);
  });

  // C1: an un-validated name from the (untrusted) lockfile could smuggle a path
  // and make the metadata fetch read a DIFFERENT package's publish date.
  it("rejects names that could change the fetch target or smuggle a path", () => {
    expect(isValidRegistryName("@scope/a/../../b")).toBe(false); // C1 traversal
    expect(isValidRegistryName("a/b/c")).toBe(false); // more than one slash
    expect(isValidRegistryName("..")).toBe(false);
    expect(isValidRegistryName("/etc/passwd")).toBe(false);
    expect(isValidRegistryName("foo/")).toBe(false); // trailing slash
    expect(isValidRegistryName(".hidden")).toBe(false); // may not start with a dot
    expect(isValidRegistryName("Foo")).toBe(false); // uppercase not allowed
    expect(isValidRegistryName("")).toBe(false);
    expect(isValidRegistryName(undefined)).toBe(false);
    expect(isValidRegistryName(42)).toBe(false);
  });
});

describe("collectRegistryVersions", () => {
  /** @type {{ packages: Record<string, { name?: string, version?: string, resolved?: unknown, link?: boolean }> }} */
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
      // file: dependency — also non-registry, counted as skipped
      "node_modules/file-dep": {
        version: "1.0.0",
        resolved: "file:../local-pkg",
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
    expect(skipped).toBe(2); // git-dep and file-dep; the link and workspace entries are not deps
  });

  it("tolerates a lockfile with no packages map", () => {
    expect(collectRegistryVersions({})).toEqual({ versions: [], skipped: 0 });
  });

  it("uses the entry's real `name` for aliased deps, not the path key", () => {
    const { versions } = collectRegistryVersions({
      packages: {
        // npm alias: key is the alias, entry.name is the real registry package
        "node_modules/string-width-cjs": {
          name: "string-width",
          version: "4.2.3",
          resolved: "https://registry.npmjs.org/string-width/-/string-width-4.2.3.tgz",
        },
      },
    });
    expect(versions).toEqual([
      { name: "string-width", version: "4.2.3", id: "string-width@4.2.3" },
    ]);
  });
});

describe("isV3Lockfile", () => {
  it("accepts a real v3 lockfile with a packages object (even an empty one)", () => {
    expect(isV3Lockfile({ packages: { "": { name: "smudge" } } })).toBe(true);
    expect(isV3Lockfile({ packages: {} })).toBe(true);
  });

  // Fail-OPEN guard (I2): every degenerate-but-valid-JSON shape below collects
  // zero registry versions, which the shell would otherwise report as a clean
  // pass — the worst failure direction for a security gate. They must fail closed.
  it("rejects degenerate shapes that would silently pass the gate (fail-open)", () => {
    expect(isV3Lockfile({})).toBe(false); // no packages key
    expect(isV3Lockfile({ dependencies: {} })).toBe(false); // npm v1/v2 lockfile shape
    expect(isV3Lockfile({ packages: 5 })).toBe(false);
    expect(isV3Lockfile({ packages: [] })).toBe(false); // array, not a map
    expect(isV3Lockfile({ packages: null })).toBe(false);
  });

  // The `null` sub-case crashed collectRegistryVersions outright; a primitive
  // failed open. Both are non-objects and must be rejected before the scan.
  it("rejects non-object values (null/primitive/array/undefined)", () => {
    expect(isV3Lockfile(null)).toBe(false);
    expect(isV3Lockfile(5)).toBe(false);
    expect(isV3Lockfile("packages")).toBe(false);
    expect(isV3Lockfile(true)).toBe(false);
    expect(isV3Lockfile([])).toBe(false);
    expect(isV3Lockfile(undefined)).toBe(false);
  });
});

describe("sanitizeCache", () => {
  it("passes through a well-formed id→ISO-date map", () => {
    const cache = sanitizeCache({ "react@18.3.1": "2024-04-25T00:00:00.000Z" });
    expect(cache["react@18.3.1"]).toBe("2024-04-25T00:00:00.000Z");
  });

  // I1: a non-object-but-valid-JSON cache (a truncated/hand-edited file) must not
  // crash the gate — `'id' in null` throws. Coerce to an empty map and re-fetch.
  it("returns an empty map for non-object JSON (null/primitive/array)", () => {
    for (const bad of [null, 5, "a string", true, []]) {
      expect(Object.keys(sanitizeCache(bad))).toEqual([]);
    }
  });

  // S1: only string-valued entries survive, so a tampered numeric date (e.g. 0,
  // which Date.parse coerces to year 2000 and would age a young package through)
  // is dropped rather than trusted.
  it("drops entries whose value is not a string", () => {
    const cache = sanitizeCache({
      "good@1.0.0": "2024-01-01T00:00:00.000Z",
      "tampered@1.0.0": 0,
      "nested@1.0.0": { date: "x" },
      "nullish@1.0.0": null,
    });
    expect(Object.keys(cache)).toEqual(["good@1.0.0"]);
  });

  it("is safe under the `in` operator and resists prototype pollution", () => {
    const cache = sanitizeCache(
      JSON.parse('{"__proto__": "evil", "ok@1.0.0": "2024-01-01T00:00:00.000Z"}'),
    );
    expect("ok@1.0.0" in cache).toBe(true);
    expect("missing@1.0.0" in cache).toBe(false);
    expect(Object.getPrototypeOf(cache)).toBeNull();
    expect(/** @type {Record<string, unknown>} */ ({}).polluted).toBeUndefined();
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
    expect(grouped.get("@types/node")).toHaveLength(1);
  });
});

describe("parseAllowlist", () => {
  it("maps each entry by its name@version id", () => {
    const map = parseAllowlist([
      { package: "react", version: "19.0.0", reason: "CVE fix", added: "2026-06-01" },
      { package: "@types/node", version: "22.9.0", reason: "needed now" },
    ]);
    expect(map.get("react@19.0.0")).toEqual({ reason: "CVE fix", added: "2026-06-01" });
    expect(map.get("@types/node@22.9.0")).toEqual({ reason: "needed now", added: undefined });
  });

  it("returns an empty map for an empty array", () => {
    expect(parseAllowlist([]).size).toBe(0);
  });

  it("throws when the top level is not an array", () => {
    expect(() => parseAllowlist({})).toThrow(/must be a JSON array/);
  });

  it("throws when an entry is missing package or version", () => {
    expect(() => parseAllowlist([{ version: "1.0.0", reason: "x" }])).toThrow(/package/);
    expect(() => parseAllowlist([{ package: "p", reason: "x" }])).toThrow(/version/);
  });

  it("throws when an entry is null or not an object", () => {
    expect(() => parseAllowlist([null])).toThrow(/package/);
    expect(() => parseAllowlist([42])).toThrow(/package/);
  });

  it("throws when reason is missing or blank (no silent waivers)", () => {
    expect(() => parseAllowlist([{ package: "p", version: "1.0.0" }])).toThrow(/reason/);
    expect(() => parseAllowlist([{ package: "p", version: "1.0.0", reason: "   " }])).toThrow(
      /reason/,
    );
    expect(() => parseAllowlist([{ package: "p", version: "1.0.0", reason: 42 }])).toThrow(
      /reason/,
    );
  });
});

describe("parseCooldownDays", () => {
  it("defaults to 7 when the value is unset", () => {
    expect(parseCooldownDays(undefined)).toBe(7);
  });

  it("parses a positive number, including fractional", () => {
    expect(parseCooldownDays("14")).toBe(14);
    expect(parseCooldownDays("3.5")).toBe(3.5);
  });

  // S4: an empty string coerces to 0 via Number(""), which would pass EVERY
  // version and report "OK" — a silently disabled gate. Fail closed instead.
  it("rejects an empty string instead of silently disabling the gate", () => {
    expect(() => parseCooldownDays("")).toThrow(/DEP_COOLDOWN_DAYS/);
  });

  it("rejects non-numeric, zero, and negative values (fail closed)", () => {
    expect(() => parseCooldownDays("abc")).toThrow(/DEP_COOLDOWN_DAYS/);
    expect(() => parseCooldownDays("0")).toThrow(/DEP_COOLDOWN_DAYS/);
    expect(() => parseCooldownDays("-3")).toThrow(/DEP_COOLDOWN_DAYS/);
  });
});

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
    expect(isRetriableStatus(499)).toBe(false);
  });
});

describe("fetchPublishTimes", () => {
  const noopSleep = async () => {};
  const okDoc = (/** @type {Record<string, unknown>} */ time) => ({
    ok: true,
    status: 200,
    json: async () => ({ time }),
  });
  const status = (/** @type {number} */ s) => ({ ok: false, status: s, json: async () => ({}) });

  it("returns the time object on the first successful fetch", async () => {
    const time = { "1.0.0": "2026-01-01T00:00:00.000Z" };
    let calls = 0;
    const got = await fetchPublishTimes({
      name: "react",
      maxAttempts: 4,
      sleep: noopSleep,
      fetchDoc: async () => {
        calls++;
        return okDoc(time);
      },
    });
    expect(got).toEqual(time);
    expect(calls).toBe(1);
  });

  it("retries a retriable status, then succeeds", async () => {
    const time = { "1.0.0": "2026-01-01T00:00:00.000Z" };
    const seq = [status(503), okDoc(time)];
    let i = 0;
    let slept = 0;
    const got = await fetchPublishTimes({
      name: "react",
      maxAttempts: 4,
      sleep: async () => {
        slept++;
      },
      fetchDoc: async () => {
        const r = seq[i++];
        if (!r) throw new Error("test fixture exhausted its fetchDoc sequence");
        return r;
      },
    });
    expect(got).toEqual(time);
    expect(slept).toBe(1);
  });

  // I1: the central fail-closed property — exhausted retries THROW (the shell
  // maps the throw to a distinct infra exit 3), never silently pass.
  it("throws after retries are exhausted on a 5xx (fail closed)", async () => {
    let calls = 0;
    let slept = 0;
    await expect(
      fetchPublishTimes({
        name: "react",
        maxAttempts: 4,
        sleep: async () => {
          slept++;
        },
        fetchDoc: async () => {
          calls++;
          return status(503);
        },
      }),
    ).rejects.toThrow(/503/);
    expect(calls).toBe(4);
    expect(slept).toBe(3); // backoff happens BETWEEN attempts only
  });

  it("retries a network/timeout rejection, then exhausts and throws", async () => {
    let calls = 0;
    await expect(
      fetchPublishTimes({
        name: "react",
        maxAttempts: 3,
        sleep: noopSleep,
        fetchDoc: async () => {
          calls++;
          throw new Error("ECONNRESET");
        },
      }),
    ).rejects.toThrow(/ECONNRESET/);
    expect(calls).toBe(3);
  });

  // S1: a non-retriable status (e.g. 404) fails fast — no wasted retries/backoff.
  it("fails fast on a non-retriable status without retrying", async () => {
    let calls = 0;
    let slept = 0;
    await expect(
      fetchPublishTimes({
        name: "react",
        maxAttempts: 4,
        sleep: async () => {
          slept++;
        },
        fetchDoc: async () => {
          calls++;
          return status(404);
        },
      }),
    ).rejects.toThrow(/404/);
    expect(calls).toBe(1);
    expect(slept).toBe(0);
  });

  // S2: a 200 whose whole `time` object is missing is a transient/partial
  // response (retry → infra), NOT a per-version "absent" violation.
  it("treats a 200 with no usable time object as infra and retries to exhaustion", async () => {
    let calls = 0;
    await expect(
      fetchPublishTimes({
        name: "react",
        maxAttempts: 3,
        sleep: noopSleep,
        fetchDoc: async () => {
          calls++;
          return { ok: true, status: 200, json: async () => ({}) };
        },
      }),
    ).rejects.toThrow(/time/);
    expect(calls).toBe(3);
  });

  it("treats a 200 with a non-object time as infra (retries)", async () => {
    let calls = 0;
    await expect(
      fetchPublishTimes({
        name: "react",
        maxAttempts: 2,
        sleep: noopSleep,
        fetchDoc: async () => {
          calls++;
          return { ok: true, status: 200, json: async () => ({ time: "nope" }) };
        },
      }),
    ).rejects.toThrow(/time/);
    expect(calls).toBe(2);
  });

  // An array is `typeof === "object"` in JS, but it is NOT a usable per-version
  // time map: `time[version]` is always undefined, so every version would read
  // as "absent" (a blocking yanked/tampered violation) instead of the intended
  // retry-then-infra-error path a malformed `time` is supposed to take. A proxy
  // or CDN returning `time: []` must therefore be treated as infra, not success.
  it("treats a 200 with an array time as infra (retries)", async () => {
    let calls = 0;
    await expect(
      fetchPublishTimes({
        name: "react",
        maxAttempts: 2,
        sleep: noopSleep,
        fetchDoc: async () => {
          calls++;
          return { ok: true, status: 200, json: async () => ({ time: [] }) };
        },
      }),
    ).rejects.toThrow(/time/);
    expect(calls).toBe(2);
  });

  it("treats a 200 with malformed JSON as a retriable infra blip", async () => {
    let calls = 0;
    await expect(
      fetchPublishTimes({
        name: "react",
        maxAttempts: 2,
        sleep: noopSleep,
        fetchDoc: async () => {
          calls++;
          return {
            ok: true,
            status: 200,
            json: async () => {
              throw new Error("Unexpected end of JSON input");
            },
          };
        },
      }),
    ).rejects.toThrow();
    expect(calls).toBe(2);
  });
});

describe("publishDateFromTime", () => {
  // S3: per-version dates are read by EXACT key, so the `created`/`modified`
  // sentinel keys in a registry `time` object are never mistaken for versions.
  it("reads a version's date by exact key, ignoring created/modified sentinels", () => {
    const time = {
      created: "2020-01-01T00:00:00.000Z",
      modified: "2026-01-01T00:00:00.000Z",
      "1.2.3": "2026-05-01T00:00:00.000Z",
    };
    expect(publishDateFromTime(time, "1.2.3")).toBe("2026-05-01T00:00:00.000Z");
  });

  it("returns null for a version absent from the time object", () => {
    expect(publishDateFromTime({ created: "x", "1.0.0": "y" }, "9.9.9")).toBeNull();
  });

  it("returns null for a non-string date value", () => {
    expect(publishDateFromTime({ "1.0.0": 12345 }, "1.0.0")).toBeNull();
  });
});

describe("classify", () => {
  // Fixed reference clock so fixtures are deterministic.
  const now = Date.parse("2026-06-01T00:00:00.000Z");
  const day = 24 * 60 * 60 * 1000;
  const iso = (/** @type {number} */ msAgo) => new Date(now - msAgo).toISOString();
  const base = { now, cooldownDays: 7 };

  const mk = (/** @type {string} */ id) => {
    const [name, version] = id.split(/@(?=[^@]+$)/);
    return { name: name ?? "", version: version ?? "", id };
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
    const result = classify({
      ...base,
      versions: [mk("react@19.0.0")],
      publishDates: new Map([["react@19.0.0", iso(1 * day)]]),
      allowlist: new Map([["react@19.0.0", { reason: "CVE" }]]),
    });
    expect(result.violations).toEqual([]);
    expect(result.staleWaivers).toEqual([]);
    expect(result.orphanedWaivers).toEqual([]);
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

  it("passes a version at exactly the cooldown boundary (7.0 days old)", () => {
    const { violations } = classify({
      ...base,
      versions: [mk("react@18.0.0")],
      publishDates: new Map([["react@18.0.0", iso(7 * day)]]),
      allowlist: new Map(),
    });
    expect(violations).toEqual([]);
  });

  it("treats an unparseable publish date as an absent violation", () => {
    const { violations } = classify({
      ...base,
      versions: [mk("garbage@1.0.0")],
      publishDates: new Map([["garbage@1.0.0", "not-a-date"]]),
      allowlist: new Map(),
    });
    expect(violations).toEqual([{ id: "garbage@1.0.0", ageDays: null, kind: "absent" }]);
  });

  it("suppresses an absent violation when the missing-date version is allowlisted", () => {
    const result = classify({
      ...base,
      versions: [mk("sketchy@9.9.9")],
      publishDates: new Map([["sketchy@9.9.9", null]]),
      allowlist: new Map([["sketchy@9.9.9", { reason: "accepted risk" }]]),
    });
    expect(result.violations).toEqual([]);
    expect(result.orphanedWaivers).toEqual([]);
  });
});

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

  it("returns no lines and is non-blocking for a clean run (all empty)", () => {
    const { lines, blocking } = buildReport({
      violations: [],
      staleWaivers: [],
      orphanedWaivers: [],
      skipped: 0,
      cooldownDays: 7,
    });
    expect(lines).toEqual([]);
    expect(blocking).toBe(false);
  });
});
