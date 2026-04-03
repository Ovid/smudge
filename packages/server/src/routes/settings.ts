import { Router } from "express";
import type { Knex } from "knex";
import { UpdateSettingsSchema } from "@smudge/shared";
import { asyncHandler } from "../app";

const SETTING_VALIDATORS: Record<string, (value: string) => boolean> = {
  timezone: (value) => {
    try {
      return Intl.supportedValuesOf("timeZone").includes(value);
    } catch {
      return false;
    }
  },
};

export function settingsRouter(db: Knex): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const rows = await db("settings").select("key", "value");
      const settings: Record<string, string> = {};
      for (const row of rows) {
        settings[row.key] = row.value;
      }
      res.json(settings);
    }),
  );

  router.patch(
    "/",
    asyncHandler(async (req, res) => {
      const parsed = UpdateSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: parsed.error.message },
        });
      }

      // Validate all values before applying any
      const errors: Record<string, string> = {};
      for (const { key, value } of parsed.data.settings) {
        const validator = SETTING_VALIDATORS[key];
        if (validator && !validator(value)) {
          errors[key] = `Invalid value for ${key}: ${value}`;
        }
      }

      if (Object.keys(errors).length > 0) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid settings",
            details: errors,
          },
        });
      }

      // Apply atomically
      await db.transaction(async (trx) => {
        for (const { key, value } of parsed.data.settings) {
          const existing = await trx("settings").where({ key }).first();
          if (existing) {
            await trx("settings").where({ key }).update({ value });
          } else {
            await trx("settings").insert({ key, value });
          }
        }
      });

      res.json({ message: "Settings updated" });
    }),
  );

  return router;
}
