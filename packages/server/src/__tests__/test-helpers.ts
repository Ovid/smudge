import http from "http";
import { beforeAll, afterAll, beforeEach } from "vitest";
import knex, { type Knex } from "knex";
import { createTestKnexConfig } from "../db/knexfile";
import { createApp } from "../app";

let testDb: Knex;
let testServer: http.Server;

export function setupTestDb() {
  beforeAll(async () => {
    testDb = knex(createTestKnexConfig());
    await testDb.raw("PRAGMA foreign_keys = ON");
    await testDb.migrate.latest();
    testServer = createApp(testDb).listen(0);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => testServer.close(() => resolve()));
    await testDb.destroy();
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
