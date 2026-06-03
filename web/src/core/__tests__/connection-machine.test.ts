import { describe, it, expect } from 'vitest';
import { initial, reduce } from '../connection-machine';

describe('connection-machine', () => {
  it('goes idle -> joining -> waiting-for-peer when alone', () => {
    let s = reduce(initial, { type: 'join' });
    expect(s.conn).toBe('joining');
    s = reduce(s, { type: 'joined', peerPresent: false });
    expect(s.conn).toBe('waiting-for-peer');
  });

  it('negotiates immediately when a peer is already present', () => {
    let s = reduce(initial, { type: 'join' });
    s = reduce(s, { type: 'joined', peerPresent: true });
    expect(s.conn).toBe('negotiating');
  });

  it('reaches connected and records transport', () => {
    let s = reduce(initial, { type: 'join' });
    s = reduce(s, { type: 'joined', peerPresent: true });
    s = reduce(s, { type: 'connected', transport: 'relay' });
    expect(s.conn).toBe('connected');
    expect(s.transport).toBe('relay');
  });

  it('peer leaving returns to waiting and clears transport', () => {
    let s = { conn: 'connected', transport: 'direct' } as const;
    const next = reduce(s, { type: 'peer-left' });
    expect(next.conn).toBe('waiting-for-peer');
    expect(next.transport).toBe('unknown');
  });

  it('socket loss enters reconnecting; restore re-joins', () => {
    let s = reduce(initial, { type: 'join' });
    s = reduce(s, { type: 'socket-lost' });
    expect(s.conn).toBe('reconnecting');
    s = reduce(s, { type: 'socket-restored' });
    expect(s.conn).toBe('joining');
  });

  it('close is terminal from any state', () => {
    const s = reduce({ conn: 'connected', transport: 'direct' }, { type: 'close' });
    expect(s.conn).toBe('closed');
  });
});
