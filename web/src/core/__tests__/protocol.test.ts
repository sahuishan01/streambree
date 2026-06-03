import { describe, it, expect } from 'vitest';
import { parseServerMsg, serializeClientMsg } from '../protocol';

describe('protocol', () => {
  it('serializes a join message to the server wire format', () => {
    const json = serializeClientMsg({ type: 'join', room: 'R1', role: 'sender', mode: 'realtime' });
    expect(JSON.parse(json)).toEqual({ type: 'join', room: 'R1', role: 'sender', mode: 'realtime' });
  });

  it('parses a joined server message', () => {
    const msg = parseServerMsg('{"type":"joined","peer_present":true,"ice_servers":[]}');
    expect(msg).toEqual({ type: 'joined', peer_present: true, ice_servers: [] });
  });

  it('parses a kebab-case peer-left message', () => {
    expect(parseServerMsg('{"type":"peer-left"}')).toEqual({ type: 'peer-left' });
  });

  it('returns null for malformed JSON', () => {
    expect(parseServerMsg('not json')).toBeNull();
  });
});
