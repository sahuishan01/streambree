export async function captureScreen(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
}

export async function captureCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ video: true, audio: true });
}

type CaptureEl = (HTMLVideoElement | HTMLAudioElement) & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

export async function captureFile(file: File, el: CaptureEl): Promise<MediaStream> {
  el.srcObject = null;
  el.src = URL.createObjectURL(file);
  el.muted = false; // must be unmuted — Chrome skips audio pipeline for muted elements
  await el.play();

  const captureMethod =
    el.captureStream ??
    (el as unknown as { mozCaptureStream?: () => MediaStream }).mozCaptureStream;

  if (!captureMethod) throw new Error('captureStream not supported in this browser');

  const stream = captureMethod.call(el);

  if (!stream.getAudioTracks().length) {
    console.warn('[captureFile] No audio — codec may be unsupported (AC3/DTS). Convert: ffmpeg -i input.mkv -c:v copy -c:a aac out.mkv');
  }

  const audioTrack = stream.getAudioTracks()[0];
  if (audioTrack) {
    await audioTrack.applyConstraints({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    }).catch(() => {});
  }

  return stream;
}

export function isAudioFile(file: File): boolean {
  return file.type.startsWith('audio/') ||
    /\.(mp3|wav|flac|ogg|oga|opus|m4a|aac|wma|aiff|aif)$/i.test(file.name);
}
