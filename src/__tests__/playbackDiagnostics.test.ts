import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaybackDiagnostics } from '../modules/media/playbackDiagnostics';

function makeDiagnosticEnvironment() {
  let timerId = 0;
  let sampledSource: { fingerprintSeed?: number } | null = null;
  const sampleContext = {
    clearRect: vi.fn(),
    drawImage: vi.fn((source: CanvasImageSource) => {
      sampledSource = source as unknown as { fingerprintSeed?: number };
    }),
    getImageData: vi.fn(() => {
      const seed = sampledSource?.fingerprintSeed ?? 0;
      const data = new Uint8ClampedArray(32 * 32 * 4);
      for (let index = 0; index < data.length; index += 4) {
        data[index] = seed;
        data[index + 1] = Math.floor(seed / 2);
        data[index + 2] = Math.floor(seed / 3);
        data[index + 3] = 255;
      }
      return { data } as ImageData;
    }),
  } as unknown as CanvasRenderingContext2D;

  const documentStub = {
    hidden: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    elementFromPoint: vi.fn(),
    createElement: vi.fn(() => ({
      width: 0,
      height: 0,
      getContext: vi.fn(() => sampleContext),
    })),
  };

  const windowStub = {
    location: { search: '?fluxgraphDebug=1' },
    setInterval: vi.fn(() => ++timerId),
    clearInterval: vi.fn(),
    getComputedStyle: vi.fn(() => ({
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      zIndex: 'auto',
      position: 'relative',
      pointerEvents: 'auto',
      transform: 'none',
    })),
  };

  vi.stubGlobal('window', windowStub);
  vi.stubGlobal('document', documentStub);
  vi.spyOn(console, 'info').mockImplementation(() => {});

  const videoTarget = new EventTarget();
  const video = videoTarget as unknown as HTMLVideoElement;
  Object.defineProperties(video, {
    paused: { value: false, configurable: true },
    ended: { value: false, configurable: true },
    readyState: { value: 4, configurable: true },
    currentTime: { value: 1.25, configurable: true },
    duration: { value: 12, configurable: true },
    videoWidth: { value: 640, configurable: true },
    videoHeight: { value: 480, configurable: true },
    error: { value: null, configurable: true },
    isConnected: { value: true, configurable: true },
    getBoundingClientRect: {
      value: () => ({ left: 0, top: 0, right: 640, bottom: 480, width: 640, height: 480 }),
      configurable: true,
    },
  });

  const context = { canvas: null as unknown as HTMLCanvasElement } as CanvasRenderingContext2D;
  const canvas = {
    id: 'main-canvas',
    tagName: 'CANVAS',
    width: 640,
    height: 480,
    isConnected: true,
    fingerprintSeed: 10,
    getContext: vi.fn(() => context),
    getBoundingClientRect: () => ({
      left: 0, top: 0, right: 640, bottom: 480, width: 640, height: 480,
    }),
  } as unknown as HTMLCanvasElement & { fingerprintSeed: number };
  Object.defineProperty(context, 'canvas', { value: canvas });
  documentStub.elementFromPoint.mockReturnValue(canvas);

  return { video, canvas, context, documentStub, windowStub };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PlaybackDiagnostics', () => {
  it('tracks lifecycle events, frame metadata, renderer identity, sampled pixels, and cleanup', () => {
    const { video, canvas, context, documentStub, windowStub } = makeDiagnosticEnvironment();
    const removeVideoListener = vi.spyOn(video, 'removeEventListener');
    const diagnostics = new PlaybackDiagnostics(video, true);
    diagnostics.retain();
    diagnostics.setCanvas(canvas, context);

    video.dispatchEvent(new Event('play'));
    video.dispatchEvent(new Event('playing'));
    video.dispatchEvent(new Event('waiting'));
    diagnostics.setLoopState(true, 'rvfc', 'test-start');
    diagnostics.recordCallbackScheduled('rvfc');
    diagnostics.recordFrameCallback({ mediaTime: 0.04, presentedFrames: 1 });
    diagnostics.recordFrameCallback({ mediaTime: 0.04, presentedFrames: 1 });
    diagnostics.recordFrameCallback({ mediaTime: 0.08, presentedFrames: 2 });

    const renderer = {};
    diagnostics.recordPipelineFrame();
    diagnostics.recordAnalysisSuccess();
    diagnostics.recordRendererStart('particles', renderer);
    diagnostics.recordRendererSuccess(canvas, 2100);
    (canvas as HTMLCanvasElement & { fingerprintSeed: number }).fingerprintSeed = 200;
    diagnostics.recordRendererStart('particles', renderer);
    diagnostics.recordRendererSuccess(canvas, 4200);

    const snapshot = diagnostics.snapshot();
    expect(snapshot.video.currentTime).toBe(1.25);
    expect(snapshot.events.play).toBe(1);
    expect(snapshot.events.playing).toBe(1);
    expect(snapshot.events.waiting).toBe(1);
    expect(snapshot.scheduler.callbacksScheduled).toBe(1);
    expect(snapshot.scheduler.callbacksReceived).toBe(3);
    expect(snapshot.scheduler.repeatedMediaTimeCallbacks).toBe(1);
    expect(snapshot.scheduler.presentedFrameAdvances).toBe(2);
    expect(snapshot.scheduler.repeatedPresentedFrameCallbacks).toBe(1);
    expect(snapshot.pipeline.framesReceived).toBe(1);
    expect(snapshot.pipeline.analysisSuccesses).toBe(1);
    expect(snapshot.pipeline.rendererInvocations).toBe(2);
    expect(snapshot.pipeline.rendererSuccesses).toBe(2);
    expect(snapshot.pipeline.lastRendererMode).toBe('particles');
    expect(snapshot.pipeline.lastRendererInstanceId).not.toBeNull();
    expect(snapshot.canvas.contextMatchesCanvas).toBe(true);
    expect(snapshot.canvas.pixelFingerprintSamples).toBe(2);
    expect(snapshot.canvas.pixelFingerprintChanges).toBe(1);
    expect(snapshot.canvas.centerIsCanvas).toBe(true);

    diagnostics.release();
    expect(windowStub.clearInterval).toHaveBeenCalledTimes(1);
    expect(removeVideoListener).toHaveBeenCalledWith('play', expect.any(Function));
    expect(removeVideoListener).toHaveBeenCalledWith('seeked', expect.any(Function));
    expect(documentStub.removeEventListener).not.toHaveBeenCalled();
    expect((windowStub as unknown as { __FLUXGRAPH_DIAGNOSTICS__?: unknown }).__FLUXGRAPH_DIAGNOSTICS__).toBeUndefined();
  });

  it('keeps shared diagnostics alive until every owner releases it', () => {
    const { video, windowStub } = makeDiagnosticEnvironment();
    const diagnostics = new PlaybackDiagnostics(video, true);
    diagnostics.retain(); // MediaController owner
    diagnostics.retain(); // VisualizationPipeline owner

    diagnostics.release();
    expect(windowStub.clearInterval).not.toHaveBeenCalled();
    expect((windowStub as unknown as { __FLUXGRAPH_DIAGNOSTICS__?: unknown }).__FLUXGRAPH_DIAGNOSTICS__).toBeDefined();

    diagnostics.release();
    expect(windowStub.clearInterval).toHaveBeenCalledTimes(1);
    expect((windowStub as unknown as { __FLUXGRAPH_DIAGNOSTICS__?: unknown }).__FLUXGRAPH_DIAGNOSTICS__).toBeUndefined();
  });
});
