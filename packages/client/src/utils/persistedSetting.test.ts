import { describe, it, expect } from "vitest";
import { numberInRange, flag, text } from "./persistedSetting";

describe("numberInRange", () => {
  const codec = numberInRange(180, 480, 260);

  it("parses an in-range number", () => {
    expect(codec.parse("300")).toBe(300);
  });

  it("clamps a value below the minimum", () => {
    expect(codec.parse("50")).toBe(180);
  });

  it("clamps a value above the maximum", () => {
    expect(codec.parse("999")).toBe(480);
  });

  it("rejects a non-numeric value", () => {
    expect(codec.parse("not-a-number")).toBeUndefined();
  });

  // Number("") === 0, which is finite — without an explicit guard this would
  // clamp to the minimum (180) and silently turn garbage into a plausible width.
  it("rejects an empty string rather than clamping it to the minimum", () => {
    expect(codec.parse("")).toBeUndefined();
  });

  it("rejects a whitespace-only string", () => {
    expect(codec.parse("   ")).toBeUndefined();
  });

  it("rejects Infinity", () => {
    expect(codec.parse("Infinity")).toBeUndefined();
  });

  it("serializes to a plain string", () => {
    expect(codec.serialize(300)).toBe("300");
  });

  it("carries its fallback", () => {
    expect(codec.fallback).toBe(260);
  });
});

describe("flag", () => {
  const codec = flag(false);

  it('parses "true"', () => {
    expect(codec.parse("true")).toBe(true);
  });

  it('parses "false"', () => {
    expect(codec.parse("false")).toBe(false);
  });

  it("rejects anything else", () => {
    expect(codec.parse("garbage")).toBeUndefined();
  });

  it("round-trips", () => {
    expect(codec.serialize(true)).toBe("true");
    expect(codec.parse(codec.serialize(true))).toBe(true);
  });
});

describe("text", () => {
  const codec = text("images");

  it("passes any string through untouched", () => {
    // Domain validity (is this a real tab id?) is NOT this codec's job — the
    // hook does not know the tab set. ReferencePanel owns that and degrades an
    // unknown id to tabs[0]. See 4c.0 review item [I1].
    expect(codec.parse("notes")).toBe("notes");
    expect(codec.parse("a-tab-that-no-longer-exists")).toBe("a-tab-that-no-longer-exists");
  });

  it("carries its fallback", () => {
    expect(codec.fallback).toBe("images");
  });
});
