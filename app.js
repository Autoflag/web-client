/* AutoFlag BLE Console (Web Bluetooth) */

(() => {
  const SERVICE_UUID = '3159e1ed-1e93-412c-9591-c146b2ce70fc';
  const TX_CHAR_UUID = '99000ae1-42bd-4ca1-9b00-1815c0cc351f'; // device -> web (indicate/notify/read)
  const RX_CHAR_UUID = '99000ae2-42bd-4ca1-9b00-1815c0cc351f'; // web -> device (write)

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const $ = (id) => document.getElementById(id);

  const btnSendOnce = $('btnSendOnce');
  const btnClear = $('btnClear');
  const status = $('status');

  const ssid = $('ssid');
  const pss  = $('pss');
  const id   = $('id');
  const cou  = $('cou');
  const sta  = $('sta');
  const cit  = $('cit');
  const jsonPreview = $('jsonPreview');

  function log(line) {
    const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');
    status.textContent += `[${ts}] ${line}\n`;
    status.scrollTop = status.scrollHeight;
  }

  // Cryptographically random 6-digit integer as a string (100000..999999), rejection-sampled to avoid modulo bias.
  function randomSixDigit() {
    const range = 900000; // values 0..899999
    const min   = 100000;
    const U32_MAX_PLUS_1 = 0x100000000; // 2^32
    const limit = Math.floor(U32_MAX_PLUS_1 / range) * range; // largest multiple of range
    const buf = new Uint32Array(1);
    let r;
    do {
      crypto.getRandomValues(buf);
      r = buf[0];
    } while (r >= limit);
    return String((r % range) + min);
  }

  function buildPayload() {
    return {
      ssid: ssid.value,
      pss:  pss.value,
      cou:  parseInt(cou.value, 10),
      sta:  parseInt(sta.value, 10),
      cit:  cit.value,
      id:   id.value,
    };
  }

  function refreshPreview() {
    jsonPreview.value = JSON.stringify(buildPayload());
  }

  // Attach notification handler; return an off() function to remove it.
  function onTxAttach(txChar) {
    const handler = (ev) => {
      const dv = /** @type {DataView} */ (ev.target.value);
      // Decode only the bytes in this notification.
      const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
      const text = dec.decode(bytes);
      let statusDescription = '';
      if (text === '1') {
        statusDescription = ' (Device ACKed payload)';
      } else if (text === '2') {
        statusDescription = ' (Device configured successfully with payload)';
      } else if (text === '3') {
        statusDescription = ' (Device failed to configure with payload)';
      }
      log(`RX from device: ${JSON.stringify(text)}` + statusDescription);
    };
    txChar.addEventListener('characteristicvaluechanged', handler);
    return () => txChar.removeEventListener('characteristicvaluechanged', handler);
  }

  async function sendOnceFlow() {
    if (!('bluetooth' in navigator)) {
      log('Web Bluetooth not supported in this browser.');
      return;
    }

    // Build and validate payload before prompting.
    const payload = buildPayload();
    try { JSON.parse(JSON.stringify(payload)); } catch (err) {
      log(`Invalid payload: ${String(err)}`);
      return;
    }

    btnSendOnce.disabled = true;

    /** @type {BluetoothDevice | null} */ let device = null;

    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'AutoFlag' },
          { services: [SERVICE_UUID] }
        ],
        optionalServices: [SERVICE_UUID]
      });

      log(`Selected device: ${device.name || '(unnamed)'} (${device.id})`);
      const server = await device.gatt.connect();
      log('GATT connected.');

      const svc = await server.getPrimaryService(SERVICE_UUID);

      // Subscribe first; keep logging until the device disconnects.
      const txChar = await svc.getCharacteristic(TX_CHAR_UUID);
      await txChar.startNotifications();
      const offTx = onTxAttach(txChar);
      log('Subscribed to TX indications/notifications. Logging until device disconnects...');

      // Promise resolves when the device closes the connection.
      const disconnected = new Promise((resolve) => {
        const onDisc = () => {
          log('GATT disconnected by device.');
          offTx();
          resolve();
        };
        device.addEventListener('gattserverdisconnected', onDisc, { once: true });
      });

      // Write the payload after subscription is active.
      const rxChar = await svc.getCharacteristic(RX_CHAR_UUID);
      const bytes = enc.encode(JSON.stringify(payload));
      await rxChar.writeValue(bytes);
      log(`Sent to device (${bytes.byteLength} bytes).`);

      // Block until the device ends the session.
      await disconnected;

      // No explicit disconnect/stopNotifications: peripheral controls session length.
      log('Flow complete.');
    } catch (err) {
      log(`Flow error: ${String(err)}`);
      try { if (device?.gatt?.connected) device.gatt.disconnect(); } catch {}
    } finally {
      btnSendOnce.disabled = false;
    }
  }

  // Initialize defaults
  id.value = randomSixDigit();
  [ssid, pss, id, cou, sta, cit].forEach(el => el.addEventListener('input', refreshPreview));
  cou.addEventListener('change', refreshPreview);
  sta.addEventListener('change', refreshPreview);
  refreshPreview();

  // Wire UI
  btnSendOnce?.addEventListener('click', sendOnceFlow);
  btnClear?.addEventListener('click', () => { status.textContent = ''; });
})();
