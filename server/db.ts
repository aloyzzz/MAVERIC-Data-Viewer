import Database from 'better-sqlite3';
import { resolve } from 'path';
import type { ColumnDef, ColumnType, AppSchema, TableMeta } from '../src/types.js';

const DB_PATH = resolve(process.cwd(), 'ground_station.db');

const META: Record<string, { label: string; desc: string; primary: string; schema: string }> = {
  passes:             { label: 'passes',             desc: 'Operator log sessions / passes', primary: 'pass_id', schema: 'mission' },
  event_rx_packet:    { label: 'event_rx_packet',    desc: 'Decoded downlink packets',       primary: 'id',      schema: 'events'  },
  event_tx_command:   { label: 'event_tx_command',   desc: 'Sent uplink commands',           primary: 'id',      schema: 'events'  },
  event_parameter:    { label: 'event_parameter',    desc: 'Parameter snapshots from RX',    primary: 'id',      schema: 'events'  },
  event_alarm:        { label: 'event_alarm',        desc: 'Active + cleared alarms',        primary: 'id',      schema: 'events'  },
  event_cmd_verifier: { label: 'event_cmd_verifier', desc: 'TX verifier outcomes',           primary: 'id',      schema: 'events'  },
  event_radio:        { label: 'event_radio',        desc: 'GNU Radio process events',       primary: 'id',      schema: 'events'  },
};

function inferType(colName: string, sqliteType: string): ColumnType {
  const n = colName.toLowerCase();
  const t = sqliteType.toUpperCase();
  if (n === 'ts_iso' || n.endsWith('_iso') || n === 'pass_date' || n === 'pass_time' || n === 'value_iso_utc') return 'time';
  if (n.endsWith('_ms') || n === 'value_unix_ms') return 'int';
  if (t === 'INTEGER') return 'int';
  if (n === 'frame_type' || n === 'frame_label') return 'frame';
  if (['alarm_severity', 'alarm_state', 'alarm_prev_state', 'alarm_prev_severity',
       'outcome', 'stage', 'radio_action', 'radio_state', 'mission_facts_header_ptype'].includes(n)) return 'tag';
  if (/^(duplicate|uplink_echo|unknown|display_only|alarm_removed|.*_ok|.*_plausible)$/.test(n)) return 'bool';
  if (n === 'size' || n.endsWith('_len')) return 'int';
  return 'text';
}

function widthFor(colName: string, type: ColumnType): number {
  const n = colName.toLowerCase();
  if (['event_id', 'rx_event_id', 'cmd_event_id', 'match_event_id', 'instance_id'].includes(n)) return 220;
  if (n === 'ts_iso') return 210;
  if (n === 'ts_ms' || n.endsWith('_ms')) return 130;
  if (['id', 'pass_id', 'seq'].includes(n)) return 70;
  if (n === 'v') return 60;
  if (['frame_type', 'frame_label'].includes(n)) return 130;
  if (n === 'name') return 220;
  if (['value', 'value_display'].includes(n)) return 200;
  if (n === 'unit') return 70;
  if (['alarm_label', 'alarm_detail', 'message'].includes(n)) return 240;
  if (['alarm_id', 'alarm_source', 'alarm_context_container_id'].includes(n)) return 200;
  if (['mission_id', 'station', 'operator'].includes(n)) return 100;
  if (['session_id', 'source_file'].includes(n)) return 280;
  if (['raw_hex', 'wire_hex', 'inner_hex'].includes(n)) return 360;
  if (n.startsWith('mission_facts_')) return 130;
  if (n.startsWith('mission_csp_')) return 100;
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

let _db: Database.Database | null = null;
let _dbWrite: Database.Database | null = null;

function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH, { readonly: true });
  }
  return _db;
}

function getWriteDb(): Database.Database {
  if (!_dbWrite) {
    _dbWrite = new Database(DB_PATH);
  }
  return _dbWrite;
}

