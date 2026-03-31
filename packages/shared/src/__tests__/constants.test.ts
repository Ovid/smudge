import { describe, it, expect } from "vitest";
import { UNTITLED_CHAPTER } from "../constants";

describe("constants", () => {
  it("exports UNTITLED_CHAPTER with expected value", () => {
    expect(UNTITLED_CHAPTER).toBe("Untitled Chapter");
  });
});
