import { useState, useCallback, useRef, useEffect } from "react";
import { api, ApiRequestError } from "../api/client";
import { type SearchResult } from "@smudge/shared";
import { mapSearchErrorToMessage } from "../utils/findReplaceErrors";

export interface SearchOptionsShape {
  case_sensitive: boolean;
  whole_word: boolean;
  regex: boolean;
}

export interface UseFindReplaceStateReturn {
  panelOpen: boolean;
  togglePanel: () => void;
  closePanel: () => void;
  query: string;
  setQuery: (q: string) => void;
  replacement: string;
  setReplacement: (r: string) => void;
  options: SearchOptionsShape;
  toggleOption: (opt: "case_sensitive" | "whole_word" | "regex") => void;
  results: SearchResult | null;
  /** The query string that produced the current results (frozen at fetch time). */
  resultsQuery: string | null;
  /** The options that produced the current results (frozen at fetch time). */
  resultsOptions: SearchOptionsShape | null;
  loading: boolean;
  error: string | null;
  /**
   * Reset the panel-local error so a stale prior-search failure cannot
   * co-display with a fresh mutation outcome (S3). Used by replace
   * callers on entry alongside the parent's actionError/actionInfo
   * clears.
   */
  clearError: () => void;
  search: (projectSlug: string) => Promise<void>;
}

