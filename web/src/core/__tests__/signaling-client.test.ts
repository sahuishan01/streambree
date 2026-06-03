import { describe, it, expect, vi } from 'vitest';
import { SignalingClient, type ISocket } from '../signaling-client';
import type { ServerMsg } from '../protocol';

class FakeSocket implements ISocket {
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  send(data: string) { this.sent.push(data); }
  close() { this.onclose?.(); }
  open() { this.onopen?.(); }
  emit(msg: string) { this.onmessage?.({ data: msg }); }
}

describe('SignalingClient', () => {
  it('sends a join frame once the socket opens', () => {
    const fake = new FakeSocket();
    const client = new SignalingClient('ws://x/ws', () => fake);
    client.join('R1', 'sender', 'realtime');
    fake.open();
    expect(JSON.parse(fake.sent[0])).toEqual({
      type: 'join', room: 'R1', role: 'sender', mode: 'realtime',
    });
  });

  it('delivers parsed inbound messages to the handler', () => {
    const fake = new FakeSocket();
    const client = new SignalingClient('ws://x/ws', () => fake);
    const received: ServerMsg[] = [];
    client.onMessage((m) => received.push(m));
    client.join('R1', 'receiver', 'quality');
    fake.open();
    fake.emit('{"type":"peer-joined"}');
    expect(received).toEqual([{ type: 'peer-joined' }]);
  });

  it('serializes outbound client messages', () => {
    const fake = new FakeSocket();
    const client = new SignalingClient('ws://x/ws', () => fake);
    client.join('R1', 'sender', 'realtime');
    fake.open();
    client.send({ type: 'offer', sdp: 'SDP' });
    expect(JSON.parse(fake.sent[1])).toEqual({ type: 'offer', sdp: 'SDP' });
  });

  it('ignores malformed inbound frames without throwing', () => {
    const fake = new FakeSocket();
    const client = new SignalingClient('ws://x/ws', () => fake);
    const handler = vi.fn();
    client.onMessage(handler);
    client.join('R1', 'sender', 'realtime');
    fake.open();
    fake.emit('garbage');
    expect(handler).not.toHaveBeenCalled();
  });
});
