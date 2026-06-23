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

// Module-level cache shared across all component instances (frames + telemetry tabs)
const _frameCache = new Map<string, Row[]>();

export function useFramePackets(tableId: string | null) {
  const [rows, setRows] = useState<Row[]>(() =>
    tableId ? (_frameCache.get(`frames:${tableId}`) ?? []) : [],
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tableId) return;
    const key = `frames:${tableId}`;
    if (_frameCache.has(key)) {
      setRows(_frameCache.get(key)!);
      return;
    }
    setLoading(true);
    setRows([]);
    fetch(`/api/tables/${tableId}/frames`)
      .then((r) => r.json() as Promise<Record<string, unknown>[]>)
      .then((data) => {
        const indexed: Row[] = data.map((r, i) => ({ ...r, __idx: i }));
        _frameCache.set(key, indexed);
        setRows(indexed);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [tableId]);

  return { rows, loading };
}

export function useTableRows(tableId: string | null, limit: number) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const cache = useRef<Map<string, Row[]>>(new Map());

  useEffect(() => {
    if (!tableId) return;
    const key = `${tableId}:${limit}`;
    if (cache.current.has(key)) {
      setRows(cache.current.get(key)!);
      return;
    }
    setLoading(true);
    setRows([]);
    fetch(`/api/tables/${tableId}?limit=${limit}`)
      .then((r) => r.json() as Promise<Record<string, unknown>[]>)
      .then((data) => {
        const indexed: Row[] = data.map((r, i) => ({ ...r, __idx: i }));
        cache.current.set(key, indexed);
        setRows(indexed);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [tableId, limit]);

  return { rows, loading };
}
