import { useMemo, useState, useEffect } from 'react';
import { C } from '../lib/colors';
import type { Row } from '../types';
import { useFramePackets } from '../hooks/useApi';

// ── Protocol parsing ──────────────────────────────────────────────────────────

const HDR = 8;   // bytes before name_len
const FTR = 7;   // footer bytes after args (CRC etc.)

function hexToU8(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < hex.length; i += 2) arr[i >> 1] = parseInt(hex.slice(i, i + 2), 16);
  return arr;
}

interface Parsed {
  cmdName: string;
  argsLen: number;
  argsBytes: Uint8Array;
  argsText: string | null;
  isBinary: boolean;
}

function parseInner(hex: string): Parsed | null {
  if (!hex || hex.length < (HDR + 2) * 2) return null;
  try {
    const b = hexToU8(hex);
    if (b.length < HDR + 2) return null;
    const nameLen = b[HDR];
    const argsLen = b[HDR + 1];
    const nameStart = HDR + 2;
    if (nameStart + nameLen + 1 > b.length) return null;

    const cmdName = Array.from(b.slice(nameStart, nameStart + nameLen))
      .map(x => String.fromCharCode(x)).join('');
    const argsStart = nameStart + nameLen + 1;
    const argsBytes = b.slice(argsStart, argsStart + argsLen);

    const isPrintable = argsBytes.length === 0 ||
      Array.from(argsBytes).every(x => x === 0 || x === 9 || x === 10 || x === 13 || (x >= 32 && x < 127));

    const argsText = isPrintable && argsBytes.length > 0
      ? Array.from(argsBytes).filter(x => x !== 0).map(x => String.fromCharCode(x)).join('').trim()
      : null;

    return { cmdName, argsLen, argsBytes, argsText, isBinary: !isPrintable };
  } catch {
    return null;
  }
}

// tlm_beacon binary layout (105 bytes total):
// [0-6]   callsign: 7-byte fixed ASCII null-padded
// [7-14]  time: u64 LE ms since Unix epoch
// [15]    ops_stage: u8 enum (0=Pre-Launch,1=Detumble,2=Sun-Point,3=Nominal,4=Safe)
// [16-17] lppm_rbt_cnt: u16 LE
// [18]    lppm_rbt_cause: u8
// [19-20] uppm_rbt_cnt: u16 LE
// [21]    uppm_rbt_cause: u8
// [22-25] lppm_time_to_rst: u32 LE (s)
// [26-29] uppm_time_to_rst: u32 LE (s)
// [30]    ertc_heartbeat, [31] mtq_heartbeat, [32] nvg_heartbeat, [33] eps_heartbeat: u8
// [34]    hn_state, [35] ab_state: u8
// [36-39] stat_reg: u32 LE bitfield (bits 0-6=MODE,8=EKF,11=TUMB,13=SUN,15=TLE,26=OT,27=OC,28=UV,29=WDT,30=SERR,31=HERR)
// [40]    gyro_rate_src, [41] mag_src: u8
// [42-53] rate: 3×f32 LE (rad/s)
// [54-65] mag: 3×f32 LE (µT)
// [66-77] mtq: 3×f32 LE (A·m²)
// [78-81] adcs_tmp: f32 LE (°C)
// [82-83] eps_i_bus: u16 LE (mA)  [84-85] eps_i_bat: u16 LE (mA)
// [86-87] eps_v_bus: u16 LE (mV)  [88-89] eps_v_bat: u16 LE (mV)  [90-91] eps_v_sys: u16 LE (mV)
// [92-93] eps_ts_adc: u16 LE (raw, ×0.0976563 %)  [94-95] eps_t_die: u16 LE (raw, ×0.5 °C)
// [96-97] eps_mode: u16 LE
// [98]    gnc_mode: u8 (0=Safe,1=Auto,2=Manual)
// [99-100] unexpected_safe, [101-102] unexpected_detumble, [103-104] sunspin: u16 LE

const OPS_STAGE = ['Pre-Launch', 'Detumble', 'Sun-Point', 'Nominal', 'Safe'];
const GNC_MODE  = ['Safe', 'Auto', 'Manual'];

interface DecodedSection { label: string; rows: { k: string; v: string }[] }
/** @deprecated use DecodedSection */
type BeaconSection = DecodedSection;

function decodeTlmBeacon(bytes: Uint8Array): BeaconSection[] | null {
  if (bytes.length < 98) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const callsign = Array.from(bytes.slice(0, 7))
    .filter(b => b >= 32 && b < 127).map(b => String.fromCharCode(b)).join('');

  const timeLow  = dv.getUint32(7,  true);
  const timeHigh = dv.getUint32(11, true);
  const timeMs   = timeHigh * 4_294_967_296 + timeLow;
  const timeIso  = new Date(timeMs).toISOString();

  const opsStage = bytes[15];
  const statReg  = dv.getUint32(36, true);

  const f = (off: number) => dv.getFloat32(off, true);
  const u16 = (off: number) => dv.getUint16(off, true);

  const statFlags: string[] = [];
  if (statReg & (1 << 8))  statFlags.push('EKF');
  if (statReg & (1 << 11)) statFlags.push('TUMB');
  if (statReg & (1 << 13)) statFlags.push('SUN');
  if (statReg & (1 << 15)) statFlags.push('TLE');
  if (statReg & (1 << 26)) statFlags.push('OT');
  if (statReg & (1 << 27)) statFlags.push('OC');
  if (statReg & (1 << 28)) statFlags.push('UV');
  if (statReg & (1 << 29)) statFlags.push('WDT');
  if (statReg & (1 << 30)) statFlags.push('SERR');
  if (statReg & (1 << 31)) statFlags.push('HERR');

  const gncMode = bytes.length > 98 ? bytes[98] : 0;

  return [
    {
      label: 'Spacecraft',
      rows: [
        { k: 'callsign',           v: callsign },
        { k: 'time',               v: timeIso },
        { k: 'ops_stage',          v: `${OPS_STAGE[opsStage] ?? opsStage} (${opsStage})` },
        { k: 'hn_state',           v: String(bytes[34]) },
        { k: 'ab_state',           v: String(bytes[35]) },
        { k: 'ertc_heartbeat',     v: String(bytes[30]) },
      ],
    },
    {
      label: 'Reboot',
      rows: [
        { k: 'lppm_rbt_cnt',       v: String(u16(16)) },
        { k: 'lppm_rbt_cause',     v: String(bytes[18]) },
        { k: 'lppm_time_to_rst',   v: `${dv.getUint32(22, true).toLocaleString()} s` },
        { k: 'uppm_rbt_cnt',       v: String(u16(19)) },
        { k: 'uppm_rbt_cause',     v: String(bytes[21]) },
        { k: 'uppm_time_to_rst',   v: `${dv.getUint32(26, true).toLocaleString()} s` },
      ],
    },
    {
      label: 'Heartbeats',
      rows: [
        { k: 'ertc',   v: String(bytes[30]) },
        { k: 'mtq',    v: String(bytes[31]) },
        { k: 'nvg',    v: String(bytes[32]) },
        { k: 'eps',    v: String(bytes[33]) },
      ],
    },
    {
      label: 'GNC',
      rows: [
        { k: 'gnc_mode',     v: `${GNC_MODE[gncMode] ?? gncMode} (${gncMode})` },
        { k: 'stat MODE',    v: String(statReg & 0x7F) },
        { k: 'stat flags',   v: statFlags.length ? statFlags.join(' ') : 'none' },
        { k: 'rate_src',     v: String(bytes[40]) },
        { k: 'mag_src',      v: String(bytes[41]) },
        { k: 'RATE X',       v: `${f(42).toFixed(6)} rad/s` },
        { k: 'RATE Y',       v: `${f(46).toFixed(6)} rad/s` },
        { k: 'RATE Z',       v: `${f(50).toFixed(6)} rad/s` },
        { k: 'MAG X',        v: `${f(54).toFixed(3)} µT` },
        { k: 'MAG Y',        v: `${f(58).toFixed(3)} µT` },
        { k: 'MAG Z',        v: `${f(62).toFixed(3)} µT` },
        { k: 'MTQ X',        v: `${f(66).toFixed(4)} A·m²` },
        { k: 'MTQ Y',        v: `${f(70).toFixed(4)} A·m²` },
        { k: 'MTQ Z',        v: `${f(74).toFixed(4)} A·m²` },
        { k: 'ADCS temp',    v: `${f(78).toFixed(2)} °C` },
        { k: 'unexpected_safe',      v: String(u16(99)) },
        { k: 'unexpected_detumble',  v: String(u16(101)) },
        { k: 'sunspin',              v: String(u16(103)) },
      ],
    },
    {
      label: 'EPS',
      rows: [
        { k: 'eps_mode', v: String(u16(96)) },
        { k: 'I_BUS',   v: `${(u16(82) / 1000).toFixed(3)} A` },
        { k: 'I_BAT',   v: `${(u16(84) / 1000).toFixed(3)} A` },
        { k: 'V_BUS',   v: `${(u16(86) / 1000).toFixed(3)} V` },
        { k: 'V_BAT',   v: `${(u16(88) / 1000).toFixed(3)} V` },
        { k: 'V_SYS',   v: `${(u16(90) / 1000).toFixed(3)} V` },
        { k: 'TS_ADC',  v: `${(u16(92) * 0.0976563).toFixed(2)} %` },
        { k: 'T_DIE',   v: `${(u16(94) * 0.5).toFixed(1)} °C` },
      ],
    },
  ];
}

