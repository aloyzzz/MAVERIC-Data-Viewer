import { Router } from 'express';
import { existsSync, statSync, openSync, readSync, closeSync, readFileSync } from 'fs';
import { join } from 'path';
import multer from 'multer';
import {
  loadSchema, fetchRows, fetchFramePackets, ingestJsonl,
  assembleFilesForTable, listAssembledFiles, FILES_DIR,
  materializeTelemetry, fetchDecodedSummary, fetchDecodedTelemetry, fetchDecodeStatus,
  deletePass, previewBeacons, insertBeacons,
} from './db.js';

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
    const forcedPassId = req.body?.passId ? parseInt(req.body.passId as string, 10) : undefined;

    if (originalname.endsWith('.jsonl') || originalname.endsWith('.ndjson')) {
      const result = ingestJsonl(content, originalname, forcedPassId);
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

// Frames endpoint — returns only rx_packet and tx_command rows that have inner_hex data,
// used by the decoded-frames tab to avoid fetching all 40k+ rows.
router.get('/tables/:tableId/frames', (req, res) => {
  try {
    const rows = fetchFramePackets(req.params.tableId);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Assemble all FILE packets for a table and write them to assembled_files/<tableId>/.
// Idempotent: existing files are overwritten with fresh data from the database.
router.post('/tables/:tableId/assemble-files', (req, res) => {
  try {
    const files = assembleFilesForTable(req.params.tableId);
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// List already-assembled files for a table (fast — reads directory only).
router.get('/tables/:tableId/assembled-files', (req, res) => {
  try {
    const files = listAssembledFiles(req.params.tableId);
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Serve an assembled file (download or inline for images).
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

// Decode and persist TLM/RES frames for one pass into decoded_telemetry.
router.post('/history/materialize', (req, res) => {
  const { passId } = req.body as { passId?: number };
  if (!passId) { res.status(400).json({ error: 'passId required' }); return; }
  try {
    const result = materializeTelemetry(Number(passId));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// cmd_id + field summary for selected passes (used to populate the field picker).
router.get('/history/summary', (req, res) => {
  try {
    res.json(fetchDecodedSummary(parsePassIds(req.query.passIds)));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Decoded rows for selected passes + a specific cmd_id.
router.get('/history/data', (req, res) => {
  const passIds = parsePassIds(req.query.passIds);
  const cmd = String(req.query.cmd ?? '');
  if (!cmd) { res.status(400).json({ error: 'cmd required' }); return; }
  try {
    res.json(fetchDecodedTelemetry(passIds, cmd));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// How many decoded rows exist per pass (to show materialization status).
router.get('/history/status', (req, res) => {
  try {
    res.json(fetchDecodeStatus(parsePassIds(req.query.passIds)));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Manual beacon entry ─────────────────────────────────────────────────────

// Parse hex strings and return decoded field previews (no DB writes).
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

// Insert previewed beacons into a pass table and re-materialize decoded telemetry.
router.post('/beacons/insert', (req, res) => {
  const { hexLines, passId } = req.body as { hexLines?: string[]; passId?: number };
  if (!Array.isArray(hexLines) || hexLines.length === 0) {
    res.status(400).json({ error: 'hexLines array required' }); return;
  }
  if (!passId || isNaN(Number(passId))) {
    res.status(400).json({ error: 'passId required' }); return;
  }
  try {
    const count = insertBeacons(Number(passId), hexLines);
    schemaCache = null;
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Delete a pass and all associated data. Requires password in request body.
router.delete('/passes/:passId', (req, res) => {
  const { password } = req.body as { password?: string };
  if (password !== 'maveric') {
    res.status(403).json({ error: 'Incorrect password' }); return;
  }
  const passId = parseInt(req.params.passId, 10);
  if (!passId || isNaN(passId)) {
    res.status(400).json({ error: 'Invalid passId' }); return;
  }
  try {
    deletePass(passId);
    schemaCache = null;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Live telemetry SSE stream ────────────────────────────────────────────────
// Tails a JSONL file and pushes each new line to the client as an SSE event.
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
      const fd = openSync(rawPath, 'r');
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
  const poll = setInterval(flush, 500);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20000);
  req.on('close', () => { clearInterval(poll); clearInterval(heartbeat); });
});

// Load all events from a JSONL file and return them as JSON (no ingestion).
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

// Ingest a JSONL file from disk into the database.
router.post('/live/ingest', (req, res) => {
  try {
    const body = req.body as { filePath?: string; passId?: number };
    const { filePath: rawPath, passId } = body;
    if (!rawPath || !/\.(jsonl|ndjson)$/i.test(rawPath)) {
      res.status(400).json({ error: 'filePath must be a .jsonl file' }); return;
    }
    if (!existsSync(rawPath)) {
      res.status(404).json({ error: 'File not found' }); return;
    }
    const content = readFileSync(rawPath, 'utf-8');
    const fileName = rawPath.split('/').pop() ?? rawPath;
    const result = ingestJsonl(content, fileName, passId);
    schemaCache = null;
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
