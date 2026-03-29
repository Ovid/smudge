import { describe, it, expect } from "vitest";
import { generateSlug } from "../slugify";

describe("generateSlug", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(generateSlug("My Novel")).toBe("my-novel");
  });

  it("transliterates accented characters", () => {
    expect(generateSlug("Café Début")).toBe("cafe-debut");
  });

  it("strips non-alphanumeric characters", () => {
    expect(generateSlug("The Cat's Meow!!")).toBe("the-cats-meow");
  });

  it("collapses consecutive hyphens", () => {
    expect(generateSlug("My---Novel")).toBe("my-novel");
  });

  it("trims leading and trailing hyphens", () => {
    expect(generateSlug("--hello--")).toBe("hello");
  });

  it("falls back to 'untitled' for empty result", () => {
    expect(generateSlug("!!!")).toBe("untitled");
    expect(generateSlug("")).toBe("untitled");
  });

  it("handles mixed unicode and ascii", () => {
    expect(generateSlug("Chapter 1: Début")).toBe("chapter-1-debut");
  });

  it("handles already-clean input", () => {
    expect(generateSlug("simple")).toBe("simple");
  });
});
