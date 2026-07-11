import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";

// O1: writeImageFile must publish atomically (write-to-temp-then-rename), so an
// interrupted write never truncates the live destination. A `make backup` that
// runs while an image is being uploaded then reads either the OLD complete file
// or nothing — never a torn/half-written copy. ESM named-import spying can't
// intercept the module's `writeFile` ("namespace is not configurable"), so this
// dedicated file vi.mock's node:fs/promises and injects a partial-then-fail
// write, delegating every other call to the real fs.
let failWrite = false;

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    default: actual,
    writeFile: (async (p: unknown, data: unknown, ...rest: unknown[]) => {
      if (failWrite && typeof p === "string" && Buffer.isBuffer(data)) {
        // Simulate a torn write: land HALF the bytes at the target path, then
        // fail. If the target is the live destination, it is now truncated.
        await (actual.writeFile as (...a: unknown[]) => unknown)(
          p,
          data.subarray(0, Math.floor(data.length / 2)),
        );
        throw new Error("injected mid-write failure");
      }
      return (actual.writeFile as (...a: unknown[]) => unknown)(p, data, ...rest);
    }) as typeof actual.writeFile,
  };
});

const { writeImageFile } = await import("../images.fs");
const realFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

const tempDirs: string[] = [];
beforeEach(() => {
  failWrite = false;
});
afterEach(async () => {
  failWrite = false;
  for (const d of tempDirs) await realFs.rm(d, { recursive: true, force: true });
  tempDirs.length = 0;
});

describe("writeImageFile atomic publish (O1)", () => {
  it("preserves the existing complete file when a write fails mid-way", async () => {
    const dir = await realFs.mkdtemp(join(tmpdir(), "smudge-imgfs-"));
    tempDirs.push(dir);
    const dest = join(dir, "img.png");
    const OLD = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]);
    await realFs.writeFile(dest, OLD);

    failWrite = true;
    const NEW = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    await expect(writeImageFile(dest, NEW)).rejects.toThrow(/mid-write/);

    // The failed write must have landed on a temp path, never truncating the
    // live destination — it still holds the complete OLD content.
    expect(await realFs.readFile(dest)).toEqual(OLD);
    // And the mid-write failure leaves no orphan .tmp behind.
    expect((await realFs.readdir(dir)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("writes and renames into place on the happy path (no .tmp left)", async () => {
    const dir = await realFs.mkdtemp(join(tmpdir(), "smudge-imgfs-"));
    tempDirs.push(dir);
    const dest = join(dir, "sub", "img.png"); // parent created on demand
    const data = Buffer.from([1, 2, 3, 4]);

    await writeImageFile(dest, data);

    expect(await realFs.readFile(dest)).toEqual(data);
    expect((await realFs.readdir(join(dir, "sub"))).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});
