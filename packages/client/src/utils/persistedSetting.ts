import { useCallback, useRef, useState } from "react";

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
// Two properties every codec MUST hold, because usePersistedState's fixed-point
// invariant rests on them:
//   (a) `parse ∘ serialize` is idempotent — normalizing an already-normalized
//       value must be a no-op, or repeated writes would drift.
//   (b) `fallback` is a fixed point of it: parse(serialize(fallback)) === fallback.
//       Violate (b) and read() hands back a value no write could ever produce —
//       state and reload silently disagree. numberInRange enforces (b) by
//       clamping its own fallback; a new codec must enforce it too.

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
    // Clamped so the fallback is a fixed point of the parse above (property (b)):
    // an out-of-range fallback would have read() return e.g. 900 while every
    // write normalized to 480.
    fallback: clamp(fallback, min, max),
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

/** Any rejection — absent, unparseable, storage unavailable — yields the fallback. */
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
 * React state backed by a localStorage key, validated by a single codec.
 *
 * `codec.parse` is the ONLY validator, and it governs BOTH directions: the
 * setter normalizes via `parse(serialize(next))`, so state and storage are
 * always normalized identically — the same value a reload would parse back.
 * (Identically NORMALIZED, not identical: a failed `setItem` leaves storage
 * stale while state moves on. See below.) This is what stops the read and
 * write paths from drifting apart — the asymmetry this helper was written to
 * close: handlePanelResize clamped before persisting, handleSidebarResize did
 * not.
 *
 * A write the codec cannot represent (NaN, Infinity — e.g. a resize handler
 * reading a torn-down rect) is IGNORED: state and storage keep the last
 * known-good value. It is not reset to `codec.fallback`, which would wipe the
 * user's real 400px width on one bad mousemove. The fallback is the floor for
 * absent/corrupt STORAGE, not a reset button for a bad live write — at read
 * time the fallback IS the last known-good value, because there is nothing
 * else to keep. Same rule, both directions.
 *
 * Storage failures are deliberately SILENT (no clientWarn). The data-loss path
 * — useContentCache, which shares this origin's quota — already warns loudly,
 * and the resize path would otherwise warn at mousemove frequency. State still
 * updates, so the setting works for the session even when it cannot persist.
 *
 * CONTRACT: `key` must be constant for the component's lifetime, and one
 * component owns it. The stored value is read exactly once, by the lazy
 * `useState` initializer at mount. A changing key would split-brain — state
 * holding the OLD key's value while writes land on the NEW key, with no
 * re-read. Two mounted components sharing a key split-brain the same way: each
 * holds its own state and neither sees the other's writes. There is no
 * cross-tab `storage` listener either — a deliberate non-goal, matching the
 * hand-rolled readers this replaces. Derive per-entity settings by remounting
 * (a `key` prop on the component), not by varying this argument.
 */
export function usePersistedState<T>(
  key: string,
  codec: SettingCodec<T>,
): readonly [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => read(key, codec));

  // Mirrors `value` so the functional-updater form can resolve `prev` WITHOUT
  // running the setItem side effect inside a setState updater — React
  // StrictMode double-invokes updaters, which would persist twice.
  const valueRef = useRef(value);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const requested =
        typeof next === "function" ? (next as (prev: T) => T)(valueRef.current) : next;

      // One validator, both directions. A rejected write keeps the last
      // known-good value rather than resetting to the fallback — valueRef.current
      // is itself a fixed point of the round-trip, so the invariant holds.
      const normalized = codec.parse(codec.serialize(requested)) ?? valueRef.current;

      valueRef.current = normalized;
      try {
        // Yes, this serializes a second time. Hoisting the first result is only
        // valid when `normalized === requested`, which is not the common case —
        // the branch would cost more than the String() it saves. Left as-is.
        localStorage.setItem(key, codec.serialize(normalized));
      } catch {
        // Silent — see the doc comment above. State still updates below, so the
        // setting works for this session even when it cannot be persisted.
      }
      setValue(normalized);
    },
    [key, codec],
  );

  return [value, set] as const;
}
