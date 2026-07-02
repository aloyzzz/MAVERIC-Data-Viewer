import { Pool, types, type PoolClient } from 'pg';
import { mkdirSync, writeFileSync, existsSync, readdirSync, statSync, rmSync } from 'fs';
import { resolve, join } from 'path';
import { createHash } from 'crypto';
import type { ColumnDef, ColumnType, AppSchema, TableMeta } from '../src/types.js';
import { decodeRow, parseInnerHex } from './telemetryDecode.js';
import { getCatalogParameterRows } from './missionCatalog.js';

// node-postgres returns BIGINT (int8, OID 20) as a string by default to avoid
// precision loss. Every BIGINT column here holds an epoch-millisecond timestamp,
// a duration, or a small counter -- all well within Number.MAX_SAFE_INTEGER --
// and the frontend treats them as numbers (e.g. `new Date(ts_ms)`, which throws
// on a string). Parse int8 to a JS number so that contract holds.
types.setTypeParser(20, (val) => parseInt(val, 10));

// ── Connection pool ───────────────────────────────────────────────────────────

const pool = new Pool({
  host:     process.env.PG_HOST     ?? 'localhost',
  port:     Number(process.env.PG_PORT ?? 5432),
  database: process.env.PG_DATABASE ?? 'maveric_gs',
  user:     process.env.PG_USER     ?? 'maveric',
  password: process.env.PG_PASSWORD ?? 'maveric',
});

// ── Schema constants ──────────────────────────────────────────────────────────

// All columns in a per-pass unified event table, in declared order.
// id is omitted here (it is SERIAL in the DDL, not inserted by app code).
const EVENT_COLS = [
  'event_kind', 'event_id', 'ts_ms', 'ts_iso', 'seq', 'v',
  // shared by rx_packet + tx_command
  'frame_label', 'inner_hex', 'inner_len', 'wire_hex', 'wire_len',
  'mission_facts_header_cmd_id', 'mission_facts_header_src', 'mission_facts_header_dest',
  'mission_facts_header_echo', 'mission_facts_header_ptype',
  'mission_facts_protocol_args_hex', 'mission_facts_protocol_csp_plausible',
  'mission_facts_protocol_stripped_header',
  'mission_facts_protocol_csp_header_prio', 'mission_facts_protocol_csp_header_src',
  'mission_facts_protocol_csp_header_dest', 'mission_facts_protocol_csp_header_dport',
  'mission_facts_protocol_csp_header_sport', 'mission_facts_protocol_csp_header_flags',
  'mission_facts_integrity_overall_ok', 'mission_facts_integrity_body_crc_ok',
  'mission_facts_integrity_csp_crc32', 'mission_facts_integrity_csp_crc32_ok',
  // rx_packet only
  'frame_type', 'transport_meta', 'raw_hex', 'size',
  'duplicate', 'uplink_echo', 'unknown', 'warnings', 'mission_id',
  // parameter
  'rx_event_id', 'name', 'value', 'unit', 'display_only',
  // alarm
  'alarm_id', 'alarm_source', 'alarm_label', 'alarm_detail',
  'alarm_severity', 'alarm_state', 'alarm_prev_state', 'alarm_prev_severity',
  'alarm_removed', 'alarm_first_seen_ms', 'alarm_last_transition_ms',
  'alarm_operator', 'alarm_context_raw',
  // cmd_verifier
  'cmd_event_id', 'instance_id', 'stage', 'verifier_id', 'outcome', 'elapsed_ms', 'match_event_id',
  // radio
  'radio_action', 'radio_state', 'radio_pid', 'radio_exit_code',
  'radio_command', 'radio_script', 'radio_cwd', 'radio_detail', 'radio_expected',
] as const;

type EventRow = Record<typeof EVENT_COLS[number], unknown>;

function emptyRow(): EventRow {
  return Object.fromEntries(EVENT_COLS.map((c) => [c, null])) as EventRow;
}

function passTableDDL(tableName: string): string {
  return `
    CREATE TABLE IF NOT EXISTS "${tableName}" (
      id          SERIAL PRIMARY KEY,
      event_kind  TEXT NOT NULL,
      event_id    TEXT,
      ts_ms       BIGINT,
      ts_iso      TEXT,
      seq         INTEGER,
      v           TEXT,
      frame_label TEXT,
      inner_hex   TEXT,
      inner_len   INTEGER,
      wire_hex    TEXT,
      wire_len    INTEGER,
      mission_facts_header_cmd_id              TEXT,
      mission_facts_header_src                 TEXT,
      mission_facts_header_dest                TEXT,
      mission_facts_header_echo                TEXT,
      mission_facts_header_ptype               TEXT,
      mission_facts_protocol_args_hex          TEXT,
      mission_facts_protocol_csp_plausible     TEXT,
      mission_facts_protocol_stripped_header   TEXT,
      mission_facts_protocol_csp_header_prio   TEXT,
      mission_facts_protocol_csp_header_src    TEXT,
      mission_facts_protocol_csp_header_dest   TEXT,
      mission_facts_protocol_csp_header_dport  TEXT,
      mission_facts_protocol_csp_header_sport  TEXT,
      mission_facts_protocol_csp_header_flags  TEXT,
      mission_facts_integrity_overall_ok       TEXT,
      mission_facts_integrity_body_crc_ok      TEXT,
      mission_facts_integrity_csp_crc32        TEXT,
      mission_facts_integrity_csp_crc32_ok     TEXT,
      frame_type      TEXT,
      transport_meta  TEXT,
      raw_hex         TEXT,
      size            INTEGER,
      duplicate       TEXT,
      uplink_echo     TEXT,
      unknown         TEXT,
      warnings        TEXT,
      mission_id      TEXT,
      rx_event_id     TEXT,
      name            TEXT,
      value           TEXT,
      unit            TEXT,
      display_only    TEXT,
      alarm_id                 TEXT,
      alarm_source             TEXT,
      alarm_label              TEXT,
      alarm_detail             TEXT,
      alarm_severity           TEXT,
      alarm_state              TEXT,
      alarm_prev_state         TEXT,
      alarm_prev_severity      TEXT,
      alarm_removed            TEXT,
      alarm_first_seen_ms      BIGINT,
      alarm_last_transition_ms BIGINT,
      alarm_operator           TEXT,
      alarm_context_raw        TEXT,
      cmd_event_id   TEXT,
      instance_id    TEXT,
      stage          TEXT,
      verifier_id    TEXT,
      outcome        TEXT,
      elapsed_ms     BIGINT,
      match_event_id TEXT,
      radio_action    TEXT,
      radio_state     TEXT,
      radio_pid       TEXT,
      radio_exit_code TEXT,
      radio_command   TEXT,
      radio_script    TEXT,
      radio_cwd       TEXT,
      radio_detail    TEXT,
      radio_expected  TEXT
    );
    CREATE INDEX IF NOT EXISTS "idx_${tableName}_ts_ms" ON "${tableName}" (ts_ms);
  `;
}

// ── Type inference ────────────────────────────────────────────────────────────

function inferType(colName: string, pgType: string): ColumnType {
  const n = colName.toLowerCase();
  const t = pgType.toLowerCase();
  if (n === 'ts_iso' || n.endsWith('_iso') || n === 'pass_date' || n === 'pass_time') return 'time';
  if (n.endsWith('_ms') || n === 'value_unix_ms') return 'int';
  if (t === 'integer' || t === 'bigint' || t === 'smallint' || t === 'numeric') return 'int';
  if (t === 'double precision' || t === 'real') return 'float';
  if (n === 'frame_type' || n === 'frame_label') return 'frame';
  if (n === 'event_kind') return 'tag';
  if (['alarm_severity', 'alarm_state', 'alarm_prev_state', 'alarm_prev_severity',
       'outcome', 'stage', 'radio_action', 'radio_state', 'mission_facts_header_ptype'].includes(n)) return 'tag';
  if (/^(duplicate|uplink_echo|unknown|display_only|alarm_removed|.*_ok|.*_plausible)$/.test(n)) return 'bool';
  if (n === 'size' || n.endsWith('_len')) return 'int';
  return 'text';
}

function widthFor(colName: string, type: ColumnType): number {
  const n = colName.toLowerCase();
  if (n === 'event_kind') return 120;
  if (['event_id', 'rx_event_id', 'cmd_event_id', 'match_event_id', 'instance_id'].includes(n)) return 220;
  if (n === 'ts_iso') return 210;
  if (n === 'ts_ms' || n.endsWith('_ms')) return 130;
  if (['id', 'pass_id', 'seq'].includes(n)) return 70;
  if (n === 'v') return 60;
  if (['frame_type', 'frame_label'].includes(n)) return 130;
  if (n === 'name') return 220;
  if (['value', 'value_display'].includes(n)) return 200;
  if (n === 'unit') return 70;
  if (['alarm_label', 'alarm_detail'].includes(n)) return 240;
  if (['alarm_id', 'alarm_source'].includes(n)) return 200;
  if (['mission_id', 'station', 'operator'].includes(n)) return 100;
  if (['session_id', 'source_file'].includes(n)) return 280;
  if (['raw_hex', 'wire_hex', 'inner_hex'].includes(n)) return 360;
  if (n.startsWith('mission_facts_')) return 130;
  if (n.startsWith('radio_')) return 160;
  if (type === 'int') return 110;
  if (type === 'bool') return 80;
  if (type === 'tag') return 110;
  return 140;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function tableExists(client: PoolClient, name: string): Promise<boolean> {
  const res = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [name],
  );
  return res.rowCount !== null && res.rowCount > 0;
}

