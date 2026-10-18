/* ───────────────────────────────────────────────
   FluxGraph — Visualization Pipeline
   Connects video → analyzer → renderer in a
   single animation frame callback. Operates
   outside React state to avoid per-frame rerenders.
   Includes audio reactivity and tab visibility handling.
   ─────────────────────────────────────────────── */

import {
  type AnalysisConfig,
  type BinaryMask,
  type ContourConfig,
  type ParticleConfig,
  type PerfStats,
  type QualityPreset,
  type RenderMode,
  QUALITY_PRESETS,
} from '../types';
import { FrameAnalyzer } from '../modules/analyzer';
import { AudioAnalyzer } from '../modules/audio';
import { ContourRenderer } from '../modules/renderer/contourRenderer';
import { getPlaybackDiagnostics, type PlaybackDiagnostics } from '../modules/media/playbackDiagnostics';
import { ParticleRenderer } from '../modules/renderer/particleRenderer';

export interface PipelineConfig {
  analysisConfig: AnalysisConfig;
  particleConfig: ParticleConfig;
  contourConfig: ContourConfig;
  mode: RenderMode;
}

/**
 * The visualization pipeline runs per-frame outside of React.
 * It owns the analyzer and renderers, and writes directly to the canvas.
 *
 * It manages its own animation loop using requestVideoFrameCallback
 * (with requestAnimationFrame fallback) and correctly handles
 * pause/seek/resume without desynchronization.
 */
export class VisualizationPipeline {
  private analyzer: FrameAnalyzer;
  private particleRenderer: ParticleRenderer;
  private contourRenderer: ContourRenderer;
  private audioAnalyzer: AudioAnalyzer;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private video: HTMLVideoElement | null = null;
  private mode: RenderMode = 'particles';
  private _stats: PerfStats = {
    fps: 0,
    frameTime: 0,
    analysisTime: 0,
    renderTime: 0,
    particleCount: 0,
    contourCount: 0,
    analysisResolution: '0×0',
    audioActive: false,
    audioLevel: 0,
  };

  // Animation loop state
  private rafId = 0;
  private rvfcId = 0;
  private running = false;
  private hasRVFC = false;
  private shouldStartWhenCanvasReady = false;
  private forceRender = false;
  private loopGeneration = 0;
  private diagnostics: PlaybackDiagnostics | null = null;

  // FPS tracking
  private frameCount = 0;
  private lastFpsTime = 0;
  private lastMask: BinaryMask | null = null;

  // Listeners
  private seekListener: (() => void) | null = null;
  private playListener: (() => void) | null = null;
  private visibilityListener: (() => void) | null = null;

  constructor(config: PipelineConfig) {
    this.analyzer = new FrameAnalyzer(config.analysisConfig);
    this.particleRenderer = new ParticleRenderer(config.particleConfig);
    this.contourRenderer = new ContourRenderer(config.contourConfig);
    this.audioAnalyzer = new AudioAnalyzer();
    this.mode = config.mode;
    this._stats.analysisResolution =
      `${config.analysisConfig.analysisWidth}×${config.analysisConfig.analysisHeight}`;

    // Suspend loop when tab is hidden to save battery and prevent audio/video drift
    this.visibilityListener = () => {
      if (!document.hidden && this.video && !this.video.paused) {
        this.processOneFrame(performance.now());
      }
    };
    document.addEventListener('visibilitychange', this.visibilityListener);
  }

  setCanvas(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.diagnostics?.setCanvas(canvas, this.ctx);

    // If start() was called before canvas was ready, start now
    if (this.shouldStartWhenCanvasReady && !this.running) {
      this.start();
    }

    // If we're running and video is ready, render a frame immediately
    if (this.running && this.video && this.video.readyState >= 2) {
      this.processOneFrame(performance.now());
    }
  }