// eps_hk binary layout: 48 × i16 LE values (96 bytes)
// [0]  I_BUS  [1]  I_BAT  [2]  V_BUS  [3]  V_AC1  [4]  V_AC2  [5]  V_BAT  [6]  V_SYS  (mA/mV ×0.001)
// [7]  TS_ADC (×0.0976563 %)  [8]  T_DIE (×0.5 °C)
// [9]  V3V3   [10] I3V3   [11] P3V3   [12] V5V0   [13] I5V0   [14] P5V0   (mV/mA/mW ×0.001)
// [15-32]: VOUT1/IOUT1/POUT1 … VOUT6/IOUT6/POUT6  (3 fields × 6 ports)
// [33-38]: VBRN1/IBRN1/PBRN1  VBRN2/IBRN2/PBRN2
// [39-47]: VSIN1/ISIN1/PSIN1  VSIN2/ISIN2/PSIN2  VSIN3/ISIN3/PSIN3
// Signed (i16): all current fields (I_*), TS_ADC, T_DIE; unsigned (u16): all V_* and P_*

type EpsSection = DecodedSection;

function decodeEpsHk(bytes: Uint8Array): EpsSection[] | null {
  if (bytes.length < 96) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const i16 = (idx: number) => dv.getInt16(idx * 2, true);
  const u16 = (idx: number) => dv.getUint16(idx * 2, true);
  const mV  = (idx: number) => `${(u16(idx) / 1000).toFixed(3)} V`;
  const mAs = (idx: number) => `${(i16(idx) / 1000).toFixed(3)} A`;
  const mW  = (idx: number) => `${(u16(idx) / 1000).toFixed(3)} W`;
  return [
    {
      label: 'Bus / Battery / System',
      rows: [
        { k: 'I_BUS',  v: mAs(0) },  { k: 'I_BAT',  v: mAs(1) },
        { k: 'V_BUS',  v: mV(2)  },  { k: 'V_AC1',  v: mV(3)  },
        { k: 'V_AC2',  v: mV(4)  },  { k: 'V_BAT',  v: mV(5)  },
        { k: 'V_SYS',  v: mV(6)  },
        { k: 'TS_ADC', v: `${(i16(7) * 0.0976563).toFixed(2)} %` },
        { k: 'T_DIE',  v: `${(i16(8) * 0.5).toFixed(1)} °C` },
      ],
    },
    {
      label: 'Rail 3V3 / 5V0',
      rows: [
        { k: 'V3V3', v: mV(9)   }, { k: 'I3V3', v: mAs(10) }, { k: 'P3V3', v: mW(11) },
        { k: 'V5V0', v: mV(12)  }, { k: 'I5V0', v: mAs(13) }, { k: 'P5V0', v: mW(14) },
      ],
    },
    {
      label: 'Output Ports',
      rows: [
        { k: 'VOUT1', v: mV(15) }, { k: 'IOUT1', v: mAs(16) }, { k: 'POUT1', v: mW(17) },
        { k: 'VOUT2', v: mV(18) }, { k: 'IOUT2', v: mAs(19) }, { k: 'POUT2', v: mW(20) },
        { k: 'VOUT3', v: mV(21) }, { k: 'IOUT3', v: mAs(22) }, { k: 'POUT3', v: mW(23) },
        { k: 'VOUT4', v: mV(24) }, { k: 'IOUT4', v: mAs(25) }, { k: 'POUT4', v: mW(26) },
        { k: 'VOUT5', v: mV(27) }, { k: 'IOUT5', v: mAs(28) }, { k: 'POUT5', v: mW(29) },
        { k: 'VOUT6', v: mV(30) }, { k: 'IOUT6', v: mAs(31) }, { k: 'POUT6', v: mW(32) },
      ],
    },
    {
      label: 'Burn Channels',
      rows: [
        { k: 'VBRN1', v: mV(33) }, { k: 'IBRN1', v: mAs(34) }, { k: 'PBRN1', v: mW(35) },
        { k: 'VBRN2', v: mV(36) }, { k: 'IBRN2', v: mAs(37) }, { k: 'PBRN2', v: mW(38) },
      ],
    },
    {
      label: 'Solar Input',
      rows: [
        { k: 'VSIN1', v: mV(39) }, { k: 'ISIN1', v: mAs(40) }, { k: 'PSIN1', v: mW(41) },
        { k: 'VSIN2', v: mV(42) }, { k: 'ISIN2', v: mAs(43) }, { k: 'PSIN2', v: mW(44) },
        { k: 'VSIN3', v: mV(45) }, { k: 'ISIN3', v: mAs(46) }, { k: 'PSIN3', v: mW(47) },
      ],
    },
  ];
}

// Decode all bytes as float32 LE, filtering NaN/Inf
function decodeFloats(bytes: Uint8Array): number[] {
  const result: number[] = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i + 4 <= dv.byteLength; i += 4) {
    const f = dv.getFloat32(i, true);
    if (isFinite(f)) result.push(f);
  }
  return result;
}

// ── File chunk parsing ────────────────────────────────────────────────────────

interface FileChunk {
  filename: string;
  index: number;
  data: Uint8Array;
}

function parseFileChunk(argsBytes: Uint8Array): FileChunk | null {
  let pos = 0;
  const tokens: string[] = [];
  while (tokens.length < 3 && pos < argsBytes.length) {
    while (pos < argsBytes.length && argsBytes[pos] === 0x20) pos++;
    if (pos >= argsBytes.length || argsBytes[pos] < 0x21 || argsBytes[pos] > 0x7e) break;
    let end = pos;
    while (end < argsBytes.length && argsBytes[end] !== 0x20 && argsBytes[end] >= 0x20 && argsBytes[end] <= 0x7e) end++;
    tokens.push(Array.from(argsBytes.slice(pos, end)).map(b => String.fromCharCode(b)).join(''));
    pos = end;
  }
  while (pos < argsBytes.length && argsBytes[pos] === 0x20) pos++;
  if (tokens.length < 2) return null;
  // tokens[2] is the declared payload size; take exactly that many bytes to avoid trailing nulls
  const size = tokens.length >= 3 ? parseInt(tokens[2]) : argsBytes.length - pos;
  return { filename: tokens[0], index: parseInt(tokens[1]), data: argsBytes.slice(pos, pos + size) };
}

const IMAGE_EXTS = /\.(jpg|jpeg|png|gif|bmp|webp)$/i;

const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp',
  json: 'application/json', txt: 'text/plain', csv: 'text/csv',
  npz: 'application/octet-stream',
};

function mimeForFilename(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

type AssembledFile = { dataUrl: string; totalBytes: number; chunkCount: number };

function assembleFileData(packets: Pkt[], mime: string): AssembledFile | null {
  const chunks: FileChunk[] = [];
  for (const p of packets) {
    if (p.ptype !== 'FILE' || !p.parsed?.argsBytes.length) continue;
    const fc = parseFileChunk(p.parsed.argsBytes);
    if (fc && fc.data.length > 0) chunks.push(fc);
  }
  if (chunks.length === 0) return null;
  chunks.sort((a, b) => a.index - b.index);
  const total = chunks.reduce((s, c) => s + c.data.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c.data, off); off += c.data.length; }
  let binary = '';
  const STEP = 8192;
  for (let i = 0; i < out.length; i += STEP) binary += String.fromCharCode(...out.slice(i, i + STEP));
  return { dataUrl: `data:${mime};base64,${btoa(binary)}`, totalBytes: total, chunkCount: chunks.length };
}

function assembleImage(packets: Pkt[]): AssembledFile | null {
  return assembleFileData(packets, 'image/jpeg');
}

