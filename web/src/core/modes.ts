import type { Mode } from './protocol';

export interface SenderParams {
  degradationPreference: RTCDegradationPreference;
  maxBitrate: number;
}

export function senderParams(mode: Mode): SenderParams {
  return mode === 'quality'
    ? { degradationPreference: 'maintain-resolution', maxBitrate: 6_000_000 }
    : { degradationPreference: 'maintain-framerate', maxBitrate: 2_500_000 };
}

/** Receiver jitter/playout buffer hint in seconds. */
export function receiverPlayoutHint(mode: Mode): number {
  return mode === 'quality' ? 0.5 : 0;
}

/** Apply sender params to the first video sender of a peer connection. */
export async function applySenderParams(pc: RTCPeerConnection, mode: Mode): Promise<void> {
  const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
  if (!sender) return;
  const params = sender.getParameters();
  if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
  const { degradationPreference, maxBitrate } = senderParams(mode);
  params.degradationPreference = degradationPreference;
  params.encodings[0].maxBitrate = maxBitrate;
  await sender.setParameters(params);
}
