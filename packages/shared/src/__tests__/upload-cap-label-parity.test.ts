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

// S16 (agentic-review 2026-08-04): constants.ts is the site that MATTERS and it
// was the one omitted — the label is defined there, so a hand-written "10 MB"
// would live there and nowhere else. Without it every assertion in this file
// passed with the derivation replaced by a literal, which is the exact
// regression the file exists to prevent. It is safe to scan: the derivation
// itself (`${... / 1024 / 1024} MB`) has no digit adjacent to "MB".
const MESSAGE_SITES = [
  resolve(HERE, "../constants.ts"),
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

  // S16 (agentic-review 2026-08-04): the "discriminating half" used to live here
  // as two assertions that could not fail — `${20*1024*1024/1024/1024} MB` ===
  // "20 MB" is an arithmetic identity, and `MAX_IMAGE_UPLOAD_LABEL !== "20 MB"`
  // holds for any cap that isn't 20 MB. Neither said anything about the label
  // being DERIVED. The real discrimination is the source scan below, which now
  // includes constants.ts: replace the derivation with a literal "10 MB" and
  // this file goes red, which is what it always claimed to do.

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
