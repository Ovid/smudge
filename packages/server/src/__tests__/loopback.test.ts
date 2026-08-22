import { describe, it, expect } from "vitest";
import { DEFAULT_BIND_HOST, getBindHost } from "../config/loopback";

// F-02 (architecture report 2026-08-22): `app.listen(PORT, cb)` bound the
// unspecified address, so any host that could reach the port had full
// read/write/delete on the manuscript. The host is resolved through this
// wrapper rather than inlined at the listen call so it is decidable in a
// unit test, and so Phase 7g.1 has one seam to add SMUDGE_BIND_ADDRESS at.
describe("getBindHost()", () => {
  it("resolves to loopback", () => {
    expect(getBindHost()).toBe("127.0.0.1");
    expect(getBindHost()).toBe(DEFAULT_BIND_HOST);
  });

  // Node treats "" and undefined alike as the unspecified address (verified:
  // net.Server.listen(0, "") reports address "::"). A wrapper that ever
  // returned either would silently restore the exact flaw F-02 names, so the
  // property under test is "never falsy", not merely "equals a constant".
  it("never returns a value Node would read as the unspecified address", () => {
    const host = getBindHost();
    expect(host).toBeTruthy();
    expect(host).not.toBe("0.0.0.0");
    expect(host).not.toBe("::");
  });

  // No environment variable is read today. Phase 7g.1 owns SMUDGE_BIND_ADDRESS
  // (docs/roadmap.md), and its planned 0.0.0.0 default is the state this
  // finding exists to remove — so the unsafe value must not be reachable by
  // configuration until that phase decides otherwise deliberately.
  it("ignores the environment", () => {
    const prev = process.env.SMUDGE_BIND_ADDRESS;
    process.env.SMUDGE_BIND_ADDRESS = "0.0.0.0";
    try {
      expect(getBindHost()).toBe("127.0.0.1");
    } finally {
      if (prev === undefined) delete process.env.SMUDGE_BIND_ADDRESS;
      else process.env.SMUDGE_BIND_ADDRESS = prev;
    }
  });
});
