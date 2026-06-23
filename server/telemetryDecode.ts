// Server-side telemetry decode logic (mirrors DecodedFramesTab.tsx client decode).
// Uses Node.js Buffer instead of DataView/Uint8Array.

export interface DecodedField {
  field: string;
  value: string;
  unit: string;
}

const HDR = 8;

// Extract cmdName + argsBytes from an inner_hex string.
export function parseInnerHex(
  hex: string,
): { cmdName: string; argsBytes: Buffer; argsText: string | null } | null {
  if (!hex || hex.length < (HDR + 2) * 2) return null;
  let b: Buffer;
  try { b = Buffer.from(hex, 'hex'); } catch { return null; }
  if (b.length < HDR + 2) return null;

  const nameLen  = b[HDR];
  const argsLen  = b[HDR + 1];
  const nameStart = HDR + 2;
  if (nameStart + nameLen + 1 > b.length) return null;

  const cmdName  = b.subarray(nameStart, nameStart + nameLen).toString('ascii');
  const argsStart = nameStart + nameLen + 1;
  const argsBytes = b.subarray(argsStart, argsStart + argsLen);

  const isPrintable = argsBytes.length === 0 ||
    argsBytes.every(x => x === 0 || x === 9 || x === 10 || x === 13 || (x >= 32 && x < 127));
  const argsText = isPrintable && argsBytes.length > 0
    ? [...argsBytes].filter(x => x !== 0).map(x => String.fromCharCode(x)).join('').trim()
    : null;

  return { cmdName, argsBytes, argsText };
}

// ── Binary decoders ───────────────────────────────────────────────────────────

