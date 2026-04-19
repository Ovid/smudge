import { describe, it, expect } from "vitest";
import { useEditorMutation } from "../hooks/useEditorMutation";

describe("useEditorMutation", () => {
  it("exports a hook", () => {
    expect(typeof useEditorMutation).toBe("function");
  });
});
