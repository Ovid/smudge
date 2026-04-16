import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../app";
import { getProjectStore } from "../stores/project-store.injectable";
import * as SearchService from "./search.service";

const SearchOptionsSchema = z
  .object({
    case_sensitive: z.boolean().optional(),
    whole_word: z.boolean().optional(),
    regex: z.boolean().optional(),
  })
  .optional();

const SearchSchema = z.object({
  query: z.string().min(1, "Search query is required"),
  options: SearchOptionsSchema,
});

const ReplaceSchema = z.object({
  search: z.string().min(1, "Search term is required"),
  replace: z.string(),
  options: SearchOptionsSchema,
  scope: z
    .union([
      z.object({ type: z.literal("project") }),
      z.object({ type: z.literal("chapter"), chapter_id: z.string().uuid() }),
    ])
    .optional()
    .default({ type: "project" }),
});

export function searchRouter(): Router {
  const router = Router();

  // POST /api/projects/:slug/search
  router.post(
    "/:slug/search",
    asyncHandler(async (req, res) => {
      const parsed = SearchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0]?.message ?? "Invalid input",
          },
        });
        return;
      }

      const { query, options } = parsed.data;

      // Resolve slug to project ID
      const store = getProjectStore();
      const project = await store.findProjectBySlug(req.params.slug);
      if (!project) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Project not found." },
        });
        return;
      }

      try {
        const result = await SearchService.searchProject(
          project.id,
          query,
          options,
        );
        // searchProject returns null only when project not found,
        // which we've already handled above
        res.json(result);
      } catch (err) {
        // Invalid regex throws from searchInDoc
        if (err instanceof SyntaxError || (err as Error).message?.includes("Invalid regular expression")) {
          res.status(400).json({
            error: {
              code: "VALIDATION_ERROR",
              message: (err as Error).message,
            },
          });
          return;
        }
        throw err;
      }
    }),
  );

  // POST /api/projects/:slug/replace
  router.post(
    "/:slug/replace",
    asyncHandler(async (req, res) => {
      const parsed = ReplaceSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0]?.message ?? "Invalid input",
          },
        });
        return;
      }

      const { search, replace, options, scope } = parsed.data;

      // Resolve slug to project ID
      const store = getProjectStore();
      const project = await store.findProjectBySlug(req.params.slug);
      if (!project) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Project not found." },
        });
        return;
      }

      const result = await SearchService.replaceInProject(
        project.id,
        search,
        replace,
        options,
        scope,
      );

      if (result === null) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Project not found." },
        });
        return;
      }

      if ("validationError" in result) {
        res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: result.validationError },
        });
        return;
      }

      res.json(result);
    }),
  );

  return router;
}
