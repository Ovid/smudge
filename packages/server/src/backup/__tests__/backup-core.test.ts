import { describe, it, expect } from "vitest";
import { isoStampLocal, buildBackupName } from "../backup-core";

describe("isoStampLocal", () => {
  it("formats local time as YYYY-MM-DD-HHmmss with hyphens only", () => {
    const d = new Date(2026, 4, 26, 14, 32, 11); // local 2026-05-26 14:32:11
    expect(isoStampLocal(d)).toBe("2026-05-26-143211");
  });
});

describe("buildBackupName", () => {
  it("uses smudge- for manual and smudge-auto- for auto", () => {
    expect(buildBackupName("2026-05-26-143211", "manual")).toBe("smudge-2026-05-26-143211.zip");
    expect(buildBackupName("2026-05-26-143211", "auto")).toBe("smudge-auto-2026-05-26-143211.zip");
  });
});
