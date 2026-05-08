import { useState, useEffect, useRef } from 'react';
import type { AppSchema, Row } from '../types';

export function useSchema() {
  const [schema, setSchema] = useState<AppSchema | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/schema')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<AppSchema>;
      })
      .then(setSchema)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  return { schema, error };
}

export function useTableRows(tableId: string | null) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const cache = useRef<Map<string, Row[]>>(new Map());

  useEffect(() => {
    if (!tableId) return;
    if (cache.current.has(tableId)) {
      setRows(cache.current.get(tableId)!);
      return;
    }
    setLoading(true);
    fetch(`/api/tables/${tableId}`)
      .then((r) => r.json() as Promise<Record<string, unknown>[]>)
      .then((data) => {
        const indexed: Row[] = data.map((r, i) => ({ ...r, __idx: i }));
        cache.current.set(tableId, indexed);
        setRows(indexed);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [tableId]);

  return { rows, loading };
}