function ImagePreview({ packets, filename }: { packets: Pkt[]; filename?: string }) {
  const result = useMemo(() => assembleImage(packets), [packets, filename]);

  if (!result) return null;

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 9.5, fontFamily: C.fontMono, color: C.textDisabled }}>
          {filename ?? 'image'} — {result.chunkCount} chunks, {(result.totalBytes / 1024).toFixed(1)} KB
        </span>
        <a
          href={result.dataUrl}
          download={filename ?? 'image.jpg'}
          style={{
            fontSize: 9.5, fontFamily: C.fontMono,
            color: C.active, textDecoration: 'none',
            padding: '1px 6px', borderRadius: 2,
            border: `1px solid ${C.active}44`,
            backgroundColor: `${C.active}11`,
          }}
        >
          ↓ download
        </a>
      </div>
      <img
        src={result.dataUrl}
        alt={filename ?? 'image'}
        style={{
          maxWidth: '100%', maxHeight: 420, borderRadius: 4,
          border: `1px solid ${C.borderStrong}`, display: 'block',
        }}
      />
    </div>
  );
}

// ── Data model ────────────────────────────────────────────────────────────────

interface Pkt {
  ts: number;
  ptype: string;
  src: string;
  dst: string;
  innerHex: string | null;
  parsed: Parsed | null;
  intOk: boolean | null;
  eventKind: string;
  cmdId: string;
  frameLabel: string | null;
  duplicate: boolean;
}

interface Exchange {
  id: string;
  ts: number;
  cmdId: string;
  packets: Pkt[];
  isFile: boolean;
  fileName?: string;
  chunkCount?: number;
}

const FILE_WIN = 300_000;
const CMD_WIN  =  30_000;

