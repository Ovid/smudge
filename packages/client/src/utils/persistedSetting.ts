export interface SettingCodec<T> {
  /** Parse a raw storage string. Return undefined to reject it → fallback. */
  parse: (raw: string) => T | undefined;
  serialize: (value: T) => string;
  fallback: T;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * A number constrained to [min, max]. Out-of-range values CLAMP (rather than
 * reject) so that this same `parse` can normalize writes as well as reads —
 * see usePersistedState. Non-numbers reject and fall back.
 */
export function numberInRange(min: number, max: number, fallback: number): SettingCodec<number> {
  return {
    // Number("") === 0 and Number("   ") === 0 — both finite. Without this
    // guard an empty stored value would clamp to `min`, silently turning
    // garbage into a legitimate-looking width instead of falling back to the
    // default. Keep "is it a number at all?" separate from "is it in range?".
    parse: (raw) => {
      if (raw.trim() === "") return undefined;
      const n = Number(raw);
      return Number.isFinite(n) ? clamp(n, min, max) : undefined;
    },
    serialize: String,
    fallback,
  };
}

/** A strict boolean: only "true" and "false" parse; everything else falls back. */
export function flag(fallback: boolean): SettingCodec<boolean> {
  return {
    parse: (raw) => (raw === "true" ? true : raw === "false" ? false : undefined),
    serialize: String,
    fallback,
  };
}

/**
 * An opaque string. Deliberately does NOT validate domain membership — the
 * helper cannot know the caller's value set (e.g. which tab ids exist). The
 * component that owns the domain validates it (ReferencePanel degrades an
 * unknown activeTabId to tabs[0]). See 4c.0 review item [I1].
 */
export function text(fallback: string): SettingCodec<string> {
  return { parse: (raw) => raw, serialize: (value) => value, fallback };
}
