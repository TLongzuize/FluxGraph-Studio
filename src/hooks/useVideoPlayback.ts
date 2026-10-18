/* ───────────────────────────────────────────────
   FluxGraph — useVideoPlayback hook
   Manages MediaController lifecycle and exposes
   playback state to React components.
   ─────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from 'react';
import { MediaController } from '../modules/media';
import type { MediaError, PlaybackState, VideoMetadata } from '../types';

export interface UseVideoPlaybackReturn {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  state: PlaybackState;
  metadata: VideoMetadata | null;
  error: MediaError | null;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  loadFile: (file: File) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  seek: (time: number) => void;
  replay: () => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
}

export function useVideoPlayback(): UseVideoPlaybackReturn {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controllerRef = useRef<MediaController | null>(null);

  const [state, setState] = useState<PlaybackState>('idle');
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [error, setError] = useState<MediaError | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  // Time update via requestAnimationFrame — only updates React state at ~4Hz to avoid excessive rerenders
  const timeUpdateRef = useRef<number>(0);
  const lastTimeUpdateRef = useRef<number>(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const controller = new MediaController(video, (newState, meta, err) => {
      setState(newState);
      if (meta) {
        setMetadata(meta);
        setDuration(meta.duration);
      }
      if (err) setError(err);
      if (newState === 'ready' || newState === 'playing') setError(null);
    });

    controllerRef.current = controller;

    // Poll currentTime at low frequency for the UI timeline
    let running = true;
    const pollTime = () => {
      if (!running) return;
      const now = performance.now();
      // Update currentTime in React state at ~4Hz (every 250ms) to avoid excessive rerenders
      if (now - lastTimeUpdateRef.current > 250) {
        setCurrentTime(video.currentTime);
        lastTimeUpdateRef.current = now;
      }
      timeUpdateRef.current = requestAnimationFrame(pollTime);
    };
    timeUpdateRef.current = requestAnimationFrame(pollTime);

    return () => {
      running = false;
      cancelAnimationFrame(timeUpdateRef.current);
      controller.dispose();
    };
  }, []);

  const loadFile = useCallback((file: File) => {
    controllerRef.current?.loadFile(file);
    setError(null);
  }, []);

  const play = useCallback(async () => {
    try {
      await controllerRef.current?.play();
    } catch (e) {
      console.warn('[useVideoPlayback] play() failed:', e);
      // Error is already set in MediaController; state will reflect 'error'
    }
  }, []);

  const pause = useCallback(() => {
    controllerRef.current?.pause();
  }, []);

  const togglePlay = useCallback(() => {
    const ctrl = controllerRef.current;
    const video = videoRef.current;
    if (!ctrl || !video) return;

    // Use actual video.paused as source of truth, not controller state.
    // This handles cases where controller state and video.paused are out of sync
    // (e.g., video paused without firing 'pause' event).
    if (ctrl.state === 'ended') {
      ctrl.replay();
    } else if (!video.paused) {
      ctrl.pause();
    } else {
      ctrl.play();
    }
  }, []);

  const seek = useCallback((time: number) => {
    controllerRef.current?.seek(time);
    setCurrentTime(time);
  }, []);

  const replay = useCallback(() => {
    controllerRef.current?.replay();
  }, []);

  const setVolume = useCallback((vol: number) => {
    controllerRef.current?.setVolume(vol);
    setVolumeState(vol);
  }, []);

  const toggleMute = useCallback(() => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;
    const newMuted = !ctrl.isMuted();
    ctrl.setMuted(newMuted);
    setIsMuted(newMuted);
  }, []);

  return {
    videoRef,
    state,
    metadata,
    error,
    currentTime,
    duration,
    volume,
    isMuted,
    loadFile,
    play,
    pause,
    togglePlay,
    seek,
    replay,
    setVolume,
    toggleMute,
  };
}
