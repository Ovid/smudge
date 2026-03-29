import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/shared",
  "packages/server/vitest.config.ts",
  "packages/client",
]);
