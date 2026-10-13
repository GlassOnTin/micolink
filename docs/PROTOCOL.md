# Micolink protocol

Micolink is the vendor protocol of MicoAir telemetry/ranging products: the
MT-01, MT-15 range-only sensors and the MTF-01/MTF-02 range + optical-flow
sensors. This document defines the wire protocol so that hardware the user
owns can be configured and read from any platform. It was compiled from
observed traffic and from analysis of the vendor's public configuration tool;
the project is not affiliated with or endorsed by MicoAir.

Scope: covering Micolink itself (frame layer, heartbeat, range-sensor and
optical-flow telemetry, and the range-sensor parameter command layer). The
MSP and MAVLink output protocols of these sensors are standard, documented
elsewhere, and not covered here. Radio and RTK accessories share the frame and
command layer but their parameter tables are not documented here yet.

## Transport

The physical layer is a UART (or USB CDC when connected through a serial
bridge). Factory default is 115200 8N1 on the sensor end. Typical PC hookup is
a USB-to-TTL adapter; a flight-controller USB CDC passthrough port also works.

## Frame layer

Every frame:

| Offset | Field    | Size | Meaning                                                    |
|--------|----------|------|------------------------------------------------------------|
| 0      | head     | 1    | 0xEF                                                       |
| 1      | dev_id   | 1    | sender type: 1 for the host, a product-type value for a device |
| 2      | sys_id   | 1    | 0 in all frames seen so far                                |
| 3      | msg_id   | 1    | message type                                               |
| 4      | seq      | 1    | free-running 8-bit counter                                 |
| 5      | len      | 1    | payload length, must be 100 or less                        |
| 6      | payload  | len  | little-endian values                                       |
| 6+len  | checksum | 1    | 8-bit wrap sum of every byte from head through the last payload byte |

The minimum frame is 7 bytes (empty payload). A receiver should:

1. scan until head 0xEF,
2. reject the candidate if the `len` byte exceeds 100,
3. wait until at least `6 + len + 1` bytes are available,
4. verify the checksum, and on failure discard the whole candidate frame
   without rescanning inside it.

`dev_id` values seen in this family (`PRODUCT_TYPE`):

| Value | Name           |
|-------|----------------|
| 1     | host (PC/tool) |
| 3     | flight control |
| 8     | ESC            |
| 0x0F  | range sensor   |
| 0x14  | optical flow   |
| 21    | GPS            |
| 22    | UWB            |
| 23    | RTK            |
| 30    | radio link     |

## Messages

msg_id values relevant here: 1 HEARTBEAT, 2 CMD (host to device), 3 CMD_ACK
(device to host), 81 (0x51) RANGE_SENSOR telemetry, 85 (0x55) OPTICALFLOW
telemetry.

### HEARTBEAT (msg_id 1, 13-byte payload)

Both sides send heartbeats. The host sends one every few seconds; the device
also announces periodically.

| Offset | Field       | Size | Meaning                                    |
|--------|-------------|------|--------------------------------------------|
| 0      | time        | u32  | sender uptime (ms)                         |
| 4      | product_ver | u8   | product id (see table below)               |
| 5      | hardware_ver| u8   | displayed as `ver/10 . ver%10`             |
| 6      | software_low| u8   | version low digit                          |
| 7      | software_mid| u8   | version middle digit                       |
| 8      | software_high| u8  | version major digit                        |
| 9      | reserved    | u32  |                                            |

Software version displays as `high.mid.low`. `product_ver` identifies the
exact model:

| dev_id | product_ver | Model  | Notes                                 |
|--------|-------------|--------|---------------------------------------|
| 0x0F   | 1           | MT-01  | range-only, external TOF head         |
| 0x0F   | 2           | MTF-01 | range + integrated optical flow       |
| 0x0F   | 3           | MTF-02 | range + flow, external TOF supported  |
| 0x0F   | 16          | MT-15  | range-only, external TOF head         |
| 0x14   | 1           | FL01   | optical flow only                     |
| 0x14   | 2           | FL02   | optical flow only                     |

### CMD (msg_id 2, host to device, 18-byte payload)

| Offset | Field     | Size | Meaning              |
|--------|-----------|------|----------------------|
| 0      | cmd       | u16  | command id           |
| 2      | cmd_param1..16 | 16x u8 | command arguments |

