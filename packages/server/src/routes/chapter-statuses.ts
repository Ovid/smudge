import { Router } from "express";
import type { Knex } from "knex";
import { asyncHandler } from "../app";

export function chapterStatusesRouter(db: Knex): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const statuses = await db("chapter_statuses").orderBy("sort_order", "asc").select("*");
      res.json(statuses);
    }),
  );

  return router;
}
