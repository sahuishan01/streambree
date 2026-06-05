/**
 * Boost Opus audio quality in an SDP string.
 * WebRTC defaults Opus to ~32 kbps mono — fine for voice, bad for music/video.
 * This sets 128 kbps stereo, which is transparent for virtually all content.
 */
export function enhanceAudioSdp(sdp: string): string {
  const lines = sdp.split('\n');

  // Find the Opus payload type from the rtpmap line.
  let opusPt: string | null = null;
  for (const line of lines) {
    const m = line.match(/a=rtpmap:(\d+) opus\/48000\/2/i);
    if (m) { opusPt = m[1]; break; }
  }
  if (!opusPt) return sdp; // no Opus — leave unchanged

  return lines.map((line) => {
    // Rewrite the fmtp line for this payload type.
    if (!line.startsWith(`a=fmtp:${opusPt} `)) return line;

    const params = new Map<string, string>();
    const prefix = `a=fmtp:${opusPt} `;
    line.slice(prefix.length).split(';').forEach((kv) => {
      const [k, v = ''] = kv.trim().split('=');
      if (k) params.set(k, v);
    });

    // Apply quality overrides.
    params.set('maxaveragebitrate', '128000'); // 128 kbps
    params.set('stereo', '1');                // stereo playback
    params.set('sprop-stereo', '1');          // stereo send
    params.set('useinbandfec', '1');          // forward error correction

    return prefix + Array.from(params.entries()).map(([k, v]) => v ? `${k}=${v}` : k).join(';');
  }).join('\n');
}
