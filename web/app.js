// Micolink console app: wire the codec and transport to the page.

import {
  MSG, DEV, PRODUCT_NAMES, PROTOCOLS, ORIENTATIONS, TOF_FREQS, RNGFND_ORIENTS,
  IO_TYPES, INQUIRE_MODES, fieldsForProduct,
  Parser, buildCMD, buildHostHeartbeat, buildRangeSensorGetParam,
  buildRangeSensorSetParam, decodeHeartbeat, decodeRangeSensor,
  decodeOpticalFlow, decodeCMD, unpackRangeSensorParam1,
} from './micolink.js';
import { SerialTransport } from './transport.js';

const $ = (id) => document.getElementById(id);

const state = {
  t: null, // SerialTransport
  parser: null,
  seq: 0,
  heartbeatTimer: null,
  productType: null, // DEVICE product type = dev_id of heartbeat frames
  productVer: null,
  lastRender: 0,
};

function nextSeq() {
  state.seq = (state.seq + 1) % 256;
  return state.seq;
}

function hex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

function log(kind, text) {
  const el = document.createElement('div');
  el.className = kind;
  el.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  $('log').prepend(el);
  while ($('log').children.length > 200) $('log').lastChild.remove();
}

function fillSelect(id, list, current) {
  const sel = $(id);
  sel.innerHTML = '';
  for (const item of list) {
    const opt = document.createElement('option');
    opt.value = item.value;
    opt.textContent = item.label;
    sel.appendChild(opt);
  }
  if (current !== undefined && current !== null) sel.value = String(current);
}

function initForm() {
  fillSelect('protocol', PROTOCOLS, 0);
  fillSelect('orientation', ORIENTATIONS, 0);
  fillSelect('tofFreq', TOF_FREQS, 3);
  fillSelect('rngfndOrient', RNGFND_ORIENTS, 9);
  fillSelect('ioType', IO_TYPES, 0);
  fillSelect('inqMode', INQUIRE_MODES, 0);
  $('tofId').max = 31;
}

function readConfig() {
  const num = (id) => Number($(id).value);
  return {
    protocol: num('protocol'),
    orientation: num('orientation'),
    flowScale: num('flowScale'),
    tofId: num('tofId'),
    tofFreq: num('tofFreq'),
    rngfndOrient: num('rngfndOrient'),
    ioType: num('ioType'),
    inqMode: num('inqMode'),
    mavSysId: num('mavSysId'),
  };
}

function applyFieldScoping(productVer) {
  const enabled = new Set(['protocol', 'mavSysId', ...fieldsForProduct(productVer)]);
  for (const id of ['protocol', 'orientation', 'flowScale', 'tofId', 'tofFreq',
    'rngfndOrient', 'ioType', 'inqMode', 'mavSysId']) {
    $(id).disabled = !enabled.has(id);
  }
  for (const id of ['orientation', 'flowScale', 'tofId', 'tofFreq', 'rngfndOrient',
    'ioType', 'inqMode']) {
    const label = document.querySelector(`label[for="${id}"]`);
    if (label) label.classList.toggle('disabled', !enabled.has(id));
  }
}

function sendFrame(frame, note) {
  try {
    state.t.write(frame);
    log('tx', `${note}: ${hex(frame)}`);
  } catch (e) {
    log('err', `send failed: ${e.message}`);
  }
}

function sendSendableHeartbeat() {
  sendFrame(buildHostHeartbeat(nextSeq(), performance.now() | 0), 'host heartbeat');
}

// ---- frame handling ---------------------------------------------------------

function handleFrame(f) {
  switch (f.msgId) {
    case MSG.HEARTBEAT:
      handleHeartbeat(f);
      break;
    case MSG.RANGE_SENSOR:
      handleRangeSensor(f);
      break;
    case MSG.OPTICALFLOW:
      handleOpticalFlow(f);
      break;
    case MSG.CMD_ACK:
      handleCmdAck(f);
      break;
    default:
      log('rx', `msg 0x${f.msgId.toString(16)} dev=0x${f.devId.toString(16)} len=${f.payload.length} (unhandled): ${hex(f.payload.slice(0, 24))}${f.payload.length > 24 ? ' …' : ''}`);
  }
}

function handleHeartbeat(f) {
  const hb = decodeHeartbeat(f.payload);
  state.productType = f.devId;
  state.productVer = hb.productVer;
  const name = (PRODUCT_NAMES[f.devId] || {})[hb.productVer] || 'Unknown';
  $('productName').textContent = name;
  $('productType').textContent = `dev 0x${f.devId.toString(16)} (type ${f.devId})`;
  $('fwVersion').textContent = `${hb.softwareVer} (hw ${Math.floor(hb.hardwareVer / 10)}.${hb.hardwareVer % 10})`;
  $('connStatus').textContent = `device: ${name}`;
  $('connStatus').classList.add('ok');
  if (f.devId === DEV.RANGE_SENSOR) {
    applyFieldScoping(hb.productVer);
  }
}

function handleRangeSensor(f) {
  const d = decodeRangeSensor(f.payload);
  state.range = d;
  maybeRenderTelemetry();
  if (logRaw()) {
    log('rx', `range 0x51: ${hex(f.payload)}`);
  }
}

