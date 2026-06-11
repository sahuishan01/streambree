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

/** Minimal peer surface needed to apply mode (kept narrow for testability). */
export interface ModeTarget {
  getSenders(): RTCRtpSender[];
  getReceivers(): RTCRtpReceiver[];
}

/**
 * Apply the chosen mode to a live peer: set the video sender's encoding params
 * (bitrate + degradation preference) and the receivers' playout buffer hint.
 */
export async function applyMode(peer: ModeTarget, mode: Mode): Promise<void> {
  const videoSender = peer.getSenders().find((s) => s.track?.kind === 'video');
  if (videoSender) {
    const params = videoSender.getParameters();
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
    const { degradationPreference, maxBitrate } = senderParams(mode);
    params.degradationPreference = degradationPreference;
    params.encodings[0].maxBitrate = maxBitrate;
    await videoSender.setParameters(params).catch(() => {});
  }

  const audioSender = peer.getSenders().find((s) => s.track?.kind === 'audio');
  if (audioSender) {
    const params = audioSender.getParameters();
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
    params.encodings[0].maxBitrate = 320_000;
    await audioSender.setParameters(params).catch(() => {});
  }

  const hint = receiverPlayoutHint(mode);
  for (const receiver of peer.getReceivers()) {
    // playoutDelayHint is a non-standard but widely-supported tuning knob.
    (receiver as unknown as { playoutDelayHint?: number }).playoutDelayHint = hint;
  }
}
