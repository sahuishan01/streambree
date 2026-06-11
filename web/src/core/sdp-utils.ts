/**
 * Maximise Opus audio quality in an SDP offer.
 *
 * WebRTC defaults Opus to ~32 kbps mono. We upgrade to:
 *   320 kbps  — transparent for music and film audio
 *   stereo    — full left/right channels
 *   48 kHz    — full Opus bandwidth (matches the codec's native rate)
 *   FEC       — forward error correction for packet loss resilience
 *   CBR       — constant bitrate keeps quality consistent under load
 */
export function enhanceAudioSdp(sdp: string): string {
  const lines = sdp.split('\n');

  let opusPt: string | null = null;
  for (const line of lines) {
    const m = line.match(/a=rtpmap:(\d+) opus\/48000(?:\/2)?/i);
    if (m) { opusPt = m[1]; break; }
  }
  if (!opusPt) return sdp;

  return lines.map((line) => {
    if (!line.startsWith(`a=fmtp:${opusPt} `)) return line;

    const prefix = `a=fmtp:${opusPt} `;
    const params = new Map<string, string>();
    line.slice(prefix.length).split(';').forEach((kv) => {
      const [k, v = ''] = kv.trim().split('=');
      if (k) params.set(k, v);
    });

    params.set('maxaveragebitrate', '320000'); // 320 kbps
    params.set('maxplaybackrate',   '48000');  // full 48 kHz bandwidth
    params.set('stereo',            '1');
    params.set('sprop-stereo',      '1');
    params.set('useinbandfec',      '1');
    // VBR (no cbr=1) — lets Opus allocate bits where they matter most

    return prefix + Array.from(params.entries()).map(([k, v]) => v ? `${k}=${v}` : k).join(';');
  }).join('\n');
}
