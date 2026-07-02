import { useRef, useState, useEffect, useLayoutEffect } from 'react';
import { C } from '../lib/colors';
import type { ColumnDef, Row, SortState } from '../types';
import { Cell, HeaderCell } from './Cell';

interface DataTableProps {
  rows: Row[];
  columns: ColumnDef[];
  selected: Row | null;
  onSelect: (row: Row) => void;
  sort: SortState | null;
  onSort: (colId: string) => void;
  highlightRow?: number;
  loading?: boolean;
}

// Fixed row height (incl. 1px border via box-sizing: border-box) used for
// windowed virtualization — only rows near the viewport are mounted.
const ROW_H = 24;
const OVERSCAN = 16;

export function DataTable({
  rows, columns, selected, onSelect, sort, onSort, highlightRow, loading,
}: DataTableProps) {
  const total = columns.reduce((a, c) => a + c.width, 0) + 60;

  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);
  const [headerH, setHeaderH] = useState(29);

  // Track viewport + header height (mount + resize)
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      setViewportH(el.clientHeight);
      if (headerRef.current) setHeaderH(headerRef.current.offsetHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (headerRef.current) ro.observe(headerRef.current);
    return () => ro.disconnect();
  }, []);

  // Reset scroll to top whenever the dataset changes (new table / sort / filter)
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
    setScrollTop(0);
  }, [rows]);

  const count = rows.length;
  // Window relative to the rows track, which begins below the sticky header.
  const rowsScroll = Math.max(0, scrollTop - headerH);
  const startIdx = Math.max(0, Math.floor(rowsScroll / ROW_H) - OVERSCAN);
  const visibleCount = Math.ceil(viewportH / ROW_H) + OVERSCAN * 2;
  const endIdx = Math.min(count, startIdx + visibleCount);
  const topPad = startIdx * ROW_H;

  const visibleRows = rows.slice(startIdx, endIdx);

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => setScrollTop((e.currentTarget as HTMLDivElement).scrollTop)}
      style={{ overflow: 'auto', flex: 1, minHeight: 0 }}
    >
      <div style={{ minWidth: total }}>
        {/* Sticky header — scrolls horizontally with the content, stays fixed vertically */}
        <div ref={headerRef} style={{
          display: 'flex',
          backgroundColor: C.bgPanel,
          borderBottom: `1px solid ${C.borderStrong}`,
          position: 'sticky',
          top: 0,
          zIndex: 2,
        }}>
          <div style={{
            flex: '0 0 60px',
            fontSize: 10,
            fontFamily: C.fontMono,
            color: C.textDisabled,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            paddingRight: 8,
            borderRight: `1px solid ${C.borderSubtle}`,
          }}>#</div>
          {columns.map((c) => (
            <HeaderCell key={c.id} col={c} sort={sort} onSort={onSort} />
          ))}
        </div>

        {loading && (
          <div style={{ padding: 32, textAlign: 'center', color: C.textMuted, fontSize: 12, fontFamily: C.fontMono }}>
            loading…
          </div>
        )}
        {!loading && count === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: C.textMuted, fontSize: 12, fontFamily: C.fontMono }}>
            0 rows match filter
          </div>
        )}

        {/* Constant-height track: keeps the scroll height stable so the sticky
            header never sees sibling height changes (which caused scroll flicker).
            Visible rows are offset with a transform instead of variable spacers. */}
        {count > 0 && (
          <div style={{ position: 'relative', height: count * ROW_H }}>
            <div style={{ transform: `translateY(${topPad}px)` }}>
              {visibleRows.map((row) => {
                const sel = selected?.__idx === row.__idx;
                const flash = highlightRow === row.__idx;
                return (
                  <div
                    key={row.__idx}
                    onClick={() => onSelect(row)}
                    style={{
                      display: 'flex',
                      height: ROW_H,
                      boxSizing: 'border-box',
                      alignItems: 'center',
                      borderBottom: `1px solid ${C.borderSubtle}`,
                      borderLeft: `2px solid ${sel ? C.active : 'transparent'}`,
                      backgroundColor: sel ? C.bgPanelRaised : flash ? 'rgba(60,201,142,0.06)' : 'transparent',
                      cursor: 'pointer',
                      transition: 'background-color 80ms ease',
                    }}
                    onMouseEnter={(e) => { if (!sel) (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.025)'; }}
                    onMouseLeave={(e) => { if (!sel) (e.currentTarget as HTMLElement).style.backgroundColor = flash ? 'rgba(60,201,142,0.06)' : 'transparent'; }}
                  >
                    <div style={{
                      flex: '0 0 60px',
                      padding: '0 8px',
                      textAlign: 'right',
                      fontFamily: C.fontMono,
                      fontSize: 10.5,
                      color: sel ? C.active : C.textDisabled,
                      borderRight: `1px solid ${C.borderSubtle}`,
                    }}>
                      {(row.__idx + 1).toString().padStart(4, '0')}
                    </div>
                    {columns.map((c) => (
                      <Cell key={c.id} col={c} value={row[c.id]} />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
