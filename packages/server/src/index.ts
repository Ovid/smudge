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
            loadExtensions: [".ts", ".js"],
          },
        }
      : undefined,
  );

  const app = createApp(db);

  app.listen(PORT, () => {
    console.log(`Smudge server running on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
