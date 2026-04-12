import { describe, it, expect, beforeEach } from "vitest";
import {
  getProjectStore,
  setProjectStore,
  initProjectStore,
} from "../stores/project-store.injectable";
import type { ProjectStore } from "../stores/project-store.types";
import { setupTestDb } from "./test-helpers";

setupTestDb();

describe("project-store.injectable", () => {
  beforeEach(() => {
    // Reset to uninitialized state by setting to null via a mock
    setProjectStore(null as unknown as ProjectStore);
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
