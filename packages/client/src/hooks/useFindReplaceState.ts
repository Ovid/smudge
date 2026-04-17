import { useState, useCallback, useRef, useEffect } from "react";
import { api, ApiRequestError } from "../api/client";
import { STRINGS } from "../strings";
import type { SearchResult } from "@smudge/shared";

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
  /** The replacement string as of the search that produced current results. */
  resultsReplacement: string | null;
  loading: boolean;
  error: string | null;
  search: (projectSlug: string) => Promise<void>;
}

export function useFindReplaceState(projectSlug?: string): UseFindReplaceStateReturn {
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
  const [resultsReplacement, setResultsReplacement] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSlugRef = useRef<string | null>(projectSlug ?? null);
  // Monotonic counter used to discard stale in-flight search responses.
  const searchSeqRef = useRef(0);

  // Keep latestSlugRef in sync with projectSlug prop, and reset search state
  // when the project changes so a previous project's results never leak into
  // a new project's panel.
  useEffect(() => {
    if (!projectSlug) return;
    if (latestSlugRef.current !== projectSlug) {
      latestSlugRef.current = projectSlug;
      setQuery("");
      setReplacement("");
      setResults(null);
      setResultsQuery(null);
      setResultsOptions(null);
      setResultsReplacement(null);
      setError(null);
      searchSeqRef.current++;
    }
  }, [projectSlug]);

  const togglePanel = useCallback(() => {
    setPanelOpen((prev) => !prev);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
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
        setResultsReplacement(null);
        setError(null);
        setLoading(false);
        return;
      }
      // Snapshot the query/options/replacement as-of the request so replace
      // operations use the exact context that produced the current results
      // (the user may be typing while waiting for the response).
      const frozenQuery = query;
      const frozenOptions: SearchOptionsShape = { ...options };
      const frozenReplacement = replacement;
      setLoading(true);
      setError(null);
      try {
        const result = await api.search.find(slug, frozenQuery, frozenOptions);
        if (seq !== searchSeqRef.current) return;
        setResults(result);
        setResultsQuery(frozenQuery);
        setResultsOptions(frozenOptions);
        setResultsReplacement(frozenReplacement);
      } catch (err) {
        if (seq !== searchSeqRef.current) return;
        if (err instanceof ApiRequestError && err.status === 400) {
          // The server uses 400 for both invalid regex and match-cap-exceeded;
          // surface the server's human message when present, falling back to
          // the generic invalid-regex string.
          setError(err.message || S.invalidRegex);
        } else {
          setError(err instanceof Error ? err.message : "Search failed");
        }
        setResults(null);
        setResultsQuery(null);
        setResultsOptions(null);
        setResultsReplacement(null);
      } finally {
        if (seq === searchSeqRef.current) setLoading(false);
      }
    },
    [query, options, replacement],
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
    resultsReplacement,
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
