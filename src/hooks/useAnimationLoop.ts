/* ───────────────────────────────────────────────
   FluxGraph — useAnimationLoop hook
   Provides a stable animation frame loop that
   calls a callback with the current video time.
   Does NOT update React state per frame.
   ─────────────────────────────────────────────── */

import { useCallback, useEffect, useRef } from 'react';

export interface AnimationFrameData {
  videoTime: number;
  deltaTime: number;
  timestamp: number;
}

type FrameCallback = (data: AnimationFrameData) => void;

/**
 * Manages a requestAnimationFrame loop tied to a video element.
 * Uses requestVideoFrameCallback when available for frame-accurate sync.
 */
export function useAnimationLoop(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  callback: FrameCallback,
  active: boolean,
) {
  const callbackRef = useRef<FrameCallback>(callback);
  const lastTimestampRef = useRef<number>(0);
  const rafIdRef = useRef<number>(0);

  // Keep callback ref stable without causing loop restart
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const startLoop = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    // Check if requestVideoFrameCallback is available
    const hasRVFC = typeof (video as any).requestVideoFrameCallback === 'function';

    if (hasRVFC) {
      const rvfc = (video as any).requestVideoFrameCallback.bind(video);
      const onVideoFrame = (_now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => {
        if (!active) return;
        const delta = lastTimestampRef.current
          ? metadata.presentationTime - lastTimestampRef.current
          : 16.67;
        lastTimestampRef.current = metadata.presentationTime;

        callbackRef.current({
          videoTime: metadata.mediaTime,
          deltaTime: delta,
          timestamp: metadata.presentationTime,
        });

        rvfc(onVideoFrame);
      };

      rvfc(onVideoFrame);
    } else {
      // Fallback: use requestAnimationFrame
      const onFrame = (timestamp: number) => {
        if (!active) return;
        const delta = lastTimestampRef.current
          ? timestamp - lastTimestampRef.current
          : 16.67;
        lastTimestampRef.current = timestamp;

        callbackRef.current({
          videoTime: video.currentTime,
          deltaTime: delta,
          timestamp,
        });

        rafIdRef.current = requestAnimationFrame(onFrame);
      };

      rafIdRef.current = requestAnimationFrame(onFrame);
    }
  }, [videoRef, active]);

  useEffect(() => {
    if (active) {
      lastTimestampRef.current = 0;
      startLoop();
    }

    return () => {
      cancelAnimationFrame(rafIdRef.current);
    };
  }, [active, startLoop]);
}

// Type declarations for requestVideoFrameCallback

interface VideoFrameCallbackMetadata {
  presentationTime: DOMHighResTimeStamp;
  expectedDisplayTime: DOMHighResTimeStamp;
  width: number;
  height: number;
  mediaTime: number;
  presentedFrames: number;
  processingDuration?: number;
}