function decodeTlmBeacon(b: Buffer): DecodedField[] | null {
  if (b.length < 98) return null;

  const callsign = [...b.subarray(0, 7)]
    .filter(x => x >= 32 && x < 127).map(x => String.fromCharCode(x)).join('');

  const timeLow  = b.readUInt32LE(7);
  const timeHigh = b.readUInt32LE(11);
  const timeMs   = timeHigh * 4_294_967_296 + timeLow;

  const statReg = b.readUInt32LE(36);
  const gncMode = b.length > 98 ? b[98] : 0;

  const fields: DecodedField[] = [
    { field: 'callsign',           value: callsign,                              unit: '' },
    { field: 'time_ms',            value: String(timeMs),                        unit: 'ms' },
    { field: 'ops_stage',          value: String(b[15]),                         unit: '' },
    { field: 'hn_state',           value: String(b[34]),                         unit: '' },
    { field: 'ab_state',           value: String(b[35]),                         unit: '' },
    { field: 'ertc_heartbeat',     value: String(b[30]),                         unit: '' },
    { field: 'mtq_heartbeat',      value: String(b[31]),                         unit: '' },
    { field: 'nvg_heartbeat',      value: String(b[32]),                         unit: '' },
    { field: 'eps_heartbeat',      value: String(b[33]),                         unit: '' },
    { field: 'lppm_rbt_cnt',       value: String(b.readUInt16LE(16)),            unit: '' },
    { field: 'lppm_rbt_cause',     value: String(b[18]),                         unit: '' },
    { field: 'lppm_time_to_rst',   value: String(b.readUInt32LE(22)),            unit: 's' },
    { field: 'uppm_rbt_cnt',       value: String(b.readUInt16LE(19)),            unit: '' },
    { field: 'uppm_rbt_cause',     value: String(b[21]),                         unit: '' },
    { field: 'uppm_time_to_rst',   value: String(b.readUInt32LE(26)),            unit: 's' },
    { field: 'gnc_mode',           value: String(gncMode),                       unit: '' },
    { field: 'stat_reg',           value: String(statReg),                       unit: '' },
    { field: 'rate_x',             value: b.readFloatLE(42).toFixed(6),          unit: 'rad/s' },
    { field: 'rate_y',             value: b.readFloatLE(46).toFixed(6),          unit: 'rad/s' },
    { field: 'rate_z',             value: b.readFloatLE(50).toFixed(6),          unit: 'rad/s' },
    { field: 'mag_x',              value: b.readFloatLE(54).toFixed(4),          unit: 'µT' },
    { field: 'mag_y',              value: b.readFloatLE(58).toFixed(4),          unit: 'µT' },
    { field: 'mag_z',              value: b.readFloatLE(62).toFixed(4),          unit: 'µT' },
    { field: 'mtq_x',             value: b.readFloatLE(66).toFixed(5),           unit: 'A·m²' },
    { field: 'mtq_y',             value: b.readFloatLE(70).toFixed(5),           unit: 'A·m²' },
    { field: 'mtq_z',             value: b.readFloatLE(74).toFixed(5),           unit: 'A·m²' },
    { field: 'adcs_tmp',           value: b.readFloatLE(78).toFixed(2),          unit: '°C' },
    { field: 'eps_i_bus',          value: (b.readUInt16LE(82) / 1000).toFixed(3), unit: 'A' },
    { field: 'eps_i_bat',          value: (b.readUInt16LE(84) / 1000).toFixed(3), unit: 'A' },
    { field: 'eps_v_bus',          value: (b.readUInt16LE(86) / 1000).toFixed(3), unit: 'V' },
    { field: 'eps_v_bat',          value: (b.readUInt16LE(88) / 1000).toFixed(3), unit: 'V' },
    { field: 'eps_v_sys',          value: (b.readUInt16LE(90) / 1000).toFixed(3), unit: 'V' },
    { field: 'eps_ts_adc',         value: (b.readUInt16LE(92) * 0.0976563).toFixed(2), unit: '%' },
    { field: 'eps_t_die',          value: (b.readUInt16LE(94) * 0.5).toFixed(1), unit: '°C' },
    { field: 'eps_mode',           value: String(b.readUInt16LE(96)),            unit: '' },
  ];

  if (b.length >= 101) fields.push({ field: 'unexpected_safe',      value: String(b.readUInt16LE(99)),  unit: '' });
  if (b.length >= 103) fields.push({ field: 'unexpected_detumble',  value: String(b.readUInt16LE(101)), unit: '' });
  if (b.length >= 105) fields.push({ field: 'sunspin',              value: String(b.readUInt16LE(103)), unit: '' });

  return fields;
}