  setVideo(video: HTMLVideoElement) {
    // Playback-state updates frequently call setVideo with the same DOM element.
    // Reconnecting it would detach listeners while a callback is pending and
    // needlessly reconnect audio. Only replace the binding when identity changes.
    if (this.video === video) {
      if (!this.diagnostics) {
        this.diagnostics = getPlaybackDiagnostics(video);
        this.diagnostics.retain();
      }
      if (this.canvas) this.diagnostics.setCanvas(this.canvas, this.ctx);
      return;
    }

    const resumeAfterReplacement = this.running;
    if (resumeAfterReplacement) this.stop('video-replaced');
    this.detachVideo();
    this.diagnostics?.release();
    this.video = video;
    this.diagnostics = getPlaybackDiagnostics(video);
    this.diagnostics.retain();
    this.hasRVFC = typeof video.requestVideoFrameCallback === 'function';
    if (this.canvas) this.diagnostics.setCanvas(this.canvas, this.ctx);

    this.audioAnalyzer.connect(video);

    this.seekListener = () => {
      if (video.paused && video.readyState >= 2) {
        this.forceRender = true;
        this.processOneFrame(performance.now());
      }
    };
    video.addEventListener('seeked', this.seekListener);

    this.playListener = () => {
      this.audioAnalyzer.resume();
    };
    video.addEventListener('play', this.playListener);

    if (resumeAfterReplacement) this.start();
  }

  private detachVideo() {
    if (this.video) {
      if (this.seekListener) this.video.removeEventListener('seeked', this.seekListener);
      if (this.playListener) this.video.removeEventListener('play', this.playListener);
    }
    this.seekListener = null;
    this.playListener = null;
    this.video = null;
  }

  setMode(mode: RenderMode) {
    this.mode = mode;
    // Re-render current frame immediately when switching modes while paused
    if (this.video && this.video.paused && this.lastMask) {
      this.forceRender = true;
      this.processOneFrame(performance.now());
    }
  }

  updateAnalysisConfig(config: Partial<AnalysisConfig>) {
    this.analyzer.updateConfig(config);
    const c = this.analyzer.getConfig();
    this._stats.analysisResolution = `${c.analysisWidth}×${c.analysisHeight}`;
  }

  updateParticleConfig(config: Partial<ParticleConfig>) {
    this.particleRenderer.updateConfig(config);
  }

  updateContourConfig(config: Partial<ContourConfig>) {
    this.contourRenderer.updateConfig(config);
  }

  /**
   * Apply a predefined quality preset to all subsystems.
   */
  applyPreset(preset: QualityPreset) {
    const params = QUALITY_PRESETS[preset];
    if (!params) return;

    this.updateAnalysisConfig({
      analysisWidth: params.analysisWidth,
      analysisHeight: params.analysisHeight,
    });
    this.updateParticleConfig({
      density: params.particleDensity,
      size: params.particleSize,
      glow: params.particleGlow,
    });
    this.updateContourConfig({
      simplifyTolerance: params.contourSimplify,
    });
  }

  get stats(): PerfStats {
    return { ...this._stats };
  }

  /** Start the animation loop. Safe to call multiple times. */
  start() {
    if (this.running) {
      return;
    }

    if (!this.canvas || !this.ctx) {
      // Defer until the canvas is attached.
      this.shouldStartWhenCanvasReady = true;
      return;
    }

    if (!this.video) {
      return;
    }

    this.running = true;
    const generation = ++this.loopGeneration;
    this.shouldStartWhenCanvasReady = false;
    this.lastFpsTime = performance.now();
    this.frameCount = 0;
    this.audioAnalyzer.resume();

    // Prefer requestVideoFrameCallback when available — it is NOT subject to
    // media throttling and fires when a new video frame is presented, even for
    // hidden video elements. Falls back to requestAnimationFrame otherwise.
    this.hasRVFC = typeof this.video.requestVideoFrameCallback === 'function';
    const scheduler = this.hasRVFC ? 'rvfc' : 'raf';
    this.diagnostics?.setLoopState(true, scheduler, 'start');
    if (this.hasRVFC) this.requestNextRVFC(generation);
    else this.scheduleNextFrame(generation);
  }

