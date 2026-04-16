import { initDb, closeDb } from "./db/connection";
import { initProjectStore, resetProjectStore } from "./stores/project-store.injectable";
import { createApp } from "./app";
import { purgeOldTrash } from "./db/purge";
import { logger } from "./logger";
import type { Server } from "node:http";

const PORT = parseInt(process.env.SMUDGE_PORT ?? "3456", 10);
if (Number.isNaN(PORT) || PORT < 1 || PORT > 65535) {
  logger.error({ port: process.env.SMUDGE_PORT }, "Invalid SMUDGE_PORT: must be a number 1-65535");
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

  initProjectStore(db);

  const purged = await purgeOldTrash(db);
  if (purged.chapters > 0 || purged.projects > 0 || purged.images > 0) {
    logger.info(
      { chapters: purged.chapters, projects: purged.projects, images: purged.images },
      "Purged old trash entries",
    );
  }

  const app = createApp();

  const server = app.listen(PORT, () => {
    logger.info({ port: PORT }, "Smudge server running");
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      logger.error({ port: PORT }, "Port is already in use");
    } else {
      logger.error({ err }, "Server error");
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
    logger.info("Shutting down gracefully");

    const forceExit = setTimeout(() => {
      logger.error("Shutdown timed out after 10s, forcing exit");
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    server.close(() => {
      resetProjectStore();
      closeDb()
        .then(() => {
          clearTimeout(forceExit);
          logger.info("Database connection closed");
          process.exit(0);
        })
        .catch((err) => {
          logger.error({ err }, "Error closing database");
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
    logger.error(
      { err },
      "SQLite I/O error — possible causes: corrupt database, stale WAL files, disk full, or permission issues. Check disk space and file permissions first.",
    );
  } else {
    logger.error({ err }, "Failed to start server");
  }
  process.exit(1);
});
