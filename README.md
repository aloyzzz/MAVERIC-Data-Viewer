# MAVERIC GSS — Database Viewer

A web-based telemetry and mission archive browser for the MAVERIC ground station. Ingests `.jsonl` pass files, stores them in PostgreSQL, and serves a React frontend for browsing, filtering, and exporting data.

---

## Quick start (development)

```bash
npm install
npm run dev
```

Opens on `http://localhost:5173`. Both servers start together:

| Process | Port | Role |
|---------|------|------|
| Vite dev server | 5173 | Serves the React frontend |
| Express API server | 5051 | Queries PostgreSQL |

Vite proxies all `/api` requests to the Express server, so the frontend only ever talks to one origin during development.

---

## Deployment

The app is split across two hosts:

| Host | Port | Role |
|------|------|------|
| `mavericdata.isi.edu` | 5051 | Data server — Express API + PostgreSQL |
| `mavericweb.isi.edu` | 5052 | Web server — static frontend + `/api` proxy |

### 1. Configure environment

Copy `.env.example` to `.env` on each host and fill in the values.

**Data server `.env`:**
```
PORT=5051
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=maveric_gs
PG_USER=maveric
PG_PASSWORD=<password>
```

**Web server `.env`:**
```
PORT=5052
DATA_SERVER_URL=http://mavericdata.isi.edu:5051
```

### 2. Build the frontend (run once, or after any source change)

```bash
npm install
npm run build
```

This produces `dist/` which the web server serves as static files.

### 3. Start the data server (mavericdata.isi.edu)

```bash
npm run start
```

### 4. Start the web server (mavericweb.isi.edu)

```bash
npm run start:web
```

The web server serves `dist/` and transparently proxies all `/api/*` browser requests to the data server, so no frontend code changes are needed between environments.

---

## Architecture

```
PostgreSQL (mavericdata.isi.edu)
        │
        ▼
server/
  db.ts        Connection pool, schema loader, row fetcher, ingestion
  routes.ts    /api/* handlers
  index.ts     Express API server — listens on $PORT (default 5051)
  web.ts       Static file server + /api proxy — listens on $PORT (default 5052)
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

Returns the full database schema — table metadata and column definitions for every table. Fetched once on load and cached client-side.

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
      "name": "passes",
      "tables": [ /* pass_1, pass_2, … */ ]
    }
  ],
  "columns": {
    "passes": [
      { "id": "pass_id", "type": "int", "width": 70, "align": "right", "pk": 1, "fk": null },
      { "id": "session_id", "type": "text", "width": 280, "align": "left", "pk": null, "fk": null }
    ]
  }
}
```

### `GET /api/tables/:tableId`

Returns rows for a table.

| Param | Default | Description |
|-------|---------|-------------|
| `limit` | 1000 | Max rows to return |
| `offset` | 0 | Row offset for pagination |
| `sort` | — | Column name to sort by |
| `dir` | `asc` | Sort direction: `asc` or `desc` |

### `GET /api/tables/:tableId/frames`

Returns only `rx_packet` and `tx_command` events with non-null `inner_hex`, used by the decoded frames tab.

### `POST /api/ingest`

Accepts a `.jsonl` file upload (multipart `file` field). Parses every event, writes to a new `pass_N` table in PostgreSQL, decodes binary telemetry into `decoded_telemetry`, and returns an ingest summary.

### `DELETE /api/passes/:passId`

Drops the `pass_N` table and removes the pass record.

---

## Database schema

Passes are stored in PostgreSQL. Each ingested `.jsonl` file creates one row in `passes` and a dedicated `pass_N` table containing all its events.

| Table | Description |
|-------|-------------|
| `passes` | Top-level session records — one row per ingested file |
| `pass_N` | All events for pass N (rx_packet, tx_command, parameter, alarm, cmd_verifier, radio) |
| `decoded_telemetry` | Binary TLM/RES fields decoded from `inner_hex`, keyed by `pass_id` + `cmd_id` |

