import { describe, it, expect } from "vitest";
import {
  derivePackageName,
  versionId,
  isRegistryResolved,
} from "../dep-cooldown-core.mjs";
import {
  collectRegistryVersions,
  groupVersionsByName,
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
    expect(
      isRegistryResolved("https://registry.npmjs.org/@types/node/-/node-22.0.0.tgz"),
    ).toBe(true);
    expect(isRegistryResolved("http://registry.npmjs.org/x/-/x-1.0.0.tgz")).toBe(true);
  });

  it("rejects git, file, and missing resolved URLs", () => {
    expect(isRegistryResolved("git+ssh://git@github.com/x/y.git#abc123")).toBe(false);
    expect(isRegistryResolved("file:../local-pkg")).toBe(false);
    expect(isRegistryResolved(undefined)).toBe(false);
    expect(isRegistryResolved("")).toBe(false);
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
