import mqtt from 'https://cdnjs.cloudflare.com/ajax/libs/mqtt/5.14.1/mqtt.esm.min.js';
import { readLocalAuth, EMQX_BASE, MQTT_URL, fetchApiDevicesList, navigateToLogin, deleteDeviceFromApi } from './common.js';

(() => {
  const MQTT_OPTS = {
    clientId: 'devices-list-' + Math.random().toString(16).slice(2, 8),
    username: 'dev-test',
    password: 'dev-testing',
    clean: true,
    reconnectPeriod: 2000,
    keepalive: 60,
    connectTimeout: 30000,
    protocolVersion: 4,
  };

  const $ = (sel) => document.querySelector(sel);
  const listEl = $('#list');
  const statusEl = $('#status');
  const btn = $('#refresh');
  const addBtn = $('#add');

  function setStatus(text) { statusEl.textContent = text; }

  function requireAuthOrRedirect() {
    const auth = readLocalAuth();
    const jwt = auth?.jwt;
    const userId = auth?.user?.id;
    if (!jwt || !userId) {
      navigateToLogin();
      return null;
    }
    return { auth, jwt, userId };
  }

  function fmt(s) { return s || '—'; }
  function deviceLabel(d) { return d.deviceName || d.deviceId || 'this device'; }

  async function deleteDeviceCard(device, card, btnEl) {
    const label = deviceLabel(device);
    const confirmed = confirm(`Delete ${label}? This cannot be undone.`);
    if (!confirmed) {
      return;
    }

    if (!device.documentId) {
      alert('Delete failed: missing device record id');
      return;
    }

    const original = btnEl.innerHTML;
    btnEl.disabled = true;
    btnEl.innerHTML = '…';

    try {
      await deleteDeviceFromApi({ deviceDbId: device.documentId, redirectToLogin: true });
      untrackDevice(device.deviceId);
      card.remove();
      if (!listEl.querySelector('.card')) {
        listEl.innerHTML = '<div class="muted">No devices.</div>';
      }
      setTimeout(() => {
        alert(`Deleted ${label} · ${new Date().toLocaleTimeString()}`);
      }, 100); // allow UI to update
    } catch (err) {
      btnEl.disabled = false;
      btnEl.innerHTML = original;
      console.error('Failed to delete device', err);
      alert(`Delete failed: ${String(err?.message || err)}`);
    }
  }

  function deviceCard(d) {
    const url = `device.html?device_id=${encodeURIComponent(d.deviceId)}`;
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.id = d.deviceId;
    el.innerHTML = `
      <div class="name">${d.deviceName || d.deviceId || '(unnamed)'} <span class="mono" style="font-size:x-small;opacity:.6">${d.deviceId ? '('+d.deviceId+')' : ''}</span></div>
      <div class="meta">${fmt(d.deviceCountry?.short_name)}, ${fmt(d.deviceState?.short_name)}, ${fmt(d.deviceCity)}</div>
      <div class="statusline">
        <span class="chip" data-k="online">⏳ Online…</span>
        <span class="chip" data-k="charge">—</span>
        <span class="chip" data-k="battery">—</span>
        <span class="chip" data-k="flag">—</span>
      </div>
    `;
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'device-remove';
    deleteBtn.innerHTML = '&times;';
    deleteBtn.title = 'Delete device';
    deleteBtn.setAttribute('aria-label', `Delete ${deviceLabel(d)}`);
    deleteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      deleteDeviceCard(d, el, deleteBtn);
    });
    el.appendChild(deleteBtn);
    el.addEventListener('click', () => { location.href = url; });
    return el;
  }

  async function fetchDevices(userId) {
    const allDevices = await fetchApiDevicesList({ navigateToLogin: true });
    // Filter to only devices associated with this user
    const filtered = allDevices.filter(d => Array.isArray(d.users_permissions_users) && d.users_permissions_users.includes(userId));
    return filtered;    
  }

  // --- EMQX connected snapshot (404 => offline) ---
  function updateOnlineChip(card, online) {
    const el = card.querySelector('[data-k="online"]');
    if (!el) return;
    if (online === true) { el.textContent = 'Online'; el.classList.add('ok'); el.classList.remove('bad'); }
    else if (online === false) { el.textContent = 'Offline'; el.classList.add('bad'); el.classList.remove('ok'); }
    else { el.textContent = '—'; el.classList.remove('ok','bad'); }
  }

  // Batch poller: GET /clients?clientid=...&clientid=...
  let onlinePollTimer = null;
  async function pollEmqxOnline() {
    const ids = Array.from(knownCards.keys());
    if (ids.length === 0) return;

    const p = new URLSearchParams({ limit: '1000', fields: 'clientid,connected' });
    ids.forEach(id => p.append('clientid', id));

    try {
      const res = await fetch(`${EMQX_BASE}/clients?` + p.toString());
      if (!res.ok) return;
      const js = await res.json();
      const arr = Array.isArray(js?.data) ? js.data : [];
      const map = new Map(arr.map(c => [c.clientid, !!c.connected]));
      // Missing IDs => offline
      for (const id of ids) {
        const card = knownCards.get(id);
        if (!card) continue;
        const online = map.has(id) ? map.get(id) : false;
        updateOnlineChip(card, online);
      }
    } catch {}
  }
  function startOnlinePolling() {
    stopOnlinePolling();
    pollEmqxOnline();
    onlinePollTimer = setInterval(pollEmqxOnline, 5000);
  }
  function stopOnlinePolling() {
    if (onlinePollTimer) { clearInterval(onlinePollTimer); onlinePollTimer = null; }
  }

  function updateMqttStatus(card, statusObj) {
    const per = Number(statusObj.per);
    const charging = Number(statusObj.char) === 1;
    const fpos = Number(statusObj.Fpos);

    const chargeEl = card.querySelector('[data-k="charge"]');
    const battEl = card.querySelector('[data-k="battery"]');
    const flagEl = card.querySelector('[data-k="flag"]');

    if (chargeEl) { chargeEl.textContent = charging ? 'Charging' : 'Not charging'; }
    if (battEl) { battEl.textContent = Number.isFinite(per) ? `${per}%` : '—'; battEl.classList.remove('ok','bad'); }
    if (flagEl) {
      const pos = (fpos === 1 ? 'Top' : fpos === 2 ? 'Mid' : fpos === 3 ? 'Bottom' : 'Unknown');
      flagEl.textContent = pos;
      flagEl.classList.remove('ok','bad');
    }
  }

  // --- MQTT wiring ---
  let mqttClient = null;
  const pendingSubs = new Set();
  const knownCards = new Map();

  function ensureMqtt() {
    if (mqttClient) return mqttClient;
    mqttClient = mqtt.connect(MQTT_URL, MQTT_OPTS);

    mqttClient.on('connect', () => {
      // On connect, subscribe and request STATUS for any queued ids
      for (const deviceId of pendingSubs) {
        const outT = `mqtt_communication/AutoFlag/${deviceId}/OUT`;
        mqttClient.subscribe(outT, { qos: 0 });
        mqttClient.publish(`mqtt_communication/AutoFlag/${deviceId}/IN`, 'STATUS');
      }
      pendingSubs.clear();
    });

    const decoder = new TextDecoder();
    mqttClient.on('message', (topic, payload) => {
      const parts = String(topic).split('/');
      const deviceId = parts[2];
      const card = knownCards.get(deviceId);
      if (!card) return;
      let obj = null; try { obj = JSON.parse(decoder.decode(payload)); } catch {}
      if (obj && typeof obj === 'object') updateMqttStatus(card, obj);
    });

    return mqttClient;
  }

  function trackDevice(deviceId, card) {
    knownCards.set(deviceId, card);
    const cli = ensureMqtt();
    const outT = `mqtt_communication/AutoFlag/${deviceId}/OUT`;
    // Subscribe immediately if connected; otherwise queue for connect
    if (cli.connected) {
      cli.subscribe(outT, { qos: 0 });
    } else {
      pendingSubs.add(deviceId);
    }
    // Always issue a STATUS request immediately (will buffer until connected)
    cli.publish(`mqtt_communication/AutoFlag/${deviceId}/IN`, 'STATUS');
  }

  function untrackDevice(deviceId) {
    pendingSubs.delete(deviceId);
    knownCards.delete(deviceId);
    if (mqttClient) {
      const outT = `mqtt_communication/AutoFlag/${deviceId}/OUT`;
      try { mqttClient.unsubscribe(outT); } catch {}
    }
  }

  async function load() {
    const ctx = requireAuthOrRedirect();
    if (!ctx) return;

    stopOnlinePolling();

    setStatus('Loading…');
    btn.disabled = true;
    listEl.innerHTML = '<div class="muted">Loading…</div>';

    try {
      const list = await fetchDevices(ctx.userId);
      if (list.length === 0) {
        listEl.innerHTML = '<div class="muted">No devices.</div>';
      } else {
        listEl.innerHTML = '';
        knownCards.clear();
        for (const d of list) {
          const card = deviceCard(d);
          listEl.appendChild(card);
          trackDevice(d.deviceId, card);
        }
        startOnlinePolling();
      }
      setStatus(`Loaded ${list.length} device(s) · ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      listEl.innerHTML = `<div class="muted">Error: ${String(err.message || err)}</div>`;
      setStatus('Failed');
    } finally {
      btn.disabled = false;
    }
  }

  btn.addEventListener('click', load);
  addBtn.addEventListener('click', () => { location.href = 'index.html'; });
  window.addEventListener('beforeunload', stopOnlinePolling);
  load();
})();
