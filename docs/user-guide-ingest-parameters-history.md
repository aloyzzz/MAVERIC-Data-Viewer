# User Guide: Ingesting a Pass, Viewing Parameters, and the History Screen

This guide walks through the three most common workflows in the MAVERIC GSS
Database Viewer: getting a pass file into the database, inspecting individual
parameters, and using the History screen to compare decoded telemetry across
passes.

It assumes the app is already running. If it is not, start it with
`npm run dev` (see the [README](../README.md)) and open
`http://localhost:5173`. The top of the window has a navigation strip with the
tabs referenced below: **Dashboard, Database, Parameters, History, Ingest,
Reports, Settings**.

---

## 1. Ingesting a pass

A "pass" is a single ground-station session exported as a `.jsonl` file (one
JSON event per line). Ingesting it creates one row in the `passes` table plus a
dedicated `pass_N` table holding every event in the file, and it decodes the
binary telemetry frames into the `decoded_telemetry` table so they are ready for
the Parameters and History screens.

### Steps

1. Click the **Ingest** tab in the top navigation strip. Make sure the
   **File Import** sub-tab is selected (the other sub-tab is Beacon Entry).
2. Drag a `.jsonl` file onto the drop zone, or click the drop zone to open a
   file browser. Only `.jsonl` / `.ndjson` files are accepted.
3. The app parses a local preview without uploading anything yet. You will see:
   - The file name and size.
   - A **file preview** panel breaking down the event counts by kind
     (RX Packets, TX Commands, Parameters, Alarms, CMD Verifiers, Radio Events)
     and the total line count.
   - A **duplicate warning** if this exact file (matched by SHA-256 hash) was
     already ingested. Ingesting again will create a second, duplicate pass, so
     check this before proceeding.
4. Click **↑ Ingest into Database**.
5. A modal asks you to **Assign Pass ID**:
   - Leave it blank to auto-assign the next available ID (recommended).
   - Or type a specific positive integer to force a pass ID.
   - Press Enter or click **↑ Ingest** to confirm.
6. The server writes the events, decodes telemetry, and returns an
   **ingest result** panel showing the assigned `pass_id`, the session ID, the
   per-kind counts, how many lines were skipped, and any warnings.
7. To load another file, click **+ Ingest Another**. To see the new pass
   elsewhere in the app, the schema refreshes automatically; the Dashboard,
   Database, Parameters, and History screens will pick it up.

### What happens under the hood

The upload posts to `POST /api/ingest` (multipart, `file` field, optional
`passId`). The server parses every line, creates the `pass_N` table, inserts all
events, and runs telemetry materialization (binary TLM/RES frames decoded from
`inner_hex` into `decoded_telemetry`). Materialization is a one-time operation
per pass; later screens read the already-decoded rows rather than re-decoding.

To remove a pass, use the Management screen (reached from **Settings**), which
drops the `pass_N` table and its `decoded_telemetry` rows via
`DELETE /api/passes/:passId`.

---

## 2. Viewing parameters

The **Parameters** tab is a catalog-aware browser for every named parameter
known to the mission, showing observed readings across all ingested passes.

### Steps

1. Click the **Parameters** tab.
2. The left column lists every known parameter. Each entry shows the parameter
   name, its most recent value with unit, and a count of how many readings have
   been observed (`N×`). Use the **search parameters…** box at the top to filter
   the list by name.
3. Click a parameter to open its detail on the right. The detail view shows:
   - A **header** with the parameter name and summary metadata: number of
     readings, which pass IDs contributed data, the parameter domain and type
     (from the mission catalog), and min / max / average for numeric parameters.
   - A **sparkline** trend chart when the parameter is numeric and has more than
     one reading.
   - A **readings table** listing every observation: timestamp (in the current
     display timezone), value, unit, and the source pass ID. Rows are sorted
     oldest to newest.
4. Parameters that exist in the mission catalog but have not been observed in any
   ingested pass show "known in mission catalog, not observed in imported
   passes" instead of a table. This is expected for parameters no pass has
   reported yet.

### Notes

- Values come from both the `parameter` events in each pass and decoded
  telemetry. The "count" and "latest value" only reflect actual readings, not
  catalog-only entries.
- Timestamps honor the timezone selected in **Settings**.

---

## 3. The History screen

The **History** tab is the primary tool for comparing decoded telemetry across
one or more passes over a time range. It is where you select passes, choose which
telemetry sources and fields to plot, and view the resulting time series.

### Steps

1. Click the **History** tab.
2. **Select passes (Pass Scope panel, left side).** Every ingested pass is
   listed with its decode status. Click passes to add them to the selection; you
   can select multiple passes to overlay their data.
   - A pass that has not yet been decoded shows as decodable. Use the decode
     action to run materialization on it (`POST /api/history/materialize`). This
     is the same decode step ingestion runs automatically, provided here for
     passes that need re-decoding.
3. **Choose signals / sources.** Once passes are selected, the panel lists the
   available telemetry sources (command IDs and parameters) found in those
   passes, ordered by how many readings each contributes. Toggle sources on or
   off to control what gets plotted. Density filters (for example, numeric-only
   and hide-file) and a source filter help narrow a long list, and a field
   search box filters by field name.
4. **Pick fields.** Within each active source you can select individual fields to
   chart, so you are not forced to render every field in a busy command.
5. **Set a time range.** The screen auto-fills the start and end to span all
   loaded data. Adjust the range start / end inputs to zoom into a window; the
   charts and tables update to that range. Times use the Settings timezone.
6. **Read the results.** Selected fields render as time-series cards you can
   resize. Data for multiple passes is overlaid so you can compare the same field
   across different sessions.

### What History is pulling

- Pass list: `GET /api/tables/passes`
- Per-pass decode status: `GET /api/history/status`
- Available sources for the selected passes: `GET /api/history/summary`
- Decoded field data: `GET /api/history/data` (per command) and
  `GET /api/history/params` (for parameter sources)
- On-demand decode: `POST /api/history/materialize`

### Tips

- If a selected pass shows no sources, it likely has not been decoded yet — run
  materialization from the Pass Scope panel.
- Collapse the left control panel to a thin rail to give the charts more room.
- The History tab stays mounted as you switch tabs, so your pass selection and
  chart layout survive navigating away and back.

---

## Quick reference

| Task | Tab | Key action |
|------|-----|-----------|
| Import a pass file | Ingest → File Import | Drop `.jsonl`, assign/auto pass ID, Ingest |
| Inspect one parameter's readings | Parameters | Search, click a parameter |
| Compare telemetry across passes | History | Select passes, pick sources/fields, set range |
| Delete a pass | Settings → Management | Delete pass |
