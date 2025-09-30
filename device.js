// AutoFlag MQTT Console (browser)

(() => {
  const STORAGE_KEY = 'autoflag.auth';
  const API_BASE = 'https://api.autoflagraiser.com';

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

  // EMQX advanced info elements
  const emqxConnected   = $('emqxConnected');
  const emqxConnectedAt = $('emqxConnectedAt');
  const emqxIp          = $('emqxIp');
  const emqxRecvOct     = $('emqxRecvOct');
  const emqxSendOct     = $('emqxSendOct');
  const emqxLastChecked = $('emqxLastChecked');
  const btnEmqxRefresh  = $('btnEmqxRefresh');
  const emqxEfuse       = $('emqxEfuse');
  const emqxFirmware    = $('emqxFirmware');
  const deviceNameEl    = $('deviceName');
  const deviceLocationEl = $('deviceLocation');
  const emqxPanelEl     = $('emqxPanel');
  const statusPanelEl   = $('statusPanel');

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

    // Are we currently at (or near) the bottom?
    const atBottom = (logEl.scrollTop + logEl.clientHeight) >= (logEl.scrollHeight - 2);

    // Append without resetting the whole text node
    logEl.insertAdjacentText('beforeend', `[${ts}] ${line}\n`);

    // If we were at bottom, keep it pinned after the DOM updates
    if (atBottom) requestAnimationFrame(() => {
      logEl.scrollTop = logEl.scrollHeight;
    });
  }

  function setButtonsEnabled(yes) {
    const enable = yes && !!DEVICE_ID && initialStatusReceived;
    Object.values(btns).forEach((b) => b.disabled = !enable);
    // Maintenance checkbox enabled separately below
  }

  function fmtTime(d) {
    try {
      return new Intl.DateTimeFormat(undefined, {
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric'
      }).format(d);
    } catch { return d.toLocaleString(); }
  }

  if (!DEVICE_ID) {
    log('Missing device_id query parameter. Example: ?device_id=17589400948014EX');
    setButtonsEnabled(false);
    chkMaint.disabled = true;
    return;
  }

  // EMQX API helpers
  function renderEmqxInfo(info) {
    function fmtIsoOrDash(s) {
      if (!s) return '—';
      try { return new Date(s).toLocaleString(); } catch { return s; }
    }
    emqxConnected.textContent   = info.connected ? '🟢 Connected' : '❌ Disconnected';
    emqxConnectedAt.textContent = fmtIsoOrDash(info.connected_at);
    emqxIp.textContent          = info.ip_address || '—';
    emqxRecvOct.textContent     = Number.isFinite(info.recv_oct) ? String(info.recv_oct) : (info.recv_oct ?? '—');
    emqxSendOct.textContent     = Number.isFinite(info.send_oct) ? String(info.send_oct) : (info.send_oct ?? '—');
    emqxLastChecked.textContent = fmtTime(new Date());
  }
  async function fetchEmqxClient() {
    const url = new URL(`https://emqx.dev-proxy.api-autoflag.com/api/v5/clients/${encodeURIComponent(DEVICE_ID)}`);
    try {
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) {
        emqxConnected.textContent = `(${res.status} ${res.statusText})`;
        return null;
      }
      const data = await res.json();
      renderEmqxInfo(data);
      return data;
    } catch {
      emqxConnected.textContent = '(request failed)';
      return null;
    } finally {
      btnEmqxRefresh.disabled = false;
      emqxPanelEl.classList.remove('disable-text');
    }
  }
  fetchEmqxClient();

  async function fetchEmqxClientMetadataTopic() {
    const url = new URL(`https://emqx.dev-proxy.api-autoflag.com/api/v5/clients/${encodeURIComponent(DEVICE_ID)}/subscriptions`);
    try {
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) {
        console.error(`EMQX metadata fetch error: ${res.status} ${res.statusText}`);
        return null;
      }
      const data = await res.json();
      const metadataTopic = Array.isArray(data) ? data.find(s => s.topic.includes('EFUSE:')) : null;
      if (metadataTopic) {
        // example: "mqtt_communication/AutoFlag/EFUSE:6478F016A3986C10/ID:828713/MQTT_HOST:209.38.70.39/FIRMWARE: v4.0.0-beta.3"
        const parts = metadataTopic.topic.split('/');
        const info = {};
        for (const part of parts) {
          const [k, v] = part.split(':');
          if (k && v) info[k] = v.trim();
        }
        if (info.EFUSE) {
          emqxEfuse.textContent = info.EFUSE;
          emqxEfuse.closest('.item').hidden = false;
        }
        if (info.FIRMWARE) {
          emqxFirmware.textContent = info.FIRMWARE;
          emqxFirmware.closest('.item').hidden = false;
        }
      }
    } catch (error) {
      console.error(`EMQX metadata fetch error`, error);
    }
    return null;
  }
  fetchEmqxClientMetadataTopic();

  async function getApiDeviceInfo() {
    try {
      const userAuthData = JSON.parse(localStorage.getItem(STORAGE_KEY)); 
      const url = new URL(`${API_BASE}/api/auto-flag-devices`);
      url.searchParams.set('filters[users_permissions_users][$eq]', userAuthData.user.id);
      const res = await fetch(url, { headers: { 'Authorization': `Bearer ${userAuthData.jwt}` }});
      const jsonResult = await res.json();
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const arr = Array.isArray(jsonResult?.data) ? jsonResult.data : [];
      const d = arr.find(d => d.deviceId === DEVICE_ID);
      if (d?.deviceName) {
        deviceNameEl.textContent = d.deviceName;
        document.title = `AutoFlag: ${d.deviceName}`;
        deviceLocationEl.textContent = `${d.deviceCountry?.short_name}, ${d.deviceState?.short_name}, ${d.deviceCity}`;
      }
    } catch (error) {
      console.error('API device info fetch error', error);
    }
  }
  getApiDeviceInfo();

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

  // Status render
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
      fpos === 1 ? '⏫  Upper' :
      fpos === 2 ? '↕️  Mid' :
      fpos === 3 ? '⏬  Lower' :
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
    statusPanelEl.classList.remove('disable-text');
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

  btns.status.addEventListener('click', () => {
    statusPanelEl.classList.add('disable-text');
    publish('STATUS');
  });
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

  // EMQX refresh button
  btnEmqxRefresh.addEventListener('click', () => {
    emqxPanelEl.classList.add('disable-text');
    fetchEmqxClient();
    fetchEmqxClientMetadataTopic();
  });
})();

