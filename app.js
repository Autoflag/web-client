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

  const name = $('deviceName');
  const ssid = $('ssid');
  const pss  = $('pss');
  const id   = $('id');
  const cou  = $('cou');
  const sta  = $('sta');
  const cit  = $('cit');
  const jsonPreview = $('jsonPreview');
  const userFirstName = $('userFirstName');
  const btnLogin = $('btnLogin');

  function log(line) {
    const ts = new Intl.DateTimeFormat(undefined, {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      fractionalSecondDigits: 3, hour12: false
    }).format(new Date());
    status.textContent += `[${ts}] ${line}\n`;
    status.scrollTop = status.scrollHeight;
  }

  // Generate ID with 2025 epoch seconds + 3 random alpha chars.
  function generateID() {
    const epochSeconds2025 = Math.floor((Date.now() - new Date('2025-01-01T00:00:00Z').getTime()) / 1000);
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
    let suffix = '';
    for (let i = 0; i < 3; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
    return String(epochSeconds2025) + suffix;
  }

  function generateRandomName() {
    const words = [
      "alpha","bravo","charlie","delta","echo","foxtrot","golf","hotel","india",
      "juliet","kilo","lima","mike","november","oscar","papa","quebec","romeo",
      "sierra","tango","uniform","victor","whiskey","xray","yankee","zulu"
    ];
    const word1 = words[Math.floor(Math.random() * words.length)];
    const word2 = words[Math.floor(Math.random() * words.length)];
    const digits = Math.floor(Math.random() * 900 + 100); // 3 random digits
    return `${word1}-${word2}-${digits}`;
  }

  function seedDefaults() {
    name.value = generateRandomName();
    id.value = generateID();
    refreshPreview();
  }
  seedDefaults();

  async function setupUserAuth() {
    try {
      let authData = localStorage.getItem('autoflag.auth');
      if (!authData) {
        throw new Error('No user logged in');
      }
      const userAuthData = JSON.parse(authData);
      // Some user info is in the login auth response
      // displayLoggedInUser({ firstName: userAuthData.user.firstname });

      const res = await fetch('https://api.autoflagraiser.com/user', {
        headers: { 'Authorization': `Bearer ${userAuthData.jwt}` }
      });
      if (!res.ok) {
        log(`Error fetching user info: ${res.status} ${res.statusText}`);
        return;
      }
      const data = await res.json();
      log(`User authenticated: ${data.profile.firstName || '<unnamed>'} <${data.profile.email || '<no email>'}>`);
      userFirstName.textContent = `Howdy, ${data.profile.firstName || '<unnamed>'}!`;
    } catch (err) {
      userFirstName.textContent = '(unauthenticated)';
      btnLogin.classList.toggle('hidden', false);
      console.error('Error checking user auth:', err);
      log('Error checking user auth: ' + String(err));
    }
  }
  setupUserAuth();

  function buildPayload() {
    return {
      name: name.value,
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

  async function sendOnceFlow() {
    if (!('bluetooth' in navigator)) {
      log('Web Bluetooth not supported in this browser.');
      return;
    }

    const payload = buildPayload();
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

      // Step 1: Connect to device, takes up to 10 seconds.

      log(`Selected device: ${device.name || '(unnamed)'} (${device.id})`);
      const server = await device.gatt.connect();
      log('GATT connected.');

      const svc = await server.getPrimaryService(SERVICE_UUID);

      // Subscribe first; keep logging until the device disconnects.
      const txChar = await svc.getCharacteristic(TX_CHAR_UUID);
      await txChar.startNotifications();

      const { readable, writable } = new TransformStream();
      const bleTxWriter = writable.getWriter();
      const bleTxReader = readable.getReader();
      txChar.addEventListener('characteristicvaluechanged', ev => {
        // Decode the bytes in this notification as text.
        bleTxWriter.write(new TextDecoder().decode(ev.target.value));
      });
      log('Subscribed to TX indications/notifications.');

      // Promise resolves when the device closes the connection.
      const disconnected = new Promise((resolve) => {
        device.addEventListener('gattserverdisconnected', () => {
          log('GATT disconnected by device.');
          bleTxWriter.close().catch(() => {});
          bleTxReader.cancel().catch(() => {});
          resolve();
        }, { once: true });
      });

      // Write the payload after subscription is active.
      const rxChar = await svc.getCharacteristic(RX_CHAR_UUID);
      const blePayload = {
        ssid: payload.ssid,
        pss:  payload.pss,
        cou:  payload.cou,
        sta:  payload.sta,
        cit:  payload.cit,
        id:   payload.id,
      };
      const bytes = enc.encode(JSON.stringify(blePayload));
      await rxChar.writeValue(bytes);
      log(`Sent config to device (${bytes.byteLength} bytes):`);
      log(JSON.stringify(blePayload));

      // Step 2: Wait for device to ACK and report success/failure.
      const bleResp1 = await bleTxReader.read();
      if (bleResp1.value !== '1') {
        log(`Error: Device did not ACK configuration payload, received: ${bleResp1.value}`);
      } else {
        log('Device ACKed configuration payload.');
      }

      // Step 3: Wait for device to report success/failure applying config.
      const bleResp2 = await bleTxReader.read();
      if (bleResp2.value !== '2') {
        log(`Error: Device reported configuration failure, received: ${bleResp2.value}`);
      } else {
        log('Device reported successful configuration.');
      }

      // Block until the device ends the session.
      await disconnected;

      // No explicit disconnect/stopNotifications: peripheral controls session length.
      log('BLE pairing complete.');

      // Step 4: Register the device to the user.
      log('Registering device to user...');
      await registerDeviceToUser(payload);

      // Step 5: Wait for device to connect to EMQX broker.
      log('Waiting for device to connect to MQTT broker...');
      const emqxConnected = await waitForEmqxClientConnection(payload.id, 60_000);
      if (!emqxConnected) {
        throw new Error('Timeout waiting for device to connect to MQTT broker.');
      }

      // Navigate to the device page for this device.
      log('Redirecting to device page...');
      // location.href = `device.html?device_id=${encodeURIComponent(payload.id)}`;
    } catch (err) {
      log(`Flow error: ${String(err)}`);
      try { if (device?.gatt?.connected) device.gatt.disconnect(); } catch {}
    } finally {
      btnSendOnce.disabled = false;
      seedDefaults();
    }
  }

  // POST the device data to the API to add it to the currently logged-in user's list of devices.
  async function registerDeviceToUser(payload) {
    let authData = localStorage.getItem('autoflag.auth');
    if (!authData) {
      log('Warning: not logged in; cannot register device to user.');
      return;
    }
    const jwt = JSON.parse(authData).jwt;

    const postPayload = {
      data: {
        deviceName: payload.name,
        deviceCity: payload.cit,
        deviceId: payload.id,
        deviceState: String(payload.sta),
        deviceCountry: String(payload.cou),
        wifiName: payload.ssid,
        wifiPassword: payload.pss,
        users_permissions_users: [],
      }
    };

    const resp = await fetch(`https://api.autoflagraiser.com/api/auto-flag-devices`, { 
      method: 'POST', 
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwt}`,
      }, 
      body: JSON.stringify(postPayload)
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '<no body>');
      throw new Error(`API error registering device for user: ${resp.status} ${resp.statusText}: ${errText}`);
    }
    const respData = await resp.json();
    // returns device_id as JSON literal string, e.g. "68db5f3bf69ba4df2fd77896""
    console.log('API response data:', respData);
    log('Device registered to user successfully.');
  }

  async function waitForEmqxClientConnection(deviceId, timeout) {
    const start = Date.now();
    const url = new URL(`https://emqx.dev-proxy.api-autoflag.com/api/v5/clients/${encodeURIComponent(deviceId)}`);
    while (Date.now() - start < timeout) {
      try {
        const res = await fetch(url, { method: 'GET', cache: 'no-store'});
        if (!res.ok) {
          throw new Error(`${res.status} ${res.statusText}`);
        }
        return true;
      } catch {
        await new Promise(r => setTimeout(r, 250));
        continue;
      }
    }
    return false;
  }

  // Initialize defaults
  id.value = generateID();
  [ssid, pss, id, cou, sta, cit, name].forEach(el => el.addEventListener('input', refreshPreview));
  cou.addEventListener('change', refreshPreview);
  sta.addEventListener('change', refreshPreview);
  refreshPreview();

  // Wire UI
  btnSendOnce?.addEventListener('click', sendOnceFlow);
  btnClear?.addEventListener('click', () => { status.textContent = ''; });
  btnLogin?.addEventListener('click', () => { window.location.href = 'login.html?next=index.html'; });
})();
