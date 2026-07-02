import { existsSync, readFileSync } from 'fs';

export interface CatalogField {
  field: string;
  value: string;
  unit: string;
}

interface ParamType {
  kind: string;
  sizeBits?: number;
  signed?: boolean;
  byteOrder?: 'little' | 'big';
  unit?: string;
  arrayTypeRef?: string;
  dimensionList?: number[];
  fixedSizeBytes?: number;
  encoding?: string;
  polynomial?: number[];
  values?: Record<number, string>;
  dynamicRef?: string;
}

interface ParameterDef {
  type: string;
  domain?: string;
}

interface EntryDef {
  name: string;
  type?: string;
  emit: boolean;
  repeatToEnd?: boolean;
}

interface BitfieldEntry {
  name: string;
  bits: [number, number];
  kind: string;
  enumRef?: string;
  unit?: string;
}

interface BitfieldType {
  sizeBits: number;
  byteOrder: 'little' | 'big';
  entries: BitfieldEntry[];
}

interface ContainerDef {
  id: string;
  domain?: string;
  layout?: string;
  cmdId?: string;
  ptype?: string;
  abstract: boolean;
  baseContainerRef?: string;
  parentArgs?: Record<string, number>;
  entries: EntryDef[];
  hasPagedFrame: boolean;
}

export interface MissionCatalog {
  path: string | null;
  parameters: Map<string, ParameterDef>;
  parameterTypes: Map<string, ParamType>;
  bitfields: Map<string, BitfieldType>;
  containers: ContainerDef[];
  registerContainers: Map<string, ContainerDef>;
}

const DEFAULT_MISSION_PATH = '/Users/aloysius/Downloads/mission.yml';

const BUILTIN_TYPES: Record<string, ParamType> = {
  u8:          { kind: 'int', sizeBits: 8, signed: false },
  u16:         { kind: 'int', sizeBits: 16, signed: false, byteOrder: 'little' },
  u32:         { kind: 'int', sizeBits: 32, signed: false, byteOrder: 'little' },
  u64:         { kind: 'int', sizeBits: 64, signed: false, byteOrder: 'little' },
  i16:         { kind: 'int', sizeBits: 16, signed: true, byteOrder: 'little' },
  f32_le:      { kind: 'float', sizeBits: 32, byteOrder: 'little' },
  ascii_token: { kind: 'string', encoding: 'ascii_token' },
  ascii_blob:  { kind: 'string', encoding: 'to_end' },
};

let cache: MissionCatalog | null = null;

export function getMissionCatalog(): MissionCatalog | null {
  const path = process.env.MAVERIC_MISSION_YML || DEFAULT_MISSION_PATH;
  if (!existsSync(path)) return null;
  if (cache?.path === path) return cache;
  cache = parseMissionYaml(readFileSync(path, 'utf8'), path);
  return cache;
}

