import { describe, it, expect } from "vitest";
import { DEFAULT_BIND_HOST, getBindHost, isLoopbackHost } from "../config/loopback";

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

// The Host allowlist is the DNS-rebinding defence (F-02), so its edges are
// security behaviour rather than incidental branches. `app.ts` exercises it
// through Supertest, which always sends a Host — the fail-closed arm is only
// reachable here.
describe("isLoopbackHost()", () => {
  it.each([
    ["localhost with a port", "localhost:3456"],
    ["bare localhost", "localhost"],
    ["IPv4 loopback with a port", "127.0.0.1:3456"],
    ["bare IPv4 loopback", "127.0.0.1"],
    ["another address in 127/8", "127.0.0.2:3456"],
    ["bracketed IPv6 loopback", "[::1]:3456"],
    ["bracketed IPv6 loopback with no port", "[::1]"],
    ["mixed case", "LocalHost:3456"],
    ["surrounding whitespace", "  localhost:3456  "],
  ])("accepts %s", (_label, host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.each([
    ["a rebinding domain", "evil.com"],
    ["a rebinding domain on the server port", "evil.com:3456"],
    ["a domain that merely contains a loopback name", "localhost.evil.com"],
    ["a domain suffixed with a loopback name", "evil-localhost"],
    ["a LAN address", "192.168.1.50:3456"],
    ["a public address", "203.0.113.9"],
    ["an address that only looks like 127/8", "1270.0.0.1"],
    ["unbracketed IPv6 loopback", "::1"],
    ["an empty string", ""],
    ["whitespace only", "   "],
  ])("rejects %s", (_label, host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });

  // Fails closed. HTTP/1.1 requires Host, so its absence is not a shape any
  // supported client produces — but "no header" must never read as "local".
  it("rejects an absent Host header", () => {
    expect(isLoopbackHost(undefined)).toBe(false);
  });
});
