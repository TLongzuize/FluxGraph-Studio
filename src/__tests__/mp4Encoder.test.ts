import { beforeEach, describe, expect, it, vi } from 'vitest';

const ffmpegMocks = vi.hoisted(() => ({
  load: vi.fn(),
  writeFile: vi.fn(),
  exec: vi.fn(),
  readFile: vi.fn(),
  terminate: vi.fn(),
  toBlobURL: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
}));

vi.mock('@ffmpeg/ffmpeg', () => ({
  FFmpeg: class {
    load = ffmpegMocks.load;
    writeFile = ffmpegMocks.writeFile;
    exec = ffmpegMocks.exec;
    readFile = ffmpegMocks.readFile;
    terminate = ffmpegMocks.terminate;
    on = ffmpegMocks.on;
    off = ffmpegMocks.off;
  },
}));

vi.mock('@ffmpeg/util', () => ({
  toBlobURL: ffmpegMocks.toBlobURL,
}));

import { transcodeWebMToMp4 } from '../modules/media/mp4Encoder';

describe('transcodeWebMToMp4', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ffmpegMocks.toBlobURL.mockResolvedValue('blob:ffmpeg-core');
    ffmpegMocks.load.mockResolvedValue(true);
    ffmpegMocks.writeFile.mockResolvedValue(true);
    ffmpegMocks.exec.mockResolvedValue(0);
    ffmpegMocks.readFile.mockResolvedValue(new Uint8Array([0, 0, 0, 1]));
  });

  it('loads the local core, encodes H.264 MP4, and returns an MP4 blob', async () => {
    const input = new Blob(['webm-data'], { type: 'video/webm' });
    const onProgress = vi.fn();
    const output = await transcodeWebMToMp4(input, 2.3, onProgress);

    expect(ffmpegMocks.toBlobURL).toHaveBeenCalledWith(
      `${import.meta.env.BASE_URL}ffmpeg/core/ffmpeg-core.js`,
      'text/javascript',
    );
    expect(ffmpegMocks.load).toHaveBeenCalledWith({
      coreURL: 'blob:ffmpeg-core',
      wasmURL: `${import.meta.env.BASE_URL}ffmpeg/core/ffmpeg-core.wasm`,
    }, { signal: undefined });
    expect(ffmpegMocks.writeFile).toHaveBeenCalledWith(
      'input.webm',
      new Uint8Array(await input.arrayBuffer()),
      { signal: undefined },
    );
    expect(ffmpegMocks.exec).toHaveBeenCalledWith(
      expect.arrayContaining([
        '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
        '-c:v', 'libx264',
        '-c:a', 'aac',
        'output.mp4',
      ]),
      -1,
      { signal: undefined },
    );
    expect(output.type).toBe('video/mp4');
    expect(output.size).toBe(4);
    expect(ffmpegMocks.on).toHaveBeenCalledWith('progress', expect.any(Function));
    const progressHandler = ffmpegMocks.on.mock.calls[0][1];
    progressHandler({ progress: -1_150_000, time: 1_150_000 });
    expect(onProgress).toHaveBeenCalledWith(0.5);
    progressHandler({ progress: 1, time: 2_300_000 });
    expect(onProgress).toHaveBeenLastCalledWith(0.99);
    expect(ffmpegMocks.off).toHaveBeenCalledWith('progress', progressHandler);
    expect(ffmpegMocks.terminate).toHaveBeenCalledOnce();
  });

  it('terminates FFmpeg if encoding fails', async () => {
    ffmpegMocks.exec.mockResolvedValue(1);

    await expect(transcodeWebMToMp4(new Blob(['webm-data']), 2)).rejects.toThrow(
      'FFmpeg could not convert the recording to MP4.',
    );
    expect(ffmpegMocks.terminate).toHaveBeenCalledOnce();
  });
});