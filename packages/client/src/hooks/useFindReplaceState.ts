import { useState, useCallback, useRef, useEffect } from "react";
import { api, ApiRequestError } from "../api/client";
import { STRINGS } from "../strings";
import type { SearchResult } from "@smudge/shared";

const S = STRINGS.findReplace;

export interface UseFindReplaceStateReturn {
  panelOpen: boolean;
  togglePanel: () => void;
  closePanel: () => void;
  query: string;
  setQuery: (q: string) => void;
  replacement: string;
  setReplacement: (r: string) => void;
  options: { case_sensitive: boolean; whole_word: boolean; regex: boolean };
  toggleOption: (opt: "case_sensitive" | "whole_word" | "regex") => void;
  results: SearchResult | null;
  loading: boolean;
  error: string | null;
  search: (projectSlug: string) => Promise<void>;
}

export function useFindReplaceState(): UseFindReplaceStateReturn {
  const [panelOpen, setPanelOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [options, setOptions] = useState({
    case_sensitive: false,
    whole_word: false,
    regex: false,
  });
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSlugRef = useRef<string | null>(null);

  const togglePanel = useCallback(() => {
    setPanelOpen((prev) => !prev);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
  }, []);

  const toggleOption = useCallback(
    (opt: "case_sensitive" | "whole_word" | "regex") => {
      setOptions((prev) => ({ ...prev, [opt]: !prev[opt] }));
    },
    [],
  );

  const search = useCallback(
    async (projectSlug: string) => {
      if (!query) {
        setResults(null);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await api.search.find(projectSlug, query, options);
        setResults(result);
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 400) {
          setError(S.invalidRegex);
        } else {
          setError(err instanceof Error ? err.message : "Search failed");
        }
        setResults(null);
      } finally {
        setLoading(false);
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

  // Expose a way to set the project slug for debounced search
  const setQueryWithSlug = useCallback(
    (q: string) => {
      setQuery(q);
    },
    [],
  );

  return {
    panelOpen,
    togglePanel,
    closePanel,
    query,
    setQuery: setQueryWithSlug,
    replacement,
    setReplacement,
    options,
    toggleOption,
    results,
    loading,
    error,
    search: useCallback(
      async (projectSlug: string) => {
        latestSlugRef.current = projectSlug;
        await search(projectSlug);
      },
      [search],
    ),
  };
}
