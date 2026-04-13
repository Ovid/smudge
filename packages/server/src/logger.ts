import pino from "pino";

const VALID_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal", "silent"] as const;

function resolveLogLevel(): string {
  const raw = process.env.LOG_LEVEL?.trim();
  if (!raw) return "info";
  if ((VALID_LEVELS as readonly string[]).includes(raw)) return raw;

  console.warn(`Invalid LOG_LEVEL "${raw}", defaulting to "info"`);
  return "info";
}

const usePretty = process.env.NODE_ENV === "development";

export const logger = pino({
  level: resolveLogLevel(),
  ...(usePretty && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true },
    },
  }),
});