  /** Stop the animation loop. Pending callbacks are invalidated by generation. */
  stop(reason = 'stop') {
    const wasRunning = this.running;
    this.running = false;
    this.loopGeneration++;
    this.diagnostics?.setLoopState(false, 'none', reason);
    this.cancelNextFrame();
    this.rafId = 0;
    this.rvfcId = 0;
    if (!wasRunning) return;
  }

  /** Full cleanup — stop loop, detach video, release audio and memory resources. */
  dispose() {
    this.stop('dispose');
    this.detachVideo();
    if (this.visibilityListener) {
      document.removeEventListener('visibilitychange', this.visibilityListener);
      this.visibilityListener = null;
    }
    this.audioAnalyzer.dispose();
    this.diagnostics?.release();
    this.canvas = null;
    this.ctx = null;
    this.diagnostics = null;
    this.lastMask = null;
  }

  private isCurrentLoop(generation: number, video: HTMLVideoElement | null = this.video): boolean {
    return this.running && generation === this.loopGeneration && Boolean(video) && video === this.video;
  }

  private scheduleNextFrame(generation: number) {
    if (!this.isCurrentLoop(generation)) return;
    if (!this.video) return;

    // requestVideoFrameCallback can exist yet fail during registration in an
    // implementation-specific edge case. Fall back to RAF rather than ending
    // the playback loop silently.
    if (this.hasRVFC) {
      this.requestNextRVFC(generation);
      return;
    }

    const video = this.video;
    const id = requestAnimationFrame((timestamp) => {
      if (this.rafId === id) this.rafId = 0;
      if (!this.isCurrentLoop(generation, video)) {
        this.diagnostics?.recordStaleCallbackIgnored();
        return;
      }
      this.diagnostics?.recordFrameCallback();
      try {
        this.processOneFrame(timestamp);
      } catch (error) {
        this.diagnostics?.recordError('frame', error);
      } finally {
        if (this.isCurrentLoop(generation, video)) this.scheduleNextFrame(generation);
      }
    });
    this.rafId = id;
    this.diagnostics?.recordCallbackScheduled('raf');
  }

  /** Request the next requestVideoFrameCallback, guarding stale loop generations. */
  private requestNextRVFC(generation: number) {
    if (!this.isCurrentLoop(generation) || !this.video) return;
    const video = this.video;
    try {
      const id = video.requestVideoFrameCallback((timestamp, metadata) => {
        if (this.rvfcId === id) this.rvfcId = 0;
        if (!this.isCurrentLoop(generation, video)) {
          this.diagnostics?.recordStaleCallbackIgnored();
          return;
        }
        this.diagnostics?.recordFrameCallback(metadata);
        try {
          this.processOneFrame(timestamp);
        } catch (error) {
          this.diagnostics?.recordError('frame', error);
        } finally {
          if (this.isCurrentLoop(generation, video)) this.requestNextRVFC(generation);
        }
      });
      this.rvfcId = id;
      this.diagnostics?.recordCallbackScheduled('rvfc');
    } catch (error) {
      this.diagnostics?.recordError('schedule', error);
      this.hasRVFC = false;
      this.diagnostics?.setLoopState(true, 'raf', 'rvfc-registration-failed');
      this.scheduleNextFrame(generation);
    }
  }

