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

function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH, { readonly: true });
  }
  return _db;
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
