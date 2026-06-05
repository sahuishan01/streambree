export async function captureScreen(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
}

export async function captureCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ video: true, audio: true });
}

export async function captureFile(
  file: File,
  video: HTMLVideoElement & { captureStream?: () => MediaStream },
): Promise<MediaStream> {
  video.srcObject = null;
  video.src = URL.createObjectURL(file);
  video.muted = false; // must be unmuted — Chrome skips audio pipeline for muted elements
  await video.play();

  const captureMethod =
    video.captureStream ??
    (video as unknown as { mozCaptureStream?: () => MediaStream }).mozCaptureStream;

  if (!captureMethod) throw new Error('captureStream not supported in this browser');

  const stream = captureMethod.call(video);

  if (!stream.getAudioTracks().length) {
    console.warn('[captureFile] No audio — codec may be unsupported (AC3/DTS). Convert: ffmpeg -i input.mkv -c:v copy -c:a aac out.mkv');
  }

  return stream;
}