function handleOpticalFlow(f) {
  state.flow = decodeOpticalFlow(f.payload);
  maybeRenderTelemetry();
  if (logRaw()) {
    log('rx', `opticalflow 0x55: ${hex(f.payload)}`);
  }
}

function handleCmdAck(f) {
  const ack = decodeCMD(f.payload);
  if (f.devId !== DEV.RANGE_SENSOR) {
    log('rx', `cmd_ack dev=0x${f.devId.toString(16)}: ${hex(f.payload)}`);
    return;
  }
  if (ack.cmd === 1) {
    const cfg = unpackRangeSensorParam1(ack.params);
    $('protocol').value = String(cfg.protocol);
    $('orientation').value = String(cfg.orientation);
    $('flowScale').value = String(cfg.flowScale);
    $('tofId').value = String(cfg.tofId);
    $('tofFreq').value = String(cfg.tofFreq);
    $('rngfndOrient').value = String(cfg.rngfndOrient);
    $('ioType').value = String(cfg.ioType);
    $('inqMode').value = String(cfg.inqMode);
    $('mavSysId').value = String(cfg.mavSysId);
    const baudNote = `baudrate code: ${cfg.baudrate} (GET reply slot; SET does not change baud)`;
    log('ok', `read PARAM1 ok (${baudNote})`);
  } else if (ack.cmd === 2) {
    log('ok', 'write PARAM1 confirmed by device');
  } else {
    log('rx', `cmd_ack cmd=${ack.cmd}: ${hex(f.payload)}`);
  }
}

function logRaw() {
  return $('showRaw').checked;
}

function maybeRenderTelemetry() {
  const now = performance.now();
  if (now - state.lastRender < 100) return;
  state.lastRender = now;
  const r = state.range;
  if (r) {
    const valid = r.status === 1;
    $('tlDistance').textContent = valid ? `${r.distanceMm} mm (${(r.distanceMm / 1000).toFixed(3)} m)` : 'invalid';
    $('tlStrength').textContent = r.strength;
    $('tlPrecision').textContent = r.precision;
    $('tlStatus').textContent = r.status;
    const hasFlow = r.flowStatus !== 255;
    $('tlFlow').textContent = hasFlow
      ? `x ${r.flowVelX} / y ${r.flowVelY} cm/s @1m, q ${r.flowVar}, st ${r.flowStatus}`
      : 'no flow sensor (st 255)';
    if (hasFlow && valid) {
      const m = r.distanceMm / 1000;
      $('tlFlowActual').textContent = `scaled by height ${m.toFixed(2)} m → x ${(r.flowVelX * m).toFixed(1)} / y ${(r.flowVelY * m).toFixed(1)} cm/s`;
    } else {
      $('tlFlowActual').textContent = '—';
    }
  }
}

// ---- actions ----------------------------------------------------------------

async function doConnect() {
  if ('serial' not in navigator) {
    log('err', 'Web Serial not available in this browser (use Chrome or Edge over https or localhost).');
    return;
  }
  const t = new SerialTransport();
  try {
    await t.requestPort();
  } catch (e) {
    log('err', `port pick cancelled/failed: ${e.message}`);
    return;
  }
  const baud = Number($('baud').value);
  t.onData = (bytes) => state.parser.feed(bytes);
  t.onError = (e) => log('err', `serial error: ${e.message || e}`);
  t.onDisconnect = () => {
    $('connStatus').textContent = 'disconnected';
    $('connStatus').classList.remove('ok');
    clearInterval(state.heartbeatTimer);
    log('err', 'device disconnected');
  };
  try {
    await t.open(baud);
  } catch (e) {
    log('err', `open failed at ${baud}: ${e.message}`);
    return;
  }
  state.t = t;
  state.parser = new Parser(handleFrame);
  $('connStatus').textContent = `connected @${baud}`;
  $('connStatus').classList.add('ok');
  $('connect').disabled = true;
  $('disconnect').disabled = false;
  $('sendGet').disabled = false;
  $('sendSet').disabled = false;
  log('ok', `connected at ${baud} baud`);
  sendSendableHeartbeat();
  state.heartbeatTimer = setInterval(sendSendableHeartbeat, 5000);
  sendGet();
}

async function doDisconnect() {
  clearInterval(state.heartbeatTimer);
  if (state.t) await state.t.close();
  $('connStatus').textContent = 'not connected';
  $('connStatus').classList.remove('ok');
  $('connect').disabled = false;
  $('disconnect').disabled = true;
  $('sendGet').disabled = true;
  $('sendSet').disabled = true;
  log('ok', 'disconnected');
}

function sendGet() {
  sendFrame(buildRangeSensorGetParam(nextSeq()), 'GET_PARAM1');
}

function sendSet() {
  const cfg = readConfig();
  if (!confirm(`Write PARAM1 to sensor?\n${JSON.stringify(cfg, null, 2)}\n\nBaudrate is not changed. Reconnect after changing protocol/baud.`)) return;
  sendFrame(buildRangeSensorSetParam(nextSeq(), cfg), 'SET_PARAM1');
}

// ---- boot -------------------------------------------------------------------

$('connect').addEventListener('click', doConnect);
$('disconnect').addEventListener('click', doDisconnect);
$('sendGet').addEventListener('click', sendGet);
$('sendSet').addEventListener('click', sendSet);
initForm();

if (!('serial' in navigator)) {
  $('connStatus').textContent = 'Web Serial unavailable';
}