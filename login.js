(() => {
  const API = 'https://api.autoflagraiser.com/api/auth/local';
  const STORAGE_KEY = 'autoflag.auth';

  const $ = (id) => document.getElementById(id);
  const form = $('form');
  const email = $('email');
  const password = $('password');
  const statusEl = $('status');
  const btn = $('btn');

  // optional redirect support: login.html?next=clients.html
  const next = new URLSearchParams(location.search).get('next') || 'user-devices.html';

  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = 'muted' + (cls ? ' ' + cls : '');
  }

  function saveAuth(payload) {
    /*
    type LoginResponse = {
      jwt: string; // Used for bearer auth, e.g. `Authorization: Bearer <jwt>`
      user: {
        id: string; // same as documentId ?
        documentId: string; // is this a generated userID?
        username: string; // user-defined short name
        email: string;
        provider: string | null;
        confirmed: boolean; // always false?
        blocked: boolean;
        createdAt: string; // ISO date
        updatedAt: string; // ISO date
        publishedAt: string; // ISO date
        firstname: string; // user-defined
        lastname: string; // user-defined
      };
      refresh: string; // refresh token (what's this used for?)
    }
    */
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return payload;
  }

  async function login(identifier, pwd) {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password: pwd }),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) {
      const message = data?.error || data?.message || `${res.status} ${res.statusText}`;
      throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
    }
    if (!data || !data.jwt || !data.user) throw new Error('Malformed login response');
    return data;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!email.value || !password.value) {
      setStatus('Email and password are required', 'err');
      return;
    }

    btn.disabled = true;
    setStatus('Signing in…');

    try {
      const data = await login(email.value.trim(), password.value);
      saveAuth(data);
      setStatus('Signed in', 'ok');
      // redirect after a brief tick so the status can paint
      setTimeout(() => { location.href = next; }, 150);
    } catch (err) {
      setStatus(String(err.message || err), 'err');
      btn.disabled = false;
    }
  });
})();
