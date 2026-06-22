/**
 * modbus-decoder.js — Modbus RTU frame parser
 *
 * Handles two frame formats published by the PUSR DR164 gateway:
 *
 *   Format A — request + response concatenated:
 *     [SlaveID FC StartHi StartLo CountHi CountLo CRC CRC]  ← 8-byte request
 *     [SlaveID FC ByteCount Data... CRC CRC]                 ← response
 *
 *   Format B — response only:
 *     [SlaveID FC ByteCount Data... CRC CRC]
 *
 * All register addresses in the map must be 0-based hex wire addresses
 * (i.e. what physically appears in the Modbus PDU).
 *
 * Schneider PM2220: manual uses 1-based decimal register numbers.
 *   Wire address = register_number_decimal - 1
 *   e.g. manual reg 3000 → wire address 0x0BB7
 *
 * Entes EMR53S: manual uses 0-based addresses — no adjustment needed.
 */

const ModbusDecoder = (() => {

  // ── Hex string → byte array ───────────────────────────────────────────────
  function parseHex(hex) {
    const s = hex.replace(/\s/g, '');
    const b = [];
    for (let i = 0; i < s.length - 1; i += 2)
      b.push(parseInt(s.substr(i, 2), 16));
    return b;
  }

  // ── CRC-16/IBM ────────────────────────────────────────────────────────────
  function crc16(data) {
    let crc = 0xFFFF;
    for (const byte of data) {
      crc ^= byte;
      for (let j = 0; j < 8; j++)
        crc = (crc & 1) ? (crc >>> 1) ^ 0xA001 : crc >>> 1;
    }
    return crc;
  }

  function checkCRC(bytes) {
    if (bytes.length < 4) return false;
    const calc = crc16(bytes.slice(0, -2));
    const recv = bytes[bytes.length - 2] | (bytes[bytes.length - 1] << 8);
    return calc === recv;
  }

  // ── Data-type sizes ───────────────────────────────────────────────────────
  function typeBytes(dtype) {
    if (dtype === 'UINT16' || dtype === 'INT16')  return 2;
    if (dtype === 'UINT32' || dtype === 'INT32')  return 4;
    if (dtype === 'FLOAT32' || dtype === '4Q_FP_PF') return 4;
    if (dtype === 'FLOAT64')                       return 8;
    if (dtype === 'INT64'  || dtype === 'UINT64')  return 8;
    return 2;
  }

  // ── Byte-order reorder ────────────────────────────────────────────────────
  function reorder(b, order) {
    if (!order || order === 'AB CD') return b;
    if (order === 'CD AB') return [b[2], b[3], b[0], b[1]];
    if (order === 'BA DC') return [b[1], b[0], b[3], b[2]];
    if (order === 'DC BA') return [b[3], b[2], b[1], b[0]];
    return b;
  }
  
  // ── Bytes → value ─────────────────────────────────────────────────────────
  function toValue(rawBytes, dtype, byteorder) {
    const b = reorder(rawBytes, byteorder);
    switch (dtype) {
      case 'UINT16': return (b[0] << 8) | b[1];
      case 'INT16': { const u = (b[0] << 8) | b[1]; return u > 32767 ? u - 65536 : u; }
      case 'UINT32': return ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
      case 'INT32': { const u = (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3];
                      return u > 2147483647 ? u - 4294967296 : u; }
      case 'FLOAT32': {
        const buf = new ArrayBuffer(4);
        new Uint8Array(buf).set(b.slice(0, 4));
        return new DataView(buf).getFloat32(0, false);  // big-endian
      }
      case '4Q_FP_PF': {
        // 1. Read the wire-reordered bytes into a standard 32-bit float first
        const buf = new ArrayBuffer(4);
        new Uint8Array(buf).set(b.slice(0, 4));
        const rawFloat = new DataView(buf).getFloat32(0, false);

        // 2. Map Schneider's -2.0 to +2.0 quadrant values to standard -1.0 to +1.0 Power Factor
        if (rawFloat > 1 && rawFloat <= 2)   return 2.0 - rawFloat;  // Q4: Capacitive Import
        if (rawFloat >= -2 && rawFloat < -1) return -2.0 - rawFloat; // Q2: Capacitive Export
        return rawFloat;                                             // Q1 & Q3: Inductive Import/Export
      }
      case 'FLOAT64': {
        const buf = new ArrayBuffer(8);
        new Uint8Array(buf).set(b.slice(0, 8));
        return new DataView(buf).getFloat64(0, false);
      }
      case 'INT64':
      case 'UINT64': {
        // JavaScript BigInt → Number (safe for energy counters up to ~9 PetaWh)
        const buf = new ArrayBuffer(8);
        new Uint8Array(buf).set(b.slice(0, 8));
        const dv = new DataView(buf);
        const hi = dv.getUint32(0, false);
        const lo = dv.getUint32(4, false);
        return hi * 4294967296 + lo;
      }
      default: return 0;
    }
  }

  

  // ── Parse register address ────────────────────────────────────────────────
  //
  // Users enter addresses exactly as shown in their meter manual:
  //
  //   Schneider PM2220: decimal register numbers (1-based), e.g. 3000, 3054
  //     → wire address = register_number - 1  (Modbus protocol is 0-based)
  //
  //   Entes EMR53S: decimal addresses that are already 0-based, e.g. 0, 6, 24
  //     → wire address = address as-is (no subtraction needed)
  //
  // Detection rule:
  //   - If the string contains only digits (no letters a-f) → decimal input
  //       If value >= 100 → 1-based register number → subtract 1
  //       If value < 100  → already 0-based (small address like 0,6,24,54)
  //   - If the string contains hex digits (a-f, A-F) → hex input → parse as-is
  //       Assumed to already be a 0-based wire address
  //
  function parseAddr(addr) {
    const s = String(addr).trim();
    if (!s) return null;

    const isPureDecimal = /^\d+$/.test(s);

    if (isPureDecimal) {
      const dec = parseInt(s, 10);
      // Registers ≥ 100 follow Schneider-style 1-based numbering
      // Registers < 100 are small 0-based addresses (EMR53S style)
      return dec >= 100 ? dec - 1 : dec;
    }

    // Has hex chars → parse directly as hex 0-based wire address
    const hex = parseInt(s, 16);
    return isNaN(hex) ? null : hex;
  }

  // ── Split concatenated request+response frame ─────────────────────────────
  function splitFrame(bytes) {
    // Try request (8 bytes) + response
    if (bytes.length > 8) {
      const req = bytes.slice(0, 8);
      const res = bytes.slice(8);
      const reqOk = (req[1] === 3 || req[1] === 4) && req[0] === res[0] && req[1] === res[1];
      const resLen = 3 + res[2] + 2;
      if (reqOk && res.length === resLen) {
        return { request: req, response: res };
      }
    }
    // Response-only
    return { request: null, response: bytes };
  }

  // ── Validate response frame structure ─────────────────────────────────────
  function isValidResponse(bytes) {
    if (bytes.length < 5) return false;
    if (bytes[1] !== 3 && bytes[1] !== 4) return false;
    return bytes.length === 3 + bytes[2] + 2;
  }

  // ── Main decode ───────────────────────────────────────────────────────────
  function decode(hexString, registerMap) {
    const bytes = parseHex(hexString);
    if (bytes.length < 5) return { error: 'Frame too short' };

    const { request, response } = splitFrame(bytes);

    if (!isValidResponse(response)) return { error: 'Invalid response frame' };

    if (!checkCRC(response)) {
      console.warn('[Modbus] CRC mismatch — continuing anyway');
    }

    const slaveId   = response[0];
    const fc        = response[1];
    const byteCount = response[2];
    const data      = response.slice(3, 3 + byteCount);

    // Start address from the request frame (if present)
    let startAddr = null;
    if (request) {
      startAddr = (request[2] << 8) | request[3];
    }

    const values = {};
    const fcStr  = String(fc).padStart(2, '0');

    // Build sorted register list (matching this FC, address within range)
    const candidates = (registerMap || [])
      .filter(r => !r.fc || String(r.fc) === fcStr)
      .map(r => ({ ...r, _addr: parseAddr(r.addr) }))
      .filter(r => r._addr !== null)
      .sort((a, b) => a._addr - b._addr);

    if (startAddr !== null) {
      // ── Address-aware decode ──────────────────────────────────────────────
      const endAddr = startAddr + data.length / 2;  // number of 16-bit words
      for (const reg of candidates) {
        if (reg._addr < startAddr || reg._addr >= endAddr) continue;
        const sz     = typeBytes(reg.dtype);
        const offset = (reg._addr - startAddr) * 2;
        if (offset + sz > data.length) continue;
        const raw    = toValue(data.slice(offset, offset + sz), reg.dtype, reg.byteorder);
        values[reg.param] = raw * (parseFloat(reg.scale) || 1);
      }
    } else {
      // ── Sequential decode (no address info) ──────────────────────────────
      let offset = 0;
      for (const reg of candidates) {
        const sz = typeBytes(reg.dtype);
        if (offset + sz > data.length) break;
        const raw = toValue(data.slice(offset, offset + sz), reg.dtype, reg.byteorder);
        values[reg.param] = raw * (parseFloat(reg.scale) || 1);
        offset += sz;
      }
    }

    return { slaveId, fc, startAddr, byteCount, values };
  }

  return { decode };

})();
