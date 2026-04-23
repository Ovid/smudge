import { describe, it, expect } from "vitest";
import type { ApiError } from "./types";

describe("ApiError envelope", () => {
  it("accepts arbitrary extras alongside code and message", () => {
    const envelope: ApiError = {
      error: {
        code: "IMAGE_IN_USE",
        message: "Image is referenced",
        chapters: [{ id: "c1", title: "Chapter 1" }],
        details: "extra",
      },
    };
    expect(envelope.error.code).toBe("IMAGE_IN_USE");
    expect(envelope.error.chapters).toBeDefined();
  });
});
