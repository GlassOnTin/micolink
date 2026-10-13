// Micolink codec.
//
// Frame layout (all multi-byte values little-endian):
//   [0] head 0xEF
//   [1] dev_id   sender type: 1 from the host, a PRODUCT_TYPE value from a device
//   [2] sys_id   0
//   [3] msg_id
//   [4] seq      free-running 8-bit counter
//   [5] len      payload length, 0..100
//   [6..5+len]   payload
//   [6+len]      checksum: 8-bit wrap sum of bytes 0..5+len (everything before it)
//
// Value tables cover the devices this tool is written for (MT-01, MTF-01,
// MTF-02, MT-15 range sensors). The command layer generalises to other
// product families that share the frame format.

export const HEAD = 0xef;
export const MAX_PAYLOAD = 100;

export const MSG = {
  HEARTBEAT: 1,
  CMD: 2,
  CMD_ACK: 3,
  RANGE_SENSOR: 81, // 0x51
  OPTICALFLOW: 85, // 0x55
};

// PRODUCT_TYPE values seen in dev_id. Host-to-device frames use DEV.HOST.
export const DEV = {
  HOST: 1,
  FLIGHT_CONTROL: 3,
  GIMBAL: 4,
  ESC: 8,
  RANGE_SENSOR: 0x0f,
  OPTICALFLOW: 0x14,
  GPS: 21,
  UWB: 22,
  RTK: 23,
  RADIO: 30,
};

export const PRODUCT_NAMES = {
  15: { 1: 'MT-01', 2: 'MTF-01', 3: 'MTF-02', 16: 'MT-15' },
  20: { 1: 'FL01', 2: 'FL02' },
};

// RANGE_SENSOR_PARAM1.protocol
export const PROTOCOLS = [
  { value: 0, label: 'Micolink' },
  { value: 1, label: 'MSP' },
  { value: 2, label: 'Mavlink APM' },
  { value: 3, label: 'Mavlink PX4' },
];

// RANGE_SENSOR_PARAM1.orientation: module rotation
export const ORIENTATIONS = [0, 90, 180, 270].map((deg) => ({ value: deg / 90, label: `${deg}°` }));

// RANGE_SENSOR_PARAM1.tof_freq
export const TOF_FREQS = [
  { value: 0, label: '800 Hz' }, { value: 1, label: '400 Hz' },
  { value: 2, label: '200 Hz' }, { value: 3, label: '100 Hz' },
  { value: 4, label: '50 Hz' }, { value: 5, label: '25 Hz' },
  { value: 6, label: '10 Hz' }, { value: 7, label: '5 Hz' },
];

// RANGE_SENSOR_PARAM1.rngfnd_orient: where the ranging beam points
export const RNGFND_ORIENTS = [
  { value: 0, label: 'FORWARD' },
  { value: 1, label: 'FORWARD_RIGHT' },
  { value: 2, label: 'RIGHT' },
  { value: 3, label: 'BACK_RIGHT' },
  { value: 4, label: 'BACK' },
  { value: 5, label: 'BACK_LEFT' },
  { value: 6, label: 'LEFT' },
  { value: 7, label: 'FORWARD_LEFT' },
  { value: 8, label: 'UP' },
  { value: 9, label: 'DOWN' },
];

// RANGE_SENSOR_PARAM1.interface_type
export const IO_TYPES = [
  { value: 0, label: 'UART' },
  { value: 1, label: 'IIC' },
];

// RANGE_SENSOR_PARAM1.inquire_mode
export const INQUIRE_MODES = [
  { value: 0, label: 'DISABLE' },
  { value: 1, label: 'ENABLE' },
];

// RANGE_SENSOR command ids
export const RANGE_SENSOR_CMD = { GET_PARAM1: 1, SET_PARAM1: 2 };

// Fields that apply per product (product_ver from HEARTBEAT):
//   ver 1 / 16 (MT-01, MT-15): tof_id, tof_freq, rngfnd_orient, interface, inquire
//   ver 2 (MTF-01): orientation, flow_scale
//   ver 3 (MTF-02): orientation, flow_scale, interface
export function fieldsForProduct(productVer) {
  if (productVer === 1 || productVer === 16) {
    return ['tofId', 'tofFreq', 'rngfndOrient', 'ioType', 'inqMode'];
  }
  if (productVer === 2) return ['orientation', 'flowScale'];
  if (productVer === 3) return ['orientation', 'flowScale', 'ioType'];
  return [];
}

export function checksum(bytes) {
  let s = 0;
  for (const b of bytes) s = (s + b) & 0xff;
  return s;
}

// Build one frame. devId is the sender type (DEV.HOST for host-originated frames).
export function buildFrame(devId, sysId, msgId, seq, payload) {
  if (payload.length > MAX_PAYLOAD) {
    throw new Error(`payload too long: ${payload.length}`);
  }
  const out = new Uint8Array(7 + payload.length);
  out[0] = HEAD;
  out[1] = devId;
  out[2] = sysId;
  out[3] = msgId;
  out[4] = seq;
  out[5] = payload.length;
  out.set(payload, 6);
  out[out.length - 1] = checksum(out.subarray(0, out.length - 1));
  return out;
}

// 12+1-byte heartbeat payload the host sends to announce itself.
export function buildHostHeartbeat(seq, timeMs) {
  const p = new Uint8Array(13);
  setU32LE(p, 0, timeMs);
  p[4] = 0; // product_ver
  p[5] = 1; // hardware_ver
  p[6] = 0; // software_ver_low
  p[7] = 1; // software_ver_mid
  p[8] = 0; // software_ver_high
  return buildFrame(DEV.HOST, 0, MSG.HEARTBEAT, seq, p);
}

