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
    await api.listRooms();
    const init = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer JWT');
  });

  it('createNamedRoom posts the name and returns room', async () => {
    const api = new ApiClient('http://srv', mockFetch(200, { id: '1', name: 'Movie', code: 'ABC123' }));
    api.setToken('JWT');
    const room = await api.createNamedRoom('Movie');
    expect(room.code).toBe('ABC123');
  });

  it('resolveRoom returns false on 404', async () => {
    const api = new ApiClient('http://srv', mockFetch(404, {}));
    expect(await api.resolveRoom('NOPE')).toBe(false);
  });
});
