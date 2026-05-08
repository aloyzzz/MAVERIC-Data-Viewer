import type { Row, SortState } from '../types';

export function applyFilter(rows: Row[], query: string): Row[] {
  if (!query.trim()) return rows;
  const q = query.trim();
  const m = q.match(/^(\w+)\s*(=|!=|>=|<=|>|<|:)\s*(.+)$/);
  if (m) {
    const [, col, op, raw] = m;
    const val = raw.trim().replace(/^['"]|['"]$/g, '');
    return rows.filter((r) => {
      const v = r[col];
      if (v === undefined || v === null) return false;
      if (op === ':') return String(v).toLowerCase().includes(val.toLowerCase());
      if (op === '=' || op === '==') return String(v) === val;
      if (op === '!=') return String(v) !== val;
      const a = parseFloat(String(v)), b = parseFloat(val);
      if (op === '>') return a > b;
      if (op === '<') return a < b;
      if (op === '>=') return a >= b;
      if (op === '<=') return a <= b;
      return false;
    });
  }
  const lc = q.toLowerCase();
  return rows.filter((r) =>
    Object.values(r).some((v) => v != null && String(v).toLowerCase().includes(lc)),
  );
}

export function applySort(rows: Row[], sort: SortState | null): Row[] {
  if (!sort?.col) return rows;
  const out = rows.slice();
  out.sort((a, b) => {
    const av = a[sort.col], bv = b[sort.col];
    if (av == null) return 1;
    if (bv == null) return -1;
    const an = parseFloat(String(av)), bn = parseFloat(String(bv));
    let cmp: number;
    if (!isNaN(an) && !isNaN(bn) && /^-?\d/.test(String(av))) cmp = an - bn;
    else cmp = String(av).localeCompare(String(bv));
    return sort.dir === 'desc' ? -cmp : cmp;
  });
  return out;
}

export function exportCsv(rows: Row[], columns: { id: string }[], filename: string) {
  const header = columns.map((c) => c.id).join(',');
  const body = rows
    .map((r) => columns.map((c) => JSON.stringify(r[c.id] ?? '')).join(','))
    .join('\n');
  const blob = new Blob([header + '\n' + body], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