// CMD payload: ushort cmd + 16 param bytes = 18 bytes.
export function buildCMD(seq, cmd, params = []) {
  if (params.length > 16) throw new Error(`too many params: ${params.length}`);
  const p = new Uint8Array(18);
  p[0] = cmd & 0xff;
  p[1] = (cmd >> 8) & 0xff;
  p.set(params, 2);
  return buildFrame(DEV.HOST, 0, MSG.CMD, seq, p);
}

// GET_PARAM1 — empty command.
export function buildRangeSensorGetParam(seq) {
  return buildCMD(seq, RANGE_SENSOR_CMD.GET_PARAM1);
}

// SET_PARAM1. The baudrate slot is written as 0 (unchanged); frame layout
// follows the vendor's tool, which never rewrites baud from the sensor setup
// dialog.
export function buildRangeSensorSetParam(seq, cfg) {
  const fs = Math.min(Math.max(cfg.flowScale || 1, 1), 10000);
  const mavSysId = Math.min(Math.max(cfg.mavSysId || 1, 1), 255);
  return buildCMD(seq, RANGE_SENSOR_CMD.SET_PARAM1, [
    cfg.protocol,
    0, // baudrate: leave unchanged
    cfg.orientation,
    fs & 0xff, // flow_scale low
    (fs >> 8) & 0xff, // flow_scale high
    cfg.tofId,
    cfg.tofFreq,
    cfg.rngfndOrient,
    cfg.ioType,
    cfg.inqMode,
    mavSysId,
  ]);
}

// ---- payload decoding -------------------------------------------------------

function view(payload) {
  return new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
}

export function setU32LE(buf, off, v) {
  buf[off] = v & 0xff;
  buf[off + 1] = (v >> 8) & 0xff;
  buf[off + 2] = (v >> 16) & 0xff;
  buf[off + 3] = (v >> 24) & 0xff;
}

export function decodeHeartbeat(payload) {
  const d = view(payload);
  return {
    timeMs: d.getUint32(0, true),
    productVer: d.getUint8(4),
    hardwareVer: d.getUint8(5),
    softwareVer: `${d.getUint8(8)}.${d.getUint8(7)}.${d.getUint8(6)}`, // high.mid.low
  };
}

export function decodeRangeSensor(payload) {
  const d = view(payload);
  return {
    timeMs: d.getUint32(0, true),
    distanceMm: d.getUint32(4, true),
    strength: d.getUint8(8),
    precision: d.getUint8(9),
    status: d.getUint8(10), // 1 = valid reading
    flowVelX: d.getInt16(12, true),
    flowVelY: d.getInt16(14, true),
    flowVar: d.getUint8(16), // flow quality
    flowStatus: d.getUint8(17), // 1 = valid flow; 255 = no flow sensor
  };
}

export function decodeOpticalFlow(payload) {
  const d = view(payload);
  return {
    timeMs: d.getUint32(0, true),
    velX: d.getInt16(4, true),
    velY: d.getInt16(6, true),
    var: d.getUint8(8),
    status: d.getUint8(9),
    tofDistance: d.getUint16(10, true),
    tofStrength: d.getUint8(12),
    tofStatus: d.getUint8(13),
  };
}

export function decodeCMD(payload) {
  if (payload.length < 18) throw new Error(`CMD payload too short: ${payload.length}`);
  const d = view(payload);
  const cmd = d.getUint16(0, true);
  const params = [];
  for (let i = 0; i < 16; i++) params.push(d.getUint8(2 + i));
  return { cmd, params };
}

// Unpack RANGE_SENSOR_PARAM1 from a GET-style CMD_ACK into the config shape
// used by the builders.
export function unpackRangeSensorParam1(params) {
  return {
    protocol: params[0],
    baudrate: params[1],
    orientation: params[2],
    flowScale: params[3] | (params[4] << 8),
    tofId: params[5],
    tofFreq: params[6],
    rngfndOrient: params[7],
    ioType: params[8],
    inqMode: params[9],
    mavSysId: params[10],
  };
}

// ---- stream parsing ---------------------------------------------------------

export class Parser {
  // onFrame receives {devId, sysId, msgId, seq, payload: Uint8Array}.
  constructor(onFrame) {
    this.onFrame = onFrame;
    this.buf = new Uint8Array(0);
  }

  feed(bytes) {
    // Append then parse; keep the unparsed tail.
    const merged = new Uint8Array(this.buf.length + bytes.length);
    merged.set(this.buf);
    merged.set(bytes, this.buf.length);
    this.buf = merged;
    this.#parse();
  }

  #parse() {
    const buf = this.buf;
    let i = 0;
    while (i <= buf.length - 7) {
      if (buf[i] !== HEAD) {
        i++;
        continue;
      }
      const len = buf[i + 5];
      if (len > MAX_PAYLOAD) {
        i++;
        continue;
      }
      const end = i + 6 + len + 1; // one past the checksum
      if (end > buf.length) break; // wait for the rest of the frame
      const expected = checksum(buf.subarray(i, end - 1));
      if (expected === buf[end - 1]) {
        this.onFrame({
          devId: buf[i + 1],
          sysId: buf[i + 2],
          msgId: buf[i + 3],
          seq: buf[i + 4],
          payload: buf.slice(i + 6, i + 6 + len),
        });
      }
      // On a checksum mismatch the whole candidate frame is discarded
      // without a rescan inside it.
      i = end;
    }
    if (i > 0) this.buf = buf.slice(i);
  }
}