import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    // Default 300ms threshold surfaces every full-page RTL render as "slow",
    // noising the test output even when the test is healthy. 2000ms is the
    // honest signal for this suite — the Editor auto-save test intentionally
    // waits the full 1500ms debounce (CLAUDE.md: "1.5s debounce"), and
    // full-page RTL renders naturally land in the 300-500ms range. Tests
    // exceeding 2000ms genuinely warrant attention.
    slowTestThreshold: 2000,
  },
});
