import { describe, it, expect } from 'vitest';
import { senderParams, receiverPlayoutHint } from '../modes';

describe('modes', () => {
  it('realtime favors framerate with a low playout buffer', () => {
    const p = senderParams('realtime');
    expect(p.degradationPreference).toBe('maintain-framerate');
    expect(receiverPlayoutHint('realtime')).toBe(0);
  });

  it('quality favors resolution with a larger buffer and higher bitrate', () => {
    const p = senderParams('quality');
    expect(p.degradationPreference).toBe('maintain-resolution');
    expect(p.maxBitrate).toBeGreaterThan(senderParams('realtime').maxBitrate);
    expect(receiverPlayoutHint('quality')).toBeGreaterThan(0);
  });
});
