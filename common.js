const AUTH_STORAGE_KEY = 'autoflag.auth';
export const API_BASE = 'https://api.autoflagraiser.com';
export const EMQX_BASE = 'https://emqx-service-proxy.api-autoflag.com/api/v5';
export const MQTT_URL = 'wss://mqtt-service-proxy.api-autoflag.com/mqtt';

export function readLocalAuth() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

export function saveLocalAuth(payload) {
  let valStr = typeof payload === 'string' ? payload : JSON.stringify(payload || null);
  localStorage.setItem(AUTH_STORAGE_KEY, valStr);
}

export function navigateToLogin() {
  const next = location.pathname + location.search + location.hash;
  location.replace(`login.html?next=${encodeURIComponent(next)}`);
}

/**
 * @typedef {object} ApiDeviceInfo
 * @prop {string} createdDate - ISO date string
 * @prop {string} documentId
 * @prop {string} deviceName
 * @prop {string} deviceCity
 * @prop {string} wifiName
 * @prop {string} wifiPassword
 * @prop {string[]} users_permissions_users
 * @prop {{short_name:string; code:number}} deviceCountry}}
 * @prop {{short_name:string; code:number}} deviceState}}
 */

export async function fetchApiDevicesList(opts = { redirectToLogin: false })  {
  const userAuthData = readLocalAuth();
  if (!userAuthData?.jwt) {
    if (opts?.redirectToLogin) {
      navigateToLogin();
    }
    throw new Error('Not authenticated');
  }

  // Fetch all pages, the max page limit is 200
  const MAX_PAGE_LIMIT = 200;
  /** @type {ApiDeviceInfo[]} */
  const allDevices = [];
  for (let i = 1; i < Infinity; i++) {
    const reqBody = {
      pagination: { page: i, limit: MAX_PAGE_LIMIT },
      sort: { field: 'deviceName', sortOrder: 1 },
      filters: {
        deviceName: { value: null },
        organizationId: { value: null },
        deviceId: { value: null },
        deviceCountry: { value: null },
        deviceState: { value: null }
      }
    };

    const url = new URL(`${API_BASE}/flagDevice/list`);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userAuthData.jwt}`,
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(reqBody)
    });
    if (res.status === 401 || res.status === 403) {
      if (opts?.redirectToLogin) {
        navigateToLogin();
      }
      throw new Error('Not authenticated');
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

    const json = await res.json();
    if (!Array.isArray(json?.docs) || json.docs.length === 0) {
      break;
    }
    allDevices.push(...json.docs);
  }
  return allDevices;
}

/**
 * @param {string} deviceId
 */
export async function fetchApiDeviceInfo(opts = { redirectToLogin: false, deviceId: '' }) {
  const deviceId = opts.deviceId;
  if (typeof deviceId !== 'string' || deviceId.length === 0) {
    throw new Error('Invalid deviceId');
  }

  const userAuthData = readLocalAuth();
  if (!userAuthData?.jwt) {
    if (opts?.redirectToLogin) {
      navigateToLogin();
    }
    throw new Error('Not authenticated');
  }

  const reqBody = {
    pagination: { page: 1, limit: 200 },
    sort: { field: 'deviceName', sortOrder: 1 },
    filters: { deviceId: { value: deviceId } },
  };

  const res = await fetch(new URL(`${API_BASE}/flagDevice/list`), {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${userAuthData.jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(reqBody)
  });
  if (res.status === 401 || res.status === 403) {
    if (opts?.redirectToLogin) {
      navigateToLogin();
    }
    throw new Error('Not authenticated');
  }

  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

  const json = await res.json();
  /** @type {ApiDeviceInfo[]} */
  const arr = Array.isArray(json?.docs) ? json.docs : [];
  const device = arr.find(d => d.deviceId === deviceId);
  if (!device) {
    throw new Error('Device not found from API');
  }
  return device;
}

export async function deleteDeviceFromApi(opts = { redirectToLogin: false, deviceDbId: '' }) {
  const id = opts.deviceDbId;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Invalid deviceDbId');
  }
  
  const userAuthData = readLocalAuth();
  if (!userAuthData?.jwt) {
    if (opts?.redirectToLogin) {
      navigateToLogin();
    }
    throw new Error('Not authenticated');
  }

  // DELETE https://api.autoflagraiser.com/flagDevice/:id
  // Returns 200 OK with no body
  const res = await fetch(new URL(`${API_BASE}/flagDevice/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${userAuthData.jwt}` },
  });
  if (res.status === 401 || res.status === 403) {
    if (opts?.redirectToLogin) {
      navigateToLogin();
    }
    throw new Error('Not authenticated');
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
}
