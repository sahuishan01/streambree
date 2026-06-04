import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiClient } from '../rest';

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  localStorage.clear();
});

describe('ApiClient', () => {
  it('stores the token on login', async () => {
    const api = new ApiClient('http://srv', mockFetch(200, { token: 'JWT' }));
    await api.login('a@b.com', 'pw');
    expect(api.token).toBe('JWT');
    expect(localStorage.getItem('sl_token')).toBe('JWT');
  });

  it('attaches the bearer token to authed calls', async () => {
    const fetchMock = mockFetch(200, []);
    const api = new ApiClient('http://srv', fetchMock);
    api.setToken('JWT');
    await api.listChannels();
    const init = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer JWT');
  });

  it('createChannel posts the name and returns the channel', async () => {
    const api = new ApiClient('http://srv', mockFetch(200, { id: '1', name: 'Movie', code: 'ABC123' }));
    api.setToken('JWT');
    const ch = await api.createChannel('Movie');
    expect(ch.code).toBe('ABC123');
  });

  it('listChannels returns channels with my role', async () => {
    const api = new ApiClient('http://srv', mockFetch(200, [{ id: '1', name: 'C', code: 'X', role: 'owner' }]));
    api.setToken('JWT');
    const chans = await api.listChannels();
    expect(chans[0].role).toBe('owner');
  });

  it('streamStatus reports live', async () => {
    const api = new ApiClient('http://srv', mockFetch(200, { live: true }));
    api.setToken('JWT');
    expect(await api.streamStatus('1')).toBe(true);
  });

  it('createInvite returns a code', async () => {
    const api = new ApiClient('http://srv', mockFetch(200, { code: 'INVITELONGTOKEN' }));
    api.setToken('JWT');
    expect(await api.createInvite('1')).toBe('INVITELONGTOKEN');
  });

  it('turnCredentials returns the ICE servers array', async () => {
    const servers = [{ urls: ['stun:x'] }];
    const api = new ApiClient('http://srv', mockFetch(200, servers));
    api.setToken('JWT');
    expect(await api.turnCredentials()).toEqual(servers);
  });
});