/** Invalidate read-only connection so schema/row caches refresh after ingest */
export function resetReadDb(): void {
  _db?.close();
  _db = null;
}

export function loadSchema(): AppSchema {
  const db = getDb();
  const tableRows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];

  const groups: Record<string, TableMeta[]> = {};
  const columns: Record<string, ColumnDef[]> = {};

  for (const { name } of tableRows) {
    const meta = META[name] ?? { label: name, desc: '', primary: 'id', schema: 'misc' };
    const pragma = db.prepare(`PRAGMA table_info("${name}")`).all() as PragmaRow[];
    const { cnt } = db.prepare(`SELECT COUNT(*) as cnt FROM "${name}"`).get() as { cnt: number };

    columns[name] = pragma.map((c) => {
      const type = inferType(c.name, c.type);
      const col: ColumnDef = {
        id: c.name,
        label: c.name,
        type,
        width: widthFor(c.name, type),
        mono: true,
        align: type === 'int' || type === 'float' ? 'right' : 'left',
        pk: c.pk || null,
        fk: (c.name === 'pass_id' && name !== 'passes') ? 'passes'
          : c.name === 'rx_event_id' ? 'event_rx_packet'
          : c.name === 'cmd_event_id' ? 'event_tx_command'
          : null,
      };
      return col;
    });

    if (!groups[meta.schema]) groups[meta.schema] = [];
    groups[meta.schema].push({
      id: name,
      label: meta.label,
      desc: meta.desc,
      primary: meta.primary,
      rows: cnt,
    });
  }

  const order = ['mission', 'events', 'misc'];
  return {
    schemas: order.filter((s) => groups[s]).map((name) => ({ name, tables: groups[name] })),
    columns,
  };
}

