import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

export async function transcodeWebMToMp4(
  input: Blob,
  expectedDurationSeconds: number,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const ffmpeg = new FFmpeg();
  const coreBaseUrl = `${import.meta.env.BASE_URL}ffmpeg/core/`;
  const terminateOnAbort = () => ffmpeg.terminate();
  const handleProgress = ({ progress, time }: { progress: number; time: number }) => {
    const reportedProgress = Number.isFinite(progress) ? Math.max(0, progress) : 0;
    const timestampProgress = Number.isFinite(time) && time > 0 && expectedDurationSeconds > 0
      ? time / (expectedDurationSeconds * 1_000_000)
      : 0;
    onProgress?.(Math.min(0.99, Math.max(reportedProgress, timestampProgress)));
  };
  signal?.addEventListener('abort', terminateOnAbort, { once: true });
  ffmpeg.on('progress', handleProgress);

  try {
    const coreURL = await toBlobURL(`${coreBaseUrl}ffmpeg-core.js`, 'text/javascript');
    try {
      await ffmpeg.load({
        coreURL,
        wasmURL: `${coreBaseUrl}ffmpeg-core.wasm`,
      }, { signal });
    } finally {
      URL.revokeObjectURL(coreURL);
    }
    await ffmpeg.writeFile('input.webm', new Uint8Array(await input.arrayBuffer()), { signal });
    const exitCode = await ffmpeg.exec([
      '-i', 'input.webm',
      '-map', '0:v:0',
      '-map', '0:a?',
      '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      'output.mp4',
    ], -1, { signal });

    if (exitCode !== 0) throw new Error('FFmpeg could not convert the recording to MP4.');

    const output = await ffmpeg.readFile('output.mp4', undefined, { signal });
    if (typeof output === 'string' || output.byteLength === 0) {
      throw new Error('FFmpeg did not produce an MP4 file.');
    }

    const outputBuffer = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;
    return new Blob([outputBuffer], { type: 'video/mp4' });
  } finally {
    ffmpeg.off('progress', handleProgress);
    signal?.removeEventListener('abort', terminateOnAbort);
    ffmpeg.terminate();
  }
}