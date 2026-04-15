/**
 * Vitest global setup for the server package.
 *
 * The `docx` npm package accesses `localStorage` at import time. On Node.js
 * versions that support the Web Storage API (v22+), this triggers a warning:
 *
 *   Warning: `--localstorage-file` was provided without a valid path
 *
 * The warning is harmless — it fires because Node.js exposes `localStorage`
 * only when the `--localstorage-file` flag is given a path. The library's
 * access fails silently and proceeds without localStorage.
 *
 * We intercept `process.stderr.write` to capture and suppress this specific
 * warning so it doesn't pollute test output (per CLAUDE.md zero-warnings
 * policy). The interception is scoped to only this message — all other
 * stderr output passes through unchanged.
 */

const origStderrWrite = process.stderr.write.bind(process.stderr);

const filteredWrite: typeof process.stderr.write = function (
  chunk: string | Uint8Array,
  encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
  cb?: (err?: Error | null) => void,
): boolean {
  const str = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
  if (str.includes("`--localstorage-file` was provided without a valid path")) {
    return true; // swallow the known docx library warning
  }
  if (typeof encodingOrCb === "function") {
    return origStderrWrite(chunk, encodingOrCb);
  }
  return origStderrWrite(chunk, encodingOrCb, cb);
};

process.stderr.write = filteredWrite;
