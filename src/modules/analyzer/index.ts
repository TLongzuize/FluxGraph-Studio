/* ───────────────────────────────────────────────
   FluxGraph — Frame Analyzer stub
   Will be fully implemented in Milestone 2.
   ─────────────────────────────────────────────── */

import type { AnalysisConfig, BinaryMask } from '../../types';

/**
 * Analyzes video frames: downsample → grayscale → threshold → binary mask.
 * Reuses typed arrays to minimize allocations.
 */
export class FrameAnalyzer {
  private config: AnalysisConfig;
  private offscreen: OffscreenCanvas | HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  private maskBuffer: Uint8Array;

  constructor(config: AnalysisConfig) {
    this.config = config;

    // Try OffscreenCanvas, fallback to regular canvas
    if (typeof OffscreenCanvas !== 'undefined') {
      this.offscreen = new OffscreenCanvas(config.analysisWidth, config.analysisHeight);
    } else {
      this.offscreen = document.createElement('canvas');
      this.offscreen.width = config.analysisWidth;
      this.offscreen.height = config.analysisHeight;
    }

    const ctx = this.offscreen.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Failed to get 2D context for frame analysis');
    this.ctx = ctx;

    this.maskBuffer = new Uint8Array(config.analysisWidth * config.analysisHeight);
  }

  /**
   * Update analysis configuration. Recreates buffers if resolution changed.
   */
  updateConfig(config: Partial<AnalysisConfig>) {
    const resChanged =
      (config.analysisWidth && config.analysisWidth !== this.config.analysisWidth) ||
      (config.analysisHeight && config.analysisHeight !== this.config.analysisHeight);

    Object.assign(this.config, config);

    if (resChanged) {
      this.offscreen.width = this.config.analysisWidth;
      this.offscreen.height = this.config.analysisHeight;
      this.maskBuffer = new Uint8Array(this.config.analysisWidth * this.config.analysisHeight);
    }
  }

  /**
   * Analyze a single video frame and produce a binary mask.
   */
  analyze(video: HTMLVideoElement): BinaryMask {
    const { analysisWidth: w, analysisHeight: h } = this.config;

    // Draw downsampled frame
    this.ctx.drawImage(video, 0, 0, w, h);

    // Read pixel data
    const imageData = this.ctx.getImageData(0, 0, w, h);
    const pixels = imageData.data;

    // Calculate average brightness for adaptive threshold if needed
    let totalBrightness = 0;
    for (let i = 0; i < w * h; i++) {
      const idx = i * 4;
      const gray = pixels[idx] * 0.299 + pixels[idx + 1] * 0.587 + pixels[idx + 2] * 0.114;
      totalBrightness += gray;
    }
    const avgBrightness = totalBrightness / (w * h);

    // Use a threshold that adapts to the scene brightness
    // If the scene is very bright, use a higher threshold
    // If the scene is very dark, use a lower threshold
    const adaptiveThreshold = Math.max(64, Math.min(192, avgBrightness * 1.2));

    // Convert to grayscale + threshold
    const mask = this.maskBuffer;
    for (let i = 0; i < w * h; i++) {
      const idx = i * 4;
      const gray = pixels[idx] * 0.299 + pixels[idx + 1] * 0.587 + pixels[idx + 2] * 0.114;
      mask[i] = gray < adaptiveThreshold ? 1 : 0;
    }

    return { data: mask, width: w, height: h };
  }

  getConfig(): AnalysisConfig {
    return { ...this.config };
  }
}
