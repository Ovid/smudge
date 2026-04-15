import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "forks",
    poolOptions: {
      forks: {
        // The `docx` library accesses localStorage at import time, which
        // triggers a Node.js warning when --localstorage-file is not set.
        // Point it at /dev/null to suppress the harmless warning.
        execArgv: ["--localstorage-file=/dev/null"],
      },
    },
  },
});