// ── Init / migration ──────────────────────────────────────────────────────────

export async function initDb(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS passes (
        pass_id        SERIAL PRIMARY KEY,
        session_id     TEXT,
        source_file    TEXT,
        pass_date      TEXT,
        pass_time      TEXT,
        start_ts_ms    BIGINT,
        end_ts_ms      BIGINT,
        mission_id     TEXT,
        operator       TEXT,
        station        TEXT,
        schema_version TEXT,
        content_hash   TEXT
      )
    `);
    await client.query(`ALTER TABLE passes ADD COLUMN IF NOT EXISTS content_hash TEXT`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS decoded_telemetry (
        id      SERIAL PRIMARY KEY,
        pass_id INTEGER NOT NULL,
        ts_ms   BIGINT  NOT NULL,
        cmd_id  TEXT    NOT NULL,
        field   TEXT    NOT NULL,
        value   TEXT    NOT NULL,
        unit    TEXT    NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_dt_pass     ON decoded_telemetry (pass_id);
      CREATE INDEX IF NOT EXISTS idx_dt_pass_cmd ON decoded_telemetry (pass_id, cmd_id);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS satellite_values (
        id              SERIAL PRIMARY KEY,
        pass_id         INTEGER NOT NULL,
        session_id      TEXT,
        source_event_id TEXT NOT NULL,
        source_kind     TEXT NOT NULL,
        ts_ms           BIGINT NOT NULL,
        ts_iso          TEXT,
        cmd_id          TEXT,
        ptype           TEXT,
        src             TEXT,
        dest            TEXT,
        domain          TEXT,
        parameter_name  TEXT NOT NULL,
        field_path      TEXT NOT NULL,
        display_name    TEXT,
        unit            TEXT NOT NULL DEFAULT '',
        value_text      TEXT,
        value_numeric   DOUBLE PRECISION,
        value_json      JSONB,
        decoded_ok      TEXT,
        decode_error    TEXT,
        raw_hex         TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_sv_pass_ts      ON satellite_values (pass_id, ts_ms);
      CREATE INDEX IF NOT EXISTS idx_sv_param_ts     ON satellite_values (parameter_name, ts_ms);
      CREATE INDEX IF NOT EXISTS idx_sv_cmd_ptype    ON satellite_values (cmd_id, ptype);
      CREATE INDEX IF NOT EXISTS idx_sv_domain_param ON satellite_values (domain, parameter_name);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sv_unique_value
        ON satellite_values (pass_id, source_event_id, source_kind, cmd_id, field_path);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS pass_files (
        id           SERIAL PRIMARY KEY,
        pass_id      INTEGER NOT NULL,
        table_id     TEXT NOT NULL,
        filename     TEXT NOT NULL,
        file_kind    TEXT NOT NULL,
        mime_type    TEXT,
        relative_path TEXT NOT NULL,
        download_url TEXT NOT NULL,
        total_bytes  BIGINT NOT NULL DEFAULT 0,
        chunk_count  INTEGER NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_pf_pass ON pass_files (pass_id);
      CREATE INDEX IF NOT EXISTS idx_pf_kind ON pass_files (file_kind);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pf_unique
        ON pass_files (pass_id, file_kind, filename);
    `);

    // Backfill any passes that have no decoded rows yet, and ensure each
    // per-pass table has a ts_ms index (the default sort column).
    const allPasses = (await client.query('SELECT pass_id FROM passes')).rows as { pass_id: number }[];
    await indexExistingPassFiles(client, allPasses.map(p => p.pass_id));
    const decodedRes = await client.query('SELECT DISTINCT pass_id FROM decoded_telemetry');
    const decodedSet = new Set((decodedRes.rows as { pass_id: number }[]).map(r => r.pass_id));
    const valuesRes = await client.query('SELECT DISTINCT pass_id FROM satellite_values');
    const valuesSet = new Set((valuesRes.rows as { pass_id: number }[]).map(r => r.pass_id));
    for (const { pass_id } of allPasses) {
      const tbl = `pass_${pass_id}`;
      if (await tableExists(client, tbl)) {
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tbl}_ts_ms" ON "${tbl}" (ts_ms)`);
        if (!decodedSet.has(pass_id)) {
          try { await materializeTelemetry(pass_id); } catch { /* skip */ }
        }
        if (!valuesSet.has(pass_id)) {
          try { await materializeSatelliteValues(pass_id); } catch { /* skip */ }
        }
      }
    }
  } finally {
    client.release();
  }
}

// ── Schema loading ────────────────────────────────────────────────────────────

interface PassRow {
  pass_id: number;
  session_id: string;
  station: string;
  operator: string;
  mission_id: string;
  pass_date: string;
  pass_time: string;
  source_file: string;
  start_ts_ms: number;
  end_ts_ms: number;
  schema_version: string;
}

