export async function captureScreen(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
}

export async function captureCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ video: true, audio: true });
}

/**
 * Stream a local media file: load it into a <video>, play, and capture its stream.
 * The caller supplies the video element so it can also show a local preview.
 *
 * Chrome skips audio decoding for muted elements, so captureStream() returns no
 * audio tracks when the preview element is muted. We work around this by routing
 * audio through the Web Audio API to a MediaStreamDestination (no speaker output)
 * and adding those tracks to the captured stream.
 */
export async function captureFile(
  file: File,
  video: HTMLVideoElement & { captureStream?: () => MediaStream },
): Promise<MediaStream> {
  video.srcObject = null;
  video.src = URL.createObjectURL(file);
  video.muted = true;
  await video.play();

  const captureMethod =
    video.captureStream ??
    (video as unknown as { mozCaptureStream?: () => MediaStream }).mozCaptureStream;
  if (!captureMethod) throw new Error('captureStream not supported in this browser');

  const stream = captureMethod.call(video);

  // If no audio tracks, Chrome likely skipped decoding because the element is muted.
  // Use Web Audio API: createMediaElementSource takes over audio routing from the
  // element (silencing speakers) and lets us pipe audio into a capture destination.
  if (!stream.getAudioTracks().length) {
    try {
      const ctx = new AudioContext();
      const src = ctx.createMediaElementSource(video);
      const dest = ctx.createMediaStreamDestination();
      src.connect(dest); // capture path — deliberately NOT connected to ctx.destination
      for (const track of dest.stream.getAudioTracks()) {
        stream.addTrack(track);
      }
    } catch {
      // Web Audio API unavailable or codec unsupported — stream stays video-only
    }
  }

  return stream;
}
