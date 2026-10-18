/* ───────────────────────────────────────────────
   FluxGraph — Shared type definitions
   ─────────────────────────────────────────────── */

/** Visualization rendering mode */
export type RenderMode = 'particles' | 'contours';

/** Quality preset names */
export type QualityPreset = 'performance' | 'balanced' | 'quality' | 'ultra' | 'max';

/** Media playback state */
export type PlaybackState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error';

/** Media error information */
export interface MediaError {
  code: number;
  message: string;
  actionable: string; // Human-readable suggestion
}

/** Video metadata extracted after load */
export interface VideoMetadata {
  width: number;
  height: number;
  duration: number;
  fileName: string;
}

/** Analysis configuration */
export interface AnalysisConfig {
  /** Width of the analysis downsampled frame */
  analysisWidth: number;
  /** Height of the analysis downsampled frame */
  analysisHeight: number;
  /** Grayscale threshold for binary mask (0–255) */
  threshold: number;
  /** Whether to use adaptive threshold based on scene brightness */
  adaptiveThreshold?: boolean;
}

/** Binary mask output from frame analysis */
export interface BinaryMask {
  /** Flat Uint8Array where 1 = foreground, 0 = background */
  data: Uint8Array;
  width: number;
  height: number;
}

/** A 2D point */
export interface Point {
  x: number;
  y: number;
}

/** A single contour path */
export interface ContourPath {
  points: Point[];
  closed: boolean;
  length: number; // Approximate path length in pixels
}

/** Geometry data shared between renderers */
export interface FrameGeometry {
  /** Binary mask from analysis */
  mask: BinaryMask;
  /** Extracted contour paths (computed lazily or by contour module) */
  contours: ContourPath[];
  /** Source analysis resolution */
  analysisWidth: number;
  analysisHeight: number;
  /** Timestamp of the analyzed frame */
  timestamp: number;
}

/** High-level audio metrics extracted from audio analysis */
export interface AudioMetrics {
  /** Overall volume/RMS normalized between 0 and 1 */
  volume: number;
  /** Low-frequency / bass energy (approx 20–250 Hz) normalized 0 to 1 */
  bass: number;
  /** Mid-frequency energy (approx 250–2000 Hz) normalized 0 to 1 */
  mid: number;
  /** High-frequency / treble energy (approx 2000+ Hz) normalized 0 to 1 */
  treble: number;
}

/** Particle renderer configuration */
export interface ParticleConfig {
  /** Density factor: higher = more particles */
  density: number;
  /** Base particle radius in pixels */
  size: number;
  /** Base color (CSS color string) */
  color: string;
  /** Glow intensity (0 = off, 1 = full) */
  glow: number;
  /** Trail opacity (0 = off, 1 = full) */
  trails: number;
  /** Whether particles should maintain stable positions between frames */
  stablePlacement: boolean;
  /** Whether particles react dynamically to audio */
  audioReactive?: boolean;
  /** Audio reactivity sensitivity multiplier (default 1.0) */
  audioSensitivity?: number;
}

/** Contour renderer configuration */
export interface ContourConfig {
  /** Stroke color (CSS color string) */
  color: string;
  /** Stroke width */
  lineWidth: number;
  /** Glow intensity (0 = off, 1 = full) */
  glow: number;
  /** Minimum contour length to render (pixels) */
  minLength: number;
  /** Smoothing factor (0 = no smoothing, 1 = max smoothing) */
  smoothing: number;
  /** Simplification tolerance in pixels */
  simplifyTolerance: number;
  /** Whether contours react dynamically to audio */
  audioReactive?: boolean;
  /** Audio reactivity sensitivity multiplier (default 1.0) */
  audioSensitivity?: number;
}

/** Performance overlay data */
export interface PerfStats {
  fps: number;
  frameTime: number;       // ms for the last frame
  analysisTime: number;    // ms for frame analysis
  renderTime: number;      // ms for rendering
  particleCount: number;
  contourCount: number;
  analysisResolution: string;
  audioActive?: boolean;
  audioLevel?: number;
}

/** Quality preset parameters */
export interface QualityParams {
  analysisWidth: number;
  analysisHeight: number;
  particleDensity: number;
  particleSize: number;
  particleGlow: number;
  contourSimplify: number;
  /** Maximum backing-store scale for the main canvas, also bounded by a pixel budget. */
  maxDevicePixelRatio: number;
}

/** All quality presets */
export const QUALITY_PRESETS: Record<QualityPreset, QualityParams> = {
  performance: {
    analysisWidth: 160,
    analysisHeight: 120,
    particleDensity: 0.3,
    particleSize: 2,
    particleGlow: 0,
    contourSimplify: 3,
    maxDevicePixelRatio: 1,
  },
  balanced: {
    analysisWidth: 320,
    analysisHeight: 240,
    particleDensity: 0.6,
    particleSize: 1.5,
    particleGlow: 0.4,
    contourSimplify: 1.5,
    maxDevicePixelRatio: 1.25,
  },
  quality: {
    analysisWidth: 480,
    analysisHeight: 360,
    particleDensity: 1.0,
    particleSize: 1,
    particleGlow: 0.7,
    contourSimplify: 0.8,
    maxDevicePixelRatio: 1.5,
  },
  ultra: {
    analysisWidth: 640,
    analysisHeight: 480,
    particleDensity: 1.0,
    particleSize: 0.9,
    particleGlow: 0.82,
    contourSimplify: 0.45,
    maxDevicePixelRatio: 1.75,
  },
  max: {
    // Deliberately bounded: a 480k source mask, not unbounded/native-resolution analysis.
    analysisWidth: 800,
    analysisHeight: 600,
    particleDensity: 1.0,
    particleSize: 0.8,
    particleGlow: 0.95,
    contourSimplify: 0.25,
    maxDevicePixelRatio: 2,
  },
};
