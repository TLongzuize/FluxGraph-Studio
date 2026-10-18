/* ───────────────────────────────────────────────
   FluxGraph — Media playback module
   Manages HTMLVideoElement lifecycle, file loading,
   object URL management, and playback state.
   ─────────────────────────────────────────────── */

import type { MediaError, PlaybackState, VideoMetadata } from '../../types';
import { getPlaybackDiagnostics, type PlaybackDiagnostics } from './playbackDiagnostics';

/**
 * Translate a MediaError code into an actionable message.
 */
export function getMediaErrorInfo(err: globalThis.MediaError | null): MediaError {
  if (!err) {
    return {
      code: 0,
      message: 'Unknown error',
      actionable: 'Try a different video file.',
    };
  }
  switch (err.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return {
        code: err.code,
        message: 'Playback was aborted.',
        actionable: 'The video loading was cancelled. Try loading it again.',
      };
    case MediaError.MEDIA_ERR_NETWORK:
      return {
        code: err.code,
        message: 'A network error occurred.',
        actionable: 'Check your connection and try again.',
      };
    case MediaError.MEDIA_ERR_DECODE:
      return {
        code: err.code,
        message: 'The video could not be decoded.',
        actionable: 'This video format may be unsupported. Try converting it to MP4 (H.264) or WebM.',
      };
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return {
        code: err.code,
        message: 'The video format is not supported.',
        actionable: 'Your browser cannot play this format. Try MP4 (H.264), WebM (VP8/VP9), or OGV.',
      };
    default:
      return {
        code: err.code,
        message: err.message || 'Unknown playback error.',
        actionable: 'Try a different video file or browser.',
      };
  }
}

export type MediaEventCallback = (state: PlaybackState, metadata?: VideoMetadata, error?: MediaError) => void;

/**
 * Core media controller. Wraps an HTMLVideoElement and manages its lifecycle.
 */
export class MediaController {
  private video: HTMLVideoElement;
  private objectUrl: string | null = null;
  private callback: MediaEventCallback;
  private _state: PlaybackState = 'idle';
  private readonly diagnostics: PlaybackDiagnostics;
  private readonly listeners: Array<{ event: string; handler: EventListener }> = [];

  constructor(video: HTMLVideoElement, callback: MediaEventCallback) {
    this.video = video;
    this.callback = callback;
    this.diagnostics = getPlaybackDiagnostics(video);
    this.diagnostics.retain();
    this.attachListeners();
  }

  get state(): PlaybackState {
    return this._state;
  }

  get currentTime(): number {
    return this.video.currentTime;
  }

  get duration(): number {
    return this.video.duration || 0;
  }

  get videoElement(): HTMLVideoElement {
    return this.video;
  }

  private setState(state: PlaybackState, metadata?: VideoMetadata, error?: MediaError) {
    this._state = state;
    this.callback(state, metadata, error);
  }

  private addListener(event: string, handler: EventListener) {
    this.video.addEventListener(event, handler);
    this.listeners.push({ event, handler });
  }

  private attachListeners() {
    const v = this.video;

    this.addListener('loadstart', () => {
      this.setState('loading');
    });

    this.addListener('loadedmetadata', () => {
      const metadata: VideoMetadata = {
        width: v.videoWidth,
        height: v.videoHeight,
        duration: v.duration,
        fileName: this.objectUrl ? 'local file' : v.src,
      };
      this.setState('ready', metadata);
    });

    this.addListener('play', () => {
      this.setState('playing');
    });

    this.addListener('playing', () => {
      this.setState('playing');
    });

    this.addListener('pause', () => {
      if (!v.ended) this.setState('paused');
    });

    this.addListener('ended', () => {
      this.setState('ended');
    });

    this.addListener('error', () => {
      const errInfo = getMediaErrorInfo(v.error);
      this.setState('error', undefined, errInfo);
    });
  }

  /**
   * Load a local file via Object URL.
   */
  loadFile(file: File) {
    this.releaseObjectUrl();
    this.diagnostics.resetForSource();
    this.diagnostics.recordSource(file.name);
    this.objectUrl = URL.createObjectURL(file);
    this.video.src = this.objectUrl;
    this.video.load();
  }

  /**
   * Play the video. Returns a promise that resolves when playback starts,
   * or rejects if playback fails (e.g., blocked by autoplay policy).
   * Callers should handle rejection to inform the user.
   */
  async play(): Promise<void> {
    try {
      await this.video.play();
    } catch (e) {
      this.diagnostics.recordError('play', e);
      const errInfo: MediaError = {
        code: 0,
        message: e instanceof Error ? e.message : 'Playback failed',
        actionable: 'Try clicking the play button again, or use a different video file.',
      };
      this.setState('error', undefined, errInfo);
      throw e;
    }
  }

  pause() {
    this.video.pause();
  }

  seek(time: number) {
    this.video.currentTime = Math.max(0, Math.min(time, this.duration));
  }

  replay() {
    this.video.currentTime = 0;
    this.play();
  }

  setVolume(vol: number) {
    this.video.volume = Math.max(0, Math.min(1, vol));
  }

  getVolume(): number {
    return this.video.volume;
  }

  setMuted(muted: boolean) {
    this.video.muted = muted;
  }

  isMuted(): boolean {
    return this.video.muted;
  }

  /**
   * Release the current object URL if one exists.
   */
  releaseObjectUrl() {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  /**
   * Full cleanup — release URLs and detach from video element.
   */
  dispose() {
    for (const { event, handler } of this.listeners) {
      this.video.removeEventListener(event, handler);
    }
    this.listeners.length = 0;
    this.diagnostics.release();
    this.releaseObjectUrl();
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load(); // Reset the element
  }
}