function buildExchanges(rows: Row[]): Exchange[] {
  const pkts: Pkt[] = rows
    .filter(r =>
      (r.event_kind === 'rx_packet' || r.event_kind === 'tx_command') &&
      r.mission_facts_header_cmd_id && r.inner_hex,
    )
    .sort((a, b) => (a.ts_ms as number) - (b.ts_ms as number))
    .map(r => ({
      ts:        r.ts_ms as number,
      ptype:     (r.mission_facts_header_ptype as string) ?? '',
      src:       (r.mission_facts_header_src as string) ?? '',
      dst:       (r.mission_facts_header_dest as string) ?? '',
      innerHex:  r.inner_hex as string | null,
      parsed:    null, // deferred — computed in ExchangeCard on expand
      intOk:     r.mission_facts_integrity_overall_ok != null
        ? r.mission_facts_integrity_overall_ok === '1' : null,
      eventKind: r.event_kind as string,
      cmdId:     r.mission_facts_header_cmd_id as string,
      frameLabel: r.frame_label as string | null,
      duplicate: r.duplicate === '1',
    }));

  const exchanges: Exchange[] = [];
  // O(1) lookup: maps a window key → the most-recent open exchange for that key
  const recent = new Map<string, Exchange>();

  for (const p of pkts) {
    const isFile = p.ptype === 'FILE';
    const win = isFile ? FILE_WIN : CMD_WIN;

    // For FILE grouping we need the filename. Parse only FILE packets' hex
    // here (typically a small fraction of the total) so the main loop stays fast.
    let fileName: string | undefined;
    if (isFile && p.innerHex) {
      const fp = parseInner(p.innerHex);
      if (fp) {
        if (fp.argsText) {
          fileName = fp.argsText.split(' ')[0];
        } else if (fp.argsBytes.length > 0) {
          const fc = parseFileChunk(fp.argsBytes);
          if (fc) fileName = fc.filename;
        }
      }
    }

    // Key: for named file transfers include the filename so different files
    // with the same cmdId don't merge; otherwise key by cmdId alone.
    const key = isFile && fileName ? `${p.cmdId}:${fileName}` : p.cmdId;
    const candidate = recent.get(key);
    const hit = candidate && p.ts - candidate.ts <= win ? candidate : undefined;

    if (hit) {
      hit.packets.push(p);
      if (isFile && fileName && !hit.fileName) hit.fileName = fileName;
      if (isFile) {
        hit.isFile = true;
        hit.chunkCount = (hit.chunkCount ?? 0) + 1;
      }
    } else {
      const ex: Exchange = {
        id: `${p.cmdId}_${p.ts}`,
        ts: p.ts,
        cmdId: p.cmdId,
        packets: [p],
        isFile,
        fileName: isFile ? fileName : undefined,
        chunkCount: isFile ? 1 : undefined,
      };
      exchanges.push(ex);
      recent.set(key, ex);
    }
  }

  return exchanges;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PTYPE_CLR: Record<string, { bg: string; fg: string }> = {
  CMD:  { bg: 'rgba(74,158,255,0.15)',  fg: '#4a9eff' },
  ACK:  { bg: 'rgba(201,169,110,0.15)', fg: '#c9a96e' },
  RES:  { bg: 'rgba(60,201,142,0.15)',  fg: '#3cc98e' },
  TLM:  { bg: 'rgba(125,188,176,0.15)', fg: '#7dbcb0' },
  FILE: { bg: 'rgba(180,142,173,0.15)', fg: '#b48ead' },
};

function PtypeBadge({ ptype, count }: { ptype: string; count?: number }) {
  const clr = PTYPE_CLR[ptype] ?? { bg: 'rgba(255,255,255,0.1)', fg: C.textMuted };
  return (
    <span style={{
      padding: '1px 5px', borderRadius: 3,
      backgroundColor: clr.bg, color: clr.fg,
      fontSize: 9.5, fontFamily: C.fontMono,
      border: `1px solid ${clr.fg}33`,
      whiteSpace: 'nowrap',
    }}>
      {ptype}{count && count > 1 ? ` ×${count}` : ''}
    </span>
  );
}

function ts(ms: number) {
  const d = new Date(ms);
  return d.toISOString().slice(11, 23);
}

function formatArgs(argsText: string): string {
  // Try to pretty-print JSON embedded in args
  const jsonStart = argsText.indexOf('{');
  if (jsonStart !== -1) {
    const prefix = argsText.slice(0, jsonStart).trim();
    try {
      const obj = JSON.parse(argsText.slice(jsonStart));
      return (prefix ? prefix + '\n' : '') + JSON.stringify(obj, null, 2);
    } catch { /* not json */ }
  }
  return argsText;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DecodedSections({ sections }: { sections: BeaconSection[] | EpsSection[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {sections.map(sec => (
        <div key={sec.label}>
          <div style={{ fontSize: 9, fontFamily: C.fontMono, color: C.textDisabled,
            textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>
            {sec.label}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 16px' }}>
            {sec.rows.map(r => (
              <span key={r.k} style={{ fontFamily: C.fontMono, fontSize: 10, color: C.textMuted }}>
                <span style={{ color: C.textDisabled }}>{r.k} </span>
                <span style={{ color: C.textPrimary }}>{r.v}</span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function BinaryPayload({ bytes, cmdId }: { bytes: Uint8Array; cmdId: string }) {
  if (bytes.length === 0) return null;

  if (cmdId === 'tlm_beacon') {
    const sections = decodeTlmBeacon(bytes);
    if (sections) return <DecodedSections sections={sections} />;
  }

  if (cmdId === 'eps_hk') {
    const sections = decodeEpsHk(bytes);
    if (sections) return <DecodedSections sections={sections} />;
  }

  if (cmdId === 'mag_tlm' && bytes.length >= 4) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tsS = dv.getFloat32(0, true);
    const floats: number[] = [];
    for (let i = 4; i + 4 <= bytes.byteLength; i += 4) floats.push(dv.getFloat32(i, true));
    const tsIso = isFinite(tsS) && tsS > 1e9 ? new Date(Math.round(tsS) * 1000).toISOString() : null;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontFamily: C.fontMono, fontSize: 10, color: C.textMuted }}>
          <span style={{ color: C.textDisabled }}>time </span>
          <span style={{ color: C.textPrimary }}>{tsIso ?? tsS.toFixed(0)}</span>
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px' }}>
          {floats.map((f, i) => (
            <span key={i} style={{ fontFamily: C.fontMono, fontSize: 10, color: C.textMuted }}>
              <span style={{ color: C.textDisabled }}>f{i + 1} </span>
              <span style={{ color: f !== 0 ? C.textPrimary : C.textDisabled }}>{f.toFixed(4)}</span>
            </span>
          ))}
        </div>
      </div>
    );
  }

  // For sensor float payloads
  const floats = decodeFloats(bytes);
  if (floats.length > 0 && floats.some(f => Math.abs(f) < 1e6 && f !== 0)) {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px' }}>
        {floats.slice(0, 20).map((f, i) => (
          <span key={i} style={{ fontFamily: C.fontMono, fontSize: 10, color: C.textMuted }}>
            <span style={{ color: C.textDisabled }}>f{i} </span>
            <span style={{ color: f !== 0 ? C.textPrimary : C.textDisabled }}>{f.toFixed(4)}</span>
          </span>
        ))}
        {floats.length > 20 && (
          <span style={{ fontSize: 10, color: C.textDisabled }}>+{floats.length - 20} more</span>
        )}
      </div>
    );
  }

  // Fallback: hex dump
  return (
    <span style={{ fontFamily: C.fontMono, fontSize: 10, color: C.textDisabled, wordBreak: 'break-all' }}>
      {Array.from(bytes.slice(0, 48)).map(b => b.toString(16).padStart(2, '0')).join(' ')}
      {bytes.length > 48 ? ` … (${bytes.length} bytes)` : ''}
    </span>
  );
}

function ExchangeCard({ exchange }: { exchange: Exchange }) {
  const [expanded, setExpanded] = useState(false);

  // Parse inner hex only when the card is expanded -- keeps initial render cheap.
  const packets = useMemo(() => {
    if (!expanded) return exchange.packets;
    return exchange.packets.map(p => ({
      ...p,
      parsed: p.parsed ?? (p.innerHex ? parseInner(p.innerHex) : null),
    }));
  }, [expanded, exchange.packets]);

  const ptypeCounts = packets.reduce<Record<string, number>>((acc, p) => {
    acc[p.ptype] = (acc[p.ptype] ?? 0) + 1;
    return acc;
  }, {});

  // Find primary response/TLM packet (not CMD, prefer TLM > FILE > RES > ACK)
  const cmdPkt = packets.find(p => p.ptype === 'CMD');
  const resPkt =
    packets.find(p => p.ptype === 'TLM') ??
    packets.find(p => p.ptype === 'RES') ??
    packets.find(p => p.ptype === 'FILE');

  const filePkts = packets.filter(p => p.ptype === 'FILE');

  // Integrity: pass only if all non-CMD packets with intOk info are ok
  const hasIntegrity = packets.some(p => p.intOk !== null);
  const allOk = packets.filter(p => p.intOk !== null).every(p => p.intOk);

  const flowSrc = cmdPkt?.src ?? resPkt?.src ?? packets[0]?.src ?? '';
  const flowDst = cmdPkt?.dst ?? resPkt?.dst ?? packets[0]?.dst ?? '';

  return (
    <div style={{
      borderBottom: `1px solid ${C.borderSubtle}`,
    }}>
      {/* Header row */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '7px 14px',
          cursor: 'pointer',
          backgroundColor: expanded ? 'rgba(255,255,255,0.03)' : 'transparent',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.04)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = expanded ? 'rgba(255,255,255,0.03)' : 'transparent'; }}
      >
        <span style={{ color: C.textDisabled, fontSize: 10, fontFamily: C.fontMono, flexShrink: 0 }}>
          {ts(exchange.ts)}
        </span>

        <span style={{ fontSize: 12, fontFamily: C.fontMono, color: C.textPrimary, flexShrink: 0 }}>
          {exchange.cmdId}
        </span>

        <span style={{ color: C.textDisabled, fontSize: 10, fontFamily: C.fontMono, flexShrink: 0 }}>
          {flowSrc} → {flowDst}
        </span>

        <span style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
          {(['CMD','ACK','RES','TLM','FILE'] as const).filter(pt => ptypeCounts[pt]).map(pt => (
            <PtypeBadge key={pt} ptype={pt} count={ptypeCounts[pt]} />
          ))}
        </span>

        {/* Quick preview of primary content */}
        {!expanded && (
          <span style={{
            flex: 1, minWidth: 0,
            fontFamily: C.fontMono, fontSize: 10.5, color: C.textMuted,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {exchange.isFile && exchange.fileName
              ? `${exchange.fileName} (${exchange.chunkCount} chunk${exchange.chunkCount !== 1 ? 's' : ''})`
              : resPkt?.parsed?.argsText
                ? resPkt.parsed.argsText.slice(0, 80)
                : cmdPkt?.parsed?.argsText
                  ? cmdPkt.parsed.argsText.slice(0, 80)
                  : resPkt?.parsed?.isBinary
                    ? `[binary ${resPkt.parsed.argsLen} bytes]`
                    : ''}
          </span>
        )}

        {hasIntegrity && (
          <span style={{
            fontSize: 10, fontFamily: C.fontMono, flexShrink: 0,
            color: allOk ? C.active : C.danger,
            marginLeft: 'auto',
          }}>
            {allOk ? '✓' : '✗'}
          </span>
        )}

        <span style={{ color: C.textDisabled, fontSize: 10, flexShrink: 0, marginLeft: hasIntegrity ? 0 : 'auto' }}>
          {expanded ? '▾' : '▸'}
        </span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{
          padding: '0 14px 10px 14px',
          display: 'flex', flexDirection: 'column', gap: 8,
          borderTop: `1px solid ${C.borderSubtle}`,
          backgroundColor: 'rgba(0,0,0,0.2)',
        }}>
          {packets.map((pkt, i) => {
            const clr = PTYPE_CLR[pkt.ptype] ?? PTYPE_CLR['CMD'];
            const p = pkt.parsed;

            // For FILE packets in a multi-chunk transfer, collapse all into a single summary card
            if (pkt.ptype === 'FILE' && (exchange.chunkCount ?? 0) > 1) {
              const firstFileIdx = packets.findIndex(x => x.ptype === 'FILE');
              if (i !== firstFileIdx) return null; // only render once, at first FILE packet position
              const filePackets = packets.filter(x => x.ptype === 'FILE');
              const fileCount = filePackets.length;
              const totalBytes = filePackets.reduce((sum, x) => sum + (x.parsed?.argsLen ?? 0), 0);
              const isImage = exchange.fileName && IMAGE_EXTS.test(exchange.fileName);
              return (
                <div key={i} style={{
                  padding: '6px 10px', borderRadius: 3,
                  border: `1px solid ${clr.fg}22`,
                  backgroundColor: clr.bg,
                }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: isImage ? 0 : 4 }}>
                    <PtypeBadge ptype="FILE" count={fileCount} />
                    <span style={{ fontSize: 10, color: C.textMuted, fontFamily: C.fontMono }}>
                      {exchange.fileName} — {fileCount} chunks, ~{(totalBytes / 1024).toFixed(1)} KB
                    </span>
                  </div>

                  {/* Assembled image */}
                  {isImage && (
                    <ImagePreview packets={filePackets} filename={exchange.fileName} />
                  )}

                  {/* JSON/text content (non-image files) */}
                  {!isImage && (() => {
                    const first = filePackets[0];
                    if (!first?.parsed?.argsText) return null;
                    const parts = first.parsed.argsText.split(' ');
                    const content = parts.slice(3).join(' ');
                    if (!content) return null;
                    const isJson = content.startsWith('{') || content.startsWith('[');
                    return (
                      <pre style={{
                        margin: '4px 0 0', fontSize: 9.5, fontFamily: C.fontMono,
                        color: C.textPrimary, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                        maxHeight: 200, overflow: 'auto',
                        backgroundColor: 'rgba(0,0,0,0.3)', padding: 6, borderRadius: 2,
                      }}>
                        {isJson
                          ? (() => { try { return JSON.stringify(JSON.parse(content), null, 2); } catch { return content; } })()
                          : content}
                        {fileCount > 1 ? `\n… (${fileCount - 1} more chunks)` : ''}
                      </pre>
                    );
                  })()}
                </div>
              );
            }

            return (
              <div key={i} style={{
                padding: '6px 10px', borderRadius: 3,
                border: `1px solid ${clr.fg}22`,
                backgroundColor: clr.bg,
              }}>
                {/* Packet header */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: p && (p.argsText || p.isBinary) ? 6 : 0 }}>
                  <PtypeBadge ptype={pkt.ptype} />
                  <span style={{ fontSize: 10, color: C.textDisabled, fontFamily: C.fontMono }}>
                    {ts(pkt.ts)}
                  </span>
                  <span style={{ fontSize: 10, color: C.textMuted, fontFamily: C.fontMono }}>
                    {pkt.src} → {pkt.dst}
                  </span>
                  {pkt.frameLabel && (
                    <span style={{ fontSize: 9.5, color: C.textDisabled, fontFamily: C.fontMono }}>
                      [{pkt.frameLabel}]
                    </span>
                  )}
                  {pkt.duplicate && (
                    <span style={{ fontSize: 9.5, color: C.warning, fontFamily: C.fontMono }}>dup</span>
                  )}
                  {pkt.intOk !== null && (
                    <span style={{ fontSize: 10, color: pkt.intOk ? C.active : C.danger, marginLeft: 'auto' }}>
                      {pkt.intOk ? '✓ ok' : '✗ bad'}
                    </span>
                  )}
                </div>

                {/* Decoded args */}
                {p && p.argsText && (
                  <pre style={{
                    margin: 0, fontSize: 10.5, fontFamily: C.fontMono,
                    color: C.textPrimary, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                    maxHeight: 240, overflow: 'auto',
                  }}>
                    {pkt.ptype === 'FILE'
                      ? (() => {
                          const parts = p.argsText!.split(' ');
                          const content = parts.slice(3).join(' ');
                          if (!content) return p.argsText;
                          try { return parts.slice(0, 3).join(' ') + '\n' + JSON.stringify(JSON.parse(content), null, 2); }
                          catch { return p.argsText; }
                        })()
                      : formatArgs(p.argsText)}
                  </pre>
                )}

                {p && p.isBinary && p.argsBytes.length > 0 && (
                  <BinaryPayload bytes={p.argsBytes} cmdId={pkt.cmdId} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Files tab ─────────────────────────────────────────────────────────────────

interface ServerFile {
  filename: string;
  totalBytes: number;
  chunkCount: number;
}

function FileRow({ file, tableId }: { file: ServerFile; tableId: string }) {
  const isImage = IMAGE_EXTS.test(file.filename);
  const [imgVisible, setImgVisible] = useState(false);
  const mime = mimeForFilename(file.filename);
  const typeLabel = mime.split('/')[1]?.toUpperCase().replace('JPEG', 'JPG') ?? 'BIN';
  const dlUrl = `/api/tables/${tableId}/assembled-files/${encodeURIComponent(file.filename)}`;

  return (
    <div style={{ borderBottom: `1px solid ${C.borderSubtle}`, padding: '9px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          padding: '1px 5px', borderRadius: 3, flexShrink: 0,
          backgroundColor: isImage ? 'rgba(180,142,173,0.15)' : 'rgba(255,255,255,0.07)',
          color: isImage ? '#b48ead' : C.textMuted,
          fontSize: 9, fontFamily: C.fontMono,
          border: `1px solid ${isImage ? '#b48ead33' : C.borderSubtle}`,
        }}>{typeLabel}</span>
        <span
          onClick={isImage ? () => setImgVisible(v => !v) : undefined}
          style={{
            fontFamily: C.fontMono, fontSize: 12, color: C.textPrimary,
            flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            cursor: isImage ? 'pointer' : 'default',
            userSelect: 'none',
          }}
        >
          {isImage && (
            <span style={{ fontSize: 9, color: C.textDisabled, marginRight: 5 }}>
              {imgVisible ? '▾' : '▸'}
            </span>
          )}
          {file.filename}
        </span>
        <span style={{ fontFamily: C.fontMono, fontSize: 10, color: C.textMuted, flexShrink: 0 }}>
          {(file.totalBytes / 1024).toFixed(1)} KB
        </span>
        {file.chunkCount > 0 && (
          <span style={{ fontFamily: C.fontMono, fontSize: 10, color: C.textDisabled, flexShrink: 0 }}>
            {file.chunkCount} chunk{file.chunkCount !== 1 ? 's' : ''}
          </span>
        )}
        <a
          href={dlUrl}
          download={file.filename}
          style={{
            padding: '3px 10px', borderRadius: 3, cursor: 'pointer',
            fontSize: 10, fontFamily: C.fontMono, flexShrink: 0,
            backgroundColor: C.activeFill, color: C.active,
            border: `1px solid ${C.active}44`, textDecoration: 'none',
          }}
        >↓ download</a>
      </div>
      {isImage && imgVisible && (
        <div style={{ marginTop: 8 }}>
          <img
            src={dlUrl}
            alt={file.filename}
            style={{
              maxWidth: '100%', maxHeight: 240, borderRadius: 4, display: 'block',
              border: `1px solid ${C.borderStrong}`,
            }}
          />
        </div>
      )}
    </div>
  );
}

export function FilesTab({ tableId }: { tableId: string }) {
  const [status, setStatus] = useState<'assembling' | 'done' | 'error'>('assembling');
  const [serverFiles, setServerFiles] = useState<ServerFile[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!tableId) return;
    setStatus('assembling');
    setServerFiles([]);
    fetch(`/api/tables/${tableId}/assemble-files`, { method: 'POST' })
      .then(r => r.json() as Promise<{ files?: ServerFile[]; error?: string }>)
      .then(data => {
        if (data.error) throw new Error(data.error);
        setServerFiles(data.files ?? []);
        setStatus('done');
      })
      .catch((err: unknown) => { setErrorMsg(String(err)); setStatus('error'); });
  }, [tableId]);

  const filtered = useMemo(() => {
    if (!filter) return serverFiles;
    const q = filter.toLowerCase();
    return serverFiles.filter(f => f.filename.toLowerCase().includes(q));
  }, [serverFiles, filter]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        padding: '6px 12px', borderBottom: `1px solid ${C.borderSubtle}`,
        backgroundColor: C.bgApp, fontFamily: C.fontMono, fontSize: 11,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center',
          backgroundColor: C.bgPanelRaised, border: `1px solid ${C.borderSubtle}`,
          borderRadius: 3, padding: '0 6px', flex: '0 1 240px',
        }}>
          <span style={{ color: C.textDisabled, marginRight: 6 }}>⌕</span>
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="filter by filename…"
            style={{
              flex: 1, background: 'transparent', border: 0, outline: 'none',
              color: C.textPrimary, fontFamily: C.fontMono, fontSize: 11,
              padding: '4px 0', minWidth: 0,
            }}
          />
          {filter && (
            <button onClick={() => setFilter('')}
              style={{ background: 'transparent', border: 0, color: C.textDisabled, cursor: 'pointer', padding: '0 4px' }}>×</button>
          )}
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: C.textMuted }}>
          {status === 'assembling'
            ? <span style={{ color: C.textDisabled }}>assembling…</span>
            : status === 'done'
              ? <><span style={{ color: C.textPrimary }}>{filtered.length}</span>{' '}file{filtered.length !== 1 ? 's' : ''}</>
              : null}
        </span>
      </div>

      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {status === 'assembling' && (
          <div style={{ padding: 32, textAlign: 'center', color: C.textMuted, fontSize: 12, fontFamily: C.fontMono }}>
            assembling files…
          </div>
        )}
        {status === 'error' && (
          <div style={{ padding: 32, textAlign: 'center', color: '#bf616a', fontSize: 12, fontFamily: C.fontMono }}>
            {errorMsg}
          </div>
        )}
        {status === 'done' && filtered.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: C.textMuted, fontSize: 12, fontFamily: C.fontMono }}>
            no files in this pass
          </div>
        )}
        {status === 'done' && filtered.map(f => (
          <FileRow key={f.filename} file={f} tableId={tableId} />
        ))}
      </div>
    </div>
  );
}

// ── Telemetry timeline ────────────────────────────────────────────────────────

interface TimelineEntry {
  ts: number;
  cmdId: string;
  ptype: string;
  sections: DecodedSection[];
}

// Known MTQ register labels (from GSS repo public test fixtures)
const MTQ_REG: Record<number, string> = {
  13: 'MAG0_S', 78: 'MTQ', 133: 'CAL_MAG_B',
};

function parseTextSections(argsText: string): DecodedSection[] | null {
  // Paged register format: "reg v1 v2 v3 [flag], reg v1 v2 [flag], ..."
  if (argsText.includes(',')) {
    const rows = argsText.split(',').flatMap((g): { k: string; v: string }[] => {
      const tokens = g.trim().split(/\s+/).filter(Boolean);
      if (tokens.length < 2) return [];
      const regId = parseInt(tokens[0]);
      if (isNaN(regId) || regId < 0) return [];
      const name = MTQ_REG[regId] ?? `reg.${regId}`;
      const last = tokens[tokens.length - 1];
      const hasFlag = tokens.length > 2 && (last === '0' || last === '1') && !last.includes('.');
      const vals = hasFlag ? tokens.slice(1, -1) : tokens.slice(1);
      return [{ k: name, v: vals.join(' ') }];
    });
    if (rows.length > 0) return [{ label: '', rows }];
  }
  // Single-register GET: "module register val1 val2 val3"
  if (/^\d+ \d+ /.test(argsText)) {
    const tokens = argsText.trim().split(/\s+/);
    if (tokens.length >= 3) {
      const regId = parseInt(tokens[1]);
      const name = MTQ_REG[regId] ?? `reg.${regId}`;
      return [{ label: '', rows: [{ k: name, v: tokens.slice(2).join(' ') }] }];
    }
  }
  // Simple text (short enough to show inline)
  if (argsText.length <= 160) {
    return [{ label: '', rows: [{ k: 'args', v: argsText }] }];
  }
  return null;
}

function buildTimeline(exchanges: Exchange[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const ex of exchanges) {
    const dataPkt =
      ex.packets.find(p => p.ptype === 'TLM') ??
      ex.packets.find(p => p.ptype === 'RES');
    if (!dataPkt) continue;
    // parsed is deferred in buildExchanges, so decode the inner hex here.
    const parsed = dataPkt.parsed ?? (dataPkt.innerHex ? parseInner(dataPkt.innerHex) : null);
    if (!parsed) continue;

    const { cmdId, ptype, ts: pktTs } = dataPkt;
    const { argsBytes, argsText, isBinary } = parsed;
    let sections: DecodedSection[] | null = null;

    if (isBinary && argsBytes.length > 0) {
      if (cmdId === 'tlm_beacon') {
        sections = decodeTlmBeacon(argsBytes);
      } else if (cmdId === 'eps_hk') {
        sections = decodeEpsHk(argsBytes);
      } else if (cmdId === 'mag_tlm' && argsBytes.length >= 4) {
        const dv = new DataView(argsBytes.buffer, argsBytes.byteOffset, argsBytes.byteLength);
        const tsF = dv.getFloat32(0, true);
        const tsIso = isFinite(tsF) && tsF > 1e9
          ? new Date(Math.round(tsF) * 1000).toISOString()
          : tsF.toFixed(0);
        const rows: { k: string; v: string }[] = [{ k: 'time', v: tsIso }];
        for (let i = 4; i + 4 <= argsBytes.byteLength; i += 4) {
          rows.push({ k: `f${(i - 4) / 4 + 1}`, v: dv.getFloat32(i, true).toFixed(4) });
        }
        sections = [{ label: 'Magnetometer', rows }];
      }
    } else if (argsText) {
      sections = parseTextSections(argsText);
    }

    if (sections) entries.push({ ts: pktTs, cmdId, ptype, sections });
  }

  return entries.sort((a, b) => a.ts - b.ts);
}

// ── Time-series plot ──────────────────────────────────────────────────────────

function TimeSeriesPlot({ points, unit }: {
  points: { ts: number; val: number }[];
  unit: string;
}) {
  const W = 252, H = 130;
  const PAD = { t: 14, r: 8, b: 26, l: 56 };
  const pw = W - PAD.l - PAD.r;
  const ph = H - PAD.t - PAD.b;

  const tsMin = points[0].ts, tsMax = points[points.length - 1].ts;
  const vals = points.map(p => p.val);
  const vRaw0 = Math.min(...vals), vRaw1 = Math.max(...vals);
  // Add a little padding to the y range so single-value lines don't sit on axis
  const vPad = vRaw0 === vRaw1 ? Math.max(Math.abs(vRaw0) * 0.1, 0.001) : 0;
  const vMin = vRaw0 - vPad, vMax = vRaw1 + vPad;
  const vRange = vMax - vMin;
  const tRange = tsMax - tsMin || 1;

  const cx = (t: number) => PAD.l + ((t - tsMin) / tRange) * pw;
  const cy = (v: number) => PAD.t + ph - ((v - vMin) / vRange) * ph;

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${cx(p.ts).toFixed(1)},${cy(p.val).toFixed(1)}`)
    .join(' ');

  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;

  // Y-axis tick values
  const yTicks = vRaw0 === vRaw1
    ? [vRaw0]
    : [vMax, (vMin + vMax) / 2, vMin];

  const fmt = (v: number) => {
    const abs = Math.abs(v);
    if (abs === 0) return '0';
    if (abs >= 1000 || (abs < 0.001 && abs > 0)) return v.toExponential(2);
    if (abs < 1) return v.toPrecision(3);
    return v.toPrecision(4);
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
      {/* Grid */}
      {yTicks.map((v, i) => (
        <line key={i} x1={PAD.l} y1={cy(v)} x2={PAD.l + pw} y2={cy(v)}
          stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
      ))}
      {/* Mean line */}
      <line x1={PAD.l} y1={cy(mean)} x2={PAD.l + pw} y2={cy(mean)}
        stroke={C.active} strokeWidth={0.75} strokeDasharray="3 3" opacity={0.45} />
      {/* Axes */}
      <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={PAD.t + ph}
        stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
      <line x1={PAD.l} y1={PAD.t + ph} x2={PAD.l + pw} y2={PAD.t + ph}
        stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
      {/* Line */}
      <path d={pathD} fill="none" stroke={C.active} strokeWidth={1.5} strokeLinejoin="round" />
      {/* Y labels */}
      {yTicks.map((v, i) => (
        <text key={i} x={PAD.l - 4} y={cy(v) + 3.5}
          textAnchor="end" fontSize={7.5} fill={C.textDisabled} fontFamily="monospace">
          {fmt(v)}
        </text>
      ))}
      {/* X labels */}
      <text x={PAD.l} y={H - 4} textAnchor="start" fontSize={7} fill={C.textDisabled} fontFamily="monospace">
        {new Date(tsMin).toISOString().slice(11, 19)}
      </text>
      <text x={PAD.l + pw} y={H - 4} textAnchor="end" fontSize={7} fill={C.textDisabled} fontFamily="monospace">
        {new Date(tsMax).toISOString().slice(11, 19)}
      </text>
      {/* Unit label */}
      {unit && (
        <text x={PAD.l + pw / 2} y={PAD.t - 2} textAnchor="middle"
          fontSize={7.5} fill={C.textDisabled} fontFamily="monospace">{unit}</text>
      )}
    </svg>
  );
}

// ── Pivot table ───────────────────────────────────────────────────────────────

// Extract the numeric part and unit from a formatted value string ("3.300 V" → {num: 3.3, unit: "V"})
function splitNumericValue(raw: string): { num: number; unit: string } | null {
  const num = parseFloat(raw);
  if (isNaN(num)) return null;
  const unit = raw.replace(/^[\s\-\d.e+]+/i, '').trim();
  return { num, unit };
}

export function TelemetryTab({ tableId, defaultCmd, sourceFile }: { tableId: string; defaultCmd?: string; sourceFile?: string }) {
  const { rows, loading } = useFramePackets(tableId);
  const [selectedCmd, setSelectedCmd] = useState<string | null>(defaultCmd ?? null);
  const [selectedCol, setSelectedCol] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [exportFields, setExportFields] = useState<Set<string>>(new Set());

  const exchanges = useMemo(() => buildExchanges(rows), [rows]);
  const allEntries = useMemo(() => buildTimeline(exchanges), [exchanges]);

  const availCmds = useMemo(
    () => [...new Set(allEntries.map(e => e.cmdId))].sort(),
    [allEntries],
  );

  const activeCmd = selectedCmd
    ?? (defaultCmd && availCmds.includes(defaultCmd) ? defaultCmd
      : availCmds.includes('tlm_beacon') ? 'tlm_beacon'
      : availCmds[0] ?? null);

  const cmdEntries = useMemo(
    () => (activeCmd ? allEntries.filter(e => e.cmdId === activeCmd) : []),
    [allEntries, activeCmd],
  );

  // Ordered, deduplicated column names for the active command
  const colNames = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const entry of cmdEntries) {
      for (const sec of entry.sections) {
        for (const r of sec.rows) {
          if (!seen.has(r.k)) { seen.add(r.k); ordered.push(r.k); }
        }
      }
    }
    return ordered;
  }, [cmdEntries]);

  // Pivot: one row per entry, fields keyed by column name (newest-first)
  const pivotRows = useMemo(() =>
    [...cmdEntries].reverse().map(entry => {
      const fields = new Map<string, string>();
      for (const sec of entry.sections) {
        for (const r of sec.rows) fields.set(r.k, r.v);
      }
      return { ts: entry.ts, ptype: entry.ptype, fields };
    }),
    [cmdEntries],
  );

  // Numeric time series for the selected column
  const { seriesPoints, unit: seriesUnit } = useMemo(() => {
    if (!selectedCol) return { seriesPoints: [], unit: '' };
    let unit = '';
    const pts = [...pivotRows].reverse()
      .map(r => {
        const raw = r.fields.get(selectedCol);
        if (!raw) return null;
        const parsed = splitNumericValue(raw);
        if (!parsed) return null;
        if (!unit && parsed.unit) unit = parsed.unit;
        return { ts: r.ts, val: parsed.num };
      })
      .filter((d): d is { ts: number; val: number } => d !== null);
    return { seriesPoints: pts, unit };
  }, [pivotRows, selectedCol]);

  // Stats for selected column
  const colStats = useMemo(() => {
    if (!selectedCol) return null;
    const allRaw = [...pivotRows].reverse()
      .map(r => r.fields.get(selectedCol))
      .filter((v): v is string => v != null);
    if (allRaw.length === 0) return null;
    if (seriesPoints.length > 0) {
      const vals = seriesPoints.map(p => p.val);
      const min = Math.min(...vals), max = Math.max(...vals);
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const stddev = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
      return { kind: 'numeric' as const, count: allRaw.length, min, max, mean, stddev };
    }
    const counts = new Map<string, number>();
    for (const v of allRaw) counts.set(v, (counts.get(v) ?? 0) + 1);
    return {
      kind: 'categorical' as const,
      count: allRaw.length,
      dist: [...counts.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [selectedCol, pivotRows, seriesPoints]);

  // Keep export field selection in sync when the active command (and its columns) changes.
  // Use a join-key so the effect only fires when the column list actually changes.
  const colNamesKey = colNames.join('\x00');
  useEffect(() => {
    setExportFields(new Set(colNames));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colNamesKey]);

  const handleExportCsv = () => {
    const cols = colNames.filter(c => exportFields.has(c));
    const header = ['ts_ms', 'time_utc', ...cols];
    const lines = [header.join(',')];
    for (const row of [...pivotRows].reverse()) {
      const cells = [
        String(row.ts),
        new Date(row.ts).toISOString(),
        ...cols.map(c => {
          const v = row.fields.get(c) ?? '';
          return (v.includes(',') || v.includes('"') || v.includes('\n'))
            ? `"${v.replace(/"/g, '""')}"` : v;
        }),
      ];
      lines.push(cells.join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeCmd ?? 'telemetry'}_export.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const COL_W = 88;
  const TS_W  = 96;

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

      {/* ── Table area ── */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>

        {/* Title — name the decoded telemetry table after its source file */}
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 8, flexShrink: 0,
          padding: '5px 12px', borderBottom: `1px solid ${C.borderSubtle}`,
          backgroundColor: C.bgPanel, fontFamily: C.fontMono,
        }}>
          <span style={{ fontSize: 9.5, color: C.textDisabled, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            decoded telemetry
          </span>
          <span style={{ fontSize: 12, color: C.textPrimary }}>
            {sourceFile || tableId}
          </span>
        </div>

        {/* Command selector */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, flexWrap: 'wrap',
          padding: '5px 12px', borderBottom: `1px solid ${C.borderSubtle}`,
          backgroundColor: C.bgApp, fontFamily: C.fontMono,
        }}>
          <span style={{ fontSize: 9.5, color: C.textDisabled, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            command
          </span>
          {availCmds.map(cmd => (
            <button
              key={cmd}
              onClick={() => { setSelectedCmd(cmd); setSelectedCol(null); }}
              style={{
                padding: '2px 8px', borderRadius: 3, cursor: 'pointer',
                fontSize: 10, fontFamily: C.fontMono,
                backgroundColor: cmd === activeCmd ? C.activeFill : 'transparent',
                color: cmd === activeCmd ? C.active : C.textMuted,
                border: `1px solid ${cmd === activeCmd ? `${C.active}44` : C.borderSubtle}`,
              }}
            >{cmd}</button>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: 10, color: C.textMuted }}>
            <span style={{ color: C.textPrimary }}>{pivotRows.length}</span> rows
            {' · '}
            <span style={{ color: C.textPrimary }}>{colNames.length}</span> fields
          </span>
          {pivotRows.length > 0 && (
            <button
              onClick={() => setShowExport(v => !v)}
              style={{
                padding: '2px 10px', borderRadius: 3, cursor: 'pointer',
                fontSize: 10, fontFamily: C.fontMono,
                backgroundColor: showExport ? C.activeFill : 'transparent',
                color: showExport ? C.active : C.textMuted,
                border: `1px solid ${showExport ? `${C.active}44` : C.borderSubtle}`,
              }}
            >
              ↓ Export CSV
            </button>
          )}
        </div>

        {/* Field picker for CSV export */}
        {showExport && pivotRows.length > 0 && (
          <div style={{
            flexShrink: 0, borderBottom: `1px solid ${C.borderStrong}`,
            backgroundColor: C.bgPanel, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 9.5, fontFamily: C.fontMono, color: C.textDisabled, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                fields to export
              </span>
              <span style={{ fontSize: 9.5, fontFamily: C.fontMono, color: C.textDisabled }}>
                ({exportFields.size} / {colNames.length})
              </span>
              <button
                onClick={() => setExportFields(new Set(colNames))}
                style={{ padding: '1px 7px', borderRadius: 2, cursor: 'pointer', fontSize: 9, fontFamily: C.fontMono, backgroundColor: C.bgApp, color: C.textMuted, border: `1px solid ${C.borderSubtle}` }}
              >all</button>
              <button
                onClick={() => setExportFields(new Set())}
                style={{ padding: '1px 7px', borderRadius: 2, cursor: 'pointer', fontSize: 9, fontFamily: C.fontMono, backgroundColor: C.bgApp, color: C.textMuted, border: `1px solid ${C.borderSubtle}` }}
              >none</button>
              <button
                onClick={handleExportCsv}
                disabled={exportFields.size === 0}
                style={{
                  marginLeft: 'auto', padding: '3px 14px', borderRadius: 3, cursor: exportFields.size === 0 ? 'not-allowed' : 'pointer',
                  fontSize: 10.5, fontFamily: C.fontMono, fontWeight: 700,
                  backgroundColor: exportFields.size > 0 ? C.active : C.bgPanelRaised,
                  color: exportFields.size > 0 ? C.bgApp : C.textDisabled,
                  border: 'none',
                }}
              >
                ↓ Download {pivotRows.length} rows
              </button>
            </div>
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: '3px 6px',
              maxHeight: 88, overflowY: 'auto',
              padding: '4px 6px',
              backgroundColor: C.bgApp, border: `1px solid ${C.borderSubtle}`, borderRadius: 3,
            }}>
              {colNames.map(col => {
                const checked = exportFields.has(col);
                return (
                  <label
                    key={col}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '2px 7px', borderRadius: 3, cursor: 'pointer',
                      backgroundColor: checked ? C.activeFill : 'transparent',
                      border: `1px solid ${checked ? `${C.active}44` : C.borderSubtle}`,
                      fontSize: 10, fontFamily: C.fontMono,
                      color: checked ? C.active : C.textMuted,
                      userSelect: 'none',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = new Set(exportFields);
                        checked ? next.delete(col) : next.add(col);
                        setExportFields(next);
                      }}
                      style={{ display: 'none' }}
                    />
                    {col}
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Pivot table */}
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          {loading && (
            <div style={{ padding: 32, textAlign: 'center', color: C.textMuted, fontSize: 12, fontFamily: C.fontMono }}>
              loading…
            </div>
          )}
          {!loading && pivotRows.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: C.textMuted, fontSize: 12, fontFamily: C.fontMono }}>
              no decoded telemetry in this table
            </div>
          )}
          {!loading && pivotRows.length > 0 && (
            <table style={{
              borderCollapse: 'collapse',
              tableLayout: 'fixed',
              fontSize: 10,
              fontFamily: C.fontMono,
              width: 'max-content',
              minWidth: '100%',
            }}>
              <thead>
                <tr style={{
                  position: 'sticky', top: 0, zIndex: 2,
                  backgroundColor: C.bgPanel,
                  borderBottom: `2px solid ${C.borderStrong}`,
                }}>
                  {/* Timestamp column — sticky left */}
                  <th style={{
                    width: TS_W, minWidth: TS_W, padding: '5px 8px',
                    textAlign: 'left', color: C.textDisabled,
                    fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase',
                    borderRight: `1px solid ${C.borderStrong}`,
                    position: 'sticky', left: 0, zIndex: 3,
                    backgroundColor: C.bgPanel,
                    fontWeight: 'normal',
                  }}>time</th>

                  {colNames.map(col => {
                    const isSel = col === selectedCol;
                    return (
                      <th
                        key={col}
                        onClick={() => setSelectedCol(isSel ? null : col)}
                        title={col}
                        style={{
                          width: COL_W, minWidth: COL_W, padding: '5px 6px',
                          textAlign: 'right', cursor: 'pointer',
                          color: isSel ? C.active : C.textMuted,
                          backgroundColor: isSel ? C.activeFill : C.bgPanel,
                          borderRight: `1px solid ${C.borderSubtle}`,
                          userSelect: 'none', fontWeight: 'normal',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          maxWidth: COL_W,
                        }}
                      >
                        {col}{isSel && <span style={{ marginLeft: 3, fontSize: 7, opacity: 0.6 }}>▾</span>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {pivotRows.map((row, i) => (
                  <tr
                    key={i}
                    style={{ borderBottom: `1px solid ${C.borderSubtle}` }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.02)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = ''; }}
                  >
                    <td style={{
                      padding: '4px 8px', color: C.textDisabled,
                      borderRight: `1px solid ${C.borderStrong}`,
                      whiteSpace: 'nowrap',
                      position: 'sticky', left: 0, zIndex: 1,
                      backgroundColor: C.bgPanel,
                    }}>
                      {ts(row.ts)}
                    </td>
                    {colNames.map(col => {
                      const val = row.fields.get(col);
                      const isSel = col === selectedCol;
                      return (
                        <td
                          key={col}
                          title={val ?? ''}
                          style={{
                            padding: '4px 6px', textAlign: 'right',
                            color: val != null ? C.textPrimary : C.textDisabled,
                            backgroundColor: isSel ? 'rgba(74,158,255,0.05)' : undefined,
                            borderRight: `1px solid ${C.borderSubtle}`,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            maxWidth: COL_W,
                          }}
                        >
                          {val ?? '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Sidebar ── */}
      {selectedCol && (
        <div style={{
          width: 280, flexShrink: 0,
          borderLeft: `1px solid ${C.borderStrong}`,
          backgroundColor: C.bgPanelRaised,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Sidebar header */}
          <div style={{
            padding: '9px 12px 8px',
            borderBottom: `1px solid ${C.borderSubtle}`,
            display: 'flex', alignItems: 'flex-start', gap: 6,
            flexShrink: 0,
          }}>
            <span style={{
              fontFamily: C.fontMono, fontSize: 11, color: C.textPrimary,
              flex: 1, wordBreak: 'break-all', lineHeight: 1.4,
            }}>
              {selectedCol}
            </span>
            <button
              onClick={() => setSelectedCol(null)}
              style={{ background: 'transparent', border: 0, color: C.textDisabled, cursor: 'pointer', fontSize: 15, padding: '0 2px', flexShrink: 0 }}
            >×</button>
          </div>

          {/* Sidebar body */}
          <div style={{ flex: 1, overflow: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Last value */}
            <div>
              <div style={{ fontSize: 9, color: C.textDisabled, fontFamily: C.fontMono, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
                latest
              </div>
              <div style={{ fontSize: 20, fontFamily: C.fontMono, color: C.active, wordBreak: 'break-all', lineHeight: 1.2 }}>
                {pivotRows[0]?.fields.get(selectedCol) ?? '—'}
              </div>
            </div>

            {/* Numeric: plot + stats */}
            {seriesPoints.length > 0 && (
              <>
                <div>
                  <div style={{ fontSize: 9, color: C.textDisabled, fontFamily: C.fontMono, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
                    time series · {seriesPoints.length} samples
                  </div>
                  <div style={{ backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 4, overflow: 'hidden', border: `1px solid ${C.borderSubtle}` }}>
                    <TimeSeriesPlot points={seriesPoints} unit={seriesUnit} />
                  </div>
                </div>

                {colStats?.kind === 'numeric' && (
                  <div>
                    <div style={{ fontSize: 9, color: C.textDisabled, fontFamily: C.fontMono, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
                      statistics
                    </div>
                    {[
                      { k: 'min',    v: colStats.min.toPrecision(6) },
                      { k: 'max',    v: colStats.max.toPrecision(6) },
                      { k: 'mean',   v: colStats.mean.toPrecision(6) },
                      { k: 'stddev', v: colStats.stddev.toPrecision(4) },
                      { k: 'n',      v: String(colStats.count) },
                    ].map(s => (
                      <div key={s.k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, gap: 8 }}>
                        <span style={{ fontSize: 10, color: C.textDisabled, fontFamily: C.fontMono }}>{s.k}</span>
                        <span style={{ fontSize: 10, color: C.textPrimary, fontFamily: C.fontMono }}>{s.v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Categorical: value distribution */}
            {colStats?.kind === 'categorical' && (
              <div>
                <div style={{ fontSize: 9, color: C.textDisabled, fontFamily: C.fontMono, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
                  distribution · {colStats.count} samples
                </div>
                {colStats.dist.map(([v, n]) => (
                  <div key={v} style={{ marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2, gap: 8 }}>
                      <span style={{ fontSize: 10, color: C.textPrimary, fontFamily: C.fontMono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {v}
                      </span>
                      <span style={{ fontSize: 10, color: C.textDisabled, fontFamily: C.fontMono, flexShrink: 0 }}>
                        {n}×
                      </span>
                    </div>
                    {/* Bar */}
                    <div style={{ height: 3, backgroundColor: C.borderSubtle, borderRadius: 2 }}>
                      <div style={{
                        height: 3, borderRadius: 2,
                        backgroundColor: C.active,
                        width: `${(n / colStats.count) * 100}%`,
                        opacity: 0.7,
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface DecodedFramesTabProps {
  tableId: string;
}

const PAGE = 100;

export function DecodedFramesTab({ tableId }: DecodedFramesTabProps) {
  const { rows, loading } = useFramePackets(tableId);
  const [filter, setFilter] = useState('');
  const [ptypeFilter, setPtypeFilter] = useState<Set<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(PAGE);

  // Reset pagination when table or filters change
  useEffect(() => { setVisibleCount(PAGE); }, [tableId, filter, ptypeFilter]);

  const exchanges = useMemo(() => buildExchanges(rows), [rows]);

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    return exchanges.filter(e => {
      if (q && !e.cmdId.toLowerCase().includes(q) && !e.fileName?.toLowerCase().includes(q)) return false;
      if (ptypeFilter.size > 0) {
        const ptypes = new Set(e.packets.map(p => p.ptype));
        if (![...ptypeFilter].some(pt => ptypes.has(pt))) return false;
      }
      return true;
    });
  }, [exchanges, filter, ptypeFilter]);

  const allPtypes = ['CMD', 'ACK', 'RES', 'TLM', 'FILE'];
  const togglePtype = (pt: string) => {
    setPtypeFilter(prev => {
      const next = new Set(prev);
      if (next.has(pt)) next.delete(pt); else next.add(pt);
      return next;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Filter bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        padding: '6px 12px',
        borderBottom: `1px solid ${C.borderSubtle}`,
        backgroundColor: C.bgApp,
        fontFamily: C.fontMono, fontSize: 11,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center',
          backgroundColor: C.bgPanelRaised,
          border: `1px solid ${C.borderSubtle}`,
          borderRadius: 3, padding: '0 6px',
          flex: '0 1 240px',
        }}>
          <span style={{ color: C.textDisabled, marginRight: 6 }}>⌕</span>
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="filter commands…"
            style={{
              flex: 1, background: 'transparent', border: 0, outline: 'none',
              color: C.textPrimary, fontFamily: C.fontMono, fontSize: 11,
              padding: '4px 0', minWidth: 0,
            }}
          />
          {filter && (
            <button onClick={() => setFilter('')}
              style={{ background: 'transparent', border: 0, color: C.textDisabled, cursor: 'pointer', padding: '0 4px' }}>×</button>
          )}
        </div>

        {/* Ptype toggles */}
        <span style={{ color: C.textDisabled, fontSize: 10 }}>show:</span>
        {allPtypes.map(pt => {
          const active = ptypeFilter.size === 0 || ptypeFilter.has(pt);
          const clr = PTYPE_CLR[pt];
          return (
            <button
              key={pt}
              onClick={() => togglePtype(pt)}
              style={{
                padding: '2px 7px', borderRadius: 3, cursor: 'pointer',
                fontSize: 9.5, fontFamily: C.fontMono,
                backgroundColor: active ? clr.bg : 'transparent',
                color: active ? clr.fg : C.textDisabled,
                border: `1px solid ${active ? clr.fg + '44' : C.borderSubtle}`,
              }}
            >
              {pt}
            </button>
          );
        })}

        <span style={{ marginLeft: 'auto', color: C.textMuted, fontSize: 10 }}>
          <span style={{ color: C.textPrimary }}>{filtered.length}</span>
          {' '}/ {exchanges.length} exchanges
        </span>
      </div>

      {/* Exchange list */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {loading && (
          <div style={{ padding: 32, textAlign: 'center', color: C.textMuted, fontSize: 12, fontFamily: C.fontMono }}>
            loading packets…
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div style={{
            padding: 32, textAlign: 'center',
            color: C.textMuted, fontSize: 12, fontFamily: C.fontMono,
          }}>
            {rows.length === 0 ? 'no packet events in this table' : 'no exchanges match filter'}
          </div>
        )}
        {!loading && filtered.slice(0, visibleCount).map(e => (
          <ExchangeCard key={e.id} exchange={e} />
        ))}
        {!loading && visibleCount < filtered.length && (
          <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={() => setVisibleCount(n => n + PAGE)}
              style={{
                padding: '5px 16px', fontSize: 11, fontFamily: C.fontMono,
                backgroundColor: C.bgPanelRaised, color: C.textMuted,
                border: `1px solid ${C.borderSubtle}`, borderRadius: 3, cursor: 'pointer',
              }}
            >
              show more
            </button>
            <span style={{ fontSize: 10, color: C.textDisabled, fontFamily: C.fontMono }}>
              {visibleCount} of {filtered.length} exchanges
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
