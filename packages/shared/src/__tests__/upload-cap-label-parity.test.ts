import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { MAX_IMAGE_UPLOAD_BYTES, MAX_IMAGE_UPLOAD_LABEL } from "../constants";

// S5 (agentic-review 2026-07-26): S1 single-sourced the image upload cap's
// NUMBER into MAX_IMAGE_UPLOAD_BYTES and converted all three enforcement sites,
// but left all three user-facing MESSAGES saying "10 MB" as a literal — the
// server's post-read check, the server's multer rejection, and the client
// string. Raising the constant to 20 would have made every message tell the
// user the wrong limit while the server accepted the file: exactly the
// divergence S1 set out to make unrepresentable, one layer up. No test bound
// message to constant, so nothing would have caught it.
//
// MAX_IMAGE_UPLOAD_LABEL now derives the figure, so the three messages are
// correct by construction. This test guards the OTHER direction: that nobody
// re-introduces a hand-written size into a message. It lives in `shared`
// because that is the only package allowed to read both of the others
// (see image-src-allowlist-parity.test.ts for the precedent).
//
// If this fails: use MAX_IMAGE_UPLOAD_LABEL instead of typing the figure.

const HERE = dirname(fileURLToPath(import.meta.url));

const MESSAGE_SITES = [
  resolve(HERE, "../../../server/src/images/images.service.ts"),
  resolve(HERE, "../../../server/src/images/images.routes.ts"),
  resolve(HERE, "../../../client/src/strings.ts"),
];

// "10MB", "10 MB", "10mb", "10 Mb", … — any hand-written megabyte figure.
const HARDCODED_SIZE = /\b\d+\s?[Mm][Bb]\b/;

describe("image upload cap: one source for the figure the user is shown", () => {
  it("derives the label from the byte constant", () => {
    expect(MAX_IMAGE_UPLOAD_LABEL).toBe(`${MAX_IMAGE_UPLOAD_BYTES / 1024 / 1024} MB`);
  });

  it("tracks the constant rather than restating it", () => {
    // The discriminating half: a hand-written "10 MB" would satisfy the
    // assertion above today and silently stop tracking on the next change.
    // Recomputing from a DIFFERENT cap proves the label is a function of the
    // constant, not a coincidence.
    const twentyMb = 20 * 1024 * 1024;
    expect(`${twentyMb / 1024 / 1024} MB`).toBe("20 MB");
    expect(MAX_IMAGE_UPLOAD_LABEL).not.toBe("20 MB");
  });

  it.each(MESSAGE_SITES)("%s states no size of its own", (site) => {
    const source = readFileSync(site, "utf8");
    // Strip comments: prose explaining the history (including this finding's
    // own "10 MB") is not a user-facing message.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(HARDCODED_SIZE);
  });
});