### CMD_ACK (msg_id 3, device to host, 18-byte payload)

Same layout as CMD. For a read command the reply carries the requested values
in the param slots; for a write command the reply echoes the command id as
confirmation.

#### RANGE_SENSOR commands (dev_id 0x0F)

| cmd  | Meaning                                                          |
|------|------------------------------------------------------------------|
| 1    | GET_PARAM1: reply carries the 13-byte PARAM1 (see below)         |
| 2    | SET_PARAM1: write PARAM1, device replies with ACK cmd = 2        |

GET_PARAM1 reply param slots:

| Slot | Field          |
|------|----------------|
| 1    | protocol       |
| 2    | baudrate (code, see gaps) |
| 3    | orientation    |
| 4/5  | flow_scale u16 little-endian (slot 4 = low byte) |
| 6    | tof_id         |
| 7    | tof_freq       |
| 8    | rngfnd_orient  |
| 9    | interface_type |
| 10   | inquire_mode   |
| 11   | mav_sys_id     |

SET_PARAM1 packs the same structure into the slots. **The baudrate slot is
written as 0, meaning "leave unchanged": the vendor tool never rewrites baud
from this dialog, and slot 2 in a SET frame is 0.** Setting a new baud rate
requires a separate mechanism (not yet established, see gaps). Writing
params of fields that do not apply to the attached model should send 0.

Per-model field applicability (from the product table above):

- MT-01 / MT-15: `tof_id`, `tof_freq`, `rngfnd_orient`, `interface_type`, `inquire_mode`
- MTF-01: `protocol`, `orientation`, `flow_scale`, `mav_sys_id`
- MTF-02: `protocol`, `orientation`, `flow_scale`, `mav_sys_id`, `interface_type`

### RANGE_SENSOR telemetry (msg_id 0x51, 20-byte payload)

The sensor streams this continuously in Micolink mode (rated 100 Hz at the
factory UART default).

| Offset | Field       | Size | Meaning                                              |
|--------|-------------|------|------------------------------------------------------|
| 0      | time        | u32  | uptime ms                                            |
| 4      | distance    | u32  | mm; 0 = no valid reading                             |
| 8      | strength    | u8   | signal metric 0..255                                 |
| 9      | precision   | u8   | 0..255                                               |
| 10     | status      | u8   | 1 = reading usable                                   |
| 11     | reserved    | u8   |                                                      |
| 12     | flow_vel_x  | i16  | optical flow velocity, cm/s at 1 m reference height  |
| 14     | flow_vel_y  | i16  | as above, Y axis                                     |
| 16     | flow_var    | u8   | flow quality metric                                  |
| 17     | flow_status | u8   | 1 = flow usable; 255 = no flow sensor                |
| 18     | reserved    | i16  |                                                      |

To convert flow velocity to actual lateral speed, multiply by the current
height in metres: `vel_real_cm_s = flow_vel * distance_m`.

### OPTICALFLOW telemetry (msg_id 85, 18-byte payload)

Sent by flow-only products (FL01/FL02).

| Offset | Field       | Size | Meaning                                    |
|--------|-------------|------|--------------------------------------------|
| 0      | time        | u32  | uptime ms                                  |
| 4      | vel_x       | i16  | cm/s at 1 m reference height               |
| 6      | vel_y       | i16  |                                            |
| 8      | var         | u8   | quality metric                             |
| 9      | status      | u8   | 1 = flow usable                            |
| 10     | tof_distance| u16 | integrated TOF distance (optional source)  |
| 12     | tof_strength| u8  |                                            |
| 13     | tof_status  | u8  |                                            |
| 14     | reserved    | u32  |                                            |

## Parameter value tables

Byte values of the RANGE_SENSOR PARAM1 fields:

**protocol**

| Value | Mode         |
|-------|--------------|
| 0     | Micolink     |
| 1     | MSP          |
| 2     | MAVLink (ArduPilot flavour) |
| 3     | MAVLink (PX4 flavour)       |

**orientation** (module rotation): 0 = 0°, 1 = 90°, 2 = 180°, 3 = 270°
(MTF-01/MTF-02).

