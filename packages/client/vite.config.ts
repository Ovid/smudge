import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Read ports from env so the e2e harness can run a parallel client/server
// pair on different ports without colliding with `make dev`. Defaults
// preserve the standard 5173 (client) / 3456 (server) pair. The e2e
// harness in playwright.config.ts sets SMUDGE_PORT and SMUDGE_CLIENT_PORT
// to test-only ports so an e2e run cannot touch the dev workflow's
// database.
const clientPort = Number.parseInt(process.env.SMUDGE_CLIENT_PORT ?? "5173", 10);
const serverPort = Number.parseInt(process.env.SMUDGE_PORT ?? "3456", 10);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: clientPort,
    proxy: {
      "/api": {
        target: `http://localhost:${serverPort}`,
        changeOrigin: true,
      },
    },
  },
});
