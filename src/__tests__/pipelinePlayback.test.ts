import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisConfig, BinaryMask, ContourConfig, ParticleConfig } from '../types';

const mocks = vi.hoisted(() => ({
  analyze: vi.fn(),
  particleRender: vi.fn(),
  contourRender: vi.fn(),
  audioConnect: vi.fn(),
  audioResume: vi.fn(),
  audioGetMetrics: vi.fn(),
  audioIsActive: vi.fn(),
  audioDispose: vi.fn(),
  analyzerUpdateConfig: vi.fn(),
  analyzerGetConfig: vi.fn(),
  particleUpdateConfig: vi.fn(),
  particleGetConfig: vi.fn(),
  contourUpdateConfig: vi.fn(),
  contourGetConfig: vi.fn(),
}));

vi.mock('../modules/analyzer', () => ({
  FrameAnalyzer: class {
    analyze = mocks.analyze;
    updateConfig = mocks.analyzerUpdateConfig;
    getConfig = mocks.analyzerGetConfig;
    constructor(_config: AnalysisConfig) {}
  },
}));

vi.mock('../modules/audio', () => ({
  AudioAnalyzer: class {
    connect = mocks.audioConnect;
    resume = mocks.audioResume;
    getAudioMetrics = mocks.audioGetMetrics;
    isActive = mocks.audioIsActive;
    dispose = mocks.audioDispose;
  },
}));

vi.mock('../modules/renderer/particleRenderer', () => ({
  ParticleRenderer: class {
    render = mocks.particleRender;
    updateConfig = mocks.particleUpdateConfig;
    getConfig = mocks.particleGetConfig;
    constructor(_config: ParticleConfig) {}
  },
}));

vi.mock('../modules/renderer/contourRenderer', () => ({
  ContourRenderer: class {
    render = mocks.contourRender;
    updateConfig = mocks.contourUpdateConfig;
    getConfig = mocks.contourGetConfig;
    constructor(_config: ContourConfig) {}
  },
}));

import { VisualizationPipeline } from '../pipeline/VisualizationPipeline';

type TestFrameCallback = (
  now: number,
  metadata: VideoFrameCallbackMetadata,
) => void;

interface TestVideo extends HTMLVideoElement {
  callbackMap: Map<number, TestFrameCallback>;
  requested: ReturnType<typeof vi.fn>;
  cancelled: ReturnType<typeof vi.fn>;
  setPaused(value: boolean): void;
  setCurrentTime(value: number): void;
  fireFrame(id: number, mediaTime?: number, presentedFrames?: number): void;
  captureCallback(id: number): TestFrameCallback | undefined;
}

const defaultConfig = {
  analysisConfig: {
    analysisWidth: 4,
    analysisHeight: 4,
    threshold: 128,
    adaptiveThreshold: true,
  },
  particleConfig: {
    density: 0.5,
    size: 1,
    color: '#fff',
    glow: 0,
    trails: 0,
    stablePlacement: true,
  },
  contourConfig: {
    color: '#fff',
    lineWidth: 1,
    glow: 0,
    minLength: 1,
    smoothing: 0,
    simplifyTolerance: 0,
  },
  mode: 'particles' as const,
};

function makeMask(): BinaryMask {
  return { data: new Uint8Array([1, 0, 0, 1]), width: 2, height: 2 };
}