export function fetchRows(
  tableId: string,
  opts: { limit?: number; offset?: number; sort?: string; dir?: string } = {},
): Record<string, unknown>[] {
  const db = getDb();
  const { limit = 1000, offset = 0, sort, dir } = opts;

  // Validate table name to prevent SQL injection (only allow alphanumeric + underscore)
  if (!/^\w+$/.test(tableId)) throw new Error('Invalid table name');

  let sql = `SELECT * FROM "${tableId}"`;
  if (sort && /^\w+$/.test(sort)) {
    const direction = dir === 'desc' ? 'DESC' : 'ASC';
    sql += ` ORDER BY "${sort}" ${direction}`;
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
function json(v: unknown): string { return v == null ? '' : JSON.stringify(v); }

function flatMission(m: unknown): Record<string, unknown> {
  if (!m || typeof m !== 'object') return {};
  const mission = m as Record<string, unknown>;
  const facts   = (mission['facts']    ?? {}) as Record<string, unknown>;
  const hdr     = (facts['header']     ?? {}) as Record<string, unknown>;
  const proto   = (facts['protocol']   ?? {}) as Record<string, unknown>;
  const integ   = (facts['integrity']  ?? {}) as Record<string, unknown>;
  const csp     = (proto['csp_header'] ?? {}) as Record<string, unknown>;
  return {
    mission_facts_header_cmd_id:           str(mission['cmd_id']),
    mission_facts_header_src:              str(hdr['src']),
    mission_facts_header_dest:             str(hdr['dest']),
    mission_facts_header_echo:             str(hdr['echo']),
    mission_facts_header_ptype:            str(hdr['ptype']),
    mission_facts_protocol_args_hex:       str(proto['args_hex']),
    mission_facts_protocol_csp_plausible:  bool(proto['csp_plausible']),
    mission_facts_protocol_stripped_header:str(proto['stripped_header']),
    mission_facts_protocol_csp_header_prio:  str(csp['prio']),
    mission_facts_protocol_csp_header_src:   str(csp['src']),
    mission_facts_protocol_csp_header_dest:  str(csp['dest']),
    mission_facts_protocol_csp_header_dport: str(csp['dport']),
    mission_facts_protocol_csp_header_sport: str(csp['sport']),
    mission_facts_protocol_csp_header_flags: str(csp['flags']),
    mission_facts_integrity_overall_ok:    bool(integ['overall_ok']),
    mission_facts_integrity_body_crc_ok:   bool(integ['body_crc_ok']),
    mission_facts_integrity_csp_crc32:     str(integ['csp_crc32']),
    mission_facts_integrity_csp_crc32_ok:  bool(integ['csp_crc32_ok']),
  };
}

export function ingestJsonl(content: string, sourceFile: string): IngestResult {
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

  // Derive pass metadata from events
  const first       = events[0];
  const sessionId   = str(first['session_id']);
  const missionId   = str(first['mission_id']);
  const operator    = str(first['operator']);
  const station     = str(first['station']);
  const schemaVer   = str(first['v']);

  const timestamps  = events.map((e) => num(e['ts_ms'])).filter((t) => t > 0);
  const startMs     = timestamps.length ? Math.min(...timestamps) : 0;
  const endMs       = timestamps.length ? Math.max(...timestamps) : 0;
  const startDate   = startMs ? new Date(startMs).toISOString().slice(0, 10) : '';
  const startTime   = startMs ? new Date(startMs).toISOString().slice(11, 19) : '';

  const counts: Record<string, number> = {};

  const result = db.transaction(() => {
    // Insert pass
    const passStmt = db.prepare(`
      INSERT INTO passes
        (session_id, source_file, pass_date, pass_time,
         start_ts_ms, end_ts_ms, mission_id, operator, station, schema_version)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `);
    const { lastInsertRowid } = passStmt.run(
      sessionId, sourceFile, startDate, startTime,
      startMs, endMs, missionId, operator, station, schemaVer,
    );
    const passId = Number(lastInsertRowid);

    // Prepared statements
    const rxStmt = db.prepare(`
      INSERT INTO event_rx_packet
        (pass_id,event_id,ts_ms,ts_iso,seq,v,
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
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    const txStmt = db.prepare(`
      INSERT INTO event_tx_command
        (pass_id,event_id,ts_ms,ts_iso,seq,v,
         frame_label,inner_hex,inner_len,wire_hex,wire_len,
         mission_facts_header_cmd_id,mission_facts_header_src,mission_facts_header_dest,
         mission_facts_header_echo,mission_facts_header_ptype,
         mission_facts_protocol_args_hex,
         mission_facts_protocol_csp_header_prio,mission_facts_protocol_csp_header_src,
         mission_facts_protocol_csp_header_dest,mission_facts_protocol_csp_header_dport,
         mission_facts_protocol_csp_header_sport,mission_facts_protocol_csp_header_flags)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    const paramStmt = db.prepare(`
      INSERT INTO event_parameter
        (pass_id,event_id,ts_ms,ts_iso,seq,v,rx_event_id,name,value,unit,display_only)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `);

    const alarmStmt = db.prepare(`
      INSERT INTO event_alarm
        (pass_id,event_id,ts_ms,ts_iso,seq,v,
         alarm_id,alarm_source,alarm_label,alarm_detail,
         alarm_severity,alarm_state,alarm_prev_state,alarm_prev_severity,
         alarm_removed,alarm_first_seen_ms,alarm_last_transition_ms,alarm_operator,alarm_context_raw)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    const verStmt = db.prepare(`
      INSERT INTO event_cmd_verifier
        (pass_id,event_id,ts_ms,ts_iso,seq,v,
         cmd_event_id,instance_id,stage,verifier_id,outcome,elapsed_ms,match_event_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    for (const ev of events) {
      const kind = str(ev['event_kind']);
      const base = [passId, str(ev['event_id']), num(ev['ts_ms']), str(ev['ts_iso']), num(ev['seq']), str(ev['v'])];

      try {
        if (kind === 'rx_packet') {
          const mf = flatMission(ev['mission']);
          rxStmt.run(
            ...base,
            str(ev['frame_label']), str(ev['transport_meta']),
            str(ev['inner_hex']), num(ev['inner_len']),
            bool(ev['duplicate']), bool(ev['uplink_echo']), bool(ev['unknown']),
            json(ev['warnings']), str(ev['mission_id'] ?? missionId),
            mf['mission_facts_header_cmd_id'], mf['mission_facts_header_src'],
            mf['mission_facts_header_dest'], mf['mission_facts_header_echo'],
            mf['mission_facts_header_ptype'], mf['mission_facts_protocol_args_hex'],
            mf['mission_facts_protocol_csp_plausible'], mf['mission_facts_protocol_stripped_header'],
            mf['mission_facts_protocol_csp_header_prio'], mf['mission_facts_protocol_csp_header_src'],
            mf['mission_facts_protocol_csp_header_dest'], mf['mission_facts_protocol_csp_header_dport'],
            mf['mission_facts_protocol_csp_header_sport'], mf['mission_facts_protocol_csp_header_flags'],
            mf['mission_facts_integrity_overall_ok'], mf['mission_facts_integrity_body_crc_ok'],
            mf['mission_facts_integrity_csp_crc32'], mf['mission_facts_integrity_csp_crc32_ok'],
            str(ev['frame_label']), str(ev['inner_hex']), num(ev['inner_len']),
            str(ev['wire_hex']), num(ev['wire_len']),
          );
          counts['rx_packet'] = (counts['rx_packet'] ?? 0) + 1;

        } else if (kind === 'tx_command') {
          const m   = (ev['mission'] ?? {}) as Record<string, unknown>;
          const mf  = flatMission(m);
          const csp = ((m['facts'] as Record<string,unknown> | undefined)?.['protocol'] as Record<string,unknown> | undefined)?.['csp_header'] as Record<string,unknown> | undefined ?? {};
          txStmt.run(
            ...base,
            str(ev['frame_label']), str(ev['inner_hex']), num(ev['inner_len']),
            str(ev['wire_hex']), num(ev['wire_len']),
            mf['mission_facts_header_cmd_id'], mf['mission_facts_header_src'],
            mf['mission_facts_header_dest'], mf['mission_facts_header_echo'],
            mf['mission_facts_header_ptype'], mf['mission_facts_protocol_args_hex'],
            str(csp['prio']), str(csp['src']), str(csp['dest']),
            str(csp['dport']), str(csp['sport']), str(csp['flags']),
          );
          counts['tx_command'] = (counts['tx_command'] ?? 0) + 1;

        } else if (kind === 'parameter') {
          paramStmt.run(
            ...base,
            str(ev['rx_event_id']), str(ev['name']),
            String(ev['value'] ?? ''), str(ev['unit']), bool(ev['display_only']),
          );
          counts['parameter'] = (counts['parameter'] ?? 0) + 1;

        } else if (kind === 'alarm') {
          const al = (ev['alarm'] ?? {}) as Record<string, unknown>;
          const ctx = (al['context'] ?? {}) as Record<string, unknown>;
          alarmStmt.run(
            ...base,
            str(al['id']), str(al['source']), str(al['label']), str(al['detail']),
            str(al['severity']), str(al['state']), str(al['prev_state']), str(al['prev_severity']),
            bool(al['removed']), num(al['first_seen_ms']), num(al['last_transition_ms']),
            str(al['operator']), json(ctx['raw']),
          );
          counts['alarm'] = (counts['alarm'] ?? 0) + 1;

        } else if (kind === 'cmd_verifier') {
          verStmt.run(
            ...base,
            str(ev['cmd_event_id']), str(ev['instance_id']), str(ev['stage']),
            str(ev['verifier_id']), str(ev['outcome']), num(ev['elapsed_ms']),
            ev['match_event_id'] == null ? null : str(ev['match_event_id']),
          );
          counts['cmd_verifier'] = (counts['cmd_verifier'] ?? 0) + 1;

        } else {
          skipped++;
        }
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
