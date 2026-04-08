import { initDb, closeDb } from "./db/connection";
import { createApp } from "./app";
import { purgeOldTrash } from "./db/purge";
import type { Server } from "node:http";

const PORT = parseInt(process.env.SMUDGE_PORT ?? "3456", 10);
if (Number.isNaN(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`Invalid SMUDGE_PORT: "${process.env.SMUDGE_PORT}". Must be a number 1-65535.`);
  process.exit(1);
}
const DB_PATH = process.env.DB_PATH;

async function main() {
  const db = await initDb(
    DB_PATH
      ? {
          client: "better-sqlite3",
          connection: { filename: DB_PATH },
          useNullAsDefault: true,
          migrations: {
            directory: new URL("./db/migrations", import.meta.url).pathname,
            loadExtensions: [".js"],
          },
        }
      : undefined,
  );

  const purged = await purgeOldTrash(db);
  if (purged.chapters > 0 || purged.projects > 0) {
    console.log(
      `Purged ${purged.chapters} chapter(s) and ${purged.projects} project(s) from trash.`,
    );
  }

  const app = createApp();

  const server = app.listen(PORT, () => {
    console.log(`Smudge server running on http://localhost:${PORT}`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${PORT} is already in use.`);
      console.error(`Run: lsof -ti:${PORT} | xargs kill`);
    } else {
      console.error("Server error:", err);
    }
    process.exit(1);
  });

  setupGracefulShutdown(server);
}

function setupGracefulShutdown(server: Server): void {
  let shuttingDown = false;

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("Shutting down gracefully…");

    const forceExit = setTimeout(() => {
      console.error("Shutdown timed out after 10s, forcing exit.");
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    server.close(() => {
      closeDb()
        .then(() => {
          clearTimeout(forceExit);
          console.log("Database connection closed.");
          process.exit(0);
        })
        .catch((err) => {
          console.error("Error closing database:", err);
          process.exit(1);
        });
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err: unknown) => {
  if (
    err instanceof Error &&
    "code" in err &&
    typeof (err as Record<string, unknown>).code === "string" &&
    (err as Record<string, unknown>).code?.toString().startsWith("SQLITE_IOERR")
  ) {
    console.error("SQLite I/O error — possible causes: corrupt database, stale WAL files, disk full, or permission issues.");
    console.error("Check disk space and file permissions first. If the problem persists, run 'make clean' to reset the database.");
  } else {
    console.error("Failed to start server:", err);
  }
  process.exit(1);
});
