import { Router } from 'express';
import multer from 'multer';
import { loadSchema, fetchRows, ingestJsonl } from './db.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

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

router.post('/ingest', upload.single('file'), (req, res) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
    const { originalname, buffer } = req.file;
    const content = buffer.toString('utf-8');

    if (originalname.endsWith('.jsonl') || originalname.endsWith('.ndjson')) {
      const result = ingestJsonl(content, originalname);
      // Invalidate schema cache so row counts refresh
      schemaCache = null;
      res.json(result);
    } else {
      res.status(400).json({ error: 'Unsupported file type. Upload a .jsonl file.' });
    }
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
