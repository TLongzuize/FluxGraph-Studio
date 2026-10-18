/**
 * Opt-in playback diagnostics. Enable with ?fluxgraphDebug=1.
 * The normal playback path performs no timers, logging, or canvas readbacks.
 */

export type PlaybackScheduler = 'rvfc' | 'raf' | 'none';
export type PlaybackErrorStage = 'play' | 'schedule' | 'frame' | 'analysis' | 'renderer';

export interface PlaybackDiagnosticsSnapshot {
  enabled: boolean;
  video: {
    paused: boolean;
    ended: boolean;
    readyState: number;
    currentTime: number;
    duration: number;
    videoWidth: number;
    videoHeight: number;
    error: { code: number; message: string } | null;
    connected: boolean;
    display: string | null;
    visibility: string | null;
    opacity: string | null;
    cssWidth: number;
    cssHeight: number;
    zIndex: string | null;
  };
  events: Record<string, number>;
  scheduler: {
    strategy: PlaybackScheduler;
    running: boolean;
    starts: number;
    stops: number;
    callbacksScheduled: number;
    callbacksReceived: number;
    callbacksCancelled: number;
    staleCallbacksIgnored: number;
    lastCallbackAgeMs: number | null;
    lastMediaTime: number | null;
    lastPresentedFrames: number | null;
    repeatedMediaTimeCallbacks: number;
    presentedFrameAdvances: number;
    repeatedPresentedFrameCallbacks: number;
  };
  pipeline: {
    framesReceived: number;
    analysisSuccesses: number;
    rendererInvocations: number;
    rendererSuccesses: number;
    lastRendererMode: string | null;
    lastRendererInstanceId: number | null;
    errors: Record<PlaybackErrorStage, number>;
    skippedFrames: Record<string, number>;
    lastSkipReason: string | null;
  };
  canvas: {
    id: string | null;
    connected: boolean;
    backingWidth: number;
    backingHeight: number;
    cssWidth: number;
    cssHeight: number;
    display: string | null;
    visibility: string | null;
    opacity: string | null;
    zIndex: string | null;
    position: string | null;
    pointerEvents: string | null;
    transform: string | null;
    topElementAtCenter: string | null;
    centerIsCanvas: boolean;
    contextMatchesCanvas: boolean;
    pixelFingerprint: number | null;
    pixelFingerprintSamples: number;
    pixelFingerprintChanges: number;
    lastPixelSampleAgeMs: number | null;
  };
  lastEvent: string | null;
  lastError: { stage: PlaybackErrorStage; message: string } | null;
}

interface FrameMetadataLike {
  mediaTime?: number;
  presentedFrames?: number;
}

interface DebugWindow extends Window {
  __FLUXGRAPH_DIAGNOSTICS__?: { snapshot: () => PlaybackDiagnosticsSnapshot };
}

const VIDEO_EVENTS = [
  'loadstart', 'loadedmetadata', 'loadeddata', 'play', 'playing', 'pause',
  'waiting', 'stalled', 'seeking', 'seeked', 'ended', 'error',
] as const;

const diagnosticsByVideo = new WeakMap<HTMLVideoElement, PlaybackDiagnostics>();
const rendererInstanceIds = new WeakMap<object, number>();
let nextRendererInstanceId = 1;

function rendererInstanceId(renderer: object): number {
  let id = rendererInstanceIds.get(renderer);
  if (id === undefined) {
    id = nextRendererInstanceId++;
    rendererInstanceIds.set(renderer, id);
  }
  return id;
}

export function isPlaybackDiagnosticsEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('fluxgraphDebug') === '1';
}

export function getPlaybackDiagnostics(video: HTMLVideoElement): PlaybackDiagnostics {
  let diagnostics = diagnosticsByVideo.get(video);
  if (!diagnostics) {
    diagnostics = new PlaybackDiagnostics(video, isPlaybackDiagnosticsEnabled());
    diagnosticsByVideo.set(video, diagnostics);
  }
  return diagnostics;
}

