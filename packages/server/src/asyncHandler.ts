import type { Request, Response, NextFunction } from "express";

// Generic Express async-error adapter. It has zero dependency on app
// composition, so it lives in its own module rather than in app.ts
// (F-6): previously app.ts exported it while importing all nine routers,
// and each router imported it back — a runtime cycle through the
// composition root that resolved only because routers are invoked lazily
// inside createApp(). Routers now import from here; app.ts no longer
// participates in the cycle.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
