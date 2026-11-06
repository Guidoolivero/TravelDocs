import { auth } from '../compartido/firebase.mjs';

export function adminBaseUrl() {
  return (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8888/.netlify/functions/admin-api'
    : '/.netlify/functions/admin-api';
}

export async function adminFetch(path, options = {}, endpoint = 'admin-api') {
  const currentUser = auth.currentUser;
  if (!currentUser) throw { status: 401, error: 'Sesión expirada. Volvé a ingresar.' };
  const idToken = await currentUser.getIdToken();
  const res = await fetch(adminBaseUrl().replace(/admin-api$/, endpoint) + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
      ...(options.headers || {})
    }
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw { status: res.status, error: json.error || 'Error desconocido.' };
  return json;
}
