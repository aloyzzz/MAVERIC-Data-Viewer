# MAVERIC GSS — Database Viewer

A web-based telemetry and mission archive browser for the MAVERIC ground station database. Queries a local SQLite file directly via a Node.js API server, with a React frontend that mirrors the existing console design language.

---

## Quick start

```bash
npm install
npm run dev
```

Opens on `http://localhost:5173`. Both servers start together:

| Process | Port | Role |
|---------|------|------|
| Vite dev server | 5173 | Serves the React frontend |
| Express API server | 3001 | Queries `ground_station.db` |

Vite proxies all `/api` requests to the Express server, so the frontend only ever talks to one origin.

---

## Architecture

```
ground_station.db  (SQLite, 880 KB, readonly)
        │
        ▼
server/
  db.ts        Opens the DB, infers column types, serves rows
  routes.ts    GET /api/schema · GET /api/tables/:tableId
  index.ts     Express app on :3001
        │
        │  JSON over HTTP
        ▼
src/
  hooks/useApi.ts        fetch wrappers; caches table rows in memory
  layouts/VariationA.tsx Sidebar + Grid + Right detail panel
  layouts/VariationB.tsx Tab strip + Grid + Bottom detail panel
  components/            All UI primitives (Cell, DataTable, FilterBar…)
  lib/
    colors.ts    GSS design token constants
    dataUtils.ts Client-side filter, sort, and CSV export
  types.ts       Shared TypeScript interfaces
```

---

## API

### `GET /api/schema`

Returns the full database schema in one shot — table metadata and column definitions for every table. This is fetched once on load and cached client-side.

```jsonc
{
  "schemas": [
    {
      "name": "mission",
      "tables": [
        { "id": "passes", "label": "passes", "desc": "Operator log sessions / passes", "primary": "pass_id", "rows": 1 }
      ]
    },
    {
      "name": "events",
      "tables": [ /* event_rx_packet, event_tx_command, event_parameter, … */ ]
    }
  ],
  "columns": {
    "passes": [
      { "id": "pass_id", "type": "int", "width": 70, "align": "right", "pk": 1, "fk": null },
      { "id": "session_id", "type": "text", "width": 280, "align": "left", "pk": null, "fk": null }
      // …
    ]
    // one entry per table
  }
}
```

### `GET /api/tables/:tableId`

Returns rows for a table. Accepts optional query parameters:

| Param | Default | Description |
|-------|---------|-------------|
| `limit` | 1000 | Max rows to return |
| `offset` | 0 | Row offset for pagination |
| `sort` | — | Column name to sort by |
| `dir` | `asc` | Sort direction: `asc` or `desc` |

Rows are plain objects matching the SQLite column names. No transformation is applied server-side — types come back as SQLite stores them (integers as numbers, TEXT as strings).

---

## Database schema

The SQLite file contains 7 tables from a single MAVERIC ground station pass (April 29 2026, ~57 minutes, operator: irfan, station: GS-1).

| Table | Rows | Description |
|-------|------|-------------|
| `passes` | 1 | Top-level session record |
| `event_rx_packet` | 220 | Decoded downlink packets (ASM+GOLAY / AX.25) |
| `event_tx_command` | 46 | Uplink commands sent |
| `event_parameter` | 3,798 | Telemetry parameters extracted from RX packets |
| `event_alarm` | 138 | Alarms raised and cleared during the pass |
| `event_cmd_verifier` | 145 | TX command verification outcomes |
| `event_radio` | 3 | GNU Radio process lifecycle events |

### Key relationships

```
passes ──────────────────┬─── event_rx_packet   (pass_id FK)
                         ├─── event_tx_command  (pass_id FK)
                         ├─── event_parameter   (pass_id FK)
                         ├─── event_alarm       (pass_id FK)
                         ├─── event_cmd_verifier(pass_id FK)
                         └─── event_radio       (pass_id FK)

event_rx_packet ─────────── event_parameter     (rx_event_id FK)
event_tx_command ────────── event_cmd_verifier  (cmd_event_id FK)
```

### Column type inference

`server/db.ts` reads the raw SQLite schema with `PRAGMA table_info` and maps each column to one of seven render types used by the frontend:

| Render type | How it's detected | How it renders |
|-------------|-------------------|----------------|
| `int` | SQLite `INTEGER`, or name ends in `_ms` / `_len` | Right-aligned, locale-formatted number |
| `float` | SQLite `REAL` | 4 decimal places (2 if > 100) |
| `time` | Name is `ts_iso`, ends in `_iso`, or is `pass_date` / `pass_time` | Dimmed monospace text |
| `tag` | Name is `alarm_severity`, `outcome`, `stage`, `radio_action`, etc. | Coloured badge (severity-aware) |
| `frame` | Name is `frame_type` or `frame_label` | Coloured by protocol (AX.25 = blue, GOLAY = teal) |
| `bool` | Name matches `duplicate`, `uplink_echo`, `*_ok`, `*_plausible`, etc. | Green `true` / red `false` badge |
| `text` | Everything else | Plain monospace |

