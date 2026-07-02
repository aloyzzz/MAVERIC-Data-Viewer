import { Router, type Response } from 'express';
import { existsSync, statSync, openSync, readSync, closeSync, readFileSync } from 'fs';
import { join } from 'path';
import multer from 'multer';
import {
  loadSchema, fetchRows, fetchFramePackets, ingestJsonl,
  assembleFilesForTable, listAssembledFiles, FILES_DIR, INGESTED_FILES_DIR,
  materializeTelemetry, fetchDecodedSummary, fetchDecodedTelemetry, fetchDecodeStatus,
  deletePass, previewBeacons, insertBeacons, exportDatabase, fetchAllParameters,
  fetchParameterHistory, checkIngestHash,
  fetchSatelliteValueSummary, fetchSatelliteValues, exportSatelliteValuesCsv,
  materializeSatelliteValuesForPasses,
  reDecodeAllPasses,
  fetchPassReport,
  listPassFiles,
  type ValuesFilter,
} from './db.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

export const router = Router();
const MANAGEMENT_PASSWORD = process.env.MAVERIC_MANAGEMENT_PASSWORD ?? 'maveric';

// Cache schema in memory — it's static for this dataset
let schemaCache: Awaited<ReturnType<typeof loadSchema>> | null = null;

function requireManagementPassword(body: unknown, res: Response): boolean {
  const password = (body as { password?: string } | undefined)?.password;
  if (password !== MANAGEMENT_PASSWORD) {
    res.status(403).json({ error: 'Incorrect management password' });
    return false;
  }
  return true;
}

router.get('/schema', async (_req, res) => {
  try {
    if (!schemaCache) schemaCache = await loadSchema();
    res.json(schemaCache);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/ingest/check', async (req, res) => {
  const hash = String(req.query.hash ?? '');
  if (!hash) { res.json({ duplicate: null }); return; }
  try {
    res.json({ duplicate: await checkIngestHash(hash) });
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
    const files = await listAssembledFiles(req.params.tableId);
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

router.get('/passes/:passId/files/:filename', (req, res) => {
  const passId = parseInt(req.params.passId, 10);
  const { filename } = req.params;
  if (!passId || isNaN(passId) || filename.includes('/') || filename.includes('..')) {
    res.status(400).json({ error: 'Invalid path' }); return;
  }
  if (!filename.startsWith(`pass_${passId}_`)) {
    res.status(400).json({ error: 'Invalid pass file' }); return;
  }
  const filePath = join(INGESTED_FILES_DIR, filename);
  if (!existsSync(filePath)) { res.status(404).json({ error: 'File not found' }); return; }
  res.sendFile(filePath);
});

router.get('/passes/:passId/files', async (req, res) => {
  const passId = parseInt(req.params.passId, 10);
  if (!passId || isNaN(passId)) {
    res.status(400).json({ error: 'Invalid passId' }); return;
  }
  try {
    res.json({ files: await listPassFiles(passId) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── History / decoded telemetry ─────────────────────────────────────────────

function parsePassIds(raw: unknown): number[] {
  return String(raw ?? '').split(',').map(Number).filter(n => n > 0 && !isNaN(n));
}

function parseFields(raw: unknown): string[] | undefined {
  const list = (Array.isArray(raw) ? raw : [raw])
    .flatMap(v => String(v ?? '').split('\n'))
    .map(s => s.trim())
    .filter(Boolean);
  return list.length ? list : undefined;
}

function parseValuesFilter(query: Record<string, unknown>): ValuesFilter {
  const passIds = parsePassIds(query.passIds);
  const fromMs = query.from ? Number(query.from) : undefined;
  const toMs = query.to ? Number(query.to) : undefined;
  return {
    passIds,
    fromMs: Number.isFinite(fromMs) ? fromMs : undefined,
    toMs: Number.isFinite(toMs) ? toMs : undefined,
    domain: query.domain ? String(query.domain) : undefined,
    cmd: query.cmd ? String(query.cmd) : undefined,
    parameter: query.parameter ? String(query.parameter) : undefined,
    fields: parseFields(query.fields),
    numericOnly: String(query.numericOnly ?? '') === '1' || String(query.numericOnly ?? '') === 'true',
    limit: query.limit ? Number(query.limit) : undefined,
  };
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

router.post('/history/redecode-all', async (_req, res) => {
  try {
    const results = await reDecodeAllPasses();
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Management / protected maintenance ──────────────────────────────────────

router.post('/management/unlock', (req, res) => {
  if (!requireManagementPassword(req.body, res)) return;
  res.json({ ok: true });
});

router.post('/management/redecode-all', async (req, res) => {
  if (!requireManagementPassword(req.body, res)) return;
  try {
    const results = await reDecodeAllPasses();
    schemaCache = null;
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/management/values/materialize', async (req, res) => {
  if (!requireManagementPassword(req.body, res)) return;
  const passIds = Array.isArray(req.body?.passIds)
    ? req.body.passIds.map(Number).filter((n: number) => n > 0 && !isNaN(n))
    : parsePassIds(req.body?.passIds);
  if (passIds.length === 0) { res.status(400).json({ error: 'passIds required' }); return; }
  try {
    res.json(await materializeSatelliteValuesForPasses(passIds));
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

// ─── Canonical satellite values / analysis export ───────────────────────────

router.get('/values/summary', async (req, res) => {
  try {
    res.json(await fetchSatelliteValueSummary(parseValuesFilter(req.query)));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/values', async (req, res) => {
  try {
    res.json(await fetchSatelliteValues(parseValuesFilter(req.query)));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/values/export', async (req, res) => {
  try {
    const format = req.query.format === 'wide' ? 'wide' : 'long';
    const csv = await exportSatelliteValuesCsv(parseValuesFilter(req.query), format);
    const filename = `maveric_values_${format}_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'text/csv');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/values/materialize', async (req, res) => {
  const passIds = Array.isArray(req.body?.passIds)
    ? req.body.passIds.map(Number).filter((n: number) => n > 0 && !isNaN(n))
    : parsePassIds(req.body?.passIds);
  if (passIds.length === 0) { res.status(400).json({ error: 'passIds required' }); return; }
  try {
    res.json(await materializeSatelliteValuesForPasses(passIds));
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

router.get('/report/:passId', async (req, res) => {
  const passId = parseInt(req.params.passId, 10);
  if (!passId || isNaN(passId)) { res.status(400).json({ error: 'Invalid passId' }); return; }
  try {
    res.json(await fetchPassReport(passId));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.delete('/passes/:passId', async (req, res) => {
  const { password, deleteFiles } = req.body as { password?: string; deleteFiles?: boolean };
  if (password !== 'maveric') {
    res.status(403).json({ error: 'Incorrect password' }); return;
  }
  const passId = parseInt(req.params.passId, 10);
  if (!passId || isNaN(passId)) {
    res.status(400).json({ error: 'Invalid passId' }); return;
  }
  try {
    await deletePass(passId, { deleteFiles: Boolean(deleteFiles) });
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