export async function loadSchema(): Promise<AppSchema> {
  const client = await pool.connect();
  try {
    const passMetaMap = new Map<number, PassRow>();
    try {
      const res = await client.query('SELECT * FROM passes');
      for (const p of res.rows as PassRow[]) passMetaMap.set(p.pass_id, p);
    } catch { /* passes table may not exist yet */ }

    // List all user tables in public schema
    const tablesRes = await client.query(`
      SELECT table_name AS name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    const groups: Record<string, TableMeta[]> = {};
    const columns: Record<string, ColumnDef[]> = {};

    for (const { name } of tablesRes.rows as { name: string }[]) {
      // Column info from information_schema
      const colRes = await client.query(`
        SELECT column_name AS name,
               data_type   AS type,
               ordinal_position,
               CASE WHEN column_name = (
                 SELECT kcu.column_name
                 FROM information_schema.table_constraints tc
                 JOIN information_schema.key_column_usage kcu
                   ON tc.constraint_name = kcu.constraint_name
                  AND tc.table_schema    = kcu.table_schema
                 WHERE tc.constraint_type = 'PRIMARY KEY'
                   AND tc.table_schema    = 'public'
                   AND tc.table_name      = $1
                 LIMIT 1
               ) THEN 1 ELSE NULL END AS pk
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `, [name]);

      const cntRes = await client.query(`SELECT COUNT(*) AS cnt FROM "${name}"`);
      const cnt = Number(cntRes.rows[0].cnt);

      let schemaGroup: string;
      let label: string;
      let desc: string;
      let primary: string;
      let sourceFile: string | undefined;

      if (name === 'passes') {
        schemaGroup = 'mission';
        label = 'passes';
        desc = 'Operator log sessions / passes';
        primary = 'pass_id';
      } else if (/^pass_\d+$/.test(name)) {
        const passId = parseInt(name.slice(5), 10);
        const meta = passMetaMap.get(passId);
        schemaGroup = 'passes';
        label = meta ? `${meta.session_id} (${meta.station})` : name;
        desc = meta
          ? `${meta.pass_date} ${meta.pass_time} · mission: ${meta.mission_id} · operator: ${meta.operator}`
          : '';
        primary = 'id';
        sourceFile = meta?.source_file || undefined;
      } else {
        schemaGroup = 'misc';
        label = name;
        desc = '';
        primary = 'id';
      }

      columns[name] = (colRes.rows as { name: string; type: string; pk: number | null }[]).map((c) => {
        const type = inferType(c.name, c.type);
        return {
          id: c.name,
          label: c.name,
          type,
          width: widthFor(c.name, type),
          mono: true,
          align: (type === 'int' || type === 'float') ? 'right' : 'left',
          pk: c.pk ?? null,
          fk: (c.name === 'pass_id' && name !== 'passes') ? 'passes' : null,
        } satisfies ColumnDef;
      });

      if (!groups[schemaGroup]) groups[schemaGroup] = [];
      groups[schemaGroup].push({ id: name, label, desc, primary, rows: cnt, sourceFile });
    }

    const order = ['mission', 'passes', 'misc'];
    return {
      schemas: order.filter((s) => groups[s]).map((s) => ({ name: s, tables: groups[s] })),
      columns,
    };
  } finally {
    client.release();
  }
}

// ── Fetch rows ────────────────────────────────────────────────────────────────

export async function fetchRows(
  tableId: string,
  opts: { limit?: number; offset?: number; sort?: string; dir?: string } = {},
): Promise<Record<string, unknown>[]> {
  if (!/^\w+$/.test(tableId)) throw new Error('Invalid table name');
  const { limit = 1000, offset = 0, sort, dir } = opts;

  let sql = `SELECT * FROM "${tableId}"`;
  if (sort && /^\w+$/.test(sort)) {
    sql += ` ORDER BY "${sort}" ${dir === 'desc' ? 'DESC' : 'ASC'}`;
  }
  sql += ` LIMIT ${limit} OFFSET ${offset}`;

  const res = await pool.query(sql);
  return res.rows;
}

export async function fetchFramePackets(tableId: string): Promise<Record<string, unknown>[]> {
  if (!/^\w+$/.test(tableId)) throw new Error('Invalid table name');
  const sql = `
    SELECT
      event_kind, event_id, ts_ms, ts_iso, seq,
      frame_label, frame_type,
      inner_hex, inner_len,
      mission_facts_header_cmd_id,
      mission_facts_header_src,
      mission_facts_header_dest,
      mission_facts_header_ptype,
      mission_facts_integrity_overall_ok,
      duplicate, uplink_echo
    FROM "${tableId}"
    WHERE event_kind IN ('rx_packet','tx_command')
      AND inner_hex IS NOT NULL
    ORDER BY ts_ms ASC
  `;
  const res = await pool.query(sql);
  return res.rows;
}

// ── Parameters ───────────────────────────────────────────────────────────────

export interface ParameterRow {
  pass_id: number;
  ts_ms: number;
  ts_iso: string;
  name: string;
  value: string;
  unit: string;
  source?: string;
  cmd_id?: string;
  domain?: string;
  type?: string;
}

export async function fetchAllParameters(): Promise<ParameterRow[]> {
  const client = await pool.connect();
  try {
    const results: ParameterRow[] = [];
    const seenNames = new Set<string>();
    const observed = await client.query<{
      pass_id: number;
      ts_ms: number;
      ts_iso: string;
      parameter_name: string;
      field_path: string;
      value_text: string;
      unit: string;
      source_kind: string;
      cmd_id: string;
      domain: string;
    }>(`
      SELECT pass_id, ts_ms, ts_iso, parameter_name, field_path, value_text, unit, source_kind, cmd_id, domain
      FROM satellite_values
      ORDER BY ts_ms
    `);
    for (const r of observed.rows) {
      seenNames.add(r.field_path);
      results.push({
        pass_id: r.pass_id,
        ts_ms: r.ts_ms,
        ts_iso: r.ts_iso || (r.ts_ms ? new Date(Number(r.ts_ms)).toISOString() : ''),
        name: r.field_path,
        value: r.value_text ?? '',
        unit: r.unit ?? '',
        source: r.source_kind === 'parameter_event' ? 'parameter' : 'decoded',
        cmd_id: r.cmd_id,
        domain: r.domain,
      });
    }

    for (const p of getCatalogParameterRows()) {
      if (seenNames.has(p.name)) continue;
      results.push({
        pass_id: 0,
        ts_ms: 0,
        ts_iso: '',
        name: p.name,
        value: '',
        unit: p.unit,
        source: 'catalog',
        domain: p.domain,
        type: p.type,
      });
    }
    return results;
  } finally {
    client.release();
  }
}

// ── Export ────────────────────────────────────────────────────────────────────

export async function exportDatabase(): Promise<Record<string, unknown[]>> {
  const client = await pool.connect();
  try {
    const tablesRes = await client.query<{ name: string }>(`
      SELECT table_name AS name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    const out: Record<string, unknown[]> = {};
    for (const { name } of tablesRes.rows) {
      const res = await client.query(`SELECT * FROM "${name}"`);
      out[name] = res.rows;
    }
    return out;
  } finally {
    client.release();
  }
}

// ── Ingestion ─────────────────────────────────────────────────────────────────

type JsonEvent = Record<string, unknown>;

export interface DuplicateInfo {
  passId: number;
  sessionId: string;
  sourceFile: string;
}

export interface IngestResult {
  passId: number;
  sessionId: string;
  counts: Record<string, number>;
  skipped: number;
  warnings: string[];
  duplicateOf?: DuplicateInfo;
}

export async function checkIngestHash(hash: string): Promise<DuplicateInfo | null> {
  const res = await pool.query<{ pass_id: number; session_id: string; source_file: string }>(
    'SELECT pass_id, session_id, source_file FROM passes WHERE content_hash = $1 LIMIT 1',
    [hash],
  );
  if (res.rowCount === 0) return null;
  const row = res.rows[0];
  return { passId: row.pass_id, sessionId: row.session_id, sourceFile: row.source_file };
}

function str(v: unknown): string  { return v == null ? '' : String(v); }
function num(v: unknown): number  { return v == null ? 0  : Number(v); }
function bool(v: unknown): string { return v ? '1' : '0'; }
function jsn(v: unknown): string  { return v == null ? '' : JSON.stringify(v); }

function flatMission(m: unknown): Partial<EventRow> {
  if (!m || typeof m !== 'object') return {};
  const mission = m as Record<string, unknown>;
  const facts  = (mission['facts']    ?? {}) as Record<string, unknown>;
  const hdr    = (facts['header']     ?? {}) as Record<string, unknown>;
  const proto  = (facts['protocol']   ?? {}) as Record<string, unknown>;
  const integ  = (facts['integrity']  ?? {}) as Record<string, unknown>;
  const csp    = (proto['csp_header'] ?? {}) as Record<string, unknown>;
  return {
    mission_facts_header_cmd_id:             str(mission['cmd_id']),
    mission_facts_header_src:                str(hdr['src']),
    mission_facts_header_dest:               str(hdr['dest']),
    mission_facts_header_echo:               str(hdr['echo']),
    mission_facts_header_ptype:              str(hdr['ptype']),
    mission_facts_protocol_args_hex:         str(proto['args_hex']),
    mission_facts_protocol_csp_plausible:    bool(proto['csp_plausible']),
    mission_facts_protocol_stripped_header:  str(proto['stripped_header']),
    mission_facts_protocol_csp_header_prio:  str(csp['prio']),
    mission_facts_protocol_csp_header_src:   str(csp['src']),
    mission_facts_protocol_csp_header_dest:  str(csp['dest']),
    mission_facts_protocol_csp_header_dport: str(csp['dport']),
    mission_facts_protocol_csp_header_sport: str(csp['sport']),
    mission_facts_protocol_csp_header_flags: str(csp['flags']),
    mission_facts_integrity_overall_ok:      bool(integ['overall_ok']),
    mission_facts_integrity_body_crc_ok:     bool(integ['body_crc_ok']),
    mission_facts_integrity_csp_crc32:       str(integ['csp_crc32']),
    mission_facts_integrity_csp_crc32_ok:    bool(integ['csp_crc32_ok']),
  };
}

export async function ingestJsonl(content: string, sourceFile: string, forcedPassId?: number): Promise<IngestResult> {
  const contentHash = createHash('sha256').update(content).digest('hex');
  const duplicateOf = await checkIngestHash(contentHash) ?? undefined;

  const lines = content.split('\n').filter((l) => l.trim());
  const events: JsonEvent[] = [];
  let skipped = 0;
  const warnings: string[] = [];

  for (const line of lines) {
    try { events.push(JSON.parse(line) as JsonEvent); }
    catch { skipped++; }
  }

  if (events.length === 0) throw new Error('No valid JSON lines found');

  const first     = events[0];
  const sessionId = str(first['session_id']);
  const missionId = str(first['mission_id']);
  const operator  = str(first['operator']);
  const station   = str(first['station']);
  const schemaVer = str(first['v']);

  const timestamps = events.map((e) => num(e['ts_ms'])).filter((t) => t > 0);
  const startMs    = timestamps.length ? Math.min(...timestamps) : 0;
  const endMs      = timestamps.length ? Math.max(...timestamps) : 0;
  const startDate  = startMs ? new Date(startMs).toISOString().slice(0, 10) : '';
  const startTime  = startMs ? new Date(startMs).toISOString().slice(11, 19) : '';

  const counts: Record<string, number> = {};

  const client = await pool.connect();
  let passId: number;
  try {
    await client.query('BEGIN');

    if (forcedPassId != null) {
      await client.query(`
        INSERT INTO passes
          (pass_id, session_id, source_file, pass_date, pass_time,
           start_ts_ms, end_ts_ms, mission_id, operator, station, schema_version, content_hash)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      `, [forcedPassId, sessionId, sourceFile, startDate, startTime,
          startMs, endMs, missionId, operator, station, schemaVer, contentHash]);
      passId = forcedPassId;
    } else {
      const r = await client.query(`
        INSERT INTO passes
          (session_id, source_file, pass_date, pass_time,
           start_ts_ms, end_ts_ms, mission_id, operator, station, schema_version, content_hash)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING pass_id
      `, [sessionId, sourceFile, startDate, startTime,
          startMs, endMs, missionId, operator, station, schemaVer, contentHash]);
      passId = Number(r.rows[0].pass_id);
    }

    const tbl = `pass_${passId}`;
    await client.query(passTableDDL(tbl));

    // Build parameterized insert: $1..$N matching EVENT_COLS order
    const colList = EVENT_COLS.join(', ');
    const phList  = EVENT_COLS.map((_, i) => `$${i + 1}`).join(', ');
    const insertSql = `INSERT INTO "${tbl}" (${colList}) VALUES (${phList})`;

    for (const ev of events) {
      const kind = str(ev['event_kind']);
      const row  = emptyRow();

      row['event_kind'] = kind;
      row['event_id']   = str(ev['event_id']);
      row['ts_ms']      = num(ev['ts_ms']);
      row['ts_iso']     = str(ev['ts_iso']);
      row['seq']        = num(ev['seq']);
      row['v']          = str(ev['v']);

      try {
        if (kind === 'rx_packet') {
          Object.assign(row, flatMission(ev['mission']));
          row['frame_label']    = str(ev['frame_label']);
          row['inner_hex']      = str(ev['inner_hex']);
          row['inner_len']      = num(ev['inner_len']);
          row['wire_hex']       = str(ev['wire_hex']);
          row['wire_len']       = num(ev['wire_len']);
          row['frame_type']     = str(ev['frame_type']);
          row['transport_meta'] = str(ev['transport_meta']);
          row['raw_hex']        = str(ev['raw_hex']);
          row['size']           = num(ev['size']);
          row['duplicate']      = bool(ev['duplicate']);
          row['uplink_echo']    = bool(ev['uplink_echo']);
          row['unknown']        = bool(ev['unknown']);
          row['warnings']       = jsn(ev['warnings']);
          row['mission_id']     = str(ev['mission_id'] ?? missionId);

        } else if (kind === 'tx_command') {
          Object.assign(row, flatMission(ev['mission']));
          row['frame_label']  = str(ev['frame_label']);
          row['inner_hex']    = str(ev['inner_hex']);
          row['inner_len']    = num(ev['inner_len']);
          row['wire_hex']     = str(ev['wire_hex']);
          row['wire_len']     = num(ev['wire_len']);

        } else if (kind === 'parameter') {
          row['rx_event_id']  = str(ev['rx_event_id']);
          row['name']         = str(ev['name']);
          row['value']        = String(ev['value'] ?? '');
          row['unit']         = str(ev['unit']);
          row['display_only'] = bool(ev['display_only']);

        } else if (kind === 'alarm') {
          const al  = (ev['alarm']   ?? {}) as Record<string, unknown>;
          const ctx = (al['context'] ?? {}) as Record<string, unknown>;
          row['alarm_id']               = str(al['id']);
          row['alarm_source']           = str(al['source']);
          row['alarm_label']            = str(al['label']);
          row['alarm_detail']           = str(al['detail']);
          row['alarm_severity']         = str(al['severity']);
          row['alarm_state']            = str(al['state']);
          row['alarm_prev_state']       = str(al['prev_state']);
          row['alarm_prev_severity']    = str(al['prev_severity']);
          row['alarm_removed']          = bool(al['removed']);
          row['alarm_first_seen_ms']    = num(al['first_seen_ms']);
          row['alarm_last_transition_ms'] = num(al['last_transition_ms']);
          row['alarm_operator']         = str(al['operator']);
          row['alarm_context_raw']      = jsn(ctx['raw']);

        } else if (kind === 'cmd_verifier') {
          row['cmd_event_id']   = str(ev['cmd_event_id']);
          row['instance_id']    = str(ev['instance_id']);
          row['stage']          = str(ev['stage']);
          row['verifier_id']    = str(ev['verifier_id']);
          row['outcome']        = str(ev['outcome']);
          row['elapsed_ms']     = num(ev['elapsed_ms']);
          row['match_event_id'] = ev['match_event_id'] == null ? null : str(ev['match_event_id']);

        } else if (kind === 'radio') {
          row['radio_action']    = str(ev['radio_action']);
          row['radio_state']     = str(ev['radio_state']);
          row['radio_pid']       = str(ev['radio_pid']);
          row['radio_exit_code'] = str(ev['radio_exit_code']);
          row['radio_command']   = str(ev['radio_command']);
          row['radio_script']    = str(ev['radio_script']);
          row['radio_cwd']       = str(ev['radio_cwd']);
          row['radio_detail']    = str(ev['radio_detail']);
          row['radio_expected']  = str(ev['radio_expected']);

        } else {
          skipped++;
          continue;
        }

        await client.query(insertSql, EVENT_COLS.map((c) => row[c]));
        counts[kind] = (counts[kind] ?? 0) + 1;
      } catch (err) {
        warnings.push(`Skipped ${kind} event_id=${str(ev['event_id'])}: ${String(err)}`);
        skipped++;
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Save raw JSONL to disk for archival.
  try {
    mkdirSync(INGESTED_FILES_DIR, { recursive: true });
    const safeName = sourceFile.replace(/[^a-zA-Z0-9._-]/g, '_');
    const archivedName = `pass_${passId}_${safeName}`;
    const archivedPath = join(INGESTED_FILES_DIR, archivedName);
    writeFileSync(archivedPath, content, 'utf-8');
    await upsertPassFile({
      passId,
      tableId: `pass_${passId}`,
      filename: archivedName,
      fileKind: 'ingested_jsonl',
      relativePath: `ingested_jsonl/${archivedName}`,
      totalBytes: Buffer.byteLength(content, 'utf-8'),
    });
  } catch { /* non-fatal */ }

  // Best-effort: decode binary TLM/RES packets and save to decoded_telemetry.
  try { await materializeTelemetry(passId); } catch { /* non-fatal */ }

  return { passId, sessionId, counts, skipped, warnings, duplicateOf };
}

// ── Decoded telemetry ─────────────────────────────────────────────────────────

export interface DecodedRow {
  pass_id: number;
  ts_ms:   number;
  cmd_id:  string;
  field:   string;
  value:   string;
  unit:    string;
}

export interface SummaryRow {
  cmd_id: string;
  field:  string;
  unit:   string;
  count:  number;
}

export interface SatelliteValueRow {
  id?: number;
  pass_id: number;
  session_id: string;
  source_event_id: string;
  source_kind: string;
  ts_ms: number;
  ts_iso: string;
  cmd_id: string;
  ptype: string;
  src: string;
  dest: string;
  domain: string;
  parameter_name: string;
  field_path: string;
  display_name: string;
  unit: string;
  value_text: string;
  value_numeric: number | null;
  value_json: unknown;
  decoded_ok: string;
  decode_error: string;
  raw_hex: string;
}

export interface ValuesFilter {
  passIds?: number[];
  fromMs?: number;
  toMs?: number;
  domain?: string;
  cmd?: string;
  parameter?: string;
  fields?: string[];
  numericOnly?: boolean;
  limit?: number;
}

function baseParameterName(field: string): string {
  return field.split('.')[0] || field;
}

function numericValue(value: string): number | null {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || !/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function domainForValue(cmdId: string, field: string, catalogDomains: Map<string, string>): string {
  const base = baseParameterName(field);
  const fromCatalog = catalogDomains.get(base) ?? catalogDomains.get(field);
  if (fromCatalog) return fromCatalog;
  if (cmdId.startsWith('param:')) return 'params';
  if (cmdId === 'eps_hk' || base.startsWith('eps_') || /^I_|^V_|^P_|^T_DIE|^TS_ADC|^EPS_/.test(base)) return 'eps';
  if (cmdId === 'tlm_beacon') {
    if (['RATE', 'MAG', 'MTQ', 'STAT', 'GNC_MODE', 'ADCS_TMP_BEACON', 'RATE_SRC', 'MAG_SRC'].includes(base)) return 'gnc';
    return 'spacecraft';
  }
  if (cmdId.includes('img') || cmdId.includes('cam') || cmdId.includes('lcd')) return 'imaging';
  if (cmdId.includes('ppm')) return 'ppm';
  if (cmdId.includes('cfg')) return 'cfg';
  if (cmdId.includes('mag') || cmdId.includes('eps_')) return 'hk';
  return 'other';
}

function buildValuesWhere(filter: ValuesFilter, startParam = 1): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    clauses.push(sql.replace('?', `$${startParam + params.length - 1}`));
  };
  if (filter.passIds?.length) {
    const ph = filter.passIds.map((_, i) => `$${startParam + params.length + i}`).join(',');
    clauses.push(`pass_id IN (${ph})`);
    params.push(...filter.passIds);
  }
  if (filter.fromMs) add('ts_ms >= ?', filter.fromMs);
  if (filter.toMs) add('ts_ms <= ?', filter.toMs);
  if (filter.domain) add('domain = ?', filter.domain);
  if (filter.cmd) add('cmd_id = ?', filter.cmd);
  if (filter.parameter) {
    const p1 = `$${startParam + params.length}`;
    const p2 = `$${startParam + params.length + 1}`;
    clauses.push(`(parameter_name ILIKE ${p1} OR field_path ILIKE ${p2})`);
    params.push(`%${filter.parameter}%`, `%${filter.parameter}%`);
  }
  if (filter.fields?.length) {
    const ph = filter.fields.map((_, i) => `$${startParam + params.length + i}`).join(',');
    clauses.push(`field_path IN (${ph})`);
    params.push(...filter.fields);
  }
  if (filter.numericOnly) clauses.push('value_numeric IS NOT NULL');
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export async function materializeTelemetry(passId: number): Promise<{ count: number }> {
  const tbl = `pass_${passId}`;
  const client = await pool.connect();
  try {
    const exists = await tableExists(client, tbl);
    if (!exists) throw new Error(`Table ${tbl} does not exist`);

    await client.query('DELETE FROM decoded_telemetry WHERE pass_id = $1', [passId]);

    type FrameRow = { ts_ms: number; cmd_id: string; ptype: string; inner_hex: string };
    const rows = (await client.query(`
      SELECT ts_ms,
             mission_facts_header_cmd_id AS cmd_id,
             mission_facts_header_ptype AS ptype,
             inner_hex
      FROM   "${tbl}"
      WHERE  event_kind IN ('rx_packet', 'tx_command')
        AND  mission_facts_header_ptype IN ('TLM', 'RES', 'ACK', 'NACK', 'FILE')
        AND  inner_hex IS NOT NULL AND inner_hex != ''
      ORDER  BY ts_ms ASC
    `)).rows as FrameRow[];

    let count = 0;
    await client.query('BEGIN');
    try {
      for (const row of rows) {
        if (!row.cmd_id) continue;
        const decoded = decodeRow(row.cmd_id, row.inner_hex, row.ptype);
        for (const f of decoded) {
          await client.query(
            'INSERT INTO decoded_telemetry (pass_id, ts_ms, cmd_id, field, value, unit) VALUES ($1,$2,$3,$4,$5,$6)',
            [passId, row.ts_ms, row.cmd_id, f.field, f.value, f.unit],
          );
          count++;
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    const values = await materializeSatelliteValues(passId);
    return { count: values.count || count };
  } finally {
    client.release();
  }
}

export async function materializeSatelliteValues(passId: number): Promise<{ count: number }> {
  const tbl = `pass_${passId}`;
  const client = await pool.connect();
  try {
    const exists = await tableExists(client, tbl);
    if (!exists) throw new Error(`Table ${tbl} does not exist`);

    const passMeta = (await client.query<{ session_id: string }>(
      'SELECT session_id FROM passes WHERE pass_id = $1',
      [passId],
    )).rows[0];
    const sessionId = passMeta?.session_id ?? '';
    const catalogDomains = new Map(getCatalogParameterRows().map((p) => [p.name, p.domain]));

    type PacketRow = {
      event_id: string;
      ts_ms: number;
      ts_iso: string;
      cmd_id: string;
      ptype: string;
      src: string;
      dest: string;
      inner_hex: string;
    };
    const packets = (await client.query(`
      SELECT event_id, ts_ms, ts_iso,
             mission_facts_header_cmd_id AS cmd_id,
             mission_facts_header_ptype  AS ptype,
             mission_facts_header_src    AS src,
             mission_facts_header_dest   AS dest,
             inner_hex
      FROM "${tbl}"
      WHERE event_kind IN ('rx_packet', 'tx_command')
        AND mission_facts_header_ptype IN ('TLM', 'RES', 'ACK', 'NACK', 'FILE')
        AND inner_hex IS NOT NULL AND inner_hex != ''
      ORDER BY ts_ms ASC
    `)).rows as PacketRow[];

    type ParamEventRow = {
      event_id: string;
      rx_event_id: string;
      ts_ms: number;
      ts_iso: string;
      name: string;
      value: string;
      unit: string;
      cmd_id: string;
      ptype: string;
      src: string;
      dest: string;
      inner_hex: string;
    };
    const params = (await client.query(`
      SELECT p.event_id, p.rx_event_id, p.ts_ms, p.ts_iso, p.name, p.value, p.unit,
             CASE WHEN r.mission_facts_header_cmd_id IS NOT NULL AND r.mission_facts_header_cmd_id != ''
                  THEN 'param:' || r.mission_facts_header_cmd_id
                  ELSE 'param:unknown'
             END AS cmd_id,
             r.mission_facts_header_ptype AS ptype,
             r.mission_facts_header_src   AS src,
             r.mission_facts_header_dest  AS dest,
             r.inner_hex
      FROM "${tbl}" p
      LEFT JOIN "${tbl}" r
        ON r.event_id = p.rx_event_id AND r.event_kind = 'rx_packet'
      WHERE p.event_kind = 'parameter' AND p.name IS NOT NULL AND p.name != ''
      ORDER BY p.ts_ms ASC
    `)).rows as ParamEventRow[];

    const insertSql = `
      INSERT INTO satellite_values (
        pass_id, session_id, source_event_id, source_kind,
        ts_ms, ts_iso, cmd_id, ptype, src, dest, domain,
        parameter_name, field_path, display_name, unit,
        value_text, value_numeric, value_json,
        decoded_ok, decode_error, raw_hex
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
        $12,$13,$14,$15,$16,$17,$18,$19,$20,$21
      )
      ON CONFLICT (pass_id, source_event_id, source_kind, cmd_id, field_path)
      DO UPDATE SET
        ts_ms = EXCLUDED.ts_ms,
        ts_iso = EXCLUDED.ts_iso,
        domain = EXCLUDED.domain,
        unit = EXCLUDED.unit,
        value_text = EXCLUDED.value_text,
        value_numeric = EXCLUDED.value_numeric,
        value_json = EXCLUDED.value_json,
        decoded_ok = EXCLUDED.decoded_ok,
        decode_error = EXCLUDED.decode_error,
        raw_hex = EXCLUDED.raw_hex
    `;

    let count = 0;
    await client.query('BEGIN');
    try {
      await client.query('DELETE FROM satellite_values WHERE pass_id = $1', [passId]);

      for (const row of packets) {
        if (!row.cmd_id) continue;
        const decoded = decodeRow(row.cmd_id, row.inner_hex, row.ptype);
        const sourceEventId = row.event_id || `packet:${passId}:${row.ts_ms}:${row.cmd_id}:${row.inner_hex.slice(0, 16)}`;
        for (const f of decoded) {
          const parameterName = baseParameterName(f.field);
          const domain = domainForValue(row.cmd_id, f.field, catalogDomains);
          await client.query(insertSql, [
            passId, sessionId, sourceEventId, 'decoded_packet',
            row.ts_ms, row.ts_iso ?? '', row.cmd_id, row.ptype ?? '', row.src ?? '', row.dest ?? '', domain,
            parameterName, f.field, f.field, f.unit ?? '',
            f.value ?? '', numericValue(f.value), null,
            '1', '', row.inner_hex ?? '',
          ]);
          count++;
        }
      }

      for (const row of params) {
        const sourceEventId = row.event_id || `parameter:${passId}:${row.ts_ms}:${row.name}`;
        const fieldPath = row.name;
        const domain = domainForValue(row.cmd_id ?? 'param:unknown', fieldPath, catalogDomains);
        await client.query(insertSql, [
          passId, sessionId, sourceEventId, 'parameter_event',
          row.ts_ms, row.ts_iso ?? '', row.cmd_id ?? 'param:unknown', row.ptype ?? '', row.src ?? '', row.dest ?? '', domain,
          row.name, fieldPath, row.name, row.unit ?? '',
          row.value ?? '', numericValue(row.value), null,
          '1', '', row.inner_hex ?? '',
        ]);
        count++;
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    return { count };
  } finally {
    client.release();
  }
}

export async function fetchDecodedSummary(passIds: number[]): Promise<SummaryRow[]> {
  if (passIds.length === 0) return [];
  const ph  = passIds.map((_, i) => `$${i + 1}`).join(',');
  const res = await pool.query(`
    WITH sv_passes AS (
      SELECT DISTINCT pass_id FROM satellite_values WHERE pass_id IN (${ph})
    ),
    rows AS (
      SELECT cmd_id, field_path AS field, unit, pass_id
      FROM satellite_values
      WHERE pass_id IN (${ph})
      UNION ALL
      SELECT cmd_id, field, unit, pass_id
      FROM decoded_telemetry
      WHERE pass_id IN (${ph})
        AND pass_id NOT IN (SELECT pass_id FROM sv_passes)
    )
    SELECT cmd_id, field, MAX(unit) AS unit, COUNT(*) AS count
    FROM rows
    GROUP BY cmd_id, field
    ORDER BY cmd_id, field
  `, passIds);
  return res.rows as SummaryRow[];
}

export async function fetchParameterHistory(passIds: number[]): Promise<DecodedRow[]> {
  if (passIds.length === 0) return [];
  const ph  = passIds.map((_, i) => `$${i + 1}`).join(',');
  const canonical = await pool.query(`
    SELECT pass_id, ts_ms, cmd_id, field_path AS field, value_text AS value, unit
    FROM satellite_values
    WHERE pass_id IN (${ph}) AND source_kind = 'parameter_event'
    ORDER BY ts_ms ASC
  `, passIds);

  const svPasses = await pool.query(`
    SELECT DISTINCT pass_id FROM satellite_values WHERE pass_id IN (${ph})
  `, passIds);
  const canonicalPassIds = new Set((svPasses.rows as { pass_id: number }[]).map(r => Number(r.pass_id)));
  const missingPassIds = passIds.filter(id => !canonicalPassIds.has(id));
  if (missingPassIds.length === 0) return canonical.rows as DecodedRow[];

  const client = await pool.connect();
  try {
    const fallback: DecodedRow[] = [];
    for (const passId of missingPassIds) {
      const tbl = `pass_${passId}`;
      if (!(await tableExists(client, tbl))) continue;
      const res = await client.query<{ ts_ms: number; cmd_id: string; name: string; value: string; unit: string }>(`
        SELECT
          p.ts_ms,
          CASE WHEN r.mission_facts_header_cmd_id IS NOT NULL AND r.mission_facts_header_cmd_id != ''
               THEN 'param:' || r.mission_facts_header_cmd_id
               ELSE 'param:unknown'
          END AS cmd_id,
          p.name,
          p.value,
          p.unit
        FROM "${tbl}" p
        LEFT JOIN "${tbl}" r
          ON r.event_id = p.rx_event_id AND r.event_kind = 'rx_packet'
        WHERE p.event_kind = 'parameter' AND p.name IS NOT NULL AND p.name != ''
        ORDER BY p.ts_ms ASC
      `);
      for (const r of res.rows) {
        fallback.push({ pass_id: passId, ts_ms: r.ts_ms, cmd_id: r.cmd_id, field: r.name, value: r.value ?? '', unit: r.unit ?? '' });
      }
    }
    return [...canonical.rows as DecodedRow[], ...fallback].sort((a, b) => a.ts_ms - b.ts_ms);
  } finally {
    client.release();
  }
}

export async function fetchDecodedTelemetry(passIds: number[], cmd: string): Promise<DecodedRow[]> {
  if (passIds.length === 0) return [];
  const ph  = passIds.map((_, i) => `$${i + 1}`).join(',');
  const res = await pool.query(`
    WITH sv_passes AS (
      SELECT DISTINCT pass_id FROM satellite_values WHERE pass_id IN (${ph})
    ),
    rows AS (
      SELECT pass_id, ts_ms, cmd_id, field_path AS field, value_text AS value, unit
      FROM satellite_values
      WHERE pass_id IN (${ph}) AND cmd_id = $${passIds.length + 1}
      UNION ALL
      SELECT pass_id, ts_ms, cmd_id, field, value, unit
      FROM decoded_telemetry
      WHERE pass_id IN (${ph})
        AND pass_id NOT IN (SELECT pass_id FROM sv_passes)
        AND cmd_id = $${passIds.length + 1}
    )
    SELECT * FROM rows
    ORDER BY ts_ms ASC
  `, [...passIds, cmd]);
  return res.rows as DecodedRow[];
}

export async function fetchDecodeStatus(passIds: number[]): Promise<Record<number, number>> {
  if (passIds.length === 0) return {};
  const ph  = passIds.map((_, i) => `$${i + 1}`).join(',');
  const res = await pool.query(`
    WITH sv_counts AS (
      SELECT pass_id, COUNT(*) AS cnt
      FROM satellite_values
      WHERE pass_id IN (${ph})
      GROUP BY pass_id
    ),
    dt_counts AS (
      SELECT pass_id, COUNT(*) AS cnt
      FROM decoded_telemetry
      WHERE pass_id IN (${ph})
      GROUP BY pass_id
    )
    SELECT p.pass_id, COALESCE(NULLIF(sv.cnt, 0), dt.cnt, 0) AS cnt
    FROM (SELECT unnest(ARRAY[${ph}]::int[]) AS pass_id) p
    LEFT JOIN sv_counts sv ON sv.pass_id = p.pass_id
    LEFT JOIN dt_counts dt ON dt.pass_id = p.pass_id
  `, passIds);
  return Object.fromEntries((res.rows as { pass_id: number; cnt: number }[]).map(r => [r.pass_id, r.cnt]));
}

export async function fetchSatelliteValueSummary(filter: ValuesFilter): Promise<{
  totalRows: number;
  numericRows: number;
  parameters: number;
  minTs: number | null;
  maxTs: number | null;
  domains: { domain: string; count: number }[];
  commands: { cmd_id: string; count: number }[];
  fields: { cmd_id: string; field_path: string; count: number }[];
}> {
  const { where, params } = buildValuesWhere(filter);
  const total = await pool.query(`
    SELECT COUNT(*) AS total_rows,
           COUNT(value_numeric) AS numeric_rows,
           COUNT(DISTINCT field_path) AS parameters,
           MIN(ts_ms) AS min_ts,
           MAX(ts_ms) AS max_ts
    FROM satellite_values
    ${where}
  `, params);
  const domains = await pool.query(`
    SELECT COALESCE(domain, '') AS domain, COUNT(*) AS count
    FROM satellite_values
    ${where}
    GROUP BY domain
    ORDER BY count DESC, domain
  `, params);
  const commands = await pool.query(`
    SELECT COALESCE(cmd_id, '') AS cmd_id, COUNT(*) AS count
    FROM satellite_values
    ${where}
    GROUP BY cmd_id
    ORDER BY count DESC, cmd_id
  `, params);
  const fields = await pool.query(`
    SELECT COALESCE(cmd_id, '') AS cmd_id, field_path, COUNT(*) AS count
    FROM satellite_values
    ${where}
    GROUP BY cmd_id, field_path
    ORDER BY cmd_id, count DESC, field_path
  `, params);
  return {
    totalRows: Number(total.rows[0]?.total_rows ?? 0),
    numericRows: Number(total.rows[0]?.numeric_rows ?? 0),
    parameters: Number(total.rows[0]?.parameters ?? 0),
    minTs: total.rows[0]?.min_ts != null ? Number(total.rows[0].min_ts) : null,
    maxTs: total.rows[0]?.max_ts != null ? Number(total.rows[0].max_ts) : null,
    domains: (domains.rows as { domain: string; count: string }[]).map(r => ({ domain: r.domain, count: Number(r.count) })),
    commands: (commands.rows as { cmd_id: string; count: string }[]).map(r => ({ cmd_id: r.cmd_id, count: Number(r.count) })),
    fields: (fields.rows as { cmd_id: string; field_path: string; count: string }[]).map(r => ({ cmd_id: r.cmd_id, field_path: r.field_path, count: Number(r.count) })),
  };
}

export async function fetchSatelliteValues(filter: ValuesFilter): Promise<SatelliteValueRow[]> {
  const limit = Math.min(Math.max(filter.limit ?? 5000, 1), 50000);
  const { where, params } = buildValuesWhere(filter);
  const res = await pool.query(`
    SELECT pass_id, session_id, source_event_id, source_kind,
           ts_ms, ts_iso, cmd_id, ptype, src, dest, domain,
           parameter_name, field_path, display_name, unit,
           value_text, value_numeric, value_json,
           decoded_ok, decode_error, raw_hex
    FROM satellite_values
    ${where}
    ORDER BY ts_ms ASC, pass_id ASC, field_path ASC
    LIMIT $${params.length + 1}
  `, [...params, limit]);
  return res.rows as SatelliteValueRow[];
}

function csvEscape(value: unknown): string {
  return JSON.stringify(value ?? '');
}

function rowsToCsv(rows: Record<string, unknown>[], columns: string[]): string {
  return [
    columns.join(','),
    ...rows.map((r) => columns.map((c) => csvEscape(r[c])).join(',')),
  ].join('\n');
}

export async function exportSatelliteValuesCsv(filter: ValuesFilter, format: 'long' | 'wide'): Promise<string> {
  const rows = await fetchSatelliteValues({ ...filter, limit: 50000 });
  if (format === 'long') {
    const cols = [
      'pass_id', 'session_id', 'ts_iso', 'ts_ms', 'source_kind',
      'cmd_id', 'ptype', 'domain', 'parameter_name', 'field_path',
      'value', 'value_numeric', 'unit',
    ];
    return rowsToCsv(rows.map((r) => ({
      ...r,
      value: r.value_text,
    })), cols);
  }

  const fieldPaths = [...new Set(rows.map((r) => r.field_path))].sort();
  const grouped = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const key = `${r.pass_id}|${r.source_event_id}|${r.ts_ms}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        pass_id: r.pass_id,
        session_id: r.session_id,
        ts_iso: r.ts_iso,
        ts_ms: r.ts_ms,
        source_event_id: r.source_event_id,
        cmd_id: r.cmd_id,
        ptype: r.ptype,
      });
    }
    const out = grouped.get(key)!;
    const col = r.domain ? `${r.domain}.${r.field_path}` : r.field_path;
    out[col] = r.value_numeric ?? r.value_text;
  }
  const valueCols = [...new Set(fieldPaths.map((f) => {
    const row = rows.find((r) => r.field_path === f);
    return row?.domain ? `${row.domain}.${f}` : f;
  }))].sort();
  return rowsToCsv([...grouped.values()], [
    'pass_id', 'session_id', 'ts_iso', 'ts_ms', 'source_event_id', 'cmd_id', 'ptype',
    ...valueCols,
  ]);
}

export async function materializeSatelliteValuesForPasses(passIds: number[]): Promise<Record<number, number>> {
  const out: Record<number, number> = {};
  for (const passId of passIds) {
    const result = await materializeSatelliteValues(passId);
    out[passId] = result.count;
  }
  return out;
}

export async function reDecodeAllPasses(): Promise<{ passId: number; count: number; error?: string }[]> {
  const client = await pool.connect();
  let passIds: number[];
  try {
    const res = await client.query('SELECT pass_id FROM passes ORDER BY pass_id ASC');
    passIds = (res.rows as { pass_id: number }[]).map(r => r.pass_id);
  } finally {
    client.release();
  }

  const results: { passId: number; count: number; error?: string }[] = [];
  for (const passId of passIds) {
    try {
      const { count } = await materializeTelemetry(passId);
      results.push({ passId, count });
    } catch (err) {
      results.push({ passId, count: 0, error: String(err) });
    }
  }
  return results;
}

// ── Manual beacon entry ───────────────────────────────────────────────────────

export interface BeaconPreview {
  lineIndex: number;
  hex: string;
  cmdId: string | null;
  fields: { field: string; value: string; unit: string }[];
  error: string | null;
}

export function previewBeacons(hexLines: string[]): BeaconPreview[] {
  return hexLines.map((raw, lineIndex) => {
    const hex = raw.trim().replace(/\s+/g, '');
    if (!hex) return { lineIndex, hex: '', cmdId: null, fields: [], error: 'Empty line' };
    if (!/^[0-9a-fA-F]+$/.test(hex)) {
      return { lineIndex, hex, cmdId: null, fields: [], error: 'Not valid hex' };
    }
    try {
      const parsed = parseInnerHex(hex);
      if (!parsed) return { lineIndex, hex, cmdId: null, fields: [], error: 'Could not parse inner frame structure' };
      const fields = decodeRow(parsed.cmdName, hex, 'TLM');
      return { lineIndex, hex, cmdId: parsed.cmdName, fields, error: null };
    } catch (e) {
      return { lineIndex, hex, cmdId: null, fields: [], error: String(e) };
    }
  }).filter(p => p.hex !== '');
}

export async function insertBeacons(passId: number, hexLines: string[]): Promise<number> {
  const tableName = `pass_${passId}`;
  const client = await pool.connect();
  try {
    const exists = await tableExists(client, tableName);
    if (!exists) throw new Error(`Pass ${passId} does not exist`);

    const colList = EVENT_COLS.join(', ');
    const phList  = EVENT_COLS.map((_, i) => `$${i + 1}`).join(', ');
    const insertSql = `INSERT INTO "${tableName}" (${colList}) VALUES (${phList})`;

    const now    = Date.now();
    const nowIso = new Date(now).toISOString();

    let count = 0;
    await client.query('BEGIN');
    try {
      for (const raw of hexLines) {
        const hex = raw.trim().replace(/\s+/g, '');
        if (!hex || !/^[0-9a-fA-F]+$/.test(hex)) continue;
        const parsed = parseInnerHex(hex);
        const row = emptyRow();
        row['event_kind'] = 'rx_packet';
        row['ts_ms']      = now;
        row['ts_iso']     = nowIso;
        row['inner_hex']  = hex;
        row['inner_len']  = hex.length / 2;
        row['mission_facts_header_cmd_id']  = parsed?.cmdName ?? null;
        row['mission_facts_header_ptype']   = 'TLM';
        await client.query(insertSql, EVENT_COLS.map((c) => row[c]));
        count++;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

    await materializeTelemetry(passId);
    return count;
  } finally {
    client.release();
  }
}

export async function deletePass(passId: number, options: { deleteFiles?: boolean } = {}): Promise<void> {
  const client = await pool.connect();
  let committed = false;
  try {
    let filePaths: string[] = [];
    if (options.deleteFiles) {
      const files = await client.query<{ relative_path: string }>(
        'SELECT relative_path FROM pass_files WHERE pass_id = $1',
        [passId],
      );
      filePaths = files.rows.map(r => r.relative_path).filter(Boolean);
    }

    await client.query('BEGIN');
    await client.query(`DROP TABLE IF EXISTS "pass_${passId}"`);
    await client.query('DELETE FROM passes WHERE pass_id = $1', [passId]);
    await client.query('DELETE FROM decoded_telemetry WHERE pass_id = $1', [passId]);
    await client.query('DELETE FROM satellite_values WHERE pass_id = $1', [passId]);
    await client.query('DELETE FROM pass_files WHERE pass_id = $1', [passId]);
    await client.query('COMMIT');
    committed = true;

    if (options.deleteFiles) {
      for (const relativePath of filePaths) {
        const root = relativePath.startsWith('ingested_jsonl/')
          ? INGESTED_FILES_DIR
          : relativePath.startsWith(`assembled_files/pass_${passId}/`)
            ? FILES_DIR
            : null;
        if (!root) continue;
        const absolutePath = resolve(process.cwd(), relativePath);
        if (!absolutePath.startsWith(resolve(root))) continue;
        rmSync(absolutePath, { force: true });
      }
      rmSync(join(FILES_DIR, `pass_${passId}`), { recursive: true, force: true });
    }
  } catch (err) {
    if (!committed) await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── File assembly ─────────────────────────────────────────────────────────────

export const FILES_DIR         = resolve(process.cwd(), 'assembled_files');
export const INGESTED_FILES_DIR = resolve(process.cwd(), 'ingested_jsonl');

const INNER_HDR = 8;

function passIdFromTableId(tableId: string): number | null {
  const m = /^pass_(\d+)$/.exec(tableId);
  return m ? Number(m[1]) : null;
}

function mimeForFile(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.txt') || lower.endsWith('.log')) return 'text/plain';
  if (lower.endsWith('.npz')) return 'application/octet-stream';
  return 'application/octet-stream';
}

function fileDownloadUrl(tableId: string, fileKind: string, filename: string): string {
  if (fileKind === 'ingested_jsonl') {
    return `/api/passes/${passIdFromTableId(tableId)}/files/${encodeURIComponent(filename)}`;
  }
  return `/api/tables/${tableId}/assembled-files/${encodeURIComponent(filename)}`;
}

async function upsertPassFile(info: {
  passId: number;
  tableId: string;
  filename: string;
  fileKind: string;
  relativePath: string;
  totalBytes: number;
  chunkCount?: number;
}): Promise<void> {
  await pool.query(`
    INSERT INTO pass_files
      (pass_id, table_id, filename, file_kind, mime_type, relative_path, download_url, total_bytes, chunk_count)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (pass_id, file_kind, filename)
    DO UPDATE SET
      table_id = EXCLUDED.table_id,
      mime_type = EXCLUDED.mime_type,
      relative_path = EXCLUDED.relative_path,
      download_url = EXCLUDED.download_url,
      total_bytes = EXCLUDED.total_bytes,
      chunk_count = EXCLUDED.chunk_count,
      updated_at = now()
  `, [
    info.passId,
    info.tableId,
    info.filename,
    info.fileKind,
    mimeForFile(info.filename),
    info.relativePath,
    fileDownloadUrl(info.tableId, info.fileKind, info.filename),
    info.totalBytes,
    info.chunkCount ?? 0,
  ]);
}

async function indexExistingPassFiles(client: PoolClient, passIds: number[]): Promise<void> {
  for (const passId of passIds) {
    const tableId = `pass_${passId}`;
    const assembledDir = join(FILES_DIR, tableId);
    if (existsSync(assembledDir)) {
      for (const filename of readdirSync(assembledDir)) {
        const filePath = join(assembledDir, filename);
        const stat = statSync(filePath);
        if (!stat.isFile()) continue;
        await client.query(`
          INSERT INTO pass_files
            (pass_id, table_id, filename, file_kind, mime_type, relative_path, download_url, total_bytes, chunk_count)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT (pass_id, file_kind, filename)
          DO UPDATE SET
            table_id = EXCLUDED.table_id,
            mime_type = EXCLUDED.mime_type,
            relative_path = EXCLUDED.relative_path,
            download_url = EXCLUDED.download_url,
            total_bytes = EXCLUDED.total_bytes,
            updated_at = now()
        `, [
          passId,
          tableId,
          filename,
          'assembled',
          mimeForFile(filename),
          `assembled_files/${tableId}/${filename}`,
          fileDownloadUrl(tableId, 'assembled', filename),
          stat.size,
          0,
        ]);
      }
    }

    if (existsSync(INGESTED_FILES_DIR)) {
      for (const filename of readdirSync(INGESTED_FILES_DIR)) {
        if (!filename.startsWith(`pass_${passId}_`)) continue;
        const filePath = join(INGESTED_FILES_DIR, filename);
        const stat = statSync(filePath);
        if (!stat.isFile()) continue;
        await client.query(`
          INSERT INTO pass_files
            (pass_id, table_id, filename, file_kind, mime_type, relative_path, download_url, total_bytes, chunk_count)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT (pass_id, file_kind, filename)
          DO UPDATE SET
            table_id = EXCLUDED.table_id,
            mime_type = EXCLUDED.mime_type,
            relative_path = EXCLUDED.relative_path,
            download_url = EXCLUDED.download_url,
            total_bytes = EXCLUDED.total_bytes,
            updated_at = now()
        `, [
          passId,
          tableId,
          filename,
          'ingested_jsonl',
          mimeForFile(filename),
          `ingested_jsonl/${filename}`,
          fileDownloadUrl(tableId, 'ingested_jsonl', filename),
          stat.size,
          0,
        ]);
      }
    }
  }
}

function parseInnerHexServer(hex: string): Buffer | null {
  if (!hex || hex.length < (INNER_HDR + 2) * 2) return null;
  try {
    const b = Buffer.from(hex, 'hex');
    if (b.length < INNER_HDR + 2) return null;
    const nameLen  = b[INNER_HDR];
    const argsLen  = b[INNER_HDR + 1];
    const argsStart = INNER_HDR + 2 + nameLen + 1;
    if (argsStart > b.length) return null;
    return b.subarray(argsStart, argsStart + argsLen);
  } catch {
    return null;
  }
}

function parseFileChunkServer(
  args: Buffer,
): { filename: string; index: number; data: Buffer } | null {
  let pos = 0;
  const tokens: string[] = [];
  while (tokens.length < 3 && pos < args.length) {
    while (pos < args.length && args[pos] === 0x20) pos++;
    if (pos >= args.length || args[pos] < 0x21 || args[pos] > 0x7e) break;
    let end = pos;
    while (end < args.length && args[end] !== 0x20 && args[end] >= 0x20 && args[end] <= 0x7e) end++;
    tokens.push(args.subarray(pos, end).toString('ascii'));
    pos = end;
  }
  while (pos < args.length && args[pos] === 0x20) pos++;
  if (tokens.length < 2) return null;
  const idx = parseInt(tokens[1]);
  if (isNaN(idx)) return null;
  const size = tokens.length >= 3 ? parseInt(tokens[2]) : args.length - pos;
  return { filename: tokens[0], index: idx, data: args.subarray(pos, pos + size) };
}

export interface AssembledFileInfo {
  filename: string;
  totalBytes: number;
  chunkCount: number;
  fileKind?: string;
  mimeType?: string;
  relativePath?: string;
  downloadUrl?: string;
}

export async function assembleFilesForTable(tableId: string): Promise<AssembledFileInfo[]> {
  if (!/^\w+$/.test(tableId)) throw new Error('Invalid table name');
  const passId = passIdFromTableId(tableId);
  if (!passId) throw new Error('Invalid pass table name');

  const res = await pool.query(`
    SELECT inner_hex
    FROM "${tableId}"
    WHERE event_kind = 'rx_packet'
      AND mission_facts_header_ptype = 'FILE'
      AND inner_hex IS NOT NULL
    ORDER BY ts_ms ASC
  `);

  const fileMap = new Map<string, Map<number, Buffer>>();

  for (const row of res.rows as { inner_hex: string }[]) {
    const argsBytes = parseInnerHexServer(row.inner_hex);
    if (!argsBytes || argsBytes.length === 0) continue;
    const chunk = parseFileChunkServer(argsBytes);
    if (!chunk || chunk.data.length === 0) continue;
    if (!fileMap.has(chunk.filename)) fileMap.set(chunk.filename, new Map());
    const chunks = fileMap.get(chunk.filename)!;
    if (!chunks.has(chunk.index)) chunks.set(chunk.index, chunk.data);
  }

  const outDir = join(FILES_DIR, tableId);
  mkdirSync(outDir, { recursive: true });

  const results: AssembledFileInfo[] = [];
  for (const [filename, chunks] of fileMap) {
    const sorted   = [...chunks.keys()].sort((a, b) => a - b).map(i => chunks.get(i)!);
    const assembled = Buffer.concat(sorted);
    const filePath = join(outDir, filename);
    writeFileSync(filePath, assembled);
    const relativePath = `assembled_files/${tableId}/${filename}`;
    const downloadUrl = fileDownloadUrl(tableId, 'assembled', filename);
    await upsertPassFile({
      passId,
      tableId,
      filename,
      fileKind: 'assembled',
      relativePath,
      totalBytes: assembled.length,
      chunkCount: chunks.size,
    });
    results.push({
      filename,
      totalBytes: assembled.length,
      chunkCount: chunks.size,
      fileKind: 'assembled',
      mimeType: mimeForFile(filename),
      relativePath,
      downloadUrl,
    });
  }
  return results;
}

export async function listAssembledFiles(tableId: string): Promise<AssembledFileInfo[]> {
  if (!/^\w+$/.test(tableId)) throw new Error('Invalid table name');
  const passId = passIdFromTableId(tableId);
  if (!passId) throw new Error('Invalid pass table name');
  const indexed = await pool.query<{
    filename: string;
    total_bytes: number;
    chunk_count: number;
    file_kind: string;
    mime_type: string;
    relative_path: string;
    download_url: string;
  }>(`
    SELECT filename, total_bytes, chunk_count, file_kind, mime_type, relative_path, download_url
    FROM pass_files
    WHERE pass_id = $1 AND file_kind = 'assembled'
    ORDER BY filename ASC
  `, [passId]);
  if (indexed.rows.length > 0) {
    return indexed.rows.map(r => ({
      filename: r.filename,
      totalBytes: Number(r.total_bytes),
      chunkCount: Number(r.chunk_count),
      fileKind: r.file_kind,
      mimeType: r.mime_type,
      relativePath: r.relative_path,
      downloadUrl: r.download_url,
    }));
  }

  const dir = join(FILES_DIR, tableId);
  if (!existsSync(dir)) return [];
  const files: AssembledFileInfo[] = [];
  for (const name of readdirSync(dir)) {
    const totalBytes = statSync(join(dir, name)).size;
    const relativePath = `assembled_files/${tableId}/${name}`;
    await upsertPassFile({
      passId,
      tableId,
      filename: name,
      fileKind: 'assembled',
      relativePath,
      totalBytes,
    });
    files.push({
      filename: name,
      totalBytes,
      chunkCount: 0,
      fileKind: 'assembled',
      mimeType: mimeForFile(name),
      relativePath,
      downloadUrl: fileDownloadUrl(tableId, 'assembled', name),
    });
  }
  return files;
}

export async function listPassFiles(passId: number): Promise<AssembledFileInfo[]> {
  const res = await pool.query<{
    filename: string;
    total_bytes: number;
    chunk_count: number;
    file_kind: string;
    mime_type: string;
    relative_path: string;
    download_url: string;
  }>(`
    SELECT filename, total_bytes, chunk_count, file_kind, mime_type, relative_path, download_url
    FROM pass_files
    WHERE pass_id = $1
    ORDER BY file_kind ASC, filename ASC
  `, [passId]);
  return res.rows.map(r => ({
    filename: r.filename,
    totalBytes: Number(r.total_bytes),
    chunkCount: Number(r.chunk_count),
    fileKind: r.file_kind,
    mimeType: r.mime_type,
    relativePath: r.relative_path,
    downloadUrl: r.download_url,
  }));
}

// ── Pass report data ──────────────────────────────────────────────────────────

export interface PassReportMeta {
  pass_id: number;
  session_id: string;
  pass_date: string;
  pass_time: string;
  mission_id: string;
  operator: string;
  station: string;
  start_ts_ms: number | null;
  end_ts_ms: number | null;
  source_file: string;
}

export interface PassReportCommand {
  event_id: string;
  ts_iso: string;
  cmd_id: string;
  outcome: string | null;
  elapsed_ms: number | null;
}

export interface PassReportWarning {
  event_id: string | null;
  ts_iso: string;
  source: 'RX' | 'TX' | 'ALARM';
  label: string;
  detail: string;
  severity: string | null;
}

export interface PassReport {
  meta: PassReportMeta;
  commands: PassReportCommand[];
  warnings: PassReportWarning[];
}

export async function fetchPassReport(passId: number): Promise<PassReport> {
  const client = await pool.connect();
  try {
    const metaRes = await client.query(
      'SELECT * FROM passes WHERE pass_id = $1',
      [passId],
    );
    if (metaRes.rowCount === 0) throw new Error(`Pass ${passId} not found`);
    const meta = metaRes.rows[0] as PassReportMeta;

    const tbl = `pass_${passId}`;
    const tblCheck = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
      [tbl],
    );
    if ((tblCheck.rowCount ?? 0) === 0) {
      return { meta, commands: [], warnings: [] };
    }

    // Commands: tx_command events, joined with cmd_verifier outcomes
    const cmdRes = await client.query(`
      SELECT
        tx.event_id,
        COALESCE(tx.ts_iso, to_char(to_timestamp(tx.ts_ms / 1000.0), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) AS ts_iso,
        COALESCE(tx.mission_facts_header_cmd_id, tx.frame_label, '') AS cmd_id,
        cv.outcome,
        cv.elapsed_ms
      FROM "${tbl}" tx
      LEFT JOIN LATERAL (
        SELECT outcome, elapsed_ms
        FROM "${tbl}"
        WHERE event_kind = 'cmd_verifier' AND cmd_event_id = tx.event_id
        ORDER BY ts_ms DESC LIMIT 1
      ) cv ON true
      WHERE tx.event_kind = 'tx_command'
      ORDER BY tx.ts_ms ASC
    `);

    // Errors/warnings:
    //   RX errors  — rx_packet events that have a non-empty warnings array
    //   TX errors  — cmd_verifier events whose outcome is a failure
    //   Alarms     — alarm events (any severity)
    const warnRes = await client.query(`
      SELECT event_id, ts_iso_norm AS ts_iso, source, label, detail, severity
      FROM (
        -- RX errors: received packets flagged with warnings
        SELECT
          event_id,
          COALESCE(ts_iso, to_char(to_timestamp(ts_ms / 1000.0), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) AS ts_iso_norm,
          ts_ms,
          'RX'::text AS source,
          COALESCE(frame_label, '') AS label,
          warnings AS detail,
          NULL::text AS severity
        FROM "${tbl}"
        WHERE event_kind = 'rx_packet'
          AND warnings IS NOT NULL AND warnings <> '' AND warnings <> 'null' AND warnings <> '[]'

        UNION ALL

        -- TX errors: cmd_verifier outcomes that indicate failure
        SELECT
          cv.event_id,
          COALESCE(cv.ts_iso, to_char(to_timestamp(cv.ts_ms / 1000.0), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) AS ts_iso_norm,
          cv.ts_ms,
          'TX'::text AS source,
          COALESCE(tx.mission_facts_header_cmd_id, tx.frame_label, cv.verifier_id, '') AS label,
          COALESCE(cv.stage, '') AS detail,
          cv.outcome AS severity
        FROM "${tbl}" cv
        LEFT JOIN "${tbl}" tx ON tx.event_id = cv.cmd_event_id
        WHERE cv.event_kind = 'cmd_verifier'
          AND cv.outcome IS NOT NULL
          AND cv.outcome NOT IN ('SUCCESS', 'COMPLETE', 'COMPLETED', 'ACK', '')
          AND LOWER(cv.outcome) NOT IN ('pass', 'passed')

        UNION ALL

        -- Alarms: all alarm state-change events, excluding severity = 'pass'
        SELECT
          event_id,
          COALESCE(ts_iso, to_char(to_timestamp(ts_ms / 1000.0), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) AS ts_iso_norm,
          ts_ms,
          'ALARM'::text AS source,
          COALESCE(alarm_label, '') AS label,
          COALESCE(alarm_detail, '') AS detail,
          alarm_severity AS severity
        FROM "${tbl}"
        WHERE event_kind = 'alarm'
          AND (alarm_severity IS NULL OR LOWER(alarm_severity) NOT IN ('pass', 'passed'))
      ) sub
      ORDER BY ts_ms ASC
    `);

    return {
      meta,
      commands: cmdRes.rows as PassReportCommand[],
      warnings: warnRes.rows as PassReportWarning[],
    };
  } finally {
    client.release();
  }
}
