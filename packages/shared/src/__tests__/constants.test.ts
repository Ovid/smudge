import { describe, it, expect } from "vitest";
import { UNTITLED_CHAPTER, TRASH_RETENTION_MS } from "../constants";

describe("constants", () => {
  it("exports UNTITLED_CHAPTER with expected value", () => {
    expect(UNTITLED_CHAPTER).toBe("Untitled Chapter");
  });

  it("exports TRASH_RETENTION_MS as 30 days in milliseconds", () => {
    expect(TRASH_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