export function getCatalogParameterRows(): { name: string; unit: string; domain: string; type: string }[] {
  const catalog = getMissionCatalog();
  if (!catalog) return [];
  return [...catalog.parameters.entries()].map(([name, def]) => {
    const type = resolveType(catalog, def.type);
    return { name, unit: type?.unit ?? '', domain: def.domain ?? '', type: def.type };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function decodeWithMissionCatalog(cmdId: string, ptype: string, argsBytes: Buffer, argsText: string | null): CatalogField[] {
  const catalog = getMissionCatalog();
  if (!catalog) return [];

  const container = catalog.containers.find((c) =>
    !c.abstract &&
    c.cmdId === cmdId &&
    (!c.ptype || !ptype || c.ptype === ptype) &&
    (c.layout === 'binary' || c.layout === 'ascii_tokens')
  );
  if (!container) return [];

  if (container.hasPagedFrame && argsText) {
    return decodePagedFrame(catalog, container, argsText);
  }
  if (container.layout === 'binary') {
    return decodeBinaryContainer(catalog, container, argsBytes);
  }
  if (container.layout === 'ascii_tokens' && argsText) {
    return decodeAsciiContainer(catalog, container, argsText);
  }
  return [];
}

function parseMissionYaml(text: string, path: string): MissionCatalog {
  const sections = {
    parameterTypes: section(text, 'parameter_types', 'argument_types'),
    parameters: section(text, 'parameters', 'bitfield_types'),
    bitfields: section(text, 'bitfield_types', 'sequence_containers'),
    containers: section(text, 'sequence_containers', 'verifier_specs'),
  };
  const catalog: MissionCatalog = {
    path,
    parameters: parseParameters(sections.parameters),
    parameterTypes: parseParameterTypes(sections.parameterTypes),
    bitfields: parseBitfields(sections.bitfields),
    containers: parseContainers(sections.containers),
    registerContainers: new Map(),
  };
  for (const c of catalog.containers) {
    if (c.baseContainerRef && c.parentArgs) {
      catalog.registerContainers.set(registerKey(c.baseContainerRef, c.parentArgs), c);
    }
  }
  return catalog;
}

function section(text: string, start: string, end: string): string {
  const re = new RegExp(`^${start}:\\n([^]*?)(?=^${end}:)`, 'm');
  return re.exec(text)?.[1] ?? '';
}

function topLevelBlocks(src: string): { name: string; body: string }[] {
  const lines = src.split('\n');
  const blocks: { name: string; body: string }[] = [];
  let current: { name: string; lines: string[] } | null = null;
  for (const line of lines) {
    const m = /^  ([A-Za-z0-9_.-]+):(?:\s*(.*))?$/.exec(line);
    if (m) {
      if (current) blocks.push({ name: current.name, body: current.lines.join('\n') });
      current = { name: m[1], lines: [m[2] ?? ''] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) blocks.push({ name: current.name, body: current.lines.join('\n') });
  return blocks;
}

function parseParameters(src: string): Map<string, ParameterDef> {
  const out = new Map<string, ParameterDef>();
  for (const { name, body } of topLevelBlocks(src)) {
    const inline = /\{([^}]+)\}/.exec(body)?.[1] ?? '';
    const type = valueFor(body, 'type') ?? valueFor(inline, 'type');
    if (!type) continue;
    out.set(name, { type, domain: valueFor(body, 'domain') ?? valueFor(inline, 'domain') });
  }
  return out;
}

function parseParameterTypes(src: string): Map<string, ParamType> {
  const out = new Map<string, ParamType>(Object.entries(BUILTIN_TYPES));
  for (const { name, body } of topLevelBlocks(src)) {
    const inline = /\{([^}]+)\}/.exec(body)?.[1] ?? '';
    const get = (key: string) => valueFor(body, key) ?? valueFor(inline, key);
    const kind = get('kind');
    if (!kind) continue;
    const type: ParamType = {
      kind,
      sizeBits: numberFor(body, 'size_bits') ?? numberFor(inline, 'size_bits') ?? (kind === 'absolute_time' ? 64 : undefined),
      signed: boolFor(body, 'signed') ?? boolFor(inline, 'signed'),
      byteOrder: (get('byte_order') as 'little' | 'big' | undefined) ?? 'big',
      unit: stripQuotes(get('unit') ?? ''),
      arrayTypeRef: get('array_type_ref'),
      dimensionList: arrayNumbers(get('dimension_list') ?? ''),
      fixedSizeBytes: numberFor(body, 'fixed_size_bytes') ?? numberFor(inline, 'fixed_size_bytes'),
      encoding: get('encoding'),
      polynomial: arrayNumbers(/polynomial:\s*\[([^\]]+)\]/.exec(body)?.[1] ?? ''),
      dynamicRef: /dynamic_ref:\s*([A-Za-z0-9_.-]+)/.exec(body)?.[1],
    };
    const values = parseEnumValues(body);
    if (Object.keys(values).length > 0) type.values = values;
    out.set(name, type);
  }
  return out;
}

function parseEnumValues(body: string): Record<number, string> {
  const out: Record<number, string> = {};
  const valuesBlock = /values:\n([\s\S]*?)(?=\n\s{4}[A-Za-z_][A-Za-z0-9_]*:|\n\s{2,3}\S|$)/.exec(body)?.[1] ?? '';
  for (const m of valuesBlock.matchAll(/^\s{6}([0-9]+):\s*"?([^"\n]+)"?/gm)) {
    out[Number(m[1])] = m[2].trim();
  }
  return out;
}

function parseBitfields(src: string): Map<string, BitfieldType> {
  const out = new Map<string, BitfieldType>();
  for (const { name, body } of topLevelBlocks(src)) {
    const entries: BitfieldEntry[] = [];
    for (const m of body.matchAll(/-\s*\{([^}]+)\}/g)) {
      const raw = m[1];
      const bits = (arrayNumbers(valueFor(raw, 'bits') ?? '') ?? []).slice(0, 2);
      const entryName = valueFor(raw, 'name');
      if (!entryName || bits.length !== 2) continue;
      entries.push({
        name: entryName,
        bits: [bits[0], bits[1]],
        kind: valueFor(raw, 'kind') ?? 'uint',
        enumRef: valueFor(raw, 'enum_ref'),
        unit: stripQuotes(valueFor(raw, 'unit') ?? ''),
      });
    }
    out.set(name, {
      sizeBits: numberFor(body, 'size_bits') ?? 32,
      byteOrder: (valueFor(body, 'byte_order') as 'little' | 'big' | undefined) ?? 'little',
      entries,
    });
  }
  return out;
}