function decodeEpsHk(b: Buffer): DecodedField[] | null {
  if (b.length < 96) return null;
  const i16 = (idx: number) => b.readInt16LE(idx * 2);
  const u16 = (idx: number) => b.readUInt16LE(idx * 2);
  return [
    { field: 'I_BUS',  value: (i16(0)  / 1000).toFixed(3), unit: 'A'  },
    { field: 'I_BAT',  value: (i16(1)  / 1000).toFixed(3), unit: 'A'  },
    { field: 'V_BUS',  value: (u16(2)  / 1000).toFixed(3), unit: 'V'  },
    { field: 'V_AC1',  value: (u16(3)  / 1000).toFixed(3), unit: 'V'  },
    { field: 'V_AC2',  value: (u16(4)  / 1000).toFixed(3), unit: 'V'  },
    { field: 'V_BAT',  value: (u16(5)  / 1000).toFixed(3), unit: 'V'  },
    { field: 'V_SYS',  value: (u16(6)  / 1000).toFixed(3), unit: 'V'  },
    { field: 'TS_ADC', value: (i16(7)  * 0.0976563).toFixed(2), unit: '%'  },
    { field: 'T_DIE',  value: (i16(8)  * 0.5).toFixed(1),  unit: '°C' },
    { field: 'V3V3',   value: (u16(9)  / 1000).toFixed(3), unit: 'V'  },
    { field: 'I3V3',   value: (i16(10) / 1000).toFixed(3), unit: 'A'  },
    { field: 'P3V3',   value: (u16(11) / 1000).toFixed(3), unit: 'W'  },
    { field: 'V5V0',   value: (u16(12) / 1000).toFixed(3), unit: 'V'  },
    { field: 'I5V0',   value: (i16(13) / 1000).toFixed(3), unit: 'A'  },
    { field: 'P5V0',   value: (u16(14) / 1000).toFixed(3), unit: 'W'  },
    { field: 'VOUT1',  value: (u16(15) / 1000).toFixed(3), unit: 'V'  },
    { field: 'IOUT1',  value: (i16(16) / 1000).toFixed(3), unit: 'A'  },
    { field: 'POUT1',  value: (u16(17) / 1000).toFixed(3), unit: 'W'  },
    { field: 'VOUT2',  value: (u16(18) / 1000).toFixed(3), unit: 'V'  },
    { field: 'IOUT2',  value: (i16(19) / 1000).toFixed(3), unit: 'A'  },
    { field: 'POUT2',  value: (u16(20) / 1000).toFixed(3), unit: 'W'  },
    { field: 'VOUT3',  value: (u16(21) / 1000).toFixed(3), unit: 'V'  },
    { field: 'IOUT3',  value: (i16(22) / 1000).toFixed(3), unit: 'A'  },
    { field: 'POUT3',  value: (u16(23) / 1000).toFixed(3), unit: 'W'  },
    { field: 'VOUT4',  value: (u16(24) / 1000).toFixed(3), unit: 'V'  },
    { field: 'IOUT4',  value: (i16(25) / 1000).toFixed(3), unit: 'A'  },
    { field: 'POUT4',  value: (u16(26) / 1000).toFixed(3), unit: 'W'  },
    { field: 'VOUT5',  value: (u16(27) / 1000).toFixed(3), unit: 'V'  },
    { field: 'IOUT5',  value: (i16(28) / 1000).toFixed(3), unit: 'A'  },
    { field: 'POUT5',  value: (u16(29) / 1000).toFixed(3), unit: 'W'  },
    { field: 'VOUT6',  value: (u16(30) / 1000).toFixed(3), unit: 'V'  },
    { field: 'IOUT6',  value: (i16(31) / 1000).toFixed(3), unit: 'A'  },
    { field: 'POUT6',  value: (u16(32) / 1000).toFixed(3), unit: 'W'  },
    { field: 'VBRN1',  value: (u16(33) / 1000).toFixed(3), unit: 'V'  },
    { field: 'IBRN1',  value: (i16(34) / 1000).toFixed(3), unit: 'A'  },
    { field: 'PBRN1',  value: (u16(35) / 1000).toFixed(3), unit: 'W'  },
    { field: 'VBRN2',  value: (u16(36) / 1000).toFixed(3), unit: 'V'  },
    { field: 'IBRN2',  value: (i16(37) / 1000).toFixed(3), unit: 'A'  },
    { field: 'PBRN2',  value: (u16(38) / 1000).toFixed(3), unit: 'W'  },
    { field: 'VSIN1',  value: (u16(39) / 1000).toFixed(3), unit: 'V'  },
    { field: 'ISIN1',  value: (i16(40) / 1000).toFixed(3), unit: 'A'  },
    { field: 'PSIN1',  value: (u16(41) / 1000).toFixed(3), unit: 'W'  },
    { field: 'VSIN2',  value: (u16(42) / 1000).toFixed(3), unit: 'V'  },
    { field: 'ISIN2',  value: (i16(43) / 1000).toFixed(3), unit: 'A'  },
    { field: 'PSIN2',  value: (u16(44) / 1000).toFixed(3), unit: 'W'  },
    { field: 'VSIN3',  value: (u16(45) / 1000).toFixed(3), unit: 'V'  },
    { field: 'ISIN3',  value: (i16(46) / 1000).toFixed(3), unit: 'A'  },
    { field: 'PSIN3',  value: (u16(47) / 1000).toFixed(3), unit: 'W'  },
  ];
}