  /** Cancel pending work for the currently bound video and RAF scheduler. */
  private cancelNextFrame() {
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
      this.diagnostics?.recordCallbackCancelled();
    }
    if (this.rvfcId !== 0 && this.video) {
      try {
        if (typeof this.video.cancelVideoFrameCallback === 'function') {
          this.video.cancelVideoFrameCallback(this.rvfcId);
          this.diagnostics?.recordCallbackCancelled();
        }
      } catch (error) {
        this.diagnostics?.recordError('schedule', error);
      } finally {
        this.rvfcId = 0;
      }
    }
  }

  /**
   * Process one frame: analyze the current video frame and render visualization.
   */
  private processOneFrame(timestamp: number) {
    if (!this.canvas || !this.ctx || !this.video) {
      this.diagnostics?.recordFrameSkipped('missing-canvas-context-or-video');
      return;
    }
    if (this.video.readyState < 2) {
      this.diagnostics?.recordFrameSkipped(`readyState-${this.video.readyState}`);
      return; // HAVE_CURRENT_DATA minimum
    }

    // Skip if video is paused (but still render once if needed for mode switches)
    if (this.video.paused && !this.forceRender) {
      this.diagnostics?.recordFrameSkipped('video-paused');
      return;
    }
    this.forceRender = false;

    this.diagnostics?.recordPipelineFrame();

    // Use the canvas's CSS dimensions: high-quality profiles may cap the
    // backing-store DPR below window.devicePixelRatio to bound memory use.
    const fallbackDpr = Number(this.canvas.dataset.pixelRatio) || window.devicePixelRatio || 1;
    const canvasW = this.canvas.clientWidth || this.canvas.width / fallbackDpr;
    const canvasH = this.canvas.clientHeight || this.canvas.height / fallbackDpr;

    if (canvasW <= 0 || canvasH <= 0) {
      this.diagnostics?.recordFrameSkipped('invalid-canvas-dimensions');
      return;
    }

    const frameStart = performance.now();

    // 1. Analyze the frame (shared between both renderers)
    const analysisStart = performance.now();
    let mask: BinaryMask;
    try {
      mask = this.analyzer.analyze(this.video);
      this.diagnostics?.recordAnalysisSuccess();
    } catch (error) {
      this.diagnostics?.recordError('analysis', error);
      throw error;
    }
    this.lastMask = mask;
    const analysisEnd = performance.now();

    // 2. Fetch audio metrics (zero-allocation in hot loop)
    const audioMetrics = this.audioAnalyzer.getAudioMetrics();

    // 3. Render based on current mode
    const renderStart = performance.now();
    let particleCount = 0;
    let contourCount = 0;

    try {
      if (this.mode === 'particles') {
        this.diagnostics?.recordRendererStart('particles', this.particleRenderer);
        particleCount = this.particleRenderer.render(
          this.ctx,
          mask,
          canvasW,
          canvasH,
          audioMetrics,
        );
      } else {
        this.diagnostics?.recordRendererStart('contours', this.contourRenderer);
        const result = this.contourRenderer.render(
          this.ctx,
          mask,
          canvasW,
          canvasH,
          audioMetrics,
        );
        contourCount = result.contourCount;
      }
      this.diagnostics?.recordRendererSuccess(this.canvas, timestamp);
    } catch (error) {
      this.diagnostics?.recordError('renderer', error);
      throw error;
    }

    const renderEnd = performance.now();

    // 4. Update performance stats
    this.frameCount++;
    if (timestamp - this.lastFpsTime >= 1000) {
      this._stats.fps = Math.round(
        (this.frameCount * 1000) / (timestamp - this.lastFpsTime),
      );
      this.frameCount = 0;
      this.lastFpsTime = timestamp;
    }

    this._stats.frameTime = renderEnd - frameStart;
    this._stats.analysisTime = analysisEnd - analysisStart;
    this._stats.renderTime = renderEnd - renderStart;
    this._stats.particleCount = particleCount;
    this._stats.contourCount = contourCount;
    this._stats.audioActive = this.audioAnalyzer.isActive();
    this._stats.audioLevel = Math.round(audioMetrics.volume * 100);

    // Update stats every frame for immediate feedback (throttled in the hook)
    // This ensures the overlay shows real-time values
  }
}
