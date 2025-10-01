import { EMQX_BASE, fetchApiDevicesList } from './common.js';

(() => {
  const API = `${EMQX_BASE}/clients?limit=1000`;
  const SUBS = (id) => `${EMQX_BASE}/clients/${encodeURIComponent(id)}/subscriptions`;

  const $ = (sel) => document.querySelector(sel);
  const rows = $('#rows');
  const statusEl = $('#status');
  const btn = $('#refresh');

  function fmtDate(s) {
    if (!s) return '—';
    try { return new Date(s).toLocaleString(); } catch { return s; }
  }
  function setStatus(text) { statusEl.textContent = text; }

  // timestamp helper for sorting; invalid dates -> 0
  function ts(s) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : 0;
  }

  function escapeHtml(val) {
    return String(val ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function parseMetadataFromTopic(topic) {
    // Example: "mqtt_communication/AutoFlag/EFUSE:6478F016.../ID:828713/MQTT_HOST:.../FIRMWARE: v4.0.0-beta.3"
    const parts = String(topic || '').split('/');
    const info = {};
    for (const part of parts) {
      const idx = part.indexOf(':');
      if (idx > 0) {
        const key = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        if (key) info[key] = val;
      }
    }
    return info; // possibly { EFUSE: '...', ID: '...', FIRMWARE: '...' }
  }

  function rowHtml(c) {
    const id = c.clientid || '—';
    const connected = !!c.connected;
    const connectedAt = fmtDate(c.connected_at);
    const ip = c.ip_address || '—';
    const efuse = c._efuse || '—';
    const fw = c._firmware || '—';
    const href = `device.html?device_id=${encodeURIComponent(id)}`;
    const deviceName = typeof c._deviceName === 'string' ? c._deviceName : '';
    return `
      <tr data-id="${id}">
        <td class="mono">
          <a href="${href}">${id}</a>
          <div class="device-name">${deviceName ? escapeHtml(deviceName) : '&nbsp;'}</div>
        </td>
        <td><span class="chip ${connected ? 'on' : 'off'}">${connected ? 'yes' : 'no'}</span></td>
        <td>${connectedAt}</td>
        <td class="mono">${ip}</td>
        <td class="mono">${efuse}</td>
        <td>${fw}</td>
      </tr>`;
  }

  function render(list) {
    if (!Array.isArray(list) || list.length === 0) {
      rows.innerHTML = `<tr><td colspan="6" class="muted">No clients.</td></tr>`;
      return;
    }
    rows.innerHTML = list.map(rowHtml).join('');

    rows.querySelectorAll('tr[data-id]').forEach(tr => {
      tr.addEventListener('click', (e) => {
        if (e.target && e.target.tagName.toLowerCase() === 'a') return;
        const id = tr.getAttribute('data-id');
        location.href = `device.html?device_id=${encodeURIComponent(id)}`;
      });
      tr.style.cursor = 'pointer';
    });
  }

  async function fetchJson(url) {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  }

  async function fetchWithSubs(client) {
    const id = client.clientid;
    if (!id) return null;

    try {
      const subs = await fetchJson(SUBS(id));
      const inTopic = `mqtt_communication/AutoFlag/${id}/IN`;
      const hasIn = Array.isArray(subs) && subs.some(s => s.topic === inTopic);
      if (!hasIn) return null; // filter out clients without required subscription

      // metadata (optional)
      const meta = Array.isArray(subs) ? subs.find(s => typeof s.topic === 'string' && s.topic.includes('EFUSE:')) : null;
      if (meta) {
        const info = parseMetadataFromTopic(meta.topic);
        if (info.EFUSE) client._efuse = info.EFUSE;
        if (info.FIRMWARE) client._firmware = info.FIRMWARE;
      }
      return client;
    } catch (e) {
      // If subscriptions fail for a client, skip it silently
      return null;
    }
  }

  // Simple concurrency limit for N parallel fetches
  async function mapLimit(items, limit, task) {
    const results = new Array(items.length);
    let i = 0;
    let active = 0;
    return new Promise((resolve) => {
      function next() {
        if (i >= items.length && active === 0) return resolve(results);
        while (active < limit && i < items.length) {
          const cur = i++;
          active++;
          Promise.resolve(task(items[cur], cur))
            .then((val) => { results[cur] = val; })
            .catch(() => { results[cur] = null; })
            .finally(() => { active--; next(); });
        }
      }
      next();
    });
  }

  async function load() {
    setStatus('Loading…');
    btn.disabled = true;
    try {
      const [root, apiDevices] = await Promise.all([
        fetchJson(API),
        fetchApiDevicesList().catch((err) => {
          console.warn('Failed to load API devices list', err);
          return null;
        }),
      ]);
      const base = Array.isArray(root?.data) ? root.data : [];

      // Optional: sort by connected desc, then clientid
      base.sort((a, b) => ts(b.connected_at) - ts(a.connected_at));

      // Fetch subscriptions with limited concurrency
      const processed = await mapLimit(base, 10, fetchWithSubs);
      const filtered = processed.filter(Boolean);

      const deviceMap = new Map();
      if (Array.isArray(apiDevices)) {
        for (const device of apiDevices) {
          if (device?.deviceId) {
            deviceMap.set(device.deviceId, device);
          }
        }
      }

      if (deviceMap.size > 0) {
        for (const client of filtered) {
          const deviceInfo = deviceMap.get(client.clientid);
          if (deviceInfo?.deviceName) {
            client._deviceName = deviceInfo.deviceName;
          }
        }
      }

      render(filtered);
      setStatus(`Loaded ${filtered.length} client(s) · ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      rows.innerHTML = `<tr><td colspan="6">Request failed.</td></tr>`;
      setStatus('Failed');
    } finally {
      btn.disabled = false;
    }
  }

  btn.addEventListener('click', load);
  load();
})();