function decodeMagTlm(b: Buffer): DecodedField[] | null {
  if (b.length < 8) return null;
  const tsS = b.readFloatLE(0);
  const fields: DecodedField[] = [
    { field: 'timestamp_s', value: String(tsS), unit: 's' },
  ];
  for (let i = 4; i + 4 <= b.length; i += 4) {
    fields.push({ field: `f${(i - 4) / 4 + 1}`, value: b.readFloatLE(i).toFixed(4), unit: '' });
  }
  return fields;
}

// ── Text response decoder ─────────────────────────────────────────────────────

const MTQ_REG: Record<number, string> = { 13: 'MAG0_S', 78: 'MTQ', 133: 'CAL_MAG_B' };

function parseTextDecoded(argsText: string): DecodedField[] {
  // Paged register format: "reg v1 v2 ..., reg v1 ..."
  if (argsText.includes(',')) {
    const rows: DecodedField[] = [];
    for (const g of argsText.split(',')) {
      const tokens = g.trim().split(/\s+/).filter(Boolean);
      if (tokens.length < 2) continue;
      const regId = parseInt(tokens[0]);
      if (isNaN(regId) || regId < 0) continue;
      const name = MTQ_REG[regId] ?? `reg.${regId}`;
      const last = tokens[tokens.length - 1];
      const hasFlag = tokens.length > 2 && (last === '0' || last === '1') && !last.includes('.');
      const vals = hasFlag ? tokens.slice(1, -1) : tokens.slice(1);
      if (vals.length === 1) {
        rows.push({ field: name, value: vals[0], unit: '' });
      } else {
        vals.forEach((v, i) => rows.push({ field: `${name}.${i}`, value: v, unit: '' }));
      }
    }
    if (rows.length > 0) return rows;
  }
  // Single register GET: "module register v1 v2 ..."
  if (/^\d+ \d+ /.test(argsText)) {
    const tokens = argsText.trim().split(/\s+/);
    if (tokens.length >= 3) {
      const regId = parseInt(tokens[1]);
      const name = MTQ_REG[regId] ?? `reg.${regId}`;
      const vals = tokens.slice(2);
      if (vals.length === 1) return [{ field: name, value: vals[0], unit: '' }];
      return vals.map((v, i) => ({ field: `${name}.${i}`, value: v, unit: '' }));
    }
  }
  // Plain short text
  if (argsText.length <= 160) return [{ field: 'args', value: argsText, unit: '' }];
  return [];
}

// ── Main entry point ──────────────────────────────────────────────────────────

// Decode one TLM/RES row's inner_hex into a list of named fields.
export function decodeRow(cmdId: string, innerHex: string): DecodedField[] {
  const parsed = parseInnerHex(innerHex);
  if (!parsed) return [];
  const { argsBytes, argsText } = parsed;

  if (!argsText && argsBytes.length > 0) {
    if (cmdId === 'tlm_beacon') return decodeTlmBeacon(argsBytes) ?? [];
    if (cmdId === 'eps_hk')    return decodeEpsHk(argsBytes)    ?? [];
    if (cmdId === 'mag_tlm')   return decodeMagTlm(argsBytes)   ?? [];

    // Generic: try float32 LE array
    const floats: DecodedField[] = [];
    for (let i = 0; i + 4 <= argsBytes.length; i += 4) {
      const f = argsBytes.readFloatLE(i);
      if (isFinite(f) && Math.abs(f) < 1e9) floats.push({ field: `f${i / 4}`, value: f.toFixed(4), unit: '' });
    }
    if (floats.length > 0 && floats.some(x => parseFloat(x.value) !== 0)) return floats;
    return [];
  }

  if (argsText) return parseTextDecoded(argsText);
  return [];
}
