import { Router } from 'express';
import { existsSync, statSync, openSync, readSync, closeSync, readFileSync } from 'fs';
import { join } from 'path';
import multer from 'multer';
import {
  loadSchema, fetchRows, fetchFramePackets, ingestJsonl,
  assembleFilesForTable, listAssembledFiles, FILES_DIR,
  materializeTelemetry, fetchDecodedSummary, fetchDecodedTelemetry, fetchDecodeStatus,
  deletePass, previewBeacons, insertBeacons, exportDatabase, fetchAllParameters,
  fetchParameterHistory,
} from './db.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

export const router = Router();

// Cache schema in memory — it's static for this dataset
let schemaCache: Awaited<ReturnType<typeof loadSchema>> | null = null;

router.get('/schema', async (_req, res) => {
  try {
    if (!schemaCache) schemaCache = await loadSchema();
    res.json(schemaCache);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/ingest', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
    const { originalname, buffer } = req.file;
    const content = buffer.toString('utf-8');
    const forcedPassId = req.body?.passId ? parseInt(req.body.passId as string, 10) : undefined;

    if (originalname.endsWith('.jsonl') || originalname.endsWith('.ndjson')) {
      const result = await ingestJsonl(content, originalname, forcedPassId);
      schemaCache = null;
      res.json(result);
    } else {
      res.status(400).json({ error: 'Unsupported file type. Upload a .jsonl file.' });
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/tables/:tableId', async (req, res) => {
  try {
    const { tableId } = req.params;
    const { limit, offset, sort, dir } = req.query as Record<string, string>;
    const rows = await fetchRows(tableId, {
      limit:  limit  ? parseInt(limit, 10) : 1000,
      offset: offset ? parseInt(offset, 10) : 0,
      sort,
      dir,
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/tables/:tableId/frames', async (req, res) => {
  try {
    const rows = await fetchFramePackets(req.params.tableId);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/tables/:tableId/assemble-files', async (req, res) => {
  try {
    const files = await assembleFilesForTable(req.params.tableId);
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/tables/:tableId/assembled-files', async (req, res) => {
  try {
    const files = listAssembledFiles(req.params.tableId);
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/tables/:tableId/assembled-files/:filename', (req, res) => {
  const { tableId, filename } = req.params;
  if (!/^\w+$/.test(tableId) || filename.includes('/') || filename.includes('..')) {
    res.status(400).json({ error: 'Invalid path' }); return;
  }
  const filePath = join(FILES_DIR, tableId, filename);
  if (!existsSync(filePath)) { res.status(404).json({ error: 'File not found' }); return; }
  res.sendFile(filePath);
});

// ─── History / decoded telemetry ─────────────────────────────────────────────

function parsePassIds(raw: unknown): number[] {
  return String(raw ?? '').split(',').map(Number).filter(n => n > 0 && !isNaN(n));
}

router.post('/history/materialize', async (req, res) => {
  const { passId } = req.body as { passId?: number };
  if (!passId) { res.status(400).json({ error: 'passId required' }); return; }
  try {
    const result = await materializeTelemetry(Number(passId));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/history/summary', async (req, res) => {
  try {
    res.json(await fetchDecodedSummary(parsePassIds(req.query.passIds)));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/history/data', async (req, res) => {
  const passIds = parsePassIds(req.query.passIds);
  const cmd = String(req.query.cmd ?? '');
  if (!cmd) { res.status(400).json({ error: 'cmd required' }); return; }
  try {
    res.json(await fetchDecodedTelemetry(passIds, cmd));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/history/params', async (req, res) => {
  const passIds = parsePassIds(req.query.passIds);
  if (passIds.length === 0) { res.json([]); return; }
  try {
    res.json(await fetchParameterHistory(passIds));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/history/status', async (req, res) => {
  try {
    res.json(await fetchDecodeStatus(parsePassIds(req.query.passIds)));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Manual beacon entry ─────────────────────────────────────────────────────

router.post('/beacons/preview', (req, res) => {
  const { hexLines } = req.body as { hexLines?: string[] };
  if (!Array.isArray(hexLines) || hexLines.length === 0) {
    res.status(400).json({ error: 'hexLines array required' }); return;
  }
  try {
    res.json(previewBeacons(hexLines));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/beacons/insert', async (req, res) => {
  const { hexLines, passId } = req.body as { hexLines?: string[]; passId?: number };
  if (!Array.isArray(hexLines) || hexLines.length === 0) {
    res.status(400).json({ error: 'hexLines array required' }); return;
  }
  if (!passId || isNaN(Number(passId))) {
    res.status(400).json({ error: 'passId required' }); return;
  }
  try {
    const count = await insertBeacons(Number(passId), hexLines);
    schemaCache = null;
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/params', async (_req, res) => {
  try {
    res.json(await fetchAllParameters());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/export', async (_req, res) => {
  try {
    const data = await exportDatabase();
    const filename = `maveric_export_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(data, null, 2));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.delete('/passes/:passId', async (req, res) => {
  const { password } = req.body as { password?: string };
  if (password !== 'maveric') {
    res.status(403).json({ error: 'Incorrect password' }); return;
  }
  const passId = parseInt(req.params.passId, 10);
  if (!passId || isNaN(passId)) {
    res.status(400).json({ error: 'Invalid passId' }); return;
  }
  try {
    await deletePass(passId);
    schemaCache = null;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Live telemetry SSE stream ────────────────────────────────────────────────

router.get('/live/stream', (req, res) => {
  const rawPath = req.query.path as string;
  if (!rawPath || !/\.(jsonl|ndjson)$/i.test(rawPath)) {
    res.status(400).json({ error: 'path must be a .jsonl file' }); return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let byteOffset = 0;
  let partial = '';

  const flush = () => {
    try {
      if (!existsSync(rawPath)) return;
      const size = statSync(rawPath).size;
      if (size <= byteOffset) return;
      const fd  = openSync(rawPath, 'r');
      const len = size - byteOffset;
      const buf = Buffer.alloc(len);
      const read = readSync(fd, buf, 0, len, byteOffset);
      closeSync(fd);
      byteOffset += read;
      partial += buf.slice(0, read).toString('utf-8');
      const lines = partial.split('\n');
      partial = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (t) res.write(`data: ${t}\n\n`);
      }
    } catch { /* file not ready yet */ }
  };

  flush();
  const poll      = setInterval(flush, 500);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20000);
  req.on('close', () => { clearInterval(poll); clearInterval(heartbeat); });
});

router.get('/live/load', (req, res) => {
  const rawPath = req.query.path as string;
  if (!rawPath || !/\.(jsonl|ndjson)$/i.test(rawPath)) {
    res.status(400).json({ error: 'path must be a .jsonl file' }); return;
  }
  if (!existsSync(rawPath)) {
    res.status(404).json({ error: 'File not found' }); return;
  }
  try {
    const content = readFileSync(rawPath, 'utf-8');
    const events = content.split('\n')
      .filter(l => l.trim())
      .map(l => { try { return JSON.parse(l) as unknown; } catch { return null; } })
      .filter(Boolean);
    res.json({ events });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/live/ingest', async (req, res) => {
  try {
    const body = req.body as { filePath?: string; passId?: number };
    const { filePath: rawPath, passId } = body;
    if (!rawPath || !/\.(jsonl|ndjson)$/i.test(rawPath)) {
      res.status(400).json({ error: 'filePath must be a .jsonl file' }); return;
    }
    if (!existsSync(rawPath)) {
      res.status(404).json({ error: 'File not found' }); return;
    }
    const content  = readFileSync(rawPath, 'utf-8');
    const fileName = rawPath.split('/').pop() ?? rawPath;
    const result   = await ingestJsonl(content, fileName, passId);
    schemaCache = null;
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
