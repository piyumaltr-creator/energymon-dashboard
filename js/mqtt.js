/**
 * mqtt.js — MQTT over WebSocket client + simulation fallback
 *
 * ─── IMPORTANT: Browser MQTT needs WebSocket, not raw TCP ───
 *
 * HiveMQ public broker:
 *   ws://broker.hivemq.com:8000/mqtt    ← plain WebSocket (use this if TLS fails)
 *   wss://broker.hivemq.com:8884/mqtt   ← secure WebSocket
 *
 * Local Mosquitto (mosquitto.conf must have `listener 9001` + `protocol websockets`):
 *   ws://192.168.x.x:9001
 *
 * Your MQTTX connects on TCP port 1883. That works for desktop apps.
 * This browser dashboard must use the WebSocket port instead.
 */

const MqttClient = (() => {

  let _client    = null;
  let _connected = false;
  let _simTimer  = null;

  let _config = {
    host:     'broker.hivemq.com',
    port:     8000,        // Use 8000 (plain WS) for HiveMQ — more reliable than 8884 wss in browsers
    tls:      false,       // false = ws://, true = wss://
    clientId: 'energymon-' + Math.random().toString(16).slice(2, 10),
    username: '',
    password: '',
    qos:      0,           // QoS 0 for raw telemetry — lower latency
  };

  const _handlers = {
    onConnect:     () => {},
    onDisconnect:  () => {},
    onRawMessage:  (topic, raw, meta) => {},
    onMessage:     (topic, value) => {},
    onModbusFrame: (topic, hex) => {},
    onLog:         (level, msg) => {},   // 'info' | 'warn' | 'error'
  };

  const _modbusTopics = new Set();

  function _log(level, msg) {
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log']('[MQTT]', msg);
    _handlers.onLog(level, msg);
  }

  function _brokerUrl() {
    const scheme = _config.tls ? 'wss' : 'ws';
    // HiveMQ and most brokers expect /mqtt path for WebSocket
    return `${scheme}://${_config.host}:${_config.port}/mqtt`;
  }

  function _toBytes(message) {
    if (message instanceof Uint8Array) return message;
    if (message instanceof ArrayBuffer) return new Uint8Array(message);
    if (Array.isArray(message)) return Uint8Array.from(message);
    if (typeof Buffer !== 'undefined' && message instanceof Buffer) return new Uint8Array(message);
    if (message?.buffer instanceof ArrayBuffer) {
      return new Uint8Array(message.buffer, message.byteOffset || 0, message.byteLength || message.length || 0);
    }
    const text = typeof message === 'string' ? message : String(message ?? '');
    return new TextEncoder().encode(text);
  }

  function _bytesToHex(bytes) {
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(' ');
  }

  function _decodeText(bytes) {
    try {
      return new TextDecoder().decode(bytes);
    } catch (_) {
      return Array.from(bytes, b => String.fromCharCode(b)).join('');
    }
  }

  function _isMostlyPrintable(text) {
    if (!text) return false;
    let printable = 0;
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126)) printable++;
    }
    return (printable / text.length) >= 0.85;
  }

  function _normalizePayload(message) {
    const bytes = _toBytes(message);
    const text = _decodeText(bytes).trim();
    const hex = _bytesToHex(bytes);
    const isBinary = !_isMostlyPrintable(text);
    return {
      bytes,
      text,
      hex,
      isBinary,
      display: isBinary ? hex : text,
    };
  }

  function connect(cfg) {
    if (cfg) Object.assign(_config, cfg);

    if (typeof mqtt === 'undefined') {
      _log('error', 'mqtt.js library not loaded — check internet connection (CDN)');
      _handlers.onDisconnect('lib_missing');
      return;
    }

    if (_client) {
      try { _client.end(true); } catch (_) {}
      _client = null;
      _connected = false;
    }

    const url = _brokerUrl();
    _log('info', `Connecting to ${url} …`);

    try {
      _client = mqtt.connect(url, {
        clientId:        _config.clientId,
        username:        _config.username || undefined,
        password:        _config.password || undefined,
        clean:           true,
        reconnectPeriod: 0,        // no auto-reconnect; we handle it
        connectTimeout:  10000,
        keepalive:       60,
        protocolVersion: 4,        // MQTT 3.1.1 — broadest broker support
      });
    } catch (e) {
      _log('error', `mqtt.connect() threw: ${e.message}`);
      _scheduleSimulation(1000);
      return;
    }

    _client.on('connect', (ack) => {
      _log('info', `Connected ✓ (rc=${ack?.returnCode ?? 0})`);
      _connected = true;
      clearTimeout(_simTimer);
      // Resubscribe to all Modbus frame topics
      _modbusTopics.forEach(t => {
        _client.subscribe(t, { qos: _config.qos }, (err) => {
          if (err) _log('warn', `Subscribe failed: ${t} — ${err.message}`);
          else     _log('info', `Subscribed: ${t}`);
        });
      });
      _handlers.onConnect();
    });

    _client.on('error', err => {
      _log('error', `Error: ${err.message}`);
      // Do NOT call onDisconnect here; wait for 'close'
    });

    _client.on('close', () => {
      _log('warn', 'Connection closed');
      if (_connected) {
        _connected = false;
        _handlers.onDisconnect('closed');
      } else {
        _handlers.onDisconnect('failed');
      }
    });

    _client.on('offline', () => {
      _log('warn', 'Client went offline');
    });

    _client.on('reconnect', () => {
      _log('info', 'Attempting reconnect…');
    });

    _client.on('message', (topic, message) => {
      const payload = _normalizePayload(message);
      const raw = payload.display;
      _handlers.onRawMessage(topic, raw, payload);

      // ── Registered Modbus frame topic — only process if topic matches exactly ──
      if (_modbusTopics.has(topic)) {
        if ((payload.isBinary && payload.hex.replace(/\s/g,'').length >= 10) ||
            (/^[0-9a-fA-F\s]+$/.test(raw) && raw.replace(/\s/g,'').length >= 10)) {
          _handlers.onModbusFrame(topic, payload.isBinary ? payload.hex : raw);
          return;
        }
      }

      // ── JSON {"value": N} ──
      try {
        const obj = JSON.parse(payload.text);
        const v = obj.value !== undefined ? parseFloat(obj.value) : null;
        if (v !== null && !isNaN(v)) { _handlers.onMessage(topic, v); return; }
      } catch (_) {}

      // ── Plain number ──
      const f = parseFloat(payload.text);
      if (!isNaN(f)) { _handlers.onMessage(topic, f); return; }

      // ── No match — log as unhandled ──
      _log('info', `Unhandled message on ${topic}: ${raw.slice(0,60)}`);
    });

    // Notify disconnect if still not connected after 10s
    _simTimer = setTimeout(() => {
      if (!_connected) {
        _log('warn', 'Connection timed out after 10s');
        _handlers.onDisconnect('timeout');
      }
    }, 10000);
  }

  function disconnect() {
    clearTimeout(_simTimer);
    if (_client) { try { _client.end(true); } catch (_) {} _client = null; }
    _connected = false;
  }

  function _unsubscribeAllModbusTopics() {
    if (_client && _connected && _modbusTopics.size > 0) {
      _modbusTopics.forEach(t => { _client.unsubscribe(t, () => {}); });
    }
    _modbusTopics.clear();
  }

  /**
   * subscribeModbusTopics(topics) — replace all current Modbus subscriptions.
   * Pass an array of topic strings. Old subscriptions are cleanly unsubscribed first.
   */
  function subscribeModbusTopics(topics) {
    const list = (Array.isArray(topics) ? topics : [topics]).map(t => String(t).trim()).filter(Boolean);
    _unsubscribeAllModbusTopics();
    list.forEach(t => {
      _modbusTopics.add(t);
      if (_client && _connected) {
        _client.subscribe(t, { qos: _config.qos }, (err) => {
          if (err) _log('warn', `Subscribe failed: ${t}`);
          else     _log('info', `Subscribed: ${t}`);
        });
      }
    });
  }

  // Keep old single-topic API as alias for backwards compatibility
  function subscribeModbusTopic(topic) { subscribeModbusTopics([topic]); }

  function subscribeToMeter(meter, registers) {
    registers.forEach(reg => {
      const slug  = reg.param.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      const topic = `${meter.topic}/${slug}`;
      if (_client && _connected) _client.subscribe(topic, { qos: _config.qos });
    });
  }

  function subscribe(topic) {
    if (_client && _connected) _client.subscribe(topic, { qos: _config.qos });
  }

  function on(event, fn) {
    if (event in _handlers) _handlers[event] = fn;
  }

  function isConnected() { return _connected; }
  function getConfig()   { return { ..._config }; }

  return { connect, disconnect, subscribe, subscribeToMeter, subscribeModbusTopic, subscribeModbusTopics, on, isConnected, getConfig };

})();

