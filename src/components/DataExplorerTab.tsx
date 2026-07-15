import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { C } from '../lib/colors';
import type { AppSchema, ColumnDef, Row, SortState } from '../types';
import { applyFilter, applySort, exportCsv } from '../lib/dataUtils';
import { useTableRows } from '../hooks/useApi';
import { msToInput, inputToMs, useTz } from '../lib/timezone';
import { DataTable } from './DataTable';
import { DetailPane } from './DetailPane';
import { FilesTab } from './DecodedFramesTab';

type ExplorerMode = 'decoded' | 'raw' | 'files';
type ExportFormat = 'long' | 'wide';
type DatePreset = 'all' | '24h' | '7d' | '30d' | 'custom';

interface ValuesSummary {
  totalRows: number;
  numericRows: number;
  parameters: number;
  minTs: number | null;
  maxTs: number | null;
  domains: { domain: string; count: number }[];
  commands: { cmd_id: string; count: number }[];
  fields: { cmd_id: string; field_path: string; count: number }[];
}

const decodedColumns: ColumnDef[] = [
  { id: 'ts_iso', label: 'time', type: 'time', width: 190, mono: true, align: 'left', pk: null, fk: null },
  { id: 'pass_id', label: 'pass', type: 'int', width: 70, mono: true, align: 'right', pk: null, fk: null },
  { id: 'cmd_id', label: 'source', type: 'text', width: 150, mono: true, align: 'left', pk: null, fk: null },
  { id: 'ptype', label: 'type', type: 'tag', width: 70, mono: true, align: 'left', pk: null, fk: null },
  { id: 'domain', label: 'category', type: 'tag', width: 100, mono: true, align: 'left', pk: null, fk: null },
  { id: 'field_path', label: 'parameter', type: 'text', width: 180, mono: true, align: 'left', pk: null, fk: null },
  { id: 'value_text', label: 'value', type: 'text', width: 180, mono: true, align: 'left', pk: null, fk: null },
  { id: 'value_numeric', label: 'numeric', type: 'float', width: 120, mono: true, align: 'right', pk: null, fk: null },
  { id: 'unit', label: 'unit', type: 'text', width: 80, mono: true, align: 'left', pk: null, fk: null },
];

const decodedInspectorTable = {
  id: 'satellite_values',
  label: 'Decoded Values',
  desc: 'canonical extracted satellite values',
  primary: 'ts_ms',
  rows: 0,
};

const inputStyle: CSSProperties = {
  minWidth: 120,
  padding: '4px 7px',
  fontFamily: C.fontMono,
  fontSize: 10.5,
  color: C.textPrimary,
  backgroundColor: C.bgApp,
  border: `1px solid ${C.borderSubtle}`,
  borderRadius: 3,
  outline: 'none',
};

const PRESET_MS: Record<Exclude<DatePreset, 'all' | 'custom'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

function isPassTable(id: string) {
  return /^pass_\d+$/.test(id);
}

function pickDefaultRawTable(schema: AppSchema): string {
  const nonPass = schema.schemas.flatMap(s => s.tables).find(t => !isPassTable(t.id));
  return nonPass?.id ?? schema.schemas.flatMap(s => s.tables)[0]?.id ?? '';
}

