// AutoFlag MQTT Console (browser)

(() => {
  const $ = (id) => document.getElementById(id);
  const logEl = $('log');
  const deviceIdEl = $('deviceId');
  const clientIdEl = $('clientId');

  const sBattery = $('sBattery');
  const sFlag = $('sFlag');
  const sCal = $('sCal');
  const sMaint = $('sMaint');
  const sLast = $('sLast');
  const chkMaint = $('chkMaint');

  const btns = {
    status: $('btnStatus'),
    echo: $('btnEcho'),
    up: $('btnUp'),
    down: $('btnDown'),
    stop: $('btnStop'),
    upper: $('btnUpper'),
    mid: $('btnMid'),
    lower: $('btnLower'),
  };

  // Read device_id from URL
  const params = new URLSearchParams(window.location.search);
  const DEVICE_ID = (params.get('device_id') || '').trim();
  deviceIdEl.textContent = DEVICE_ID || '(missing)';

  // Topics
  const PUB_TOPIC = `mqtt_communication/AutoFlag/${DEVICE_ID}/IN`;
  const RESP_TOPIC = `mqtt_communication/AutoFlag/${DEVICE_ID}/OUT`;

  // Client
  const CLIENT_ID = 'dev-web-app-' + Math.random().toString(16).slice(2, 8);
  clientIdEl.textContent = CLIENT_ID;

  function log(line) {
    const ts = new Intl.DateTimeFormat(undefined, {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      fractionalSecondDigits: 3, hour12: false
    }).format(new Date());
    logEl.textContent += `[${ts}] ${line}\n`;
    const stick = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 2;
    if (stick) logEl.scrollTop = logEl.scrollHeight;
  }

  function setButtonsEnabled(yes) {
    const enable = yes && !!DEVICE_ID && initialStatusReceived;
    Object.values(btns).forEach((b) => b.disabled = !enable);
    // Maintenance checkbox enabled separately below
  }

  function fmtTime(d) {
    try {
      return new Intl.DateTimeFormat(undefined, {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      }).format(d);
    } catch { return d.toLocaleString(); }
  }

  if (!DEVICE_ID) {
    log('Missing device_id query parameter. Example: ?device_id=17589400948014EX');
    setButtonsEnabled(false);
    chkMaint.disabled = true;
    return;
  }

  // Connect
  const connectUrl = 'wss://mqtt.dev-proxy.api-autoflag.com/mqtt';
  const options = {
    clientId: CLIENT_ID,
    username: 'dev-test',
    password: 'dev-testing',
    clean: true,
    reconnectPeriod: 2000,
    keepalive: 60,
    connectTimeout: 30000,
    protocolVersion: 4, // MQTT 3.1.1
  };

  const client = mqtt.connect(connectUrl, options);

  let initialStatusReceived = false;
  let maintPending = false;

  function setCalibrationStatus(calibrated) {
    sCal.textContent = calibrated ? '🎯 Calibrated' : '🚧 Not calibrated';
  }

  function setMaintenanceStatus(on) {
    sMaint.textContent = on ? '🛠️ On' : '🛠️ Off';
    chkMaint.checked = on;
  }

  // UI helpers from status packet
  function renderStatus(obj) {
    // Expect keys: vtg (volts as string), per (0-100), char (0/1), Fpos (0-3), Fcal (0/1), Mmode (0/1)
    const per = Number(obj.per);
    const vtg = Number(obj.vtg);
    const charging = Number(obj.char) === 1;
    const fpos = Number(obj.Fpos);
    const fcal = Number(obj.Fcal) === 1;
    const mmode = Number(obj.Mmode) === 1;

    // Battery
    const battEmoji = charging ? '🔋' : '🪫';
    const pct = Number.isFinite(per) ? `${per}%` : '—';
    const volts = Number.isFinite(vtg) ? `${vtg.toFixed(2)}V` : `${obj.vtg ?? '—'}V`;
    sBattery.textContent = `${battEmoji} ${pct} (${volts})`;

    // Flag position
    const posText = (
      fpos === 1 ? '⬆️  Top' :
      fpos === 2 ? '↕️  Mid' :
      fpos === 3 ? '⬇️  Bottom' :
      '❔ Unknown'
    );
    sFlag.textContent = posText;

    // Calibration
    setCalibrationStatus(fcal);

    // Maintenance
    setMaintenanceStatus(mmode);

    // Last update timestamp
    sLast.textContent = fmtTime(new Date());

    // After first good status, enable controls
    if (!initialStatusReceived) {
      initialStatusReceived = true;
      setButtonsEnabled(true);
      chkMaint.disabled = false; // allow toggling
    }
  }

  function publish(payload) {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    log(`← ${data}`);
    client.publish(PUB_TOPIC, data, { qos: 0, retain: false }, (err) => {
      if (err) log(`Publish error: ${String(err)}`);
    });
  }

  client.on('connect', () => {
    log(`Connected to MQTT broker`);
    log(`→ Listening to: ${RESP_TOPIC}`);
    log(`← Sending to: ${PUB_TOPIC}`);
    initialStatusReceived = false;
    setButtonsEnabled(true); // still disabled until initialStatusReceived
    Object.values(btns).forEach((b) => b.disabled = true);
    chkMaint.disabled = true;

    client.subscribe(RESP_TOPIC, { qos: 0 }, (err) => {
      if (err) { log(`Subscribe error: ${String(err)}`); return; }
      // Request current status immediately
      publish('STATUS');
      log('Requesting device status...');
    });
  });

  client.on('reconnect', () => {
    log('Reconnecting…');
    setButtonsEnabled(false);
    chkMaint.disabled = true;
  });

  client.on('close', () => {
    log('Connection closed.');
    setButtonsEnabled(false);
    chkMaint.disabled = true;
  });

  client.on('error', (err) => {
    log(`Error: ${String(err)}`);
  });

  // Incoming messages
  const decoder = new TextDecoder();
  client.on('message', (topic, payload /* Uint8Array */) => {
    const msg = decoder.decode(payload);
    log(`→ ${msg}`);

    // Try to parse JSON status packets
    let parsed = null;
    try { parsed = JSON.parse(msg); } catch {}

    if (parsed && typeof parsed === 'object') {
      if ('vtg' in parsed || 'per' in parsed || 'Fpos' in parsed || 'Mmode' in parsed) {
        renderStatus(parsed);
        return;
      }
    }

    // Check for responses that end maintenance toggle pending state
    const m = msg.trim().toUpperCase();
    if (maintPending && (m.includes('SUCCESS') || m.includes('FAILED'))) {
      maintPending = false;
      chkMaint.disabled = false;
      setMaintenanceStatus(chkMaint.checked);
    }
  });

  // Buttons
  let lastMsgNumber = 0;

  btns.status.addEventListener('click', () => publish('STATUS'));
  btns.echo.addEventListener('click', () => {
    lastMsgNumber += 1;
    publish({ echoTest: true, correlationId: crypto.randomUUID(), msgNumber: lastMsgNumber });
  });
  btns.up.addEventListener('click', () => publish('1'));
  btns.down.addEventListener('click', () => publish('2'));
  btns.stop.addEventListener('click', () => publish('0'));
  btns.upper.addEventListener('click', () => publish('UP'));
  btns.mid.addEventListener('click', () => publish('MID'));
  btns.lower.addEventListener('click', () => publish('DOWN'));

  // Maintenance checkbox toggle
  chkMaint.addEventListener('change', () => {
    const desired = chkMaint.checked; // true => ON, false => OFF
    const cmd = desired ? 'MANUAL ON' : 'MANUAL OFF';
    maintPending = true;
    chkMaint.disabled = true; // disable until SUCCESS/FAILED
    publish(cmd);
  });
})();