export class PlaybackDiagnostics {
  private readonly video: HTMLVideoElement;
  private readonly enabled: boolean;
  private readonly eventCounts: Record<string, number> = {};
  private readonly eventHandlers = new Map<string, EventListener>();
  private readonly skipCounts: Record<string, number> = {};
  private lastSkipReason: string | null = null;
  private readonly errorCounts: Record<PlaybackErrorStage, number> = {
    play: 0,
    schedule: 0,
    frame: 0,
    analysis: 0,
    renderer: 0,
  };
  private readonly lastLogAt = new Map<string, number>();
  private heartbeatTimer: number | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private contextMatchesCanvas = false;
  private sampleCanvas: HTMLCanvasElement | null = null;
  private sampleContext: CanvasRenderingContext2D | null = null;
  private lastSampleAt = 0;
  private lastFingerprint: number | null = null;
  private pixelFingerprint: number | null = null;
  private pixelFingerprintSamples = 0;
  private pixelFingerprintChanges = 0;
  private lastCallbackAt = 0;
  private lastCallbackMediaTime: number | null = null;
  private lastPresentedFrames: number | null = null;
  private repeatedMediaTimeCallbacks = 0;
  private presentedFrameAdvances = 0;
  private repeatedPresentedFrameCallbacks = 0;
  private currentTimeAtPreviousHeartbeat = 0;
  private lastHeartbeatCounts = { callbacks: 0, pipelineFrames: 0, rendererSuccesses: 0, fingerprintChanges: 0 };
  private lastHeartbeatInvocationCount = 0;
  private scheduler: PlaybackScheduler = 'none';
  private loopRunning = false;
  private starts = 0;
  private stops = 0;
  private callbacksScheduled = 0;
  private callbacksReceived = 0;
  private callbacksCancelled = 0;
  private staleCallbacksIgnored = 0;
  private pipelineFrames = 0;
  private analysisSuccesses = 0;
  private rendererInvocations = 0;
  private rendererSuccesses = 0;
  private lastRendererMode: string | null = null;
  private lastRendererInstanceId: number | null = null;
  private owners = 0;
  private lastEvent: string | null = null;
  private lastError: { stage: PlaybackErrorStage; message: string } | null = null;
  private disposed = false;
  private readonly globalSnapshot = () => this.snapshot();

  constructor(video: HTMLVideoElement, enabled = isPlaybackDiagnosticsEnabled()) {
    this.video = video;
    this.enabled = enabled;
    if (!enabled) return;

    for (const eventName of VIDEO_EVENTS) {
      const handler: EventListener = () => {
        this.eventCounts[eventName] = (this.eventCounts[eventName] ?? 0) + 1;
        this.lastEvent = eventName;
        this.log(`video.${eventName}`, { event: eventName, video: this.videoState() }, 500);
      };
      this.eventHandlers.set(eventName, handler);
      video.addEventListener(eventName, handler);
    }

    this.currentTimeAtPreviousHeartbeat = video.currentTime;
    this.heartbeatTimer = window.setInterval(() => this.heartbeat(), 2000);
    (window as DebugWindow).__FLUXGRAPH_DIAGNOSTICS__ = { snapshot: this.globalSnapshot };
    this.log('diagnostics.enabled', { hint: 'Inspect window.__FLUXGRAPH_DIAGNOSTICS__.snapshot() for current counters.' });
  }

  retain() {
    if (this.disposed) return;
    this.owners++;
  }

  release() {
    if (this.disposed || this.owners === 0) return;
    this.owners--;
    if (this.owners === 0) this.dispose();
  }

  recordSource(fileName: string) {
    this.log('source.replaced', { fileName, video: this.videoState() });
  }

  setCanvas(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D | null) {
    this.canvas = canvas;
    this.contextMatchesCanvas = Boolean(context && context.canvas === canvas);
    if (this.enabled) {
      this.log('canvas.attached', {
        id: canvas.id || null,
        connected: canvas.isConnected,
        contextMatchesCanvas: this.contextMatchesCanvas,
        width: canvas.width,
        height: canvas.height,
      });
    }
  }

  setLoopState(running: boolean, scheduler: PlaybackScheduler, reason: string) {
    if (!this.enabled) return;
    const changed = this.loopRunning !== running || this.scheduler !== scheduler;
    this.scheduler = scheduler;
    if (running && !this.loopRunning) this.starts++;
    if (!running && this.loopRunning) this.stops++;
    this.loopRunning = running;
    if (changed) this.log('loop.state', { running, scheduler, reason, starts: this.starts, stops: this.stops });
  }

  recordCallbackScheduled(scheduler: PlaybackScheduler) {
    if (!this.enabled) return;
    this.scheduler = scheduler;
    this.callbacksScheduled++;
  }

  recordCallbackCancelled() {
    if (this.enabled) this.callbacksCancelled++;
  }

  recordStaleCallbackIgnored() {
    if (this.enabled) this.staleCallbacksIgnored++;
  }

