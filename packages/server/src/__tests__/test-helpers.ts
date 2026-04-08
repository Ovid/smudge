import http from "http";
import { beforeAll, afterAll, beforeEach } from "vitest";
import knex, { type Knex } from "knex";
import { createTestKnexConfig } from "../db/knexfile";
import { createApp } from "../app";
import { setDb, closeDb } from "../db/connection";

let testDb: Knex;
let testServer: http.Server;

export function setupTestDb() {
  beforeAll(async () => {
    testDb = knex(createTestKnexConfig());
    await testDb.migrate.latest();
    await setDb(testDb);
    const app = createApp();
    testServer = app.listen(0);
    await new Promise<void>((resolve) => testServer.on("listening", resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => testServer.close(() => resolve()));
    await closeDb();
  });

  beforeEach(async () => {
    await testDb("save_events").del();
    await testDb("daily_snapshots").del();
    await testDb("settings").del();
    await testDb("chapters").del();
    await testDb("projects").del();
  });

  return {
    get db() {
      return testDb;
    },
    get app() {
      return testServer;
    },
  };
}