export function useFindReplaceState(
  projectSlug?: string,
  projectId?: string,
): UseFindReplaceStateReturn {
  const [panelOpen, setPanelOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [options, setOptions] = useState({
    case_sensitive: false,
    whole_word: false,
    regex: false,
  });
  const [results, setResults] = useState<SearchResult | null>(null);
  const [resultsQuery, setResultsQuery] = useState<string | null>(null);
  const [resultsOptions, setResultsOptions] = useState<SearchOptionsShape | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSlugRef = useRef<string | null>(projectSlug ?? null);
  // Key state reset on project identity, not slug. A project rename
  // changes the slug without changing the project — preserving the
  // user's in-progress query/replacement across a rename is the
  // expected UX; wiping it is surprising data loss.
  const latestProjectIdRef = useRef<string | null>(projectId ?? null);
  // Monotonic counter used to discard stale in-flight search responses.
  const searchSeqRef = useRef(0);
  // Owned by the latest in-flight search() call. Aborting releases the
  // HTTP connection and stops the server-side regex walk; the seq-based
  // guard still protects us from late resolutions writing state back.
  const searchAbortRef = useRef<AbortController | null>(null);

  // Keep latestSlugRef in sync with the current slug so search() always
  // POSTs to the live URL. Resets are gated on project id below.
  useEffect(() => {
    if (projectSlug) latestSlugRef.current = projectSlug;
  }, [projectSlug]);

  // On unmount, abort any in-flight search so the server stops walking
  // chapters for a caller that no longer exists.
  useEffect(() => {
    return () => {
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
    };
  }, []);

  // Reset search state only on genuine project change, not on rename.
  useEffect(() => {
    if (!projectId) return;
    if (latestProjectIdRef.current !== projectId) {
      latestProjectIdRef.current = projectId;
      setQuery("");
      setReplacement("");
      setResults(null);
      setResultsQuery(null);
      setResultsOptions(null);
      setError(null);
      // I2 (review 2026-04-21): clear loading here. The seq bump below
      // stops the in-flight response from writing state back, but its
      // `finally { if (seq === searchSeqRef.current) setLoading(false) }`
      // fails the seq check after the bump — leaving a stuck "Searching…"
      // spinner on the new project's panel with no recovery path except
      // closePanel(). closePanel already clears loading; mirror that here
      // so a user who navigates projects without closing the panel sees
      // the same idle state they would after a clean close/reopen.
      setLoading(false);
      searchSeqRef.current++;
      // Abort any in-flight search so the server stops walking a project
      // the user has left. The seq bump prevents the response from
      // writing state back, but without abort the server keeps scanning.
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
    }
  }, [projectId]);

  const togglePanel = useCallback(() => {
    setPanelOpen((prev) => !prev);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    // Clear result state so reopening the panel (Ctrl+H → Esc → Ctrl+H)
    // does not surface a stale result set pinned to potentially edited
    // content. The query input itself is preserved so the user can
    // pick up where they left off; the debounced effect will re-fire the
    // search once the panel opens again.
    setResults(null);
    setResultsQuery(null);
    setResultsOptions(null);
    setError(null);
    // Any still-in-flight response must not write state back; its
    // seq-guarded finally will also not be reached to clear `loading`,
    // so reset it here or reopening the panel shows a stuck "Searching…".
    setLoading(false);
    // Invalidate any still-in-flight response so a late reply can't
    // write results back after the panel was explicitly closed.
    searchSeqRef.current++;
    // Abort the underlying fetch too so the server stops walking chapters
    // for a search the user has clearly moved on from.
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    // Clear any pending debounced search; if the panel closes inside the
    // 300ms debounce window, the timer would otherwise fire search(slug)
    // after the panel was closed — bumping the seq again and writing a
    // stale result set pinned to the pre-close query/options, visible on
    // reopen.
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const toggleOption = useCallback((opt: "case_sensitive" | "whole_word" | "regex") => {
    setOptions((prev) => ({ ...prev, [opt]: !prev[opt] }));
  }, []);

  const search = useCallback(
    async (slug: string) => {
      // Always bump the seq so any still-in-flight response for a prior
      // query is discarded rather than overwriting cleared state.
      const seq = ++searchSeqRef.current;
      // Abort any prior in-flight search so a rapid-typing stream doesn't
      // leave N regex walks running server-side for queries the user has
      // already moved past.
      searchAbortRef.current?.abort();
      if (!query) {
        searchAbortRef.current = null;
        setResults(null);
        setResultsQuery(null);
        setResultsOptions(null);
        setError(null);
        setLoading(false);
        return;
      }
      // Snapshot the query/options as-of the request so replace operations
      // use the exact search context that produced the current results
      // (the user may be typing while waiting for the response).
      // `replacement` is intentionally NOT frozen: it does not affect the
      // result set, and freezing it here would either re-fire searches on
      // every keystroke in the replace input or leave it stale relative to
      // what the user sees.
      const frozenQuery = query;
      const frozenOptions: SearchOptionsShape = { ...options };
      const controller = new AbortController();
      searchAbortRef.current = controller;
      setLoading(true);
      setError(null);
      try {
        const result = await api.search.find(slug, frozenQuery, frozenOptions, controller.signal);
        if (seq !== searchSeqRef.current) return;
        setResults(result);
        setResultsQuery(frozenQuery);
        setResultsOptions(frozenOptions);
      } catch (err) {
        if (seq !== searchSeqRef.current) return;
        const message = mapSearchErrorToMessage(err);
        if (message === null) {
          // Aborted: no banner, no state changes.
          return;
        }
        if (err instanceof ApiRequestError && (err.status === 400 || err.status === 404)) {
          // 400s mean the CURRENT query is invalid; stale results no
          // longer correspond to anything the user typed.
          // 404s mean the project (or scope) has gone away — the prior
          // results are pinned to a slug/chapter that no longer resolves
          // and can't be acted on. Clear so the panel is consistent with
          // the error.
          setError(message);
          setResults(null);
          setResultsQuery(null);
          setResultsOptions(null);
        } else {
          // Network / 5xx / unknown: the prior successful results are
          // still valid for resultsQuery. Show the error banner but
          // preserve the result set so a transient blip doesn't wipe
          // content the user is actively reading.
          setError(message);
        }
      } finally {
        if (seq === searchSeqRef.current) {
          setLoading(false);
          // Release this request's controller — a stale (overwritten) ref
          // would already have been replaced by the next search, so only
          // the current-seq branch owns the cleanup.
          if (searchAbortRef.current === controller) searchAbortRef.current = null;
        }
      }
    },
    [query, options],
  );

  // Debounced auto-search when query/options change
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    if (!panelOpen || !query || !latestSlugRef.current) {
      return;
    }
    // I3 (review 2026-04-21): read latestSlugRef.current INSIDE the
    // setTimeout callback, not at effect-setup time. A project rename
    // between the effect running and the 300ms timer firing updates
    // the ref (via the projectSlug sync useEffect) but does not re-run
    // this effect, so capturing `slug` here would fire the search
    // against the dead slug — directly contradicting the design intent
    // documented on the search() wrapper below ("always read .current
    // at call time").
    debounceRef.current = setTimeout(() => {
      const slug = latestSlugRef.current;
      if (!slug) return;
      search(slug);
    }, 300);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [panelOpen, query, options, search]);

  return {
    panelOpen,
    togglePanel,
    closePanel,
    query,
    setQuery,
    replacement,
    setReplacement,
    options,
    toggleOption,
    results,
    resultsQuery,
    resultsOptions,
    loading,
    error,
    clearError: useCallback(() => setError(null), []),
    search: useCallback(
      async (_slug: string) => {
        // Callers (EditorPage executeReplace/handleReplaceOne) capture
        // slug in a closure at call time, so after a server-side rename
        // the closure value is stale. Ignore the argument and use the
        // projectSlug-synced ref — the useEffect above keeps it current.
        // Without this, debounced searches triggered from here would
        // target the dead slug until the user manually closed and
        // reopened the panel (which resyncs the ref from the prop).
        const current = latestSlugRef.current;
        if (!current) return;
        await search(current);
      },
      [search],
    ),
  };
}