function makeVideo(): TestVideo {
  const target = new EventTarget();
  const video = target as unknown as TestVideo;
  let nextCallbackId = 1;
  const callbackMap = new Map<number, TestFrameCallback>();
  let paused = false;
  let currentTime = 0;

  Object.defineProperties(video, {
    paused: { get: () => paused, configurable: true },
    ended: { value: false, configurable: true },
    readyState: { value: 4, configurable: true },
    duration: { value: 20, configurable: true },
    videoWidth: { value: 640, configurable: true },
    videoHeight: { value: 480, configurable: true },
    volume: { value: 1, writable: true, configurable: true },
    muted: { value: false, writable: true, configurable: true },
    currentTime: { get: () => currentTime, configurable: true },
  });

  const requested = vi.fn((callback: TestFrameCallback) => {
    const id = nextCallbackId++;
    callbackMap.set(id, callback);
    return id;
  });
  const cancelled = vi.fn((id: number) => {
    callbackMap.delete(id);
  });

  Object.assign(video, {
    callbackMap,
    requested,
    cancelled,
    requestVideoFrameCallback: requested,
    cancelVideoFrameCallback: cancelled,
    setPaused: (value: boolean) => { paused = value; },
    setCurrentTime: (value: number) => { currentTime = value; },
    captureCallback: (id: number) => callbackMap.get(id),
    fireFrame: (id: number, mediaTime = currentTime, presentedFrames = id) => {
      const callback = callbackMap.get(id);
      callbackMap.delete(id);
      callback?.(performance.now(), {
        mediaTime,
        presentedFrames,
        width: 640,
        height: 480,
        expectedDisplayTime: performance.now(),
        presentationTime: performance.now(),
        processingDuration: 0,
        captureTime: performance.now(),
        receiveTime: performance.now(),
      } as VideoFrameCallbackMetadata);
    },
  });
  return video;
}

function makeCanvas(): HTMLCanvasElement {
  const context = {
    canvas: null as unknown as HTMLCanvasElement,
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fillStyle: '#000',
    globalAlpha: 1,
    shadowBlur: 0,
    shadowColor: 'transparent',
  } as unknown as CanvasRenderingContext2D;

  const canvas = {
    id: 'main-canvas',
    width: 640,
    height: 480,
    isConnected: true,
    getContext: vi.fn(() => context),
    getBoundingClientRect: () => ({
      x: 0, y: 0, top: 0, left: 0, right: 640, bottom: 480,
      width: 640, height: 480, toJSON: () => ({}),
    }),
  } as unknown as HTMLCanvasElement;
  Object.defineProperty(context, 'canvas', { value: canvas });
  return canvas;
}