function buildDecodedQuery({
  passIds,
  passFrom,
  passTo,
  fromMs,
  toMs,
  domain,
  cmd,
  parameter,
  fields,
  numericOnly,
  limit,
}: {
  passIds: number[];
  passFrom: string;
  passTo: string;
  fromMs: number | null;
  toMs: number | null;
  domain: string;
  cmd: string;
  parameter: string;
  fields: string[];
  numericOnly: boolean;
  limit: number;
}) {
  const params = new URLSearchParams();
  const fromId = Number(passFrom.trim());
  const toId = Number(passTo.trim());
  const scopedPassIds = passIds.filter(id =>
    (!Number.isFinite(fromId) || !passFrom.trim() || id >= fromId) &&
    (!Number.isFinite(toId) || !passTo.trim() || id <= toId),
  );
  if (scopedPassIds.length > 0) {
    params.set('passIds', scopedPassIds.join(','));
  } else if (passFrom.trim() || passTo.trim()) {
    params.set('passIds', String((passIds.at(-1) ?? 0) + 1_000_000));
  }
  if (fromMs != null) params.set('from', String(fromMs));
  if (toMs != null) params.set('to', String(toMs));
  if (domain.trim()) params.set('domain', domain.trim());
  if (cmd.trim()) params.set('cmd', cmd.trim());
  if (parameter.trim()) params.set('parameter', parameter.trim());
  for (const f of fields) {
    if (f.trim()) params.append('fields', f.trim());
  }
  if (numericOnly) params.set('numericOnly', '1');
  params.set('limit', String(limit));
  return params;
}

function ToolbarButton({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 10px',
        fontSize: 11,
        fontFamily: C.fontMono,
        color: active ? C.active : C.textMuted,
        backgroundColor: active ? C.activeFill : C.bgPanelRaised,
        border: `1px solid ${active ? `${C.active}55` : C.borderSubtle}`,
        borderRadius: 3,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5 }}>
      <span style={{ color: C.textDisabled, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      <span style={{ color: C.textPrimary, fontSize: 11.5 }}>{value}</span>
    </span>
  );
}

