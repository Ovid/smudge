import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { asyncHandler } from "../app";

// Safety net for architecture flaw F-6 (circular dependency:
// app.ts ↔ every *.routes.ts via the exported `asyncHandler`).
//
// F-6 moves `asyncHandler` out of the composition root (app.ts) into its
// own module so the routers no longer import back from app.ts. The
// helper had NO direct unit test before this — its behavior was only
// exercised indirectly through route integration tests. These tests pin
// the contract the move must preserve: resolved handlers pass through
// without invoking `next`, and rejected handlers forward the error to
// `next` exactly once.
//
// NOTE: the import path (`../app`) is updated to the new module in the
// F-6 fix commit; the assertions below do not change.

function mockReqRes() {
  const req = {} as Request;
  const res = {} as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next };
}

describe("asyncHandler (F-6 safety net)", () => {
  it("does not call next when the wrapped handler resolves", async () => {
    const { req, res, next } = mockReqRes();
    const handler = asyncHandler(async () => {
      // resolves with no error
    });
    await handler(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });

  it("forwards a rejected handler's error to next exactly once", async () => {
    const { req, res, next } = mockReqRes();
    const boom = new Error("boom");
    const handler = asyncHandler(async () => {
      throw boom;
    });
    await handler(req, res, next);
    // Allow the rejected promise's .catch(next) microtask to run.
    await new Promise((resolve) => setImmediate(resolve));
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(boom);
  });
});