function mountPipeline(video = makeVideo()) {
  const canvas = makeCanvas();
  const pipeline = new VisualizationPipeline(defaultConfig);
  pipeline.setCanvas(canvas);
  pipeline.setVideo(video);
  return { pipeline, video, canvas };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('window', {
    location: { search: '' },
    devicePixelRatio: 1,
    getComputedStyle: vi.fn(() => ({})),
  });
  vi.stubGlobal('document', {
    hidden: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  mocks.analyze.mockImplementation(() => makeMask());
  mocks.particleRender.mockReturnValue(2);
  mocks.contourRender.mockReturnValue({ contourCount: 1, pointCount: 4 });
  mocks.audioGetMetrics.mockReturnValue({ volume: 0, bass: 0, mid: 0, treble: 0 });
  mocks.audioIsActive.mockReturnValue(false);
  mocks.analyzerGetConfig.mockReturnValue(defaultConfig.analysisConfig);
  mocks.particleGetConfig.mockReturnValue(defaultConfig.particleConfig);
  mocks.contourGetConfig.mockReturnValue(defaultConfig.contourConfig);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VisualizationPipeline playback lifecycle', () => {
  it('reschedules RVFC after each frame and continues after an analysis exception', () => {
    const { pipeline, video } = mountPipeline();
    pipeline.start();
    expect(video.callbackMap.size).toBe(1);

    const firstId = [...video.callbackMap.keys()][0];
    mocks.analyze.mockImplementationOnce(() => { throw new Error('synthetic analyzer failure'); });
    video.fireFrame(firstId, 0.04, 1);

    expect(mocks.analyze).toHaveBeenCalledTimes(1);
    expect(video.callbackMap.size).toBe(1);
    expect(video.requested).toHaveBeenCalledTimes(2);

    const secondId = [...video.callbackMap.keys()][0];
    // Seeking during playback should be completed by the next presented frame without stopping the loop.
    video.setCurrentTime(0.08);
    video.dispatchEvent(new Event('seeking'));
    video.dispatchEvent(new Event('seeked'));
    video.fireFrame(secondId, 0.08, 2);
    expect(mocks.analyze).toHaveBeenCalledTimes(2);
    expect(mocks.particleRender).toHaveBeenCalledTimes(1);
    expect(video.callbackMap.size).toBe(1);
    pipeline.dispose();
  });

  it('cancels stale callbacks on pause and restarts exactly one loop on resume', () => {
    const { pipeline, video } = mountPipeline();
    pipeline.start();
    const staleId = [...video.callbackMap.keys()][0];
    const staleCallback = video.captureCallback(staleId);
    pipeline.stop('pause');

    expect(video.cancelled).toHaveBeenCalledWith(staleId);
    expect(video.callbackMap.size).toBe(0);
    staleCallback?.(performance.now(), { mediaTime: 1, presentedFrames: 1 } as VideoFrameCallbackMetadata);
    expect(mocks.analyze).not.toHaveBeenCalled();

    video.setPaused(false);
    pipeline.start();
    expect(video.callbackMap.size).toBe(1);
    const resumedId = [...video.callbackMap.keys()][0];
    video.setCurrentTime(1.04);
    video.fireFrame(resumedId, 1.04, 2);
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
    expect(video.callbackMap.size).toBe(1);
    pipeline.dispose();
  });

  it('rerenders on seek while paused and keeps the loop alive across mode switches', () => {
    const { pipeline, video } = mountPipeline();
    pipeline.start();
    const firstId = [...video.callbackMap.keys()][0];
    video.fireFrame(firstId, 0.04, 1);
    expect(mocks.particleRender).toHaveBeenCalledTimes(1);

    pipeline.setMode('contours');
    expect(video.callbackMap.size).toBe(1);
    const secondId = [...video.callbackMap.keys()][0];
    // Seeking during playback should be completed by the next presented frame without stopping the loop.
    video.setCurrentTime(0.08);
    video.dispatchEvent(new Event('seeking'));
    video.dispatchEvent(new Event('seeked'));
    video.fireFrame(secondId, 0.08, 2);
    expect(mocks.contourRender).toHaveBeenCalledTimes(1);
    expect(video.callbackMap.size).toBe(1);

    pipeline.stop('pause');
    video.setPaused(true);
    video.setCurrentTime(7);
    video.dispatchEvent(new Event('seeked'));
    expect(mocks.analyze).toHaveBeenCalledTimes(3);
    expect(mocks.contourRender).toHaveBeenCalledTimes(2);

    pipeline.setMode('particles');
    expect(mocks.particleRender).toHaveBeenCalledTimes(2);
    pipeline.dispose();
  });

  it('does not reattach listeners for the same video and safely replaces a playing video', () => {
    const oldVideo = makeVideo();
    const addSpy = vi.spyOn(oldVideo, 'addEventListener');
    const removeSpy = vi.spyOn(oldVideo, 'removeEventListener');
    const { pipeline } = mountPipeline(oldVideo);
    const firstVideoListenerCount = addSpy.mock.calls.length;
    pipeline.setVideo(oldVideo);
    expect(addSpy).toHaveBeenCalledTimes(firstVideoListenerCount);

    pipeline.start();
    const pendingId = [...oldVideo.callbackMap.keys()][0];
    const newVideo = makeVideo();
    pipeline.setVideo(newVideo);

    expect(oldVideo.cancelled).toHaveBeenCalledWith(pendingId);
    expect(removeSpy).toHaveBeenCalledWith('seeked', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('play', expect.any(Function));
    expect(newVideo.callbackMap.size).toBe(1);
    pipeline.dispose();
    expect(newVideo.callbackMap.size).toBe(0);
    expect(mocks.audioDispose).toHaveBeenCalledTimes(1);
  });

  it('uses RAF when RVFC is unavailable and cancels it on disposal', () => {
    let rafId = 1;
    const rafCallbacks = new Map<number, FrameRequestCallback>();
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      const id = rafId++;
      rafCallbacks.set(id, callback);
      return id;
    });
    const cancelFrame = vi.fn((id: number) => rafCallbacks.delete(id));
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);

    const video = makeVideo();
    Object.defineProperty(video, 'requestVideoFrameCallback', { value: undefined, configurable: true });
    const { pipeline } = mountPipeline(video);
    pipeline.start();
    expect(requestFrame).toHaveBeenCalledTimes(1);
    const pendingId = [...rafCallbacks.keys()][0];
    pipeline.dispose();
    expect(cancelFrame).toHaveBeenCalledWith(pendingId);
    expect(rafCallbacks.size).toBe(0);
  });
});