**tof_freq** (MT-01/MT-15 external TOF head rate): 0 = 800 Hz, 1 = 400 Hz,
2 = 200 Hz, 3 = 100 Hz, 4 = 50 Hz, 5 = 25 Hz, 6 = 10 Hz, 7 = 5 Hz. Factory
default 100 Hz.

**rngfnd_orient** (where the ranging beam points): 0 = FORWARD,
1 = FORWARD_RIGHT, 2 = RIGHT, 3 = BACK_RIGHT, 4 = BACK, 5 = BACK_LEFT,
6 = LEFT, 7 = FORWARD_LEFT, 8 = UP, 9 = DOWN. Factory default DOWN.

**tof_id**: 0..31, id of the external TOF head on the chain (MT-01/MT-15).

**interface_type**: 0 = UART, 1 = IIC.

**inquire_mode**: 0 = DISABLE, 1 = ENABLE.

**flow_scale**: u16, clamped to 1..10000 by the vendor tool.

**mav_sys_id**: 1..255, clamped to 1 by the vendor tool.

## Wire examples

Frames generated by the reference implementation in `test/frame_test.mjs`
(checksum and offsets independently verified there). Host frames use
`dev_id=1, sys_id=0`; device frames use `dev_id=0x0F, sys_id=0` in these
examples.

Read current parameters (`GET_PARAM1`, cmd 1, empty args, seq 0):

```
ef 01 00 02 00 12 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 05
```

Write parameters (`SET_PARAM1`, cmd 2, seq 1): protocol 0 (Micolink),
orientation 0, flow_scale 500, tof_freq 3 (100 Hz), rngfnd_orient 9 (DOWN),
mav_sys_id 1, baudrate slot 0 (unchanged):

```
ef 01 00 02 01 12 02 00 00 00 00 f4 01 00 03 09 00 00 01 00 00 00 00 00 09
```

ACK for the read above (get reply: baudrate code 0x73 shown as a sample
value, flow_scale 500 little-endian across slots 4/5):

```
ef 0f 00 03 00 12 01 00 00 73 00 f4 01 00 03 09 00 00 01 00 00 00 00 00 89
```

Heartbeat from an MTF-01 (`product_ver` 2, hardware 2.7, software 1.2.0,
uptime 30000 ms):

```
ef 0f 00 01 00 0d 30 75 00 00 02 1b 00 02 01 00 00 00 d1
```

Telemetry frame: 3000 ms uptime, 1000 mm distance, strength 200,
precision 100, status 1, flow x +10 / y -5 cm/s @1m, quality 80, flow
status 1:

```
ef 0f 00 51 00 14 b8 0b 00 00 e8 03 00 00 c8 64 01 00 0a 00 fb ff 50 01 00 00 93
```

## Known gaps and unverified areas

Honesty matters more than completeness here; these are the parts that need a
bench check before you rely on them.

- **baudrate code values**: GET_PARAM1 returns a baudrate byte whose mapping
  to actual rates is not established, and no command that changes it has been
  identified. The SET frame leaves it at 0. Changing baud may be possible via
  the setup flow of the vendor tool only.
- **SET confirmation semantics**: the vendor tool treats an ACK with
  `cmd = 2` as "write success". Whether the device also echoes the written
  bytes or reboots after protocol/baud changes is unverified.
- **Host heartbeat cadence and content**: frames every ~5 s with
  `hardware_ver = 1` and software 0.1.0 were observed in the tool; whether the
  device requires them (or what it does without them) is unverified.
- **Device heartbeat rate**: not established from captures; the MTF-01 data
  rate dominates the link at 100 Hz anyway.
- **MSP and MAVLink output modes** (protocol 1/2/3) are standard protocols and
  not covered here.
- **Radio (dev 30) and RTK (dev 23) parameter families** use the same CMD /
  CMD_ACK layer with different command ids (e.g. radio cmd 1/2/3/4/48) and are
  not documented yet.
- Physical-layer verification on real hardware is pending; every claim above
  except those flagged unverified is backed by the test vectors in
  `test/frame_test.mjs`.

## Licence

The spec text and code in this repository are AGPL-3.0-or-later; see LICENSE.
"Micolink", "MicoAir", and product names belong to their owner and are used
nominatively.