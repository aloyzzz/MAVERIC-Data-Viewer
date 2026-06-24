import { Pool, type PoolClient } from 'pg';
import { mkdirSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';
import type { ColumnDef, ColumnType, AppSchema, TableMeta } from '../src/types.js';
import { decodeRow, parseInnerHex } from './telemetryDecode.js';

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
        schema_version TEXT
      )
    `);

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

    // Backfill any passes that have no decoded rows yet, and ensure each
    // per-pass table has a ts_ms index (the default sort column).
    const allPasses = (await client.query('SELECT pass_id FROM passes')).rows as { pass_id: number }[];
    const decodedRes = await client.query('SELECT DISTINCT pass_id FROM decoded_telemetry');
    const decodedSet = new Set((decodedRes.rows as { pass_id: number }[]).map(r => r.pass_id));
    for (const { pass_id } of allPasses) {
      const tbl = `pass_${pass_id}`;
      if (await tableExists(client, tbl)) {
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_${tbl}_ts_ms" ON "${tbl}" (ts_ms)`);
        if (!decodedSet.has(pass_id)) {
          try { await materializeTelemetry(pass_id); } catch { /* skip */ }
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
      groups[schemaGroup].push({ id: name, label, desc, primary, rows: cnt });
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

// ── Ingestion ─────────────────────────────────────────────────────────────────

type JsonEvent = Record<string, unknown>;

export interface IngestResult {
  passId: number;
  sessionId: string;
  counts: Record<string, number>;
  skipped: number;
  warnings: string[];
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
           start_ts_ms, end_ts_ms, mission_id, operator, station, schema_version)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `, [forcedPassId, sessionId, sourceFile, startDate, startTime,
          startMs, endMs, missionId, operator, station, schemaVer]);
      passId = forcedPassId;
    } else {
      const r = await client.query(`
        INSERT INTO passes
          (session_id, source_file, pass_date, pass_time,
           start_ts_ms, end_ts_ms, mission_id, operator, station, schema_version)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING pass_id
      `, [sessionId, sourceFile, startDate, startTime,
          startMs, endMs, missionId, operator, station, schemaVer]);
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

  // Best-effort: decode binary TLM/RES packets and save to decoded_telemetry.
  try { await materializeTelemetry(passId); } catch { /* non-fatal */ }

  return { passId, sessionId, counts, skipped, warnings };
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

export async function materializeTelemetry(passId: number): Promise<{ count: number }> {
  const tbl = `pass_${passId}`;
  const client = await pool.connect();
  try {
    const exists = await tableExists(client, tbl);
    if (!exists) throw new Error(`Table ${tbl} does not exist`);

    await client.query('DELETE FROM decoded_telemetry WHERE pass_id = $1', [passId]);

    type FrameRow = { ts_ms: number; cmd_id: string; inner_hex: string };
    const rows = (await client.query(`
      SELECT ts_ms,
             mission_facts_header_cmd_id AS cmd_id,
             inner_hex
      FROM   "${tbl}"
      WHERE  event_kind IN ('rx_packet', 'tx_command')
        AND  mission_facts_header_ptype IN ('TLM', 'RES')
        AND  inner_hex IS NOT NULL AND inner_hex != ''
      ORDER  BY ts_ms ASC
    `)).rows as FrameRow[];

    let count = 0;
    await client.query('BEGIN');
    try {
      for (const row of rows) {
        if (!row.cmd_id) continue;
        const decoded = decodeRow(row.cmd_id, row.inner_hex);
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
    return { count };
  } finally {
    client.release();
  }
}

export async function fetchDecodedSummary(passIds: number[]): Promise<SummaryRow[]> {
  if (passIds.length === 0) return [];
  const ph  = passIds.map((_, i) => `$${i + 1}`).join(',');
  const res = await pool.query(`
    SELECT cmd_id, field, MAX(unit) AS unit, COUNT(*) AS count
    FROM   decoded_telemetry
    WHERE  pass_id IN (${ph})
    GROUP  BY cmd_id, field
    ORDER  BY cmd_id, field
  `, passIds);
  return res.rows as SummaryRow[];
}

export async function fetchDecodedTelemetry(passIds: number[], cmd: string): Promise<DecodedRow[]> {
  if (passIds.length === 0) return [];
  const ph  = passIds.map((_, i) => `$${i + 1}`).join(',');
  const res = await pool.query(`
    SELECT pass_id, ts_ms, cmd_id, field, value, unit
    FROM   decoded_telemetry
    WHERE  pass_id IN (${ph}) AND cmd_id = $${passIds.length + 1}
    ORDER  BY ts_ms ASC
  `, [...passIds, cmd]);
  return res.rows as DecodedRow[];
}

export async function fetchDecodeStatus(passIds: number[]): Promise<Record<number, number>> {
  if (passIds.length === 0) return {};
  const ph  = passIds.map((_, i) => `$${i + 1}`).join(',');
  const res = await pool.query(`
    SELECT pass_id, COUNT(*) AS cnt
    FROM   decoded_telemetry
    WHERE  pass_id IN (${ph})
    GROUP  BY pass_id
  `, passIds);
  return Object.fromEntries((res.rows as { pass_id: number; cnt: number }[]).map(r => [r.pass_id, r.cnt]));
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
      const fields = decodeRow(parsed.cmdName, hex);
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

export async function deletePass(passId: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DROP TABLE IF EXISTS "pass_${passId}"`);
    await client.query('DELETE FROM passes WHERE pass_id = $1', [passId]);
    await client.query('DELETE FROM decoded_telemetry WHERE pass_id = $1', [passId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── File assembly ─────────────────────────────────────────────────────────────

export const FILES_DIR = resolve(process.cwd(), 'assembled_files');

const INNER_HDR = 8;

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
}

export async function assembleFilesForTable(tableId: string): Promise<AssembledFileInfo[]> {
  if (!/^\w+$/.test(tableId)) throw new Error('Invalid table name');

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
    writeFileSync(join(outDir, filename), assembled);
    results.push({ filename, totalBytes: assembled.length, chunkCount: chunks.size });
  }
  return results;
}

export function listAssembledFiles(tableId: string): AssembledFileInfo[] {
  if (!/^\w+$/.test(tableId)) throw new Error('Invalid table name');
  const dir = join(FILES_DIR, tableId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map(name => ({
    filename: name,
    totalBytes: statSync(join(dir, name)).size,
    chunkCount: 0,
  }));
}
