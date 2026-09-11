import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

/**
 * Fetch a GET endpoint with loading, error and refetch handling.
 * Requests abort on unmount or when the path changes, so a fast navigation
 * never lands stale data on the new screen.
 */
export function useApi(path, { enabled = true, deps = [] } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const controller = useRef(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  const load = useCallback(
    async ({ quiet = false } = {}) => {
      if (!path || !enabled) {
        setLoading(false);
        return null;
      }
      controller.current?.abort();
      const ctrl = new AbortController();
      controller.current = ctrl;

      if (!quiet) setLoading(true);
      setError(null);
      try {
        const result = await api.get(path, { signal: ctrl.signal });
        if (mounted.current && !ctrl.signal.aborted) {
          setData(result);
          setLoading(false);
        }
        return result;
      } catch (err) {
        if (err.name === 'AbortError') return null;
        if (mounted.current) {
          setError(err.message || 'Something went wrong');
          setLoading(false);
        }
        return null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, enabled, ...deps],
  );

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

/** Debounce a fast-changing value, e.g. a search box. */
export function useDebounced(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/** True when the viewport is at or below a breakpoint. */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    mql.addEventListener('change', onChange);
    setMatches(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export const useIsMobile = () => useMediaQuery('(max-width: 900px)');

/** Persist a small preference (a filter, a collapsed sidebar) per browser. */
export function useLocalState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : JSON.parse(raw);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage may be unavailable; the preference simply will not persist */
    }
  }, [key, value]);
  return [value, setValue];
}

/**
 * Submit handler for forms: tracks a busy flag and surfaces the server's
 * message, so every form in the app behaves the same way.
 */
export function useSubmit(fn, { onSuccess, onError } = {}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = useCallback(
    async (...args) => {
      setBusy(true);
      setError(null);
      try {
        const result = await fn(...args);
        onSuccess?.(result);
        return result;
      } catch (err) {
        const message = err.message || 'Something went wrong';
        setError(message);
        onError?.(err);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [fn, onSuccess, onError],
  );

  return { submit, busy, error, setError };
}