  recordFrameCallback(metadata?: FrameMetadataLike) {
    if (!this.enabled) return;
    this.callbacksReceived++;
    this.lastCallbackAt = performance.now();
    if (metadata?.mediaTime !== undefined) {
      if (this.lastCallbackMediaTime === metadata.mediaTime) this.repeatedMediaTimeCallbacks++;
      this.lastCallbackMediaTime = metadata.mediaTime;
    }
    if (metadata?.presentedFrames !== undefined) {
      if (this.lastPresentedFrames === metadata.presentedFrames) {
        this.repeatedPresentedFrameCallbacks++;
      } else {
        this.presentedFrameAdvances++;
      }
      this.lastPresentedFrames = metadata.presentedFrames;
    }
  }

  recordFrameSkipped(reason: string) {
    if (!this.enabled) return;
    this.skipCounts[reason] = (this.skipCounts[reason] ?? 0) + 1;
    this.lastSkipReason = reason;
  }

  recordPipelineFrame() {
    if (this.enabled) this.pipelineFrames++;
  }

  recordAnalysisSuccess() {
    if (this.enabled) this.analysisSuccesses++;
  }

  recordRendererStart(mode: string, renderer: object) {
    if (!this.enabled) return;
    this.rendererInvocations++;
    this.lastRendererMode = mode;
    this.lastRendererInstanceId = rendererInstanceId(renderer);
  }

  recordRendererSuccess(canvas: HTMLCanvasElement, timestamp: number) {
    if (!this.enabled) return;
    this.rendererSuccesses++;
    this.sampleCanvasPixels(canvas, timestamp);
  }

  recordError(stage: PlaybackErrorStage, error: unknown) {
    if (!this.enabled) return;
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    this.errorCounts[stage]++;
    this.lastError = { stage, message };
    this.log(`error.${stage}`, { stage, message, count: this.errorCounts[stage], video: this.videoState() }, 2000);
  }

  snapshot(): PlaybackDiagnosticsSnapshot {
    const canvas = this.canvas;
    const video = this.video;
    const rect = canvas?.getBoundingClientRect();
    const canvasStyle = canvas && typeof window !== 'undefined' ? window.getComputedStyle(canvas) : null;
    const videoRect = video?.getBoundingClientRect();
    const videoStyle = video && typeof window !== 'undefined' ? window.getComputedStyle(video) : null;
    const centerX = rect ? rect.left + rect.width / 2 : 0;
    const centerY = rect ? rect.top + rect.height / 2 : 0;
    const topElement = canvas && rect && typeof document !== 'undefined' && rect.width > 0 && rect.height > 0
      ? document.elementFromPoint(centerX, centerY)
      : null;
    const topElementLabel = topElement
      ? `${topElement.tagName.toLowerCase()}${topElement.id ? `#${topElement.id}` : ''}${typeof topElement.className === 'string' && topElement.className.trim() ? `.${topElement.className.trim().replace(/\s+/g, '.')}` : ''}`
      : null;
    return {
      enabled: this.enabled,
      video: {
        ...this.videoState(),
        connected: Boolean(video?.isConnected),
        display: videoStyle?.display ?? null,
        visibility: videoStyle?.visibility ?? null,
        opacity: videoStyle?.opacity ?? null,
        cssWidth: videoRect?.width ?? 0,
        cssHeight: videoRect?.height ?? 0,
        zIndex: videoStyle?.zIndex ?? null,
      },
      events: { ...this.eventCounts },
      scheduler: {
        strategy: this.scheduler,
        running: this.loopRunning,
        starts: this.starts,
        stops: this.stops,
        callbacksScheduled: this.callbacksScheduled,
        callbacksReceived: this.callbacksReceived,
        callbacksCancelled: this.callbacksCancelled,
        staleCallbacksIgnored: this.staleCallbacksIgnored,
        lastCallbackAgeMs: this.lastCallbackAt ? Math.round(performance.now() - this.lastCallbackAt) : null,
        lastMediaTime: this.lastCallbackMediaTime,
        lastPresentedFrames: this.lastPresentedFrames,
        repeatedMediaTimeCallbacks: this.repeatedMediaTimeCallbacks,
        presentedFrameAdvances: this.presentedFrameAdvances,
        repeatedPresentedFrameCallbacks: this.repeatedPresentedFrameCallbacks,
      },
      pipeline: {
        framesReceived: this.pipelineFrames,
        analysisSuccesses: this.analysisSuccesses,
        rendererInvocations: this.rendererInvocations,
        rendererSuccesses: this.rendererSuccesses,
        lastRendererMode: this.lastRendererMode,
        lastRendererInstanceId: this.lastRendererInstanceId,
        errors: { ...this.errorCounts },
        skippedFrames: { ...this.skipCounts },
        lastSkipReason: this.lastSkipReason,
      },
      canvas: {
        id: canvas?.id || null,
        connected: Boolean(canvas?.isConnected),
        backingWidth: canvas?.width ?? 0,
        backingHeight: canvas?.height ?? 0,
        cssWidth: rect?.width ?? 0,
        cssHeight: rect?.height ?? 0,
        display: canvasStyle?.display ?? null,
        visibility: canvasStyle?.visibility ?? null,
        opacity: canvasStyle?.opacity ?? null,
        zIndex: canvasStyle?.zIndex ?? null,
        contextMatchesCanvas: this.contextMatchesCanvas,
        pixelFingerprint: this.pixelFingerprint,
        pixelFingerprintSamples: this.pixelFingerprintSamples,
        pixelFingerprintChanges: this.pixelFingerprintChanges,
        position: canvasStyle?.position ?? null,
        pointerEvents: canvasStyle?.pointerEvents ?? null,
        transform: canvasStyle?.transform ?? null,
        topElementAtCenter: topElementLabel,
        centerIsCanvas: topElement === canvas,
        lastPixelSampleAgeMs: this.lastSampleAt ? Math.round(performance.now() - this.lastSampleAt) : null,
      },
      lastEvent: this.lastEvent,
      lastError: this.lastError ? { ...this.lastError } : null,
    };
  }

