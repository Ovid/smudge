import { useState } from "react";

/**
 * Codecs are values, not hooks — construct them at MODULE scope. A codec
 * created inline during render is a new object each render and destabilizes
 * usePersistedState's setter identity.
 */
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

/** Read once, at mount. Any rejection — absent, unparseable, storage unavailable — yields the fallback. */
function read<T>(key: string, codec: SettingCodec<T>): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      const parsed = codec.parse(raw);
      if (parsed !== undefined) return parsed;
    }
  } catch {
    // Deliberately silent — do NOT "fix" this by adding a clientWarn. A UI
    // preference that fails to load is invisible to the user (they get the
    // default) and unactionable. The loud path is data loss (useContentCache),
    // which shares this origin's quota and already warns. Warning here would
    // train the user to ignore that one.
  }
  return codec.fallback;
}

/**
 * A useState whose initial value is read from localStorage and validated by
 * `codec.parse`. The codec is the single validator: whatever `parse` rejects
 * (or clamps) on the way in is what the state can hold.
 */
export function usePersistedState<T>(key: string, codec: SettingCodec<T>) {
  const [value, setValue] = useState<T>(() => read(key, codec));
  return [value, setValue] as const; // write path lands in Task 3
}