### Key relationships

```
passes ──── pass_N             (one table per pass)
passes ──── decoded_telemetry  (pass_id FK)
```

### Column type inference

`server/db.ts` maps each PostgreSQL column to one of seven render types used by the frontend:

| Render type | How it's detected | How it renders |
|-------------|-------------------|----------------|
| `int` | PostgreSQL `INTEGER`/`BIGINT`, or name ends in `_ms` / `_len` | Right-aligned, locale-formatted number |
| `float` | PostgreSQL `NUMERIC`/`REAL` | 4 decimal places (2 if > 100) |
| `time` | Name is `ts_iso`, ends in `_iso`, or is `pass_date` / `pass_time` | Dimmed monospace text |
| `tag` | Name is `event_kind`, `alarm_severity`, `outcome`, `stage`, etc. | Coloured badge (severity-aware) |
| `frame` | Name is `frame_type` or `frame_label` | Coloured by protocol |
| `bool` | Name matches `duplicate`, `uplink_echo`, `*_ok`, `*_plausible`, etc. | Green `true` / red `false` badge |
| `text` | Everything else | Plain monospace |

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
DataTable → rows rendered as fixed-height divs
```

### Filtering syntax

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

**Layout A — Sidebar + Grid + Right detail**
- Collapsible schema sidebar on the left (240 px)
- Scrollable data grid fills the centre
- Row inspector slides in from the right (360 px) when a row is selected

**Layout B — Tab strip + Grid + Bottom detail**
- Open tables tracked as closeable tabs across the top
- New tables opened from the `▦ tables` dropdown or `+` button
- Info strip below the tabs shows live row count, ingest rate, and sparkline
- Row inspector opens at the bottom (240 px)

Keyboard shortcuts (both layouts):

| Key | Action |
|-----|--------|
| `Ctrl+K` / `⌘K` | Open command palette (jump to any table) |
| `Esc` | Close palette / deselect row |
| Click row | Select and open row inspector |
| `↓ csv` button | Export current filtered view to CSV |

### Design tokens

All colours are defined in `src/lib/colors.ts` as a single `const C` object:

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
.env.example               Environment variable reference
package.json               Single package for both server and client
vite.config.ts             Vite with /api proxy to data server
tsconfig.json              Shared TS config (bundler module resolution)
index.html                 Vite entry point

server/
  index.ts                 Express API server — $PORT (default 5051)
  web.ts                   Web server: static files + /api proxy — $PORT (default 5052)
  db.ts                    PostgreSQL pool, schema loader, ingestion, telemetry decode
  routes.ts                /api/* route handlers
  telemetryDecode.ts       Binary frame decoder

src/
  main.tsx                 React root
  App.tsx                  Schema fetch, loading/error states, A/B toggle
  types.ts                 ColumnDef, Row, AppSchema, SortState, FilterChip
  lib/
    colors.ts              Design tokens and tone helpers
    dataUtils.ts           applyFilter, applySort, exportCsv
  hooks/
    useApi.ts              useSchema, useTableRows, useFramePackets
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
    IngestPage.tsx         File upload and ingest status UI
    DecodedFramesTab.tsx   Binary telemetry browser
    LiveTab.tsx            Real-time event stream
    CsvExportTab.tsx       Batch CSV export
  layouts/
    VariationA.tsx         Sidebar + Grid + Right detail
    VariationB.tsx         Tab strip + Grid + Bottom detail
```

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start both Vite (:5173) and Express API (:5051) concurrently |
| `npm run build` | Production build to `dist/` |
| `npm run start` | Start the data server (production, uses `$PORT`) |
| `npm run start:web` | Start the web server (production, uses `$PORT` and `$DATA_SERVER_URL`) |
| `npm run server` | Start only the Express API server via tsx |
| `npm run preview` | Serve the production build locally via Vite |
