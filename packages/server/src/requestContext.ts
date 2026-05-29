import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { logger } from "./logger";

// F-10: augment Express Request with a per-request correlation id and a child
// logger bound to that id. Lets the global error handler (and any future
// handler/service that receives `req`) tie log lines back to a single request.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express type augmentation requires the global namespace
  namespace Express {
    interface Request {
      id: string;
      log: Logger;
    }
  }
}

// Accept an inbound id only if it is a sane, bounded token (so an attacker
// cannot inject newlines/control chars or unbounded data into log lines);
// otherwise mint a fresh UUID.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Request-correlation middleware (F-10).
 *
 * Assigns every request a correlation id — honouring a well-formed inbound
 * `X-Request-Id` (e.g. from a reverse proxy) or minting a UUID — exposes it as
 * `req.id`, attaches a `req.log` child logger bound to `{ req_id, method, path }`,
 * and echoes the id back in the `X-Request-Id` response header. On response
 * completion it emits a `debug`-level access log (silent at the default `info`
 * level, so it adds no noise but is available via `LOG_LEVEL=debug`).
 *
 * The global error handler logs unhandled errors through the top-level logger
 * with these same correlation fields, so a 500 in the logs can be traced to its
 * request.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id");
  const accepted = !!incoming && REQUEST_ID_PATTERN.test(incoming);
  // S1: a non-empty inbound id that fails the pattern is rejected silently
  // by default — misconfigured upstreams (overlong trace ids, control chars,
  // wrong charset) lose correlation invisibly. Emit a debug-level diagnostic
  // so `LOG_LEVEL=debug` surfaces the discard with the raw value.
  if (incoming && !accepted) {
    logger.debug({ raw: incoming }, "discarded inbound x-request-id");
  }
  const id = accepted ? incoming : randomUUID();
  req.id = id;
  req.log = logger.child({ req_id: id, method: req.method, path: req.path });
  res.setHeader("X-Request-Id", id);
  res.on("finish", () => {
    req.log.debug({ status: res.statusCode }, "request completed");
  });
  next();
}
