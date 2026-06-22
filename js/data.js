/**
 * data.js — Meter model library
 *
 * Register addresses are entered exactly as shown in the meter manual:
 *
 *   Schneider PM2220: 1-based decimal register numbers (e.g. 3000, 3054)
 *     The decoder automatically converts to 0-based wire address (reg - 1).
 *
 *   Entes EMR53S: 0-based decimal addresses (e.g. 0, 6, 24)
 *     The decoder uses these as-is (values < 100 are treated as 0-based).
 *
 * When adding a new register in the UI, just type the number from the manual.
 */

const METER_MODELS = {

  PM2220: {
    name: 'Schneider PM2220',
    registers: [
      // ── Voltages ──────────────────────────────────────────────────────────
      { param: 'Voltage L1-N',         addr: '3028', fc: '03', dtype: 'FLOAT32', scale: '1',     unit: 'V',     byteorder: 'AB CD' },
      { param: 'Voltage L2-N',         addr: '3030', fc: '03', dtype: 'FLOAT32', scale: '1',     unit: 'V',     byteorder: 'AB CD' },
      { param: 'Voltage L3-N',         addr: '3032', fc: '03', dtype: 'FLOAT32', scale: '1',     unit: 'V',     byteorder: 'AB CD' },
      { param: 'Voltage L1-L2',        addr: '3020', fc: '03', dtype: 'FLOAT32', scale: '1',     unit: 'V',     byteorder: 'AB CD' },
      { param: 'Voltage L2-L3',        addr: '3022', fc: '03', dtype: 'FLOAT32', scale: '1',     unit: 'V',     byteorder: 'AB CD' },
      { param: 'Voltage L3-L1',        addr: '3024', fc: '03', dtype: 'FLOAT32', scale: '1',     unit: 'V',     byteorder: 'AB CD' },
      // ── Currents ─────────────────────────────────────────────────────────
      { param: 'Current L1',           addr: '3000', fc: '03', dtype: 'FLOAT32', scale: '1',     unit: 'A',     byteorder: 'AB CD' },
      { param: 'Current L2',           addr: '3002', fc: '03', dtype: 'FLOAT32', scale: '1',     unit: 'A',     byteorder: 'AB CD' },
      { param: 'Current L3',           addr: '3004', fc: '03', dtype: 'FLOAT32', scale: '1',     unit: 'A',     byteorder: 'AB CD' },
      { param: 'Current N',            addr: '3006', fc: '03', dtype: 'FLOAT32', scale: '1',     unit: 'A',     byteorder: 'AB CD' },
      // ── Per-phase active powers ───────────────────────────────────────────
      { param: 'Active Power L1',      addr: '3054', fc: '03', dtype: 'FLOAT32', scale: '1',     unit: 'W',     byteorder: 'AB CD' },
      { param: 'Active Power L2',      addr: '3056', fc: '03', dtype: 'FLOAT32', scale: '1',     unit: 'W',     byteorder: 'AB CD' },
      { param: 'Active Power L3',      addr: '3058', fc: '03', dtype: 'FLOAT32', scale: '1',     unit: 'W',     byteorder: 'AB CD' },
      // ── Total powers ──────────────────────────────────────────────────────
      { param: 'Active Power Total',   addr: '3060', fc: '03', dtype: 'FLOAT32', scale: '1', unit: 'kW',    byteorder: 'AB CD' },
      { param: 'Apparent Power Total', addr: '3076', fc: '03', dtype: 'FLOAT32', scale: '1', unit: 'kVA',   byteorder: 'AB CD' },
      { param: 'Reactive Power Total', addr: '3068', fc: '03', dtype: 'FLOAT32', scale: '1', unit: 'kVAR',  byteorder: 'AB CD' },
      // ── Power factors ─────────────────────────────────────────────────────
      { param: 'Power Factor L1',      addr: '3078', fc: '03', dtype: '4Q_FP_PF', scale: '1',     unit: '',      byteorder: 'AB CD' },
      { param: 'Power Factor L2',      addr: '3080', fc: '03', dtype: '4Q_FP_PF', scale: '1',     unit: '',      byteorder: 'AB CD' },
      { param: 'Power Factor L3',      addr: '3082', fc: '03', dtype: '4Q_FP_PF', scale: '1',     unit: '',      byteorder: 'AB CD' },
      { param: 'Power Factor Total',   addr: '3084', fc: '03', dtype: '4Q_FP_PF', scale: '1',     unit: '',      byteorder: 'AB CD' },
      // ── Frequency ────────────────────────────────────────────────────────
      { param: 'Frequency',            addr: '3110', fc: '03', dtype: 'FLOAT32', scale: '1',     unit: 'Hz',    byteorder: 'AB CD' },
      // ── Energy (INT64, 4 words = 8 bytes each) ───────────────────────────
      { param: 'Active Energy Delivered', addr: '3204', fc: '03', dtype: 'INT64',   scale: '0.001', unit: 'kWh',   byteorder: 'AB CD' },
      { param: 'Active Energy Received', addr: '3208', fc: '03', dtype: 'INT64',   scale: '0.001', unit: 'kWh',   byteorder: 'AB CD' },
      { param: 'Reactive Energy Delivered',  addr: '3220', fc: '03', dtype: 'INT64',   scale: '0.001', unit: 'kVARh', byteorder: 'AB CD' },
    ],
  },

  EMR53S: {
    name: 'Entes EMR53S',
    registers: [
      // ── DR164 delivers all values as FLOAT32 (2 words = 4 bytes each) ─────
      // ── Addresses are 0-based as per Entes manual ─────────────────────────
      // ── Voltages ──────────────────────────────────────────────────────────
      { param: 'Voltage L1-N',         addr: '0000',  fc: '03', dtype: 'FLOAT32', scale: '1', unit: 'V',    byteorder: 'AB CD' },
      { param: 'Voltage L2-N',         addr: '0002',  fc: '03', dtype: 'FLOAT32', scale: '1', unit: 'V',    byteorder: 'AB CD' },
      { param: 'Voltage L3-N',         addr: '0004',  fc: '03', dtype: 'FLOAT32', scale: '1', unit: 'V',    byteorder: 'AB CD' },
      { param: 'Voltage L1-L2',        addr: '0008',  fc: '03', dtype: 'FLOAT32', scale: '1', unit: 'V',    byteorder: 'AB CD' },
      { param: 'Voltage L2-L3',        addr: '0010', fc: '03', dtype: 'FLOAT32', scale: '1', unit: 'V',    byteorder: 'AB CD' },
      { param: 'Voltage L3-L1',        addr: '0012', fc: '03', dtype: 'FLOAT32', scale: '1', unit: 'V',    byteorder: 'AB CD' },
	  // ── Currents ─────────────────────────────────────────────────────────
      { param: 'Current L1',           addr: '0014', fc: '03', dtype: 'FLOAT32', scale: '1',     unit: 'A',     byteorder: 'AB CD' },
      { param: 'Current L2',           addr: '0016', fc: '03', dtype: 'FLOAT32', scale: '1',     unit: 'A',     byteorder: 'AB CD' },
      { param: 'Current L3',           addr: '0018', fc: '03', dtype: 'FLOAT32', scale: '1',     unit: 'A',     byteorder: 'AB CD' },
	  { param: 'Current N',            addr: '0020', fc: '03', dtype: 'FLOAT32', scale: '1',     unit: 'A',     byteorder: 'AB CD' },
      // ── Frequency ────────────────────────────────────────────────────────
      { param: 'Frequency',            addr: '0024', fc: '03', dtype: 'FLOAT32', scale: '1', unit: 'Hz',   byteorder: 'AB CD' },
      // ── Powers ────────────────────────────────────────────────────────────
      { param: 'Apparent Power Total', addr: '0070', fc: '03', dtype: 'FLOAT32', scale: '1', unit: 'kVA',  byteorder: 'AB CD' },
      { param: 'Active Power Total',   addr: '0038', fc: '03', dtype: 'FLOAT32', scale: '1', unit: 'kW',   byteorder: 'AB CD' },
      // ── Power factor ──────────────────────────────────────────────────────
      { param: 'Power Factor Total',   addr: '0084', fc: '03', dtype: 'FLOAT32', scale: '1', unit: '',     byteorder: 'AB CD' },
      // ── Energy ────────────────────────────────────────────────────────────
      { param: 'Active Energy Import', addr: '0200', fc: '03', dtype: 'FLOAT32', scale: '1', unit: 'kWh',  byteorder: 'AB CD' },
    ],
  },

};

// Installed meter instances
const DEMO_METERS = [
  { id: 1, name: 'Main Incomer Meter 1', model: 'PM2220', slave: 1, topic: 'sensorjip/data', loc: 'JIP Office', ct: '200/5', online: true },
  { id: 2, name: 'Main Incomer Meter 2',  model: 'EMR53S', slave: 2, topic: 'sensorjip/data', loc: 'JIP Office', ct: '100/5', online: true },
];