function parseContainers(src: string): ContainerDef[] {
  const out: ContainerDef[] = [];
  for (const { name, body } of topLevelBlocks(src)) {
    const entries: EntryDef[] = [];
    for (const m of body.matchAll(/-\s*\{([^}]+)\}/g)) {
      const raw = m[1];
      const entryName = valueFor(raw, 'name');
      if (!entryName) continue;
      entries.push({
        name: entryName,
        type: valueFor(raw, 'type') ?? undefined,
        emit: valueFor(raw, 'emit') !== 'false',
      });
    }
    const repeat = /repeat_entry:\s*\n\s+entry:\s*\{\s*name:\s*([A-Za-z0-9_.-]+)(?:,\s*type:\s*([A-Za-z0-9_.-]+))?/.exec(body);
    if (repeat) entries.push({ name: repeat[1], type: repeat[2], emit: true, repeatToEnd: true });

    out.push({
      id: name,
      domain: valueFor(body, 'domain') ?? undefined,
      layout: valueFor(body, 'layout') ?? undefined,
      cmdId: /cmd_id:\s*([A-Za-z0-9_.-]+)/.exec(body)?.[1],
      ptype: /ptype:\s*([A-Z]+)/.exec(body)?.[1],
      abstract: /abstract:\s*true/.test(body),
      baseContainerRef: valueFor(body, 'base_container_ref') ?? undefined,
      parentArgs: parseParentArgs(body),
      entries,
      hasPagedFrame: /paged_frame_entry:/.test(body),
    });
  }
  return out;
}

function parseParentArgs(body: string): Record<string, number> | undefined {
  const raw = /parent_args:\s*\{([^}]+)\}/.exec(body)?.[1];
  if (!raw) return undefined;
  const out: Record<string, number> = {};
  for (const part of raw.split(',')) {
    const [k, v] = part.split(':').map((x) => x.trim());
    if (k && v) out[k] = Number(v);
  }
  return out;
}

function decodeBinaryContainer(catalog: MissionCatalog, container: ContainerDef, bytes: Buffer): CatalogField[] {
  const fields: CatalogField[] = [];
  let offset = 0;
  for (const entry of container.entries) {
    const typeName = entry.type ?? catalog.parameters.get(entry.name)?.type ?? entry.name;
    const decoded = decodeValue(catalog, typeName, bytes, offset, entry.name, {});
    offset += decoded.bytesRead;
    if (entry.emit) fields.push(...decoded.fields);
    if (decoded.bytesRead === 0 && offset >= bytes.length) break;
  }
  return fields;
}

function decodeAsciiContainer(catalog: MissionCatalog, container: ContainerDef, text: string): CatalogField[] {
  const fields: CatalogField[] = [];
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  let idx = 0;
  for (const entry of container.entries) {
    if (entry.repeatToEnd) {
      for (let i = 0; idx < tokens.length; i++, idx++) {
        fields.push({ field: `${entry.name}.${i}`, value: tokens[idx], unit: '' });
      }
      continue;
    }
    const typeName = entry.type ?? catalog.parameters.get(entry.name)?.type ?? 'ascii_token';
    const type = resolveType(catalog, typeName);
    if (type?.encoding === 'to_end' || typeName === 'ascii_blob') {
      const value = tokens.slice(idx).join(' ');
      idx = tokens.length;
      if (entry.emit) fields.push({ field: entry.name, value, unit: type?.unit ?? '' });
      continue;
    }
    const value = tokens[idx++] ?? '';
    if (!entry.emit) continue;
    fields.push(...formatTextValue(catalog, entry.name, typeName, value));
  }
  return fields;
}

