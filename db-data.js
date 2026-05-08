// Loads the real ground_station.db schema/data from db-real-data.json
// and exposes window.DB_SCHEMA / DB_COLUMNS / DB_GENERATE so the rest of
// the viewer keeps working unchanged.

window.DB_READY = fetch('db-real-data.json').then(r => r.json()).then(raw => {
  const TABLES = raw.tables;

  // ── Friendly labels + descriptions per real table ──────────────
  const META = {
    passes:              { label: 'passes',              desc: 'Operator log sessions / passes', primary: 'pass_id',  schema: 'mission' },
    event_rx_packet:     { label: 'event_rx_packet',     desc: 'Decoded downlink packets',       primary: 'id',       schema: 'events'  },
    event_tx_command:    { label: 'event_tx_command',    desc: 'Sent uplink commands',           primary: 'id',       schema: 'events'  },
    event_parameter:     { label: 'event_parameter',     desc: 'Parameter snapshots from RX',    primary: 'id',       schema: 'events'  },
    event_alarm:         { label: 'event_alarm',         desc: 'Active + cleared alarms',        primary: 'id',       schema: 'events'  },
    event_cmd_verifier:  { label: 'event_cmd_verifier',  desc: 'TX verifier outcomes',           primary: 'id',       schema: 'events'  },
    event_radio:         { label: 'event_radio',         desc: 'GNU Radio process events',       primary: 'id',       schema: 'events'  },
  };

  // ── Render-type inference ──────────────────────────────────────
  // Map column name + sqlite type → our renderer types: text/int/float/bool/time/tag/frame
  function inferType(col, tableId) {
    const n = col.name.toLowerCase();
    const t = (col.type || '').toUpperCase();
    if (n === 'ts_iso' || n.endsWith('_iso') || n === 'pass_date' || n === 'pass_time' || n === 'value_iso_utc') return 'time';
    if (n.endsWith('_ms') || n === 'value_unix_ms') return 'int';
    if (t === 'INTEGER') return 'int';
    if (n === 'frame_type' || n === 'frame_label') return 'frame';
    if (n === 'alarm_severity' || n === 'alarm_state' || n === 'alarm_prev_state' || n === 'alarm_prev_severity'
        || n === 'outcome' || n === 'stage' || n === 'radio_action' || n === 'radio_state'
        || n === 'mission_facts_header_ptype') return 'tag';
    // boolean-ish stored as TEXT 'True'/'False'
    if (/^(duplicate|uplink_echo|unknown|display_only|alarm_removed|.*_ok|.*_plausible)$/.test(n)) return 'bool';
    if (n === 'size' || n.endsWith('_len')) return 'int';
    return 'text';
  }

  function widthFor(col, type) {
    const n = col.name.toLowerCase();
    if (n === 'event_id' || n === 'rx_event_id' || n === 'cmd_event_id' || n === 'match_event_id' || n === 'instance_id') return 220;
    if (n === 'ts_iso') return 210;
    if (n === 'ts_ms' || n.endsWith('_ms')) return 130;
    if (n === 'id' || n === 'pass_id' || n === 'seq') return 70;
    if (n === 'v') return 60;
    if (n === 'frame_type' || n === 'frame_label') return 130;
    if (n === 'name') return 220;
    if (n === 'value' || n === 'value_display') return 200;
    if (n === 'unit') return 70;
    if (n === 'alarm_label' || n === 'alarm_detail' || n === 'message') return 240;
    if (n === 'alarm_id' || n === 'alarm_source' || n === 'alarm_context_container_id') return 200;
    if (n === 'mission_id' || n === 'station' || n === 'operator') return 100;
    if (n === 'session_id' || n === 'source_file') return 280;
    if (n === 'raw_hex' || n === 'wire_hex' || n === 'inner_hex') return 360;
    if (n.startsWith('mission_facts_')) return 130;
    if (n.startsWith('mission_csp_')) return 100;
    if (n.startsWith('radio_')) return 160;
    if (type === 'int') return 110;
    if (type === 'bool') return 80;
    if (type === 'tag') return 110;
    return 140;
  }

  // ── Build DB_COLUMNS from real schema ──────────────────────────
  const DB_COLUMNS = {};
  for (const [id, t] of Object.entries(TABLES)) {
    DB_COLUMNS[id] = t.columns.map(c => {
      const type = inferType(c, id);
      return {
        id: c.name,
        label: c.name,
        type,
        width: widthFor(c, type),
        mono: true,
        align: type === 'int' || type === 'float' ? 'right' : 'left',
        pk: c.pk,
        fk: c.name === 'pass_id' ? 'passes' : (c.name === 'rx_event_id' ? 'event_rx_packet' : (c.name === 'cmd_event_id' ? 'event_tx_command' : null)),
      };
    });
  }

  // ── Build DB_SCHEMA grouped by logical schema ──────────────────
  const groups = {};
  for (const [id, t] of Object.entries(TABLES)) {
    const m = META[id] || { label: id, schema: 'misc', primary: 'id', desc: '' };
    if (!groups[m.schema]) groups[m.schema] = [];
    groups[m.schema].push({ id, label: m.label, desc: m.desc, primary: m.primary, rows: t.total });
  }
  const order = ['mission','events','misc'];
  const DB_SCHEMA = {
    schemas: order.filter(s => groups[s]).map(name => ({ name, tables: groups[name] })),
  };

  // ── DB_GENERATE returns the actual rows (subset of full table) ─
  function DB_GENERATE(tableId) {
    const t = TABLES[tableId];
    if (!t) return [];
    return t.rows.map((r, i) => ({ ...r, __idx: i }));
  }

  window.DB_SCHEMA = DB_SCHEMA;
  window.DB_COLUMNS = DB_COLUMNS;
  window.DB_GENERATE = DB_GENERATE;
  window.DB_RAW = raw;
  return raw;
});
