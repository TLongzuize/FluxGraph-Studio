/* ───────────────────────────────────────────────
   FluxGraph — usePipeline hook
   Wires the VisualizationPipeline into React,
   managing lifecycle and connecting it to the
   video element and canvas without causing
   per-frame React state updates.
   ─────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from 'react';
import { VisualizationPipeline } from '../pipeline/VisualizationPipeline';
import {
  type AnalysisConfig,
  type ContourConfig,
  type ParticleConfig,
  type PerfStats,
  type PlaybackState,
  type QualityPreset,
  type RenderMode,
  QUALITY_PRESETS,
} from '../types';

export const DEFAULT_ANALYSIS: AnalysisConfig = {
  analysisWidth: 320,
  analysisHeight: 240,
  threshold: 128,
  adaptiveThreshold: true,
};

export const DEFAULT_PARTICLES: ParticleConfig = {
  density: 0.6,
  size: 1.5,
  color: '#00e5ff',
  glow: 0.4,
  trails: 0,
  stablePlacement: true,
  audioReactive: true,
  audioSensitivity: 1.0,
};

export const DEFAULT_CONTOURS: ContourConfig = {
  color: '#00e5ff',
  lineWidth: 1.5,
  glow: 0.5,
  minLength: 5,
  smoothing: 0.4,
  simplifyTolerance: 1.5,
  audioReactive: true,
  audioSensitivity: 1.0,
};

export interface UsePipelineReturn {
  /** Call when canvas element is ready */
  onCanvasReady: (canvas: HTMLCanvasElement) => void;
  /** Current perf stats (updated at ~2Hz for the overlay) */
  perfStats: PerfStats;
  /** Current analysis parameters */
  analysisConfig: AnalysisConfig;
  /** Current particle parameters */
  particleConfig: ParticleConfig;
  /** Current contour parameters */
  contourConfig: ContourConfig;
  /** Current video quality profile */
  qualityPreset: QualityPreset;
  /** Update analysis parameters */
  setAnalysisConfig: (config: Partial<AnalysisConfig>) => void;
  /** Update particle parameters */
  setParticleConfig: (config: Partial<ParticleConfig>) => void;
  /** Update contour parameters */
  setContourConfig: (config: Partial<ContourConfig>) => void;
  /** Apply preset */
  applyPreset: (preset: QualityPreset) => void;
  /** Reset all configs to defaults */
  resetDefaults: () => void;
}

/**
 * Manages the VisualizationPipeline lifecycle.
 */
export function usePipeline(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  playbackState: PlaybackState,
  mode: RenderMode,
): UsePipelineReturn {
  const pipelineRef = useRef<VisualizationPipeline | null>(null);

  const [analysisConfig, setAnalysisConfigState] = useState<AnalysisConfig>(DEFAULT_ANALYSIS);
  const [particleConfig, setParticleConfigState] = useState<ParticleConfig>(DEFAULT_PARTICLES);
  const [contourConfig, setContourConfigState] = useState<ContourConfig>(DEFAULT_CONTOURS);
  const [qualityPreset, setQualityPreset] = useState<QualityPreset>('balanced');

  const [perfStats, setPerfStats] = useState<PerfStats>({
    fps: 0,
    frameTime: 0,
    analysisTime: 0,
    renderTime: 0,
    particleCount: 0,
    contourCount: 0,
    analysisResolution: `${DEFAULT_ANALYSIS.analysisWidth}×${DEFAULT_ANALYSIS.analysisHeight}`,
    audioActive: false,
    audioLevel: 0,
  });

  // Create pipeline once
  useEffect(() => {
    const pipeline = new VisualizationPipeline({
      analysisConfig,
      particleConfig,
      contourConfig,
      mode,
    });
    pipelineRef.current = pipeline;

    return () => {
      pipeline.dispose();
      pipelineRef.current = null;
    };
    // Intentionally only run on mount/unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Connect video element to pipeline when ready
  useEffect(() => {
    const pipeline = pipelineRef.current;
    const video = videoRef.current;
    if (!pipeline || !video) return;
    pipeline.setVideo(video);
  }, [videoRef]);

  // Forward mode changes
  useEffect(() => {
    pipelineRef.current?.setMode(mode);
  }, [mode]);

  // Start/stop animation loop based on playback state
  useEffect(() => {
    const pipeline = pipelineRef.current;
    if (!pipeline) return;

    if (playbackState === 'playing') {
      // Only start if video is ready (has dimensions)
      const video = videoRef.current;
      if (video && video.videoWidth > 0 && video.videoHeight > 0) {
        pipeline.start();
      }
    } else {
      pipeline.stop();
    }

    return () => {
      pipeline.stop();
    };
  }, [playbackState, videoRef]);

  // Throttled perf stats polling (~2Hz) — only when playing
  useEffect(() => {
    if (playbackState !== 'playing') return;

    const interval = setInterval(() => {
      const pipeline = pipelineRef.current;
      if (pipeline) {
        setPerfStats(pipeline.stats);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [playbackState]);

  const onCanvasReady = useCallback((canvas: HTMLCanvasElement) => {
    pipelineRef.current?.setCanvas(canvas);
  }, []);

  const setAnalysisConfig = useCallback((config: Partial<AnalysisConfig>) => {
    pipelineRef.current?.updateAnalysisConfig(config);
    setAnalysisConfigState((prev) => ({ ...prev, ...config }));
  }, []);

  const setParticleConfig = useCallback((config: Partial<ParticleConfig>) => {
    pipelineRef.current?.updateParticleConfig(config);
    setParticleConfigState((prev) => ({ ...prev, ...config }));
  }, []);

  const setContourConfig = useCallback((config: Partial<ContourConfig>) => {
    pipelineRef.current?.updateContourConfig(config);
    setContourConfigState((prev) => ({ ...prev, ...config }));
  }, []);

  const applyPreset = useCallback((preset: QualityPreset) => {
    pipelineRef.current?.applyPreset(preset);
    const p = QUALITY_PRESETS[preset];
    if (!p) return;
    setQualityPreset(preset);

    setAnalysisConfigState((prev) => ({
      ...prev,
      analysisWidth: p.analysisWidth,
      analysisHeight: p.analysisHeight,
    }));
    setParticleConfigState((prev) => ({
      ...prev,
      density: p.particleDensity,
      size: p.particleSize,
      glow: p.particleGlow,
    }));
    setContourConfigState((prev) => ({
      ...prev,
      simplifyTolerance: p.contourSimplify,
    }));
  }, []);

  const resetDefaults = useCallback(() => {
    pipelineRef.current?.updateAnalysisConfig(DEFAULT_ANALYSIS);
    pipelineRef.current?.updateParticleConfig(DEFAULT_PARTICLES);
    pipelineRef.current?.updateContourConfig(DEFAULT_CONTOURS);
    setAnalysisConfigState(DEFAULT_ANALYSIS);
    setParticleConfigState(DEFAULT_PARTICLES);
    setContourConfigState(DEFAULT_CONTOURS);
    setQualityPreset('balanced');
  }, []);

  return {
    onCanvasReady,
    perfStats,
    analysisConfig,
    particleConfig,
    contourConfig,
    qualityPreset,
    setAnalysisConfig,
    setParticleConfig,
    setContourConfig,
    applyPreset,
    resetDefaults,
  };
}