function decodePagedFrame(catalog: MissionCatalog, container: ContainerDef, text: string): CatalogField[] {
  const fields = decodeAsciiContainer(catalog, { ...container, entries: container.entries.filter((e) => !e.repeatToEnd) }, text.split(',')[0] ?? '');
  const groups = text.split(',').map((g) => g.trim()).filter(Boolean);
  for (const group of groups) {
    const tokens = group.split(/\s+/).filter(Boolean);
    if (tokens.length < 3) continue;
    const module = Number(tokens[0]);
    const register = Number(tokens[1]);
    if (!Number.isFinite(module) || !Number.isFinite(register)) continue;
    const regContainer = catalog.registerContainers.get(registerKey('mtq_get_1_res', { module, register }));
    if (!regContainer) continue;
    let values = tokens.slice(2);
    if (values.length > 1 && (values.at(-1) === '0' || values.at(-1) === '1')) values = values.slice(0, -1);
    fields.push(...decodeAsciiContainer(catalog, regContainer, values.join(' ')));
  }
  return fields;
}

function decodeValue(
  catalog: MissionCatalog,
  typeName: string,
  bytes: Buffer,
  offset: number,
  fieldName: string,
  context: Record<string, number>,
): { fields: CatalogField[]; bytesRead: number; rawNumber?: number } {
  const bitfield = catalog.bitfields.get(typeName);
  if (bitfield) return decodeBitfield(catalog, bitfield, bytes, offset, fieldName);

  const type = resolveType(catalog, typeName);
  if (!type) return { fields: [], bytesRead: 0 };

  if (type.kind === 'array' && type.arrayTypeRef) {
    const count = (type.dimensionList ?? []).reduce((a, b) => a * b, 1) || 1;
    const axisLabels = count === 3 ? ['x', 'y', 'z'] : null;
    const fields: CatalogField[] = [];
    let pos = offset;
    for (let i = 0; i < count; i++) {
      const suffix = axisLabels ? axisLabels[i] : String(i);
      const d = decodeValue(catalog, type.arrayTypeRef, bytes, pos, `${fieldName}.${suffix}`, context);
      pos += d.bytesRead;
      fields.push(...d.fields);
    }
    return { fields, bytesRead: pos - offset };
  }

  if (type.kind === 'string') {
    const size = type.fixedSizeBytes ?? bytes.length - offset;
    const raw = bytes.subarray(offset, Math.min(bytes.length, offset + size));
    const value = Buffer.from([...raw].filter((x) => x !== 0)).toString('ascii').trim();
    return { fields: [{ field: fieldName, value, unit: type.unit ?? '' }], bytesRead: raw.length };
  }

  if (type.kind === 'binary') {
    const size = context[type.dynamicRef ?? ''] ?? Math.max(0, bytes.length - offset);
    return { fields: [], bytesRead: Math.min(size, Math.max(0, bytes.length - offset)) };
  }

  if (type.kind === 'absolute_time') {
    const raw = readNumber(bytes, offset, { ...type, kind: 'int', sizeBits: type.sizeBits ?? 64, signed: false });
    const value = Number.isFinite(raw) && raw > 0 ? `${new Date(raw).toISOString()} (${raw})` : String(raw);
    return { fields: [{ field: fieldName, value, unit: 'ms' }], bytesRead: Math.ceil((type.sizeBits ?? 64) / 8), rawNumber: raw };
  }

  const sizeBytes = Math.ceil((type.sizeBits ?? 0) / 8);
  if (!sizeBytes || offset + sizeBytes > bytes.length) return { fields: [], bytesRead: Math.max(0, bytes.length - offset) };
  const raw = readNumber(bytes, offset, type);
  const calibrated = applyPolynomial(raw, type.polynomial);
  context[fieldName] = raw;
  return {
    fields: [{ field: fieldName, value: formatValue(catalog, type, raw, calibrated), unit: type.unit ?? '' }],
    bytesRead: sizeBytes,
    rawNumber: raw,
  };
}