function RailSection({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 9.5, fontFamily: C.fontMono, color: C.textDisabled, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          {label}
        </span>
        {hint && <span style={{ fontSize: 9.5, fontFamily: C.fontMono, color: C.textDisabled }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function FacetChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={`${label} (${count.toLocaleString()})`}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        width: '100%',
        padding: '4px 8px',
        fontFamily: C.fontMono,
        fontSize: 10.5,
        textAlign: 'left',
        color: active ? C.active : C.textSecondary,
        backgroundColor: active ? C.activeFill : C.bgApp,
        border: `1px solid ${active ? `${C.active}55` : C.borderSubtle}`,
        borderRadius: 3,
        cursor: 'pointer',
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label || '(none)'}</span>
      <span style={{ color: active ? C.active : C.textDisabled, flexShrink: 0 }}>{count.toLocaleString()}</span>
    </button>
  );
}

export function DataExplorerTab({ schema, onSchemaRefresh }: { schema: AppSchema; onSchemaRefresh?: () => void }) {
  const { tz } = useTz();
  const allTables = useMemo(() => schema.schemas.flatMap(s => s.tables), [schema]);
  const passIds = useMemo(() => schema.schemas
    .flatMap(s => s.tables)
    .map(t => /^pass_(\d+)$/.exec(t.id)?.[1])
    .filter((id): id is string => Boolean(id))
    .map(Number)
    .sort((a, b) => a - b), [schema]);
  const visibleRawTables = useMemo(() => allTables.filter(t => !isPassTable(t.id)), [allTables]);
  const passTables = useMemo(
    () => allTables
      .filter(t => isPassTable(t.id))
      .sort((a, b) => Number(/^pass_(\d+)$/.exec(a.id)?.[1]) - Number(/^pass_(\d+)$/.exec(b.id)?.[1])),
    [allTables],
  );
  const [mode, setMode] = useState<ExplorerMode>('decoded');
  const [filesPassId, setFilesPassId] = useState(() => passTables[0]?.id ?? '');
  const [rawTableId, setRawTableId] = useState(() => pickDefaultRawTable(schema));
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState>({ col: 'ts_ms', dir: 'desc' });
  const [selected, setSelected] = useState<Row | null>(null);
  const [limit, setLimit] = useState(5000);
  const [railOpen, setRailOpen] = useState(true);
  const [passFrom, setPassFrom] = useState('');
  const [passTo, setPassTo] = useState('');
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');
  const [domain, setDomain] = useState('');
  const [cmd, setCmd] = useState('');
  const [parameter, setParameter] = useState('');
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [numericOnly, setNumericOnly] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('long');
  const [decodedRows, setDecodedRows] = useState<Row[]>([]);
  const [decodedLoading, setDecodedLoading] = useState(false);
  const [decodedSummary, setDecodedSummary] = useState<ValuesSummary | null>(null);
  const [facets, setFacets] = useState<ValuesSummary | null>(null);

  const rawColumns = schema.columns[rawTableId] ?? [];
  const rawTable = allTables.find(t => t.id === rawTableId) ?? visibleRawTables[0] ?? allTables[0];
  const { rows: rawRows, loading: rawLoading } = useTableRows(mode === 'raw' ? rawTableId : null, limit);

  const fromMs = timeFrom ? inputToMs(timeFrom, tz) : null;
  const toMs = timeTo ? inputToMs(timeTo, tz) : null;

  // Parameter types grouped under each source command, for the expandable rail.
  const fieldsByCmd = useMemo(() => {
    const map = new Map<string, { field_path: string; count: number }[]>();
    for (const f of facets?.fields ?? []) {
      const list = map.get(f.cmd_id) ?? [];
      list.push({ field_path: f.field_path, count: f.count });
      map.set(f.cmd_id, list);
    }
    return map;
  }, [facets]);

  const decodedQuery = useMemo(() => buildDecodedQuery({
    passIds,
    passFrom,
    passTo,
    fromMs,
    toMs,
    domain,
    // When specific parameters are picked, they already imply their command(s),
    // so skip the single-command filter to allow cross-command selections.
    cmd: selectedFields.length > 0 ? '' : cmd,
    parameter,
    fields: selectedFields,
    numericOnly,
    limit,
  }), [passIds, passFrom, passTo, fromMs, toMs, domain, cmd, parameter, selectedFields, numericOnly, limit]);

  // Facets reflect the pass scope only (not category/date/parameter), so the
  // category and source lists stay stable while drilling down.
  const facetQuery = useMemo(() => buildDecodedQuery({
    passIds,
    passFrom,
    passTo,
    fromMs: null,
    toMs: null,
    domain: '',
    cmd: '',
    parameter: '',
    fields: [],
    numericOnly: false,
    limit,
  }), [passIds, passFrom, passTo, limit]);

  useEffect(() => {
    setSelected(null);
  }, [mode, rawTableId]);

  // Keep the files pass selection valid as the schema loads or changes.
  useEffect(() => {
    if (passTables.length === 0) return;
    if (!passTables.some(t => t.id === filesPassId)) setFilesPassId(passTables[0].id);
  }, [passTables, filesPassId]);

  useEffect(() => {
    if (mode !== 'decoded') return;
    const controller = new AbortController();
    fetch(`/api/values/summary?${facetQuery.toString()}`, { signal: controller.signal })
      .then(r => r.json() as Promise<ValuesSummary>)
      .then(setFacets)
      .catch(() => {});
    return () => controller.abort();
  }, [mode, facetQuery]);

  useEffect(() => {
    if (mode !== 'decoded') return;
    const controller = new AbortController();
    setDecodedLoading(true);
    Promise.all([
      fetch(`/api/values/summary?${decodedQuery.toString()}`, { signal: controller.signal })
        .then(r => r.json() as Promise<ValuesSummary>),
      fetch(`/api/values?${decodedQuery.toString()}`, { signal: controller.signal })
        .then(r => r.json() as Promise<Record<string, unknown>[]>),
    ]).then(([summary, rows]) => {
      setDecodedSummary(summary);
      setDecodedRows(rows.map((r, i) => ({ ...r, __idx: i })));
      setDecodedLoading(false);
    }).catch(() => {
      if (!controller.signal.aborted) setDecodedLoading(false);
    });
    return () => controller.abort();
  }, [mode, decodedQuery]);

  const applyPreset = (preset: DatePreset) => {
    setDatePreset(preset);
    if (preset === 'all') {
      setTimeFrom('');
      setTimeTo('');
      return;
    }
    if (preset === 'custom') return;
    const anchor = facets?.maxTs ?? Date.now();
    setTimeFrom(msToInput(anchor - PRESET_MS[preset], tz));
    setTimeTo(msToInput(anchor, tz));
  };

  const onCustomDate = (which: 'from' | 'to', value: string) => {
    setDatePreset('custom');
    if (which === 'from') setTimeFrom(value);
    else setTimeTo(value);
  };

  const activeColumns = mode === 'decoded' ? decodedColumns : rawColumns;
  const activeRows = mode === 'decoded' ? decodedRows : rawRows;
  const activeTable = mode === 'decoded' ? decodedInspectorTable : rawTable;
  const loading = mode === 'decoded' ? decodedLoading : rawLoading;
  const scopedRows = useMemo(() => {
    if (mode === 'decoded') return activeRows;
    let rows = activeRows;
    const fromId = Number(passFrom.trim());
    const toId = Number(passTo.trim());
    if (passFrom.trim() && Number.isFinite(fromId)) rows = rows.filter(r => Number(r.pass_id) >= fromId);
    if (passTo.trim() && Number.isFinite(toId)) rows = rows.filter(r => Number(r.pass_id) <= toId);
    if (fromMs != null) rows = rows.filter(r => Number(r.ts_ms) >= fromMs);
    if (toMs != null) rows = rows.filter(r => Number(r.ts_ms) <= toMs);
    return rows;
  }, [mode, activeRows, passFrom, passTo, fromMs, toMs]);
  const filteredRows = useMemo(() => applyFilter(scopedRows, query), [scopedRows, query]);
  const sortedRows = useMemo(() => applySort(filteredRows, sort), [filteredRows, sort]);
  const totalRows = mode === 'decoded' ? (decodedSummary?.totalRows ?? decodedRows.length) : rawTable?.rows ?? rawRows.length;
  const activeFilterCount =
    (passFrom ? 1 : 0) + (passTo ? 1 : 0) + (timeFrom || timeTo ? 1 : 0) +
    (domain ? 1 : 0) + (cmd ? 1 : 0) + (parameter ? 1 : 0) + selectedFields.length + (numericOnly ? 1 : 0);

  useEffect(() => {
    const preferred = activeColumns.some(c => c.id === sort.col) ? sort.col : activeColumns[0]?.id;
    if (!preferred) return;
    if (preferred !== sort.col) setSort({ col: preferred, dir: preferred === 'ts_ms' || preferred === 'ts_iso' ? 'desc' : 'asc' });
  }, [activeColumns, sort.col]);

  const exportCurrent = () => {
    if (mode === 'decoded') {
      const params = new URLSearchParams(decodedQuery);
      params.set('format', exportFormat);
      window.location.href = `/api/values/export?${params.toString()}`;
      return;
    }
    exportCsv(sortedRows, activeColumns, `${rawTableId}_filtered.csv`);
  };

  const resetFilters = () => {
    setQuery('');
    setPassFrom('');
    setPassTo('');
    setDatePreset('all');
    setTimeFrom('');
    setTimeTo('');
    setDomain('');
    setCmd('');
    setParameter('');
    setSelectedFields([]);
    setNumericOnly(false);
  };

  const onSort = (colId: string) => {
    setSort(sort.col === colId ? { col: colId, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { col: colId, dir: 'asc' });
  };

  const showRail = mode === 'decoded' && railOpen;

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 12 }}>
      <div style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: C.bgPanel,
        border: `1px solid ${C.borderSubtle}`,
        borderRadius: 4,
        overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: `1px solid ${C.borderStrong}`,
          backgroundColor: C.bgPanel,
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 9.5, fontFamily: C.fontMono, color: C.textDisabled, textTransform: 'uppercase', letterSpacing: '0.1em', marginRight: 2 }}>
            data explorer
          </span>
          <ToolbarButton active={mode === 'decoded'} onClick={() => setMode('decoded')}>decoded values</ToolbarButton>
          <ToolbarButton active={mode === 'raw'} onClick={() => setMode('raw')}>raw tables</ToolbarButton>
          <ToolbarButton active={mode === 'files'} onClick={() => setMode('files')}>files</ToolbarButton>
          {mode === 'raw' && (
            <select
              value={rawTableId}
              onChange={e => setRawTableId(e.target.value)}
              style={{ ...inputStyle, minWidth: 220 }}
            >
              {schema.schemas.map(group => (
                <optgroup key={group.name} label={group.name}>
                  {group.tables.filter(t => !isPassTable(t.id)).map(t => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
          {mode === 'files' && (
            <select
              value={filesPassId}
              onChange={e => setFilesPassId(e.target.value)}
              style={{ ...inputStyle, minWidth: 220 }}
            >
              {passTables.length === 0 && <option value="">no passes</option>}
              {passTables.map(t => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          )}
          <div style={{ flex: 1 }} />
          {mode === 'decoded' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {(['long', 'wide'] as const).map(fmt => (
                <ToolbarButton key={fmt} active={exportFormat === fmt} onClick={() => setExportFormat(fmt)}>{fmt}</ToolbarButton>
              ))}
            </div>
          )}
          {mode !== 'files' && (
          <button
            onClick={exportCurrent}
            disabled={loading || sortedRows.length === 0}
            style={{
              padding: '5px 14px',
              fontFamily: C.fontMono,
              fontSize: 11,
              fontWeight: 700,
              color: loading || sortedRows.length === 0 ? C.textDisabled : C.bgApp,
              backgroundColor: loading || sortedRows.length === 0 ? C.bgPanelRaised : C.active,
              border: 'none',
              borderRadius: 3,
              cursor: loading || sortedRows.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            export CSV
          </button>
          )}
        </div>

        {mode !== 'files' && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 12px',
          borderBottom: `1px solid ${C.borderSubtle}`,
          backgroundColor: C.bgApp,
          flexShrink: 0,
          flexWrap: 'wrap',
        }}>
          {mode === 'decoded' && (
            <button onClick={() => setRailOpen(v => !v)} style={{
              ...inputStyle,
              width: 'auto',
              minWidth: 0,
              cursor: 'pointer',
              color: railOpen ? C.active : C.textMuted,
              backgroundColor: railOpen ? C.activeFill : C.bgPanelRaised,
            }}>
              {railOpen ? '◀ filters' : 'filters ▶'}{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}
            </button>
          )}
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={mode === 'decoded' ? 'search values, parameters, sources...' : 'search current raw table...'}
            style={{ ...inputStyle, flex: '1 1 280px' }}
          />
          {mode === 'raw' && (
            <>
              <input value={passFrom} onChange={e => setPassFrom(e.target.value)} placeholder="from pass" style={{ ...inputStyle, width: 100, minWidth: 100 }} />
              <input value={passTo} onChange={e => setPassTo(e.target.value)} placeholder="to pass" style={{ ...inputStyle, width: 100, minWidth: 100 }} />
            </>
          )}
          <select value={limit} onChange={e => setLimit(Number(e.target.value))} style={{ ...inputStyle, width: 110, minWidth: 110 }}>
            {[1000, 5000, 10000, 25000, 50000].map(n => <option key={n} value={n}>{n.toLocaleString()}</option>)}
          </select>
          <button onClick={resetFilters} style={{ ...inputStyle, width: 'auto', minWidth: 0, cursor: 'pointer', color: C.textMuted }}>
            reset
          </button>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14, fontFamily: C.fontMono }}>
            <Stat label="showing" value={sortedRows.length.toLocaleString()} />
            <Stat label="matched" value={totalRows.toLocaleString()} />
            {mode === 'decoded' && <Stat label="numeric" value={(decodedSummary?.numericRows ?? 0).toLocaleString()} />}
            {mode === 'decoded' && <Stat label="params" value={(decodedSummary?.parameters ?? 0).toLocaleString()} />}
          </div>
        </div>
        )}

        {mode === 'files' ? (
          <FilesTab tableId={filesPassId} />
        ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {showRail && (
            <div style={{
              width: 232,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              padding: '12px 12px 16px',
              borderRight: `1px solid ${C.borderSubtle}`,
              backgroundColor: C.bgPanel,
              overflowY: 'auto',
            }}>
              <RailSection label="date range">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
                  {(['all', '24h', '7d', '30d'] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => applyPreset(p)}
                      style={{
                        padding: '4px 0',
                        fontFamily: C.fontMono,
                        fontSize: 10,
                        color: datePreset === p ? C.active : C.textMuted,
                        backgroundColor: datePreset === p ? C.activeFill : C.bgApp,
                        border: `1px solid ${datePreset === p ? `${C.active}55` : C.borderSubtle}`,
                        borderRadius: 3,
                        cursor: 'pointer',
                      }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <label style={{ fontSize: 9, fontFamily: C.fontMono, color: C.textDisabled }}>from</label>
                <input type="datetime-local" value={timeFrom} onChange={e => onCustomDate('from', e.target.value)} style={{ ...inputStyle, minWidth: 0, width: '100%' }} />
                <label style={{ fontSize: 9, fontFamily: C.fontMono, color: C.textDisabled }}>to</label>
                <input type="datetime-local" value={timeTo} onChange={e => onCustomDate('to', e.target.value)} style={{ ...inputStyle, minWidth: 0, width: '100%' }} />
              </RailSection>

              <RailSection label="category" hint={domain ? 'clear' : `${facets?.domains.length ?? 0}`}>
                {domain && (
                  <button onClick={() => setDomain('')} style={{ ...inputStyle, minWidth: 0, width: '100%', cursor: 'pointer', color: C.textMuted, textAlign: 'center' }}>
                    all categories
                  </button>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {(facets?.domains ?? []).map(d => (
                    <FacetChip
                      key={d.domain}
                      label={d.domain}
                      count={d.count}
                      active={domain === d.domain}
                      onClick={() => setDomain(domain === d.domain ? '' : d.domain)}
                    />
                  ))}
                  {(!facets || facets.domains.length === 0) && (
                    <span style={{ fontSize: 10, fontFamily: C.fontMono, color: C.textDisabled }}>no categories</span>
                  )}
                </div>
              </RailSection>

              <RailSection label="source command" hint={cmd || selectedFields.length ? 'clear' : `${facets?.commands.length ?? 0}`}>
                {(cmd || selectedFields.length > 0) && (
                  <button onClick={() => { setCmd(''); setSelectedFields([]); }} style={{ ...inputStyle, minWidth: 0, width: '100%', cursor: 'pointer', color: C.textMuted, textAlign: 'center' }}>
                    clear sources{selectedFields.length > 0 ? ` (${selectedFields.length} params)` : ''}
                  </button>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflowY: 'auto' }}>
                  {(facets?.commands ?? []).slice(0, 60).map(c => {
                    const expanded = cmd === c.cmd_id;
                    const params = fieldsByCmd.get(c.cmd_id) ?? [];
                    const selectedHere = params.filter(p => selectedFields.includes(p.field_path)).length;
                    return (
                      <div key={c.cmd_id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <FacetChip
                          label={`${expanded ? '▾ ' : '▸ '}${c.cmd_id}${selectedHere > 0 ? ` · ${selectedHere}` : ''}`}
                          count={c.count}
                          active={expanded || selectedHere > 0}
                          onClick={() => setCmd(expanded ? '' : c.cmd_id)}
                        />
                        {expanded && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 10, borderLeft: `1px solid ${C.borderSubtle}`, marginLeft: 4 }}>
                            {params.length > 1 && (
                              <button
                                onClick={() => {
                                  const all = params.map(p => p.field_path);
                                  const everySelected = all.every(f => selectedFields.includes(f));
                                  setSelectedFields(prev => everySelected
                                    ? prev.filter(f => !all.includes(f))
                                    : [...new Set([...prev, ...all])]);
                                }}
                                style={{ ...inputStyle, minWidth: 0, width: '100%', cursor: 'pointer', color: C.textMuted, fontSize: 9.5, padding: '3px 7px', textAlign: 'left' }}
                              >
                                {params.every(p => selectedFields.includes(p.field_path)) ? 'deselect all' : 'select all'}
                              </button>
                            )}
                            {params.length === 0 && (
                              <span style={{ fontSize: 9.5, fontFamily: C.fontMono, color: C.textDisabled }}>no parameters</span>
                            )}
                            {params.map(p => (
                              <FacetChip
                                key={p.field_path}
                                label={p.field_path}
                                count={p.count}
                                active={selectedFields.includes(p.field_path)}
                                onClick={() => setSelectedFields(prev => prev.includes(p.field_path)
                                  ? prev.filter(f => f !== p.field_path)
                                  : [...prev, p.field_path])}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </RailSection>

              <RailSection label="refine">
                <input value={parameter} onChange={e => setParameter(e.target.value)} placeholder="parameter name" style={{ ...inputStyle, minWidth: 0, width: '100%' }} />
                <div style={{ display: 'flex', gap: 4 }}>
                  <input value={passFrom} onChange={e => setPassFrom(e.target.value)} placeholder="from pass" style={{ ...inputStyle, minWidth: 0, width: '100%' }} />
                  <input value={passTo} onChange={e => setPassTo(e.target.value)} placeholder="to pass" style={{ ...inputStyle, minWidth: 0, width: '100%' }} />
                </div>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  fontFamily: C.fontMono,
                  fontSize: 10.5,
                  color: C.textMuted,
                  padding: '5px 7px',
                  backgroundColor: C.bgApp,
                  border: `1px solid ${C.borderSubtle}`,
                  borderRadius: 3,
                  cursor: 'pointer',
                }}>
                  <input type="checkbox" checked={numericOnly} onChange={e => setNumericOnly(e.target.checked)} style={{ accentColor: C.active }} />
                  numeric values only
                </label>
              </RailSection>
            </div>
          )}

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <DataTable
              rows={sortedRows}
              columns={activeColumns}
              selected={selected}
              onSelect={row => setSelected(selected?.__idx === row.__idx ? null : row)}
              sort={sort}
              onSort={onSort}
              loading={loading}
            />
            <div style={{
              padding: '4px 12px',
              borderTop: `1px solid ${C.borderSubtle}`,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontFamily: C.fontMono,
              fontSize: 10.5,
              color: C.textMuted,
              backgroundColor: C.bgApp,
              flexShrink: 0,
            }}>
              <span>{mode === 'decoded' ? 'satellite_values' : rawTable?.label}</span>
              {query && <span style={{ color: C.active }}>search {query}</span>}
              {domain && <span style={{ color: C.active }}>category {domain}</span>}
              {selectedFields.length > 0 && <span style={{ color: C.active }}>{selectedFields.length} params</span>}
              {(timeFrom || timeTo) && <span style={{ color: C.active }}>dated</span>}
              {sort.col && <span>order by {sort.col} {sort.dir}</span>}
              <span style={{ marginLeft: 'auto' }}>{loading ? 'loading...' : `${sortedRows.length.toLocaleString()} rows visible`}</span>
            </div>
          </div>
          <DetailPane
            row={selected}
            columns={activeColumns}
            table={activeTable}
            onClose={() => setSelected(null)}
            onPassDeleted={onSchemaRefresh}
            position="right"
          />
        </div>
        )}
      </div>
    </div>
  );
}