  resetForSource() {
    if (!this.enabled) return;
    this.pipelineFrames = 0;
    for (const key of Object.keys(this.skipCounts)) delete this.skipCounts[key];
    this.lastSkipReason = null;
    this.analysisSuccesses = 0;
    this.rendererInvocations = 0;
    this.rendererSuccesses = 0;
    this.lastRendererMode = null;
    this.lastRendererInstanceId = null;
    this.callbacksScheduled = 0;
    this.callbacksReceived = 0;
    this.callbacksCancelled = 0;
    this.staleCallbacksIgnored = 0;
    this.lastCallbackAt = 0;
    this.lastCallbackMediaTime = null;
    this.lastPresentedFrames = null;
    this.repeatedMediaTimeCallbacks = 0;
    this.presentedFrameAdvances = 0;
    this.repeatedPresentedFrameCallbacks = 0;
    this.lastFingerprint = null;
    this.pixelFingerprint = null;
    this.pixelFingerprintSamples = 0;
    this.pixelFingerprintChanges = 0;
    this.lastError = null;
    this.starts = 0;
    this.stops = 0;
    this.lastHeartbeatCounts = { callbacks: 0, pipelineFrames: 0, rendererSuccesses: 0, fingerprintChanges: 0 };
    this.lastHeartbeatInvocationCount = 0;
    this.lastSampleAt = 0;
    this.currentTimeAtPreviousHeartbeat = this.video.currentTime;
    this.errorCounts.play = 0;
    this.errorCounts.schedule = 0;
    this.errorCounts.frame = 0;
    this.errorCounts.analysis = 0;
    this.errorCounts.renderer = 0;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const [eventName, handler] of this.eventHandlers) {
      this.video.removeEventListener(eventName, handler);
    }
    this.eventHandlers.clear();
    if (this.heartbeatTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    diagnosticsByVideo.delete(this.video);
    const debugWindow = typeof window !== 'undefined' ? (window as DebugWindow) : null;
    if (debugWindow?.__FLUXGRAPH_DIAGNOSTICS__?.snapshot === this.globalSnapshot) {
      delete debugWindow.__FLUXGRAPH_DIAGNOSTICS__;
    }
  }

