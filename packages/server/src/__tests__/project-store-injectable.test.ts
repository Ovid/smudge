import { describe, it, expect, beforeEach } from "vitest";
import {
  getProjectStore,
  setProjectStore,
  resetProjectStore,
  initProjectStore,
} from "../stores/project-store.injectable";
import type { ProjectStore } from "../stores/project-store.types";
import { setupTestDb } from "./test-helpers";

setupTestDb();

describe("project-store.injectable", () => {
  beforeEach(() => {
    resetProjectStore();
  });

  it("getProjectStore throws before initialization", () => {
    expect(() => getProjectStore()).toThrow("ProjectStore not initialized");
  });

  it("initProjectStore makes getProjectStore return a store", () => {
    initProjectStore();
    const store = getProjectStore();
    expect(store).toBeDefined();
    expect(typeof store.findProjectById).toBe("function");
  });

  it("setProjectStore overrides the store", () => {
    const mockStore = {
      findProjectById: () => Promise.resolve(null),
    } as unknown as ProjectStore;
    setProjectStore(mockStore);
    expect(getProjectStore()).toBe(mockStore);
  });
});
