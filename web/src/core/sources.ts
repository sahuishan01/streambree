export function canShareScreen(): boolean {
  return typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

export async function captureScreen(): Promise<MediaStream> {
  if (!canShareScreen()) throw new Error('Screen sharing is not supported on this device.');
  return navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
}

export async function captureCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ video: true, audio: true });
}

/**
 * Stream a local media file: load it into a <video>, play, and capture its stream.
 *
 * Root cause of the muted-audio bug:
 *   Chrome skips audio decoding entirely for muted elements, so captureStream()
 *   AND createMediaElementSource() both get silence if the element is muted.
 *
 * Fix:
 *   1. Play the element UNMUTED so Chrome decodes the audio pipeline.
 *   2. Immediately call createMediaElementSource(), which hijacks the audio
 *      routing away from the speakers — so the sender never hears the audio.
 *   3. Route the audio only to a MediaStreamDestination (no ctx.destination).
 *   4. Build the final stream from captureStream() video tracks + Web Audio
 *      API audio tracks.
 */
export async function captureFile(
  file: File,
  video: HTMLVideoElement & { captureStream?: () => MediaStream },
): Promise<MediaStream> {
  video.srcObject = null;
  video.src = URL.createObjectURL(file);
  video.muted = false; // must be unmuted so Chrome decodes the audio pipeline
  await video.play();

  const captureMethod =
    video.captureStream ??
    (video as unknown as { mozCaptureStream?: () => MediaStream }).mozCaptureStream;
  if (!captureMethod) throw new Error('captureStream not supported in this browser');

  try {
    const ctx = new AudioContext();
    await ctx.resume();

    // createMediaElementSource hijacks audio from the element's default output,
    // so connecting only to dest (not ctx.destination) silences the speakers.
    const src = ctx.createMediaElementSource(video);
    const dest = ctx.createMediaStreamDestination();
    src.connect(dest);

    const videoStream = captureMethod.call(video);
    return new MediaStream([
      ...videoStream.getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);
  } catch {
    // Web Audio API unavailable or codec unsupported — return video-only stream
    video.muted = true;
    return captureMethod.call(video);
  }
}