  private heartbeat() {
    if (!this.enabled || this.disposed || this.video.paused) return;
    const currentTime = this.video.currentTime;
    const currentCounts = {
      callbacks: this.callbacksReceived,
      pipelineFrames: this.pipelineFrames,
      rendererSuccesses: this.rendererSuccesses,
      fingerprintChanges: this.pixelFingerprintChanges,
    };
    const callbackDelta = currentCounts.callbacks - this.lastHeartbeatCounts.callbacks;
    const pipelineDelta = currentCounts.pipelineFrames - this.lastHeartbeatCounts.pipelineFrames;
    const rendererDelta = currentCounts.rendererSuccesses - this.lastHeartbeatCounts.rendererSuccesses;
    const rendererInvocationDelta = this.rendererInvocations - this.lastHeartbeatInvocationCount;
    const pixelsChanged = currentCounts.fingerprintChanges > this.lastHeartbeatCounts.fingerprintChanges;
    const currentTimeAdvanced = currentTime > this.currentTimeAtPreviousHeartbeat + 0.001;
    let suspectedStage = 'flow-active';
    if (!currentTimeAdvanced) suspectedStage = 'A: currentTime-not-advancing';
    else if (!this.loopRunning) suspectedStage = 'F: pipeline-loop-not-running-while-video-advances';
    else if (callbackDelta === 0) suspectedStage = 'B: currentTime-advances-no-frame-callback';
    else if (pipelineDelta === 0) suspectedStage = `C: pipeline-frame-skipped (${this.lastSkipReason ?? 'no skip recorded'})`;
    else if (rendererInvocationDelta === 0) suspectedStage = 'D: renderer-not-invoked';
    else if (rendererDelta === 0) suspectedStage = 'D: renderer-invoked-but-failed';
    else if (pixelsChanged && !this.isCanvasVisiblyPlaced()) suspectedStage = 'E: canvas-updating-but-not-visible';
    else if (this.pixelFingerprintSamples >= 2 && !pixelsChanged) suspectedStage = 'renderer-succeeded-but-canvas-sample-unchanged';

    this.log('heartbeat', {
      suspectedStage,
      currentTimeAdvanced,
      currentTimeDelta: Number((currentTime - this.currentTimeAtPreviousHeartbeat).toFixed(3)),
      callbackDelta,
      pipelineFrameDelta: pipelineDelta,
      rendererInvocationDelta,
      rendererSuccessDelta: rendererDelta,
      canvasFingerprintChanged: pixelsChanged,
      snapshot: this.snapshot(),
    });
    this.currentTimeAtPreviousHeartbeat = currentTime;
    this.lastHeartbeatInvocationCount = this.rendererInvocations;
    this.lastHeartbeatCounts = currentCounts;
  }

  private isCanvasVisiblyPlaced(): boolean {
    const canvas = this.canvas;
    if (!canvas?.isConnected) return false;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(canvas);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const centerElement = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return centerElement === canvas;
  }

  private sampleCanvasPixels(canvas: HTMLCanvasElement, timestamp: number) {
    if (timestamp - this.lastSampleAt < 2000) return;
    try {
      if (!this.sampleCanvas) {
        this.sampleCanvas = document.createElement('canvas');
        this.sampleCanvas.width = 32;
        this.sampleCanvas.height = 32;
        this.sampleContext = this.sampleCanvas.getContext('2d', { willReadFrequently: true });
      }
      const context = this.sampleContext;
      if (!context) return;
      context.clearRect(0, 0, 32, 32);
      context.drawImage(canvas, 0, 0, 32, 32);
      const pixels = context.getImageData(0, 0, 32, 32).data;
      let hash = 2166136261;
      for (let i = 0; i < pixels.length; i += 4) {
        hash = Math.imul(hash ^ pixels[i], 16777619);
        hash = Math.imul(hash ^ pixels[i + 1], 16777619);
        hash = Math.imul(hash ^ pixels[i + 2], 16777619);
      }
      this.pixelFingerprint = hash >>> 0;
      this.pixelFingerprintSamples++;
      if (this.lastFingerprint !== null && this.lastFingerprint !== this.pixelFingerprint) {
        this.pixelFingerprintChanges++;
      }
      this.lastFingerprint = this.pixelFingerprint;
      this.lastSampleAt = timestamp;
    } catch (error) {
      this.log('canvas.sample-error', { message: error instanceof Error ? error.message : String(error) }, 5000);
    }
  }

  private videoState() {
    const v = this.video;
    return {
      paused: v.paused,
      ended: v.ended,
      readyState: v.readyState,
      currentTime: Number.isFinite(v.currentTime) ? Number(v.currentTime.toFixed(3)) : v.currentTime,
      duration: Number.isFinite(v.duration) ? Number(v.duration.toFixed(3)) : v.duration,
      videoWidth: v.videoWidth,
      videoHeight: v.videoHeight,
      error: v.error ? { code: v.error.code, message: v.error.message } : null,
    };
  }

  private log(stage: string, details: Record<string, unknown>, minIntervalMs = 0) {
    if (!this.enabled || this.disposed) return;
    const now = performance.now();
    const last = this.lastLogAt.get(stage) ?? Number.NEGATIVE_INFINITY;
    if (now - last < minIntervalMs) return;
    this.lastLogAt.set(stage, now);
    console.info('[FluxGraph:playback-diag]', JSON.stringify({ atMs: Math.round(now), stage, ...details }));
  }
}
