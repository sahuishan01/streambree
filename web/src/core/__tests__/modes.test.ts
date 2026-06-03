import { describe, it, expect, vi } from 'vitest';
import { senderParams, receiverPlayoutHint, applyMode } from '../modes';

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

  it('applyMode sets video sender params and receiver playout hint', async () => {
    const params: RTCRtpSendParameters = { encodings: [{}] } as RTCRtpSendParameters;
    const videoSender = {
      track: { kind: 'video' } as MediaStreamTrack,
      getParameters: () => params,
      setParameters: vi.fn(async () => {}),
    } as unknown as RTCRtpSender;
    const receiver = {} as RTCRtpReceiver;

    await applyMode(
      { getSenders: () => [videoSender], getReceivers: () => [receiver] },
      'quality',
    );

    expect(videoSender.setParameters).toHaveBeenCalled();
    expect(params.degradationPreference).toBe('maintain-resolution');
    expect(params.encodings[0].maxBitrate).toBe(6_000_000);
    expect((receiver as unknown as { playoutDelayHint?: number }).playoutDelayHint).toBe(0.5);
  });

  it('applyMode is a no-op when there is no video sender', async () => {
    await expect(
      applyMode({ getSenders: () => [], getReceivers: () => [] }, 'realtime'),
    ).resolves.toBeUndefined();
  });
});
