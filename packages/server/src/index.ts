import { initDb } from "./db/connection";
import { createApp } from "./app";

const PORT = parseInt(process.env.SMUDGE_PORT ?? "3456", 10);
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

  const app = createApp(db);

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
}

main().catch((err: unknown) => {
  if (err instanceof Error && "code" in err && typeof (err as Record<string, unknown>).code === "string" && (err as Record<string, unknown>).code?.toString().startsWith("SQLITE_IOERR")) {
    console.error("Database file is corrupt or has stale WAL files.");
    console.error("Run 'make clean' to reset, or manually delete packages/server/data/smudge.db*");
  } else {
    console.error("Failed to start server:", err);
  }
  process.exit(1);
});
