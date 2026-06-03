export async function captureScreen(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
}

export async function captureCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ video: true, audio: true });
}

/**
 * Stream a local media file: load it into a <video>, play, and capture its stream.
 * The caller supplies the video element so it can also show a local preview.
 */
export async function captureFile(
  file: File,
  video: HTMLVideoElement & { captureStream?: () => MediaStream },
): Promise<MediaStream> {
  video.srcObject = null;
  video.src = URL.createObjectURL(file);
  await video.play();
  const capture =
    video.captureStream ??
    (video as unknown as { mozCaptureStream?: () => MediaStream }).mozCaptureStream;
  if (!capture) throw new Error('captureStream not supported in this browser');
  return capture.call(video);
}
