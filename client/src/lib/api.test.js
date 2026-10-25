import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from './api.js';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('api', () => {
  it('calls the admin function without caching', async () => {
    fetch.mockResolvedValue(ok({ connected: false }));
    await api.getSettings();
    expect(fetch.mock.calls[0][0]).toBe('/server/admin/settings');
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'GET', cache: 'no-store' });
    expect(fetch.mock.calls[0][1].body).toBeUndefined();
  });

  it('sends JSON bodies and encodes ids', async () => {
    fetch.mockResolvedValue(ok({}));
    await api.updateRule('12/3', { keyword: 'link' });
    await api.getRules('555');
    expect(fetch.mock.calls[0][0]).toBe('/server/admin/rules/12%2F3');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ keyword: 'link' });
    expect(fetch.mock.calls[1][0]).toBe('/server/admin/rules?mediaId=555');
    await api.getAllRules();
    expect(fetch.mock.calls[2][0]).toBe('/server/admin/rules');
  });

  it('throws with the server message, status and field errors', async () => {
    fetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'Keyword is required', errors: ['Keyword is required'] }) });
    await expect(api.createRule({})).rejects.toMatchObject({ status: 400, message: 'Keyword is required', errors: ['Keyword is required'] });
  });

  it('copes with a non-JSON error body', async () => {
    fetch.mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error('html'); } });
    await expect(api.getReels()).rejects.toMatchObject({ status: 502, message: 'Request failed' });
  });
});
