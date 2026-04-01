import { describe, it, expect } from "vitest";
import { UNTITLED_CHAPTER, TRASH_RETENTION_DAYS, TRASH_RETENTION_MS } from "../constants";

describe("constants", () => {
  it("exports UNTITLED_CHAPTER with expected value", () => {
    expect(UNTITLED_CHAPTER).toBe("Untitled Chapter");
  });

  it("exports TRASH_RETENTION_DAYS as 30", () => {
    expect(TRASH_RETENTION_DAYS).toBe(30);
  });

  it("exports TRASH_RETENTION_MS derived from TRASH_RETENTION_DAYS", () => {
    expect(TRASH_RETENTION_MS).toBe(TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  });
});
