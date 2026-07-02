import { decodeRow } from './telemetryDecode.js';

function frame(cmd: string, args: Buffer): string {
  const name = Buffer.from(cmd, 'ascii');
  const b = Buffer.alloc(8 + 2 + name.length + 1 + args.length);
  b[8] = name.length;
  b[9] = args.length;
  name.copy(b, 10);
  args.copy(b, 11 + name.length);
  return b.toString('hex');
}

function beaconPayload(): Buffer {
  const b = Buffer.alloc(105);
  b.write('MAVERIC', 0, 'ascii');
  b.writeUInt32LE(123456, 7);
  b[15] = 2;
  b.writeUInt32LE(0x12345678, 36);
  b[40] = 1;
  b.writeFloatLE(1.25, 42);
  b.writeFloatLE(-2.5, 46);
  b.writeFloatLE(3.75, 50);
  b.writeFloatLE(10, 54);
  b.writeFloatLE(20, 58);
  b.writeFloatLE(30, 62);
  b.writeFloatLE(0.1, 66);
  b.writeFloatLE(0.2, 70);
  b.writeFloatLE(0.3, 74);
  b.writeFloatLE(25.5, 78);
  b.writeInt16LE(1200, 82);
  b.writeInt16LE(-300, 84);
  b.writeInt16LE(5000, 86);
  b.writeInt16LE(7600, 88);
  b.writeInt16LE(4900, 90);
  b.writeInt16LE(100, 92);
  b.writeInt16LE(50, 94);
  b.writeUInt16LE(9, 96);
  b[98] = 6;
  b.writeUInt16LE(12, 99);
  b.writeUInt16LE(13, 101);
  b.writeUInt16LE(14, 103);
  return b;
}

const beacon = decodeRow('tlm_beacon', frame('tlm_beacon', beaconPayload()), 'TLM');
const checks = [
  { name: 'eps_hk', count: decodeRow('eps_hk', frame('eps_hk', Buffer.alloc(96)), 'TLM').length, min: 48 },
  { name: 'tlm_beacon', count: beacon.length, min: 40 },
  { name: 'mag_tlm', count: decodeRow('mag_tlm', frame('mag_tlm', Buffer.alloc(80)), 'TLM').length, min: 20 },
];

for (const check of checks) {
  if (check.count < check.min) {
    throw new Error(`${check.name} decoded ${check.count} fields, expected at least ${check.min}`);
  }
}

const rateX = beacon.find((field) => field.field === 'RATE.x');
const rateY = beacon.find((field) => field.field === 'RATE.y');
const rateZ = beacon.find((field) => field.field === 'RATE.z');
if (rateX?.value !== '1.25' || rateY?.value !== '-2.5' || rateZ?.value !== '3.75') {
  throw new Error(`tlm_beacon RATE decoded incorrectly: ${rateX?.value}, ${rateY?.value}, ${rateZ?.value}`);
}

const mag = decodeRow('mag_tlm', frame('mag_tlm', Buffer.alloc(80)), 'TLM');
if (mag.some((field) => /^f\d+$/.test(field.field)) || !mag.some((field) => field.field === 'd_mag_x')) {
  throw new Error(`mag_tlm still uses generic float field names: ${mag.map((field) => field.field).join(', ')}`);
}

const chunkPayload = Buffer.concat([
  Buffer.from('a.jpg 12 4 ', 'ascii'),
  Buffer.from([0, 1, 2, 3]),
]);
const chunk = decodeRow('img_get_chunks', frame('img_get_chunks', chunkPayload), 'FILE');
if (chunk.some((field) => /^f\d+$/.test(field.field)) || !chunk.some((field) => field.field === 'filename')) {
  throw new Error(`FILE chunk decoded incorrectly: ${chunk.map((field) => field.field).join(', ')}`);
}

console.log(JSON.stringify({ ok: true, checks }, null, 2));
