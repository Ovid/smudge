import { useState, useCallback, useRef, useEffect } from "react";
import { api, ApiRequestError } from "../api/client";
import { STRINGS } from "../strings";
import { type SearchResult } from "@smudge/shared";
import { mapSearchErrorToMessage } from "../utils/findReplaceErrors";

const S = STRINGS.findReplace;

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

  // Keep latestSlugRef in sync with the current slug so search() always
  // POSTs to the live URL. Resets are gated on project id below.
  useEffect(() => {
    if (projectSlug) latestSlugRef.current = projectSlug;
  }, [projectSlug]);

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
      searchSeqRef.current++;
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
  }, []);

  const toggleOption = useCallback((opt: "case_sensitive" | "whole_word" | "regex") => {
    setOptions((prev) => ({ ...prev, [opt]: !prev[opt] }));
  }, []);

  const search = useCallback(
    async (slug: string) => {
      // Always bump the seq so any still-in-flight response for a prior
      // query is discarded rather than overwriting cleared state.
      const seq = ++searchSeqRef.current;
      if (!query) {
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
      setLoading(true);
      setError(null);
      try {
        const result = await api.search.find(slug, frozenQuery, frozenOptions);
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
        if (err instanceof ApiRequestError && err.status === 400) {
          // 400s mean the CURRENT query is invalid; stale results no
          // longer correspond to anything the user typed. Clear so the
          // panel is consistent with the error.
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
        if (seq === searchSeqRef.current) setLoading(false);
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
    const slug = latestSlugRef.current;
    debounceRef.current = setTimeout(() => {
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
    search: useCallback(
      async (slug: string) => {
        latestSlugRef.current = slug;
        await search(slug);
      },
      [search],
    ),
  };
}
