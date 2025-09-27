// AutoFlag MQTT Console (browser)

(() => {
  const $ = (id) => document.getElementById(id);
  const logEl = $('log');
  const deviceIdEl = $('deviceId');
  const clientIdEl = $('clientId');

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
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setEnabled(connected) {
    const enable = connected && !!DEVICE_ID;
    Object.values(btns).forEach((b) => b.disabled = !enable);
  }

  if (!DEVICE_ID) {
    log('Missing device_id query parameter. Example: ?device_id=17589400948014EX');
    setEnabled(false);
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

  client.on('connect', () => {
    log(`Connected to MQTT broker`);
    log(`→ Listening to: ${RESP_TOPIC}`);
    log(`← Sending to: ${PUB_TOPIC}`);
    setEnabled(true);
    client.subscribe(RESP_TOPIC, { qos: 0 }, (err) => {
      if (err) log(`Subscribe error: ${String(err)}`);
    });
  });

  client.on('reconnect', () => {
    log('Reconnecting…');
    setEnabled(false);
  });

  client.on('close', () => {
    log('Connection closed.');
    setEnabled(false);
  });

  client.on('error', (err) => {
    log(`Error: ${String(err)}`);
  });

  // Incoming messages
  const decoder = new TextDecoder();
  client.on('message', (topic, payload /* Uint8Array */) => {
    const msg = decoder.decode(payload);
    log(`→ ${msg}`);
  });

  // Publisher helper
  function publish(payload) {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    log(`← ${data}`);
    client.publish(PUB_TOPIC, data, { qos: 0, retain: false }, (err) => {
      if (err) log(`Publish error: ${String(err)}`);
    });
  }

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
})();
