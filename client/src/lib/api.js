const BASE = '/server';

async function request(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch (_) { /* non-JSON error body */ }
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed');
    err.status = res.status;
    if (Array.isArray(data.errors)) err.errors = data.errors;
    throw err;
  }
  return data;
}

export const api = {
  getSettings: () => request('GET', '/admin/settings'),
  saveToken: (accessToken) => request('PUT', '/admin/settings', { accessToken }),
  getReels: () => request('GET', '/admin/reels'),
  resolveReel: (url) => request('POST', '/admin/reels/resolve', { url }),
  getAllRules: () => request('GET', '/admin/rules'),
  getRules: (mediaId) => request('GET', `/admin/rules?mediaId=${encodeURIComponent(mediaId)}`),
  createRule: (rule) => request('POST', '/admin/rules', rule),
  updateRule: (id, rule) => request('PUT', `/admin/rules/${encodeURIComponent(id)}`, rule),
  deleteRule: (id) => request('DELETE', `/admin/rules/${encodeURIComponent(id)}`),
  getActivity: () => request('GET', '/admin/activity'),
};
