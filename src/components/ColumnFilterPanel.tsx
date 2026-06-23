import { C } from '../lib/colors';
import type { ColumnDef } from '../types';

interface ColumnFilterPanelProps {
  columns: ColumnDef[];
  hiddenColumns: Set<string>;
  setHiddenColumns: (h: Set<string>) => void;
}

const TYPE_COLORS: Record<string, string> = {
  time:  '#7aa8e0',
  int:   '#c9a96e',
  float: '#c9a96e',
  bool:  '#9ecf8c',
  tag:   '#b48ead',
  frame: '#7dbcb0',
  text:  '#8a8a8a',
};

function getGroup(colId: string): string {
  if (['id', 'event_kind', 'event_id', 'ts_ms', 'ts_iso', 'seq', 'v'].includes(colId)) return 'Core';
  if (colId.startsWith('mission_facts_header_')) return 'Mission: Header';
  if (colId.startsWith('mission_facts_protocol_')) return 'Mission: Protocol';
  if (colId.startsWith('mission_facts_integrity_')) return 'Mission: Integrity';
  if (colId.startsWith('alarm_')) return 'Alarm';
  if (colId.startsWith('radio_')) return 'Radio';
  if (
    colId.startsWith('frame_') ||
    ['raw_hex', 'inner_hex', 'inner_len', 'wire_hex', 'wire_len', 'transport_meta', 'size'].includes(colId)
  ) return 'Frame';
  if (['rx_event_id', 'name', 'value', 'unit', 'display_only'].includes(colId)) return 'Parameter';
  if (['cmd_event_id', 'instance_id', 'stage', 'verifier_id', 'outcome', 'elapsed_ms', 'match_event_id'].includes(colId)) return 'Cmd Verifier';
  if (['pass_id', 'session_id', 'source_file', 'pass_date', 'pass_time', 'start_ts_ms', 'end_ts_ms', 'mission_id', 'operator', 'station', 'schema_version'].includes(colId)) return 'Pass';
  if (colId.startsWith('pass_')) return 'Pass';
  return 'Other';
}

const GROUP_ORDER = ['Core', 'Frame', 'Mission: Header', 'Mission: Protocol', 'Mission: Integrity', 'Parameter', 'Alarm', 'Cmd Verifier', 'Radio', 'Pass', 'Other'];

export function ColumnFilterPanel({ columns, hiddenColumns, setHiddenColumns }: ColumnFilterPanelProps) {
  const groups = new Map<string, ColumnDef[]>();
  for (const col of columns) {
    const g = getGroup(col.id);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(col);
  }

  const orderedGroups = GROUP_ORDER.filter((g) => groups.has(g));

  const toggleCol = (colId: string) => {
    const next = new Set(hiddenColumns);
    if (next.has(colId)) next.delete(colId);
    else next.add(colId);
    setHiddenColumns(next);
  };

  const toggleGroup = (cols: ColumnDef[], allVisible: boolean) => {
    const next = new Set(hiddenColumns);
    if (allVisible) {
      cols.forEach((c) => next.add(c.id));
    } else {
      cols.forEach((c) => next.delete(c.id));
    }
    setHiddenColumns(next);
  };

  const allVisible = hiddenColumns.size === 0;
  const toggleAll = () => {
    if (allVisible) setHiddenColumns(new Set(columns.map((c) => c.id)));
    else setHiddenColumns(new Set());
  };

  const visibleCount = columns.length - hiddenColumns.size;

  return (
    <div style={{
      flex: 1, overflow: 'auto', minHeight: 0,
      padding: '12px 16px',
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      {/* Global header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        paddingBottom: 10,
        borderBottom: `1px solid ${C.borderSubtle}`,
      }}>
        <span style={{ fontSize: 11, fontFamily: C.fontMono, color: C.textMuted }}>
          showing <span style={{ color: C.textPrimary }}>{visibleCount}</span> of {columns.length} columns
        </span>
        <button
          onClick={toggleAll}
          style={{
            marginLeft: 'auto',
            background: 'transparent',
            border: `1px solid ${C.borderSubtle}`,
            color: C.textMuted,
            padding: '2px 8px',
            borderRadius: 3,
            fontSize: 10.5,
            fontFamily: C.fontMono,
            cursor: 'pointer',
          }}
        >
          {allVisible ? 'hide all' : 'show all'}
        </button>
      </div>

      {/* Groups */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        {orderedGroups.map((groupName) => {
          const cols = groups.get(groupName)!;
          const groupHidden = cols.filter((c) => hiddenColumns.has(c.id));
          const allGroupVisible = groupHidden.length === 0;
          const someGroupVisible = groupHidden.length < cols.length;

          return (
            <div
              key={groupName}
              style={{
                border: `1px solid ${C.borderSubtle}`,
                borderRadius: 4,
                backgroundColor: C.bgPanelRaised,
                minWidth: 180,
                flex: '0 1 220px',
                overflow: 'hidden',
              }}
            >
              {/* Group header */}
              <div style={{
                display: 'flex', alignItems: 'center',
                padding: '6px 10px',
                borderBottom: `1px solid ${C.borderSubtle}`,
                backgroundColor: C.bgPanel,
                gap: 8,
              }}>
                <input
                  type="checkbox"
                  checked={allGroupVisible}
                  ref={(el) => { if (el) el.indeterminate = !allGroupVisible && someGroupVisible; }}
                  onChange={() => toggleGroup(cols, allGroupVisible)}
                  style={{ cursor: 'pointer', accentColor: C.active, margin: 0 }}
                />
                <span style={{ fontSize: 10.5, fontFamily: C.fontMono, color: C.textPrimary, fontWeight: 600, flex: 1 }}>
                  {groupName}
                </span>
                <span style={{ fontSize: 9.5, color: C.textDisabled, fontFamily: C.fontMono }}>
                  {cols.length - groupHidden.length}/{cols.length}
                </span>
              </div>

              {/* Column rows */}
              <div style={{ padding: '4px 0' }}>
                {cols.map((col) => {
                  const visible = !hiddenColumns.has(col.id);
                  return (
                    <label
                      key={col.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '3px 10px',
                        cursor: 'pointer',
                        opacity: visible ? 1 : 0.45,
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.04)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                    >
                      <input
                        type="checkbox"
                        checked={visible}
                        onChange={() => toggleCol(col.id)}
                        style={{ cursor: 'pointer', accentColor: C.active, margin: 0, flexShrink: 0 }}
                      />
                      <span style={{
                        fontSize: 11, fontFamily: C.fontMono,
                        color: visible ? C.textPrimary : C.textMuted,
                        flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {col.label}
                      </span>
                      <span style={{
                        fontSize: 9, fontFamily: C.fontMono,
                        color: TYPE_COLORS[col.type] ?? C.textDisabled,
                        flexShrink: 0,
                      }}>
                        {col.type}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
