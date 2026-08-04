let wakeLock: WakeLockSentinel | null = null;

export async function requestWakeLock(): Promise<void> {
  if (!navigator.wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { /* wake lock denied */ }
}

export function releaseWakeLock(): void {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

export async function captureScreen(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
}

export async function captureCamera(videoOnly = false): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ video: true, audio: !videoOnly });
}

/** Merge all tracks from additional streams into a primary MediaStream. */
export function mergeStreams(primary: MediaStream, ...others: MediaStream[]): MediaStream {
  for (const other of others) {
    for (const track of other.getTracks()) {
      if (!primary.getTracks().includes(track)) primary.addTrack(track);
    }
    other.getTracks().forEach((t) => t.stop());
  }
  return primary;
}

type CaptureEl = (HTMLVideoElement | HTMLAudioElement) & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

/** Keep a media element alive on mobile — restart if Chrome suspends it in background. */
export function keepFileAlive(el: HTMLVideoElement | HTMLAudioElement): () => void {
  let playing = true;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;

  function restart() {
    if (!playing) return;
    if (el.paused && el.src) {
      el.play().catch(() => {});
    }
  }

  const onPause = () => {
    // Chrome on Android pauses the element when the tab is backgrounded.
    // Try to restart after a short delay so we don't fight a legitimate user pause.
    restartTimer = setTimeout(restart, 500);
  };

  const onVisibility = () => {
    if (document.visibilityState === 'visible') restart();
  };

  el.addEventListener('pause', onPause);
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    playing = false;
    if (restartTimer) clearTimeout(restartTimer);
    el.removeEventListener('pause', onPause);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

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
