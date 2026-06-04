import { describe, it, expect } from 'vitest';
import { serializeBroadcastMsg, parseBroadcastServerMsg } from '../broadcast-protocol';

describe('broadcast-protocol', () => {
  it('serializes a broadcaster join', () => {
    const j = serializeBroadcastMsg({ type: 'join-broadcast', code: 'C', role: 'broadcaster', jwt: 'T' });
    expect(JSON.parse(j)).toEqual({ type: 'join-broadcast', code: 'C', role: 'broadcaster', jwt: 'T' });
  });

  it('serializes an offer with peer_id', () => {
    const o = serializeBroadcastMsg({ type: 'offer', peer_id: 'v1', sdp: 'S' });
    expect(JSON.parse(o)).toEqual({ type: 'offer', peer_id: 'v1', sdp: 'S' });
  });

  it('parses viewer-joined', () => {
    expect(parseBroadcastServerMsg('{"type":"viewer-joined","peer_id":"v1"}'))
      .toEqual({ type: 'viewer-joined', peer_id: 'v1' });
  });

  it('parses broadcaster-left and returns null for garbage', () => {
    expect(parseBroadcastServerMsg('{"type":"broadcaster-left"}')).toEqual({ type: 'broadcaster-left' });
    expect(parseBroadcastServerMsg('nope')).toBeNull();
  });
});
