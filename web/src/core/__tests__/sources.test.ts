import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureScreen, captureCamera, captureFile } from '../sources';

const fakeStream = { id: 'stream' } as unknown as MediaStream;

beforeEach(() => {
  (globalThis.navigator as unknown as { mediaDevices: unknown }).mediaDevices = {
    getUserMedia: vi.fn(async () => fakeStream),
    getDisplayMedia: vi.fn(async () => fakeStream),
  };
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
});

describe('sources', () => {
  it('captureScreen uses getDisplayMedia', async () => {
    const s = await captureScreen();
    expect(s).toBe(fakeStream);
    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalled();
  });

  it('captureCamera uses getUserMedia with audio+video', async () => {
    await captureCamera();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ video: true, audio: true });
  });

  it('captureFile plays the file element and captures its stream', async () => {
    const captureStreamMock = vi.fn(() => fakeStream);
    const video = {
      srcObject: null,
      play: vi.fn(async () => {}),
      captureStream: captureStreamMock,
    } as unknown as HTMLVideoElement & { captureStream: () => MediaStream };
    const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' });
    const s = await captureFile(file, video);
    expect(video.play).toHaveBeenCalled();
    expect(s).toBe(fakeStream);
  });
});