function decodeBitfield(catalog: MissionCatalog, bitfield: BitfieldType, bytes: Buffer, offset: number, fieldName: string) {
  const sizeBytes = Math.ceil(bitfield.sizeBits / 8);
  if (offset + sizeBytes > bytes.length) return { fields: [], bytesRead: Math.max(0, bytes.length - offset) };
  const raw = bitfield.sizeBits <= 16
    ? (bitfield.byteOrder === 'little' ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset))
    : (bitfield.byteOrder === 'little' ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset));
  const fields = bitfield.entries.map((entry) => {
    const width = entry.bits[1] - entry.bits[0] + 1;
    const mask = width >= 32 ? 0xFFFFFFFF : (2 ** width) - 1;
    const value = (raw >>> entry.bits[0]) & mask;
    let display = entry.kind === 'bool' ? String(Boolean(value)) : String(value);
    const enumType = entry.enumRef ? catalog.parameterTypes.get(entry.enumRef) : undefined;
    if (enumType?.values?.[value]) display = `${enumType.values[value]} (${value})`;
    return { field: `${fieldName}.${entry.name}`, value: display, unit: entry.unit ?? '' };
  });
  return { fields, bytesRead: sizeBytes, rawNumber: raw };
}

function formatTextValue(catalog: MissionCatalog, field: string, typeName: string, value: string): CatalogField[] {
  const type = resolveType(catalog, typeName);
  const n = Number(value);
  if (type?.values && Number.isFinite(n) && type.values[n]) {
    return [{ field, value: `${type.values[n]} (${value})`, unit: type.unit ?? '' }];
  }
  const calibrated = Number.isFinite(n) ? applyPolynomial(n, type?.polynomial) : value;
  return [{ field, value: String(calibrated), unit: type?.unit ?? '' }];
}

function resolveType(catalog: MissionCatalog, typeName: string): ParamType | undefined {
  return catalog.parameterTypes.get(typeName) ?? catalog.parameterTypes.get(catalog.parameters.get(typeName)?.type ?? '');
}

function readNumber(bytes: Buffer, offset: number, type: ParamType): number {
  const little = type.byteOrder === 'little';
  if (type.kind === 'float') return little ? bytes.readFloatLE(offset) : bytes.readFloatBE(offset);
  switch (type.sizeBits) {
    case 8: return type.signed ? bytes.readInt8(offset) : bytes.readUInt8(offset);
    case 16: return type.signed ? (little ? bytes.readInt16LE(offset) : bytes.readInt16BE(offset)) : (little ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset));
    case 32: return type.signed ? (little ? bytes.readInt32LE(offset) : bytes.readInt32BE(offset)) : (little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset));
    case 64: return Number(little ? bytes.readBigUInt64LE(offset) : bytes.readBigUInt64BE(offset));
    default: return 0;
  }
}

function applyPolynomial(raw: number, polynomial?: number[]): number {
  if (!polynomial?.length) return raw;
  return polynomial.reduce((sum, coeff, pow) => sum + coeff * raw ** pow, 0);
}

function formatValue(catalog: MissionCatalog, type: ParamType, raw: number, calibrated: number): string {
  if (type.values?.[raw]) return `${type.values[raw]} (${raw})`;
  if (type.kind === 'float' || type.polynomial) return Number(calibrated.toFixed(6)).toString();
  return String(calibrated);
}

function valueFor(src: string, key: string): string | undefined {
  const m = new RegExp(`${key}:\\s*(\\[[^\\]]+\\]|"[^"]*"|'[^']*'|[^,\\n}]+)`).exec(src);
  return m ? stripQuotes(m[1].trim()) : undefined;
}

function numberFor(src: string, key: string): number | undefined {
  const value = valueFor(src, key);
  if (value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function boolFor(src: string, key: string): boolean | undefined {
  const value = valueFor(src, key);
  if (value == null) return undefined;
  return value === 'true' ? true : value === 'false' ? false : undefined;
}

function arrayNumbers(raw: string): number[] | undefined {
  const body = raw.replace(/^\[/, '').replace(/\]$/, '');
  if (!body.trim()) return undefined;
  const nums = body.split(',').map((v) => Number(v.trim())).filter(Number.isFinite);
  return nums.length ? nums : undefined;
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, '');
}

function registerKey(base: string, args: Record<string, number>): string {
  return `${base}:${args.module ?? ''}:${args.register ?? ''}:${args.sensor_id ?? ''}`;
}
