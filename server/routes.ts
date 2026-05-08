import { Router } from 'express';
import { loadSchema, fetchRows } from './db.js';

export const router = Router();

// Cache schema in memory — it's static for this dataset
let schemaCache: ReturnType<typeof loadSchema> | null = null;

router.get('/schema', (_req, res) => {
  try {
    if (!schemaCache) schemaCache = loadSchema();
    res.json(schemaCache);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/tables/:tableId', (req, res) => {
  try {
    const { tableId } = req.params;
    const { limit, offset, sort, dir } = req.query as Record<string, string>;
    const rows = fetchRows(tableId, {
      limit: limit ? parseInt(limit, 10) : 1000,
      offset: offset ? parseInt(offset, 10) : 0,
      sort,
      dir,
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