FK annotations are inferred by column name: `pass_id → passes`, `rx_event_id → event_rx_packet`, `cmd_event_id → event_tx_command`.

---

## Frontend

### Data flow

```
useSchema()          fetch /api/schema → AppSchema (cached forever)
useTableRows(id)     fetch /api/tables/:id → Row[] (cached per table in a Map)
        │
        ▼
applyFilter(rows, query)   client-side; supports plain text and operators
applySort(rows, sort)      client-side; numeric or lexicographic
        │
        ▼
DataTable → rows rendered as virtualised-style fixed-height divs
```

Table rows are fetched once per table and cached in a `useRef` Map for the lifetime of the page — switching between tables is instant after the first load.

### Filtering syntax

The filter bar in both layouts accepts a freeform query string:

| Syntax | Example | Effect |
|--------|---------|--------|
| Plain text | `callsign` | Substring match across all columns |
| `col:value` | `name:spacecraft` | Substring match on a specific column |
| `col=value` | `outcome=SUCCESS` | Exact match |
| `col!=value` | `alarm_state!=CLEARED` | Exact non-match |
| `col>value` | `ts_ms>1777490700000` | Numeric comparison |
| `col<value` | `elapsed_ms<500` | Numeric comparison |
| `col>=value` / `col<=value` | `size>=100` | Numeric comparison |

### Layouts

Two layout variants are available, toggled with the **A / B** buttons in the header:

**Layout A — Sidebar + Grid + Right detail**
- Collapsible schema sidebar on the left (240 px)
- Scrollable data grid fills the centre
- Row inspector slides in from the right (360 px) when a row is selected

**Layout B — Tab strip + Grid + Bottom detail**
- Open tables are tracked as closeable tabs across the top
- New tables opened from the `▦ tables` dropdown or `+` button
- Info strip below the tabs shows live row count, ingest rate, and sparkline
- Row inspector opens at the bottom (240 px)

Both layouts share the same keyboard shortcuts:

| Key | Action |
|-----|--------|
| `Ctrl+K` / `⌘K` | Open command palette (jump to any table) |
| `Esc` | Close palette / deselect row |
| Click row | Select and open row inspector |
| `↓ csv` button | Export current filtered view to CSV |

### Design tokens

All colours are defined in `src/lib/colors.ts` as a single `const C` object. The palette is pure-black surfaces with five semantic accent colours:

| Token | Hex | Used for |
|-------|-----|---------|
| `active` | `#30C8E0` | Selected rows, live indicators, FK labels |
| `success` | `#3CC98E` | Online status, `true` booleans, `SUCCESS` outcomes |
| `danger` | `#FF3838` | Errors, `false` booleans, `FAIL` / `CRITICAL` |
| `warning` | `#E8B83A` | `WARNING` severity, `DISCHARGE` state |
| `info` | `#5AA8F0` | `ACK` packets, FK badge, info actions |

---

## Project structure

```
ground_station.db          Source of truth — never written to
package.json               Single package for both server and client
vite.config.ts             Vite with /api proxy to :3001
tsconfig.json              Shared TS config (bundler module resolution)
index.html                 Vite entry point

server/
  index.ts                 Express app, binds :3001
  db.ts                    SQLite connection, schema loader, row fetcher
  routes.ts                /api/schema and /api/tables/:tableId handlers

src/
  main.tsx                 React root
  App.tsx                  Schema fetch, loading/error states, A/B toggle
  types.ts                 ColumnDef, Row, AppSchema, SortState, FilterChip
  lib/
    colors.ts              Design tokens and tone helpers
    dataUtils.ts           applyFilter, applySort, exportCsv
  hooks/
    useApi.ts              useSchema, useTableRows
  components/
    Cell.tsx               Value renderer + HeaderCell (sort indicator)
    DataTable.tsx          Scrollable grid with sticky header
    FilterBar.tsx          Query input, filter chips, row count, CSV export
    SchemaSidebar.tsx      Collapsible schema/table tree (Layout A)
    DetailPane.tsx         Row inspector with field list and copy actions
    Sparkline.tsx          SVG mini-chart used in Layout B info strip
    MiniHeader.tsx         App bar with brand, operator info, layout toggle
    HintBar.tsx            Keyboard shortcut hint strip at the bottom
    CommandPalette.tsx     Ctrl+K modal for jumping between tables
  layouts/
    VariationA.tsx         Sidebar + Grid + Right detail
    VariationB.tsx         Tab strip + Grid + Bottom detail
```

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start both Vite (:5173) and Express (:3001) concurrently |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run server` | Start only the Express API server |
