import Database from 'better-sqlite3';
import { resolve } from 'path';
import type { ColumnDef, ColumnType, AppSchema, TableMeta } from '../src/types.js';

const DB_PATH = resolve(process.cwd(), 'ground_station.db');

const PASSES_DDL = `
  CREATE TABLE IF NOT EXISTS passes (
    pass_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id     TEXT,
    source_file    TEXT,
    pass_date      TEXT,
    pass_time      TEXT,
    start_ts_ms    INTEGER,
    end_ts_ms      INTEGER,
    mission_id     TEXT,
    operator       TEXT,
    station        TEXT,
    schema_version TEXT
  )
`;

// All columns in a per-pass unified event table, in declared order.
// id is omitted here (it is AUTOINCREMENT in the DDL, not inserted by app code).
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
    CREATE TABLE "${tableName}" (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      event_kind  TEXT NOT NULL,
      event_id    TEXT,
      ts_ms       INTEGER,
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
      alarm_first_seen_ms      INTEGER,
      alarm_last_transition_ms INTEGER,
      alarm_operator           TEXT,
      alarm_context_raw        TEXT,
      cmd_event_id   TEXT,
      instance_id    TEXT,
      stage          TEXT,
      verifier_id    TEXT,
      outcome        TEXT,
      elapsed_ms     INTEGER,
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
    )
  `;
}

const OLD_EVENT_TABLES = [
  'event_rx_packet',
  'event_tx_command',
  'event_parameter',
  'event_alarm',
  'event_cmd_verifier',
  'event_radio',
] as const;

function inferType(colName: string, sqliteType: string): ColumnType {
  const n = colName.toLowerCase();
  const t = sqliteType.toUpperCase();
  if (n === 'ts_iso' || n.endsWith('_iso') || n === 'pass_date' || n === 'pass_time') return 'time';
  if (n.endsWith('_ms') || n === 'value_unix_ms') return 'int';
  if (t === 'INTEGER') return 'int';
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

interface PragmaRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

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

let _db: Database.Database | null = null;
let _dbWrite: Database.Database | null = null;

function getDb(): Database.Database {
  if (!_db) _db = new Database(DB_PATH, { readonly: true });
  return _db;
}

function getWriteDb(): Database.Database {
  if (!_dbWrite) _dbWrite = new Database(DB_PATH);
  return _dbWrite;
}

export function resetReadDb(): void {
  _db?.close();
  _db = null;
}

function tableExists(db: Database.Database, name: string): boolean {
  return !!(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name));
}

function migrateOldTables(db: Database.Database): void {
  const present = OLD_EVENT_TABLES.filter((t) => tableExists(db, t));
  if (present.length === 0) return;

  const passIds = new Set<number>();
  for (const t of present) {
    try {
      const rows = db.prepare(`SELECT DISTINCT pass_id FROM "${t}"`).all() as { pass_id: number }[];
      rows.forEach((r) => passIds.add(r.pass_id));
    } catch { /* ignore */ }
  }

  for (const passId of passIds) {
    const tbl = `pass_${passId}`;
    if (tableExists(db, tbl)) continue;
    db.exec(passTableDDL(tbl));

    if (present.includes('event_rx_packet')) {
      db.prepare(`
        INSERT INTO "${tbl}"
          (event_kind,event_id,ts_ms,ts_iso,seq,v,
           frame_type,transport_meta,raw_hex,size,duplicate,uplink_echo,unknown,warnings,mission_id,
           mission_facts_header_cmd_id,mission_facts_header_src,mission_facts_header_dest,
           mission_facts_header_echo,mission_facts_header_ptype,
           mission_facts_protocol_args_hex,mission_facts_protocol_csp_plausible,
           mission_facts_protocol_stripped_header,
           mission_facts_protocol_csp_header_prio,mission_facts_protocol_csp_header_src,
           mission_facts_protocol_csp_header_dest,mission_facts_protocol_csp_header_dport,
           mission_facts_protocol_csp_header_sport,mission_facts_protocol_csp_header_flags,
           mission_facts_integrity_overall_ok,mission_facts_integrity_body_crc_ok,
           mission_facts_integrity_csp_crc32,mission_facts_integrity_csp_crc32_ok,
           frame_label,inner_hex,inner_len,wire_hex,wire_len)
        SELECT
          'rx_packet',event_id,ts_ms,ts_iso,seq,v,
          frame_type,transport_meta,raw_hex,size,duplicate,uplink_echo,unknown,warnings,mission_id,
          mission_facts_header_cmd_id,mission_facts_header_src,mission_facts_header_dest,
          mission_facts_header_echo,mission_facts_header_ptype,
          mission_facts_protocol_args_hex,mission_facts_protocol_csp_plausible,
          mission_facts_protocol_stripped_header,
          mission_facts_protocol_csp_header_prio,mission_facts_protocol_csp_header_src,
          mission_facts_protocol_csp_header_dest,mission_facts_protocol_csp_header_dport,
          mission_facts_protocol_csp_header_sport,mission_facts_protocol_csp_header_flags,
          mission_facts_integrity_overall_ok,mission_facts_integrity_body_crc_ok,
          mission_facts_integrity_csp_crc32,mission_facts_integrity_csp_crc32_ok,
          frame_label,inner_hex,inner_len,wire_hex,wire_len
        FROM event_rx_packet WHERE pass_id=?
      `).run(passId);
    }

    if (present.includes('event_tx_command')) {
      db.prepare(`
        INSERT INTO "${tbl}"
          (event_kind,event_id,ts_ms,ts_iso,seq,v,
           frame_label,inner_hex,inner_len,wire_hex,wire_len,
           mission_facts_header_cmd_id,mission_facts_header_src,mission_facts_header_dest,
           mission_facts_header_echo,mission_facts_header_ptype,
           mission_facts_protocol_args_hex,
           mission_facts_protocol_csp_header_prio,mission_facts_protocol_csp_header_src,
           mission_facts_protocol_csp_header_dest,mission_facts_protocol_csp_header_dport,
           mission_facts_protocol_csp_header_sport,mission_facts_protocol_csp_header_flags)
        SELECT
          'tx_command',event_id,ts_ms,ts_iso,seq,v,
          frame_label,inner_hex,inner_len,wire_hex,wire_len,
          mission_facts_header_cmd_id,mission_facts_header_src,mission_facts_header_dest,
          mission_facts_header_echo,mission_facts_header_ptype,
          mission_facts_protocol_args_hex,
          mission_facts_protocol_csp_header_prio,mission_facts_protocol_csp_header_src,
          mission_facts_protocol_csp_header_dest,mission_facts_protocol_csp_header_dport,
          mission_facts_protocol_csp_header_sport,mission_facts_protocol_csp_header_flags
        FROM event_tx_command WHERE pass_id=?
      `).run(passId);
    }

    if (present.includes('event_parameter')) {
      db.prepare(`
        INSERT INTO "${tbl}"
          (event_kind,event_id,ts_ms,ts_iso,seq,v,rx_event_id,name,value,unit,display_only)
        SELECT
          'parameter',event_id,ts_ms,ts_iso,seq,v,rx_event_id,name,value,unit,display_only
        FROM event_parameter WHERE pass_id=?
      `).run(passId);
    }

    if (present.includes('event_alarm')) {
      db.prepare(`
        INSERT INTO "${tbl}"
          (event_kind,event_id,ts_ms,ts_iso,seq,v,
           alarm_id,alarm_source,alarm_label,alarm_detail,
           alarm_severity,alarm_state,alarm_prev_state,alarm_prev_severity,
           alarm_removed,alarm_first_seen_ms,alarm_last_transition_ms,alarm_operator,alarm_context_raw)
        SELECT
          'alarm',event_id,ts_ms,ts_iso,seq,v,
          alarm_id,alarm_source,alarm_label,alarm_detail,
          alarm_severity,alarm_state,alarm_prev_state,alarm_prev_severity,
          alarm_removed,alarm_first_seen_ms,alarm_last_transition_ms,alarm_operator,alarm_context_raw
        FROM event_alarm WHERE pass_id=?
      `).run(passId);
    }

    if (present.includes('event_cmd_verifier')) {
      db.prepare(`
        INSERT INTO "${tbl}"
          (event_kind,event_id,ts_ms,ts_iso,seq,v,
           cmd_event_id,instance_id,stage,verifier_id,outcome,elapsed_ms,match_event_id)
        SELECT
          'cmd_verifier',event_id,ts_ms,ts_iso,seq,v,
          cmd_event_id,instance_id,stage,verifier_id,outcome,elapsed_ms,match_event_id
        FROM event_cmd_verifier WHERE pass_id=?
      `).run(passId);
    }

    if (present.includes('event_radio')) {
      db.prepare(`
        INSERT INTO "${tbl}"
          (event_kind,event_id,ts_ms,ts_iso,seq,v,
           radio_action,radio_state,radio_pid,radio_exit_code,
           radio_command,radio_script,radio_cwd,radio_detail,radio_expected)
        SELECT
          'radio',event_id,ts_ms,ts_iso,seq,v,
          radio_action,radio_state,radio_pid,radio_exit_code,
          radio_command,radio_script,radio_cwd,radio_detail,radio_expected
        FROM event_radio WHERE pass_id=?
      `).run(passId);
    }
  }

  for (const t of present) {
    db.exec(`DROP TABLE IF EXISTS "${t}"`);
  }
}

export function initDb(): void {
  const db = getWriteDb();
  db.exec(PASSES_DDL);
  migrateOldTables(db);
  resetReadDb();
}

export function loadSchema(): AppSchema {
  const db = getDb();

  const passMetaMap = new Map<number, PassRow>();
  try {
    const passes = db.prepare('SELECT * FROM passes').all() as PassRow[];
    for (const p of passes) passMetaMap.set(p.pass_id, p);
  } catch { /* passes table may not exist yet */ }

  const allTables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];

  const groups: Record<string, TableMeta[]> = {};
  const columns: Record<string, ColumnDef[]> = {};

  for (const { name } of allTables) {
    const pragma = db.prepare(`PRAGMA table_info("${name}")`).all() as PragmaRow[];
    const { cnt } = db.prepare(`SELECT COUNT(*) as cnt FROM "${name}"`).get() as { cnt: number };

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

    columns[name] = pragma.map((c) => {
      const type = inferType(c.name, c.type);
      return {
        id: c.name,
        label: c.name,
        type,
        width: widthFor(c.name, type),
        mono: true,
        align: (type === 'int' || type === 'float') ? 'right' : 'left',
        pk: c.pk || null,
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
}

export function fetchRows(
  tableId: string,
  opts: { limit?: number; offset?: number; sort?: string; dir?: string } = {},
): Record<string, unknown>[] {
  const db = getDb();
  const { limit = 1000, offset = 0, sort, dir } = opts;

  if (!/^\w+$/.test(tableId)) throw new Error('Invalid table name');

  let sql = `SELECT * FROM "${tableId}"`;
  if (sort && /^\w+$/.test(sort)) {
    sql += ` ORDER BY "${sort}" ${dir === 'desc' ? 'DESC' : 'ASC'}`;
  }
  sql += ` LIMIT ${limit} OFFSET ${offset}`;

  return db.prepare(sql).all() as Record<string, unknown>[];
}

/* ─── ingestion ──────────────────────────────────────────────────────────── */

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

export function ingestJsonl(content: string, sourceFile: string, forcedPassId?: number): IngestResult {
  const db = getWriteDb();

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

  const result = db.transaction(() => {
    let passId: number;
    if (forcedPassId != null) {
      db.prepare(`
        INSERT INTO passes
          (pass_id, session_id, source_file, pass_date, pass_time,
           start_ts_ms, end_ts_ms, mission_id, operator, station, schema_version)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `).run(forcedPassId, sessionId, sourceFile, startDate, startTime,
             startMs, endMs, missionId, operator, station, schemaVer);
      passId = forcedPassId;
    } else {
      const { lastInsertRowid } = db.prepare(`
        INSERT INTO passes
          (session_id, source_file, pass_date, pass_time,
           start_ts_ms, end_ts_ms, mission_id, operator, station, schema_version)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `).run(sessionId, sourceFile, startDate, startTime,
             startMs, endMs, missionId, operator, station, schemaVer);
      passId = Number(lastInsertRowid);
    }
    const tbl = `pass_${passId}`;
    db.exec(passTableDDL(tbl));

    // Named-parameter insert: each call passes a full row object; unset columns stay NULL.
    const evStmt = db.prepare(`
      INSERT INTO "${tbl}" (${EVENT_COLS.join(',')})
      VALUES (${EVENT_COLS.map((c) => `@${c}`).join(',')})
    `);

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
          row['frame_label']   = str(ev['frame_label']);
          row['inner_hex']     = str(ev['inner_hex']);
          row['inner_len']     = num(ev['inner_len']);
          row['wire_hex']      = str(ev['wire_hex']);
          row['wire_len']      = num(ev['wire_len']);
          row['frame_type']    = str(ev['frame_type']);
          row['transport_meta']= str(ev['transport_meta']);
          row['raw_hex']       = str(ev['raw_hex']);
          row['size']          = num(ev['size']);
          row['duplicate']     = bool(ev['duplicate']);
          row['uplink_echo']   = bool(ev['uplink_echo']);
          row['unknown']       = bool(ev['unknown']);
          row['warnings']      = jsn(ev['warnings']);
          row['mission_id']    = str(ev['mission_id'] ?? missionId);

        } else if (kind === 'tx_command') {
          Object.assign(row, flatMission(ev['mission']));
          row['frame_label']   = str(ev['frame_label']);
          row['inner_hex']     = str(ev['inner_hex']);
          row['inner_len']     = num(ev['inner_len']);
          row['wire_hex']      = str(ev['wire_hex']);
          row['wire_len']      = num(ev['wire_len']);

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
          row['cmd_event_id']  = str(ev['cmd_event_id']);
          row['instance_id']   = str(ev['instance_id']);
          row['stage']         = str(ev['stage']);
          row['verifier_id']   = str(ev['verifier_id']);
          row['outcome']       = str(ev['outcome']);
          row['elapsed_ms']    = num(ev['elapsed_ms']);
          row['match_event_id']= ev['match_event_id'] == null ? null : str(ev['match_event_id']);

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

        evStmt.run(row);
        counts[kind] = (counts[kind] ?? 0) + 1;
      } catch (err) {
        warnings.push(`Skipped ${kind} event_id=${str(ev['event_id'])}: ${String(err)}`);
        skipped++;
      }
    }

    return passId;
  })() as number;

  resetReadDb();
  return { passId: result, sessionId, counts, skipped, warnings };
}
