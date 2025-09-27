(() => {
  const STORAGE_KEY = 'autoflag.auth';
  const API_BASE = 'https://api.autoflagraiser.com';

  const $ = (sel) => document.querySelector(sel);
  const listEl = $('#list');
  const statusEl = $('#status');
  const btn = $('#refresh');

  function setStatus(text) { statusEl.textContent = text; }

  function readAuth() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
  }

  function requireAuthOrRedirect() {
    const auth = readAuth();
    const jwt = auth?.jwt;
    const userId = auth?.user?.id;
    if (!jwt || !userId) {
      const next = encodeURIComponent(location.pathname.replace(/^\/+/, ''));
      location.replace(`login.html?next=${next}`);
      return null;
    }
    return { auth, jwt, userId };
  }

  function fmt(s) { return s || '—'; }
  function deviceCard(d) {
    const url = `device.html?device_id=${encodeURIComponent(d.deviceId)}`;
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `
      <div class="name">${d.deviceName || d.deviceId || '(unnamed)'} <span class="mono" style="opacity:.6;font-size:x-small;">${d.deviceId ? '('+d.deviceId+')' : ''}</span></div>
      <div class="meta">${fmt(d.deviceCountry?.short_name)}, ${fmt(d.deviceState?.short_name)}, ${fmt(d.deviceCity)}</div>
    `;
    el.addEventListener('click', () => { location.href = url; });
    return el;
  }

  // Supports both the simplified shape provided and Strapi's default shape
  function normalize(item) {
    // If it already matches the provided type
    if (item && 'deviceId' in item) return item;

    const a = item?.attributes || item || {};
    const countryShort = a.deviceCountry?.data?.attributes?.short_name || a.deviceCountry?.short_name || null;
    const stateShort   = a.deviceState?.data?.attributes?.short_name || a.deviceState?.short_name || null;

    return {
      deviceId: a.deviceId || a.device_id || a.id || item?.id || '',
      deviceName: a.deviceName || a.name || '',
      deviceCountry: countryShort ? { short_name: countryShort } : null,
      deviceState: stateShort ? { short_name: stateShort } : null,
      deviceCity: a.deviceCity || a.city || '',
    };
  }

  async function fetchDevices(jwt, userId) {
    const url = `${API_BASE}/api/auto-flag-devices?filters[users_permissions_users][$eq]=${encodeURIComponent(userId)}&populate=deviceCountry&populate=deviceState`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${jwt}` } });
    if (res.status === 401 || res.status === 403) {
      const next = encodeURIComponent(location.pathname.replace(/^\/+/, ''));
      location.replace(`login.html?next=${next}`);
      return [];
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const json = await res.json();
    const arr = Array.isArray(json?.data) ? json.data : [];
    return arr.map(normalize);
  }

  async function load() {
    const ctx = requireAuthOrRedirect();
    if (!ctx) return;
    const { jwt, userId } = ctx;

    setStatus('Loading…');
    btn.disabled = true;
    listEl.innerHTML = '<div class="muted">Loading…</div>';

    try {
      const list = await fetchDevices(jwt, userId);
      if (list.length === 0) {
        listEl.innerHTML = '<div class="muted">No devices.</div>';
      } else {
        listEl.innerHTML = '';
        for (const d of list) listEl.appendChild(deviceCard(d));
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
  load();
})();