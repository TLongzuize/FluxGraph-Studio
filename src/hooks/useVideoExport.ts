import { useCallback, useEffect, useRef, useState } from 'react';
import { transcodeWebMToMp4 } from '../modules/media/mp4Encoder';
import type { RenderMode } from '../types';

export type VideoExportFormat = 'webm' | 'mp4';

interface ExportSession {
  recorder: MediaRecorder;
  video: HTMLVideoElement;
  tracks: MediaStreamTrack[];
  chunks: Blob[];
  onEnded: () => void;
  filename: string;
  format: VideoExportFormat;
  recordingStartedAt: number;
  shouldDownload: boolean;
  isFinishing: boolean;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function useVideoExport(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  mode: RenderMode,
) {
  const sessionRef = useRef<ExportSession | null>(null);
  const transcodeAbortRef = useRef<AbortController | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [conversionProgress, setConversionProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finishSession = useCallback(async (session: ExportSession) => {
    if (sessionRef.current !== session || session.isFinishing) return;
    session.isFinishing = true;
    session.video.removeEventListener('ended', session.onEnded);
    for (const track of session.tracks) track.stop();

    try {
      if (session.shouldDownload && session.chunks.length > 0) {
        const recordedBlob = new Blob(session.chunks, {
          type: session.recorder.mimeType || 'video/webm',
        });
        let outputBlob = recordedBlob;
        if (session.format === 'mp4') {
          setIsConverting(true);
          setConversionProgress(null);
          const controller = new AbortController();
          transcodeAbortRef.current = controller;
          const recordingDurationSeconds = (performance.now() - session.recordingStartedAt) / 1000;
          outputBlob = await transcodeWebMToMp4(recordedBlob, recordingDurationSeconds, (progress) => {
            if (sessionRef.current === session) setConversionProgress(Math.round(progress * 100));
          }, controller.signal);
          setConversionProgress(100);
          if (transcodeAbortRef.current === controller) transcodeAbortRef.current = null;
        }
        if (sessionRef.current === session && session.shouldDownload) {
          downloadBlob(outputBlob, session.filename);
        }
      }
    } catch (caught) {
      if (sessionRef.current === session) {
        setError(caught instanceof Error ? caught.message : 'Could not convert the recording to MP4.');
      }
    } finally {
      if (sessionRef.current === session) {
        sessionRef.current = null;
        setIsExporting(false);
        setIsConverting(false);
        setConversionProgress(null);
      }
    }
  }, []);

  const stopVideoExport = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;

    session.video.pause();
    if (session.recorder.state === 'inactive') {
      finishSession(session);
    } else {
      session.recorder.stop();
    }
  }, [finishSession]);

  const startVideoExport = useCallback(async (format: VideoExportFormat) => {
    if (sessionRef.current) return;
    setError(null);

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas?.isConnected || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      setError('The video preview is not ready to export.');
      return;
    }
    if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
      setError('Rendered video export is not supported by this browser.');
      return;
    }

    const mimeType = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ].find((candidate) => MediaRecorder.isTypeSupported(candidate));
    if (!mimeType) {
      setError('This browser does not support WebM video export.');
      return;
    }

    let canvasStream: MediaStream | null = null;
    let sourceStream: MediaStream | null = null;
    try {
      video.pause();
      if (video.currentTime > 0.01) {
        await new Promise<void>((resolve, reject) => {
          const timeoutId = window.setTimeout(() => {
            video.removeEventListener('seeked', onSeeked);
            reject(new Error('Could not seek to the start of the video.'));
          }, 5000);
          const onSeeked = () => {
            window.clearTimeout(timeoutId);
            resolve();
          };
          video.addEventListener('seeked', onSeeked, { once: true });
          video.currentTime = 0;
        });
      }

      canvasStream = canvas.captureStream(30);
      const mediaVideo = video as HTMLVideoElement & {
        captureStream?: () => MediaStream;
        mozCaptureStream?: () => MediaStream;
      };
      sourceStream = mediaVideo.captureStream?.() ?? mediaVideo.mozCaptureStream?.() ?? null;
      const tracks = [
        ...canvasStream.getVideoTracks(),
        ...(sourceStream?.getAudioTracks() ?? []),
      ];
      if (tracks.length === 0) throw new Error('No video frames are available to export.');

      const recorder = new MediaRecorder(new MediaStream(tracks), { mimeType });
      let session: ExportSession;
      const onEnded = () => {
        if (recorder.state !== 'inactive') recorder.stop();
      };
      session = {
        recorder,
        video,
        tracks: [...canvasStream.getTracks(), ...(sourceStream?.getTracks() ?? [])],
        chunks: [],
        onEnded,
        filename: `FluxGraph-${mode}-${timestamp()}.${format}`,
        format,
        recordingStartedAt: performance.now(),
        shouldDownload: true,
        isFinishing: false,
      };
      sessionRef.current = session;
      video.addEventListener('ended', onEnded, { once: true });
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) session.chunks.push(event.data);
      };
      recorder.onstop = () => finishSession(session);
      recorder.onerror = () => {
        setError('The rendered video could not be recorded.');
        if (recorder.state !== 'inactive') recorder.stop();
      };
      recorder.start(1000);
      setIsExporting(true);
      await video.play();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start the video export.');
      const session = sessionRef.current;
      if (session) {
        session.shouldDownload = false;
        if (session.recorder.state !== 'inactive') session.recorder.stop();
        else finishSession(session);
      } else {
        for (const track of [...(canvasStream?.getTracks() ?? []), ...(sourceStream?.getTracks() ?? [])]) {
          track.stop();
        }
      }
    }
  }, [canvasRef, finishSession, mode, videoRef]);

  const downloadFrame = useCallback(() => {
    setError(null);
    const canvas = canvasRef.current;
    if (!canvas?.isConnected) {
      setError('The video preview is not ready to export.');
      return;
    }

    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          setError('Could not create the PNG image.');
          return;
        }
        downloadBlob(blob, `FluxGraph-${mode}-${timestamp()}.png`);
      }, 'image/png');
    } catch {
      setError('Could not create the PNG image.');
    }
  }, [canvasRef, mode]);

  useEffect(() => () => {
    transcodeAbortRef.current?.abort();
    transcodeAbortRef.current = null;
    const session = sessionRef.current;
    if (!session) return;
    session.shouldDownload = false;
    session.video.removeEventListener('ended', session.onEnded);
    for (const track of session.tracks) track.stop();
    if (session.recorder.state !== 'inactive') session.recorder.stop();
    sessionRef.current = null;
  }, []);

  return {
    isExporting,
    isConverting,
    conversionProgress,
    error,
    downloadFrame,
    startVideoExport,
    stopVideoExport,
  };
}