/* AutoFlag BLE Console (Web Bluetooth) */

(() => {
  const SERVICE_UUID = '3159e1ed-1e93-412c-9591-c146b2ce70fc';
  const TX_CHAR_UUID = '99000ae1-42bd-4ca1-9b00-1815c0cc351f'; // device -> web (indicate/notify/read)
  const RX_CHAR_UUID = '99000ae2-42bd-4ca1-9b00-1815c0cc351f'; // web -> device (write)

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const $ = (id) => document.getElementById(id);

  const btnConnect = $('btnConnect');
  const btnDisconnect = $('btnDisconnect');
  const btnSend = $('btnSend');
  const btnClear = $('btnClear');
  const status = $('status');

  const ssid = $('ssid');
  const pss  = $('pss');
  const id   = $('id');
  const cou  = $('cou');
  const sta  = $('sta');
  const cit  = $('cit');
  const jsonPreview = $('jsonPreview');

  /** @type {BluetoothDevice | null} */ let device = null;
  /** @type {BluetoothRemoteGATTServer | null} */ let server = null;
  /** @type {BluetoothRemoteGATTCharacteristic | null} */ let txChar = null;
  /** @type {BluetoothRemoteGATTCharacteristic | null} */ let rxChar = null;

  function log(line) {
    const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');
    status.textContent += `[${ts}] ${line}\n`;
    status.scrollTop = status.scrollHeight;
  }

  function setUIConnected(connected) {
    btnConnect.disabled = connected;
    btnDisconnect.disabled = !connected;
    btnSend.disabled = !connected;
  }

  function defaultUUID() {
    if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    // Fallback v4-ish
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15) >>> 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function buildPayload() {
    const payload = {
      ssid: ssid.value,
      pss:  pss.value,
      id:   id.value,
      cou:  parseInt(cou.value, 10),
      sta:  parseInt(sta.value, 10),
      cit:  cit.value
    };
    return payload;
  }

  function refreshPreview() {
    jsonPreview.value = JSON.stringify(buildPayload());
  }

  async function connectFlow() {
    if (!('bluetooth' in navigator)) {
      log('Web Bluetooth not supported in this browser.');
      return;
    }
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'AutoFlag' },
          { services: [SERVICE_UUID] }
        ],
        optionalServices: [SERVICE_UUID]
      });

      device.addEventListener('gattserverdisconnected', onDisconnected);

      log(`Selected device: ${device.name || '(unnamed)'} (${device.id})`);
      server = await device.gatt.connect();
      log('GATT connected.');

      const svc = await server.getPrimaryService(SERVICE_UUID);

      txChar = await svc.getCharacteristic(TX_CHAR_UUID);
      await txChar.startNotifications();
      txChar.addEventListener('characteristicvaluechanged', onTxNotification);
      log('Subscribed to TX indications/notifications.');

      rxChar = await svc.getCharacteristic(RX_CHAR_UUID);
      log('RX characteristic ready for writes.');

      setUIConnected(true);
    } catch (err) {
      log(`Connect error: ${String(err)}`);
      await safeDisconnect();
    }
  }

  function onTxNotification(ev) {
    const value = /** @type {DataView} */ (ev.target.value);
    const text = dec.decode(value.buffer);
    // ESP32 sends integer strings like "1", "2", "3"
    log(`RX from device: ${JSON.stringify(text)}`);
  }

  async function sendJson() {
    if (!rxChar) { log('Not connected.'); return; }
    try {
      const payload = buildPayload();
      // Validate locally
      JSON.parse(JSON.stringify(payload));
      const data = enc.encode(JSON.stringify(payload));
      await rxChar.writeValue(data);
      log(`Sent to device (${data.byteLength} bytes).`);
    } catch (err) {
      log(`Send error: ${String(err)}`);
    }
  }

  async function safeDisconnect() {
    try {
      if (txChar) {
        try { await txChar.stopNotifications(); } catch {}
        txChar.removeEventListener('characteristicvaluechanged', onTxNotification);
      }
      txChar = null;
      rxChar = null;
      if (device?.gatt?.connected) device.gatt.disconnect();
    } finally {
      setUIConnected(false);
      log('Disconnected.');
    }
  }

  function onDisconnected() {
    setUIConnected(false);
    log('GATT disconnected by remote.');
  }

  // Initialize defaults
  id.value = defaultUUID();
  [ssid, pss, id, cou, sta, cit].forEach(el => el.addEventListener('input', refreshPreview));
  cou.addEventListener('change', refreshPreview);
  sta.addEventListener('change', refreshPreview);
  refreshPreview();

  // Wire UI
  btnConnect.addEventListener('click', connectFlow);
  btnDisconnect.addEventListener('click', safeDisconnect);
  btnSend.addEventListener('click', sendJson);
  btnClear.addEventListener('click', () => { status.textContent = ''; });
})();
