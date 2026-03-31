import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: "http://localhost:5173",
    headless: true,
  },
  webServer: [
    {
      command: "npm run dev -w packages/server",
      port: 3456,
      reuseExistingServer: true,
    },
    {
      command: "npm run dev -w packages/client",
      port: 5173,
      reuseExistingServer: true,
    },
  ],
});
