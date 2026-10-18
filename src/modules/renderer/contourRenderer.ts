/* ───────────────────────────────────────────────
   FluxGraph — Contour Renderer
   
   Renders processed contour paths as connected
   vector-like outlines with configurable stroke,
   glow, and smoothing on Canvas 2D.
   ─────────────────────────────────────────────── */

import type { AudioMetrics, BinaryMask, ContourConfig, ContourPath } from '../../types';
import { extractAndProcessContours } from '../contour';

/**
 * Renders contour outlines from binary mask data.
 * Supports stroke color/width, glow, and clean path rendering.
 */
export class ContourRenderer {
  private config: ContourConfig;

  constructor(config: ContourConfig) {
    this.config = { ...config };
  }

  updateConfig(config: Partial<ContourConfig>) {
    Object.assign(this.config, config);
  }

  getConfig(): ContourConfig {
    return { ...this.config };
  }

  /**
   * Render contours from the given binary mask onto the canvas.
   * Returns { contourCount, pointCount } for the perf overlay.
   */
  render(
    ctx: CanvasRenderingContext2D,
    mask: BinaryMask,
    canvasW: number,
    canvasH: number,
    audioMetrics?: AudioMetrics | null,
  ): { contourCount: number; pointCount: number } {
    const { color, lineWidth, glow, audioReactive, audioSensitivity = 1.0 } = this.config;

    // Calculate audio reactive multipliers
    let lineScale = 1.0;
    let glowScale = 1.0;

    if (audioReactive && audioMetrics) {
      const bassEnergy = audioMetrics.bass * audioSensitivity;
      const volEnergy = audioMetrics.volume * audioSensitivity;
      lineScale = 1.0 + bassEnergy * 0.6;
      glowScale = 1.0 + (bassEnergy * 0.8 + volEnergy * 0.4);
    }

    const effectiveLineWidth = lineWidth * lineScale;
    const effectiveGlow = glow * glowScale;

    // Clear canvas
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Extract and process contours
    const contours = extractAndProcessContours(mask, this.config);

    if (contours.length === 0) {
      return { contourCount: 0, pointCount: 0 };
    }

    // Coordinate scaling: contour points are in mask coordinates (0..maskW, 0..maskH)
    // We need to scale them to canvas coordinates
    const scaleX = canvasW / mask.width;
    const scaleY = canvasH / mask.height;

    // Draw glow pass first (larger, blurred stroke behind the main lines)
    if (effectiveGlow > 0) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = effectiveLineWidth + effectiveGlow * 6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = Math.min(1, effectiveGlow * 0.35);
      ctx.shadowColor = color;
      ctx.shadowBlur = effectiveGlow * 16;

      this.drawPaths(ctx, contours, scaleX, scaleY);

      ctx.restore();
    }

    // Draw main contour lines
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = effectiveLineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.95;

    // Subtle inner glow on main lines
    if (effectiveGlow > 0.2) {
      ctx.shadowColor = color;
      ctx.shadowBlur = effectiveGlow * 4;
    }

    this.drawPaths(ctx, contours, scaleX, scaleY);

    ctx.restore();

    // Count total points
    let pointCount = 0;
    for (const c of contours) {
      pointCount += c.points.length;
    }

    return { contourCount: contours.length, pointCount };
  }

  /**
   * Draw all contour paths on the canvas.
   */
  private drawPaths(
    ctx: CanvasRenderingContext2D,
    contours: ContourPath[],
    scaleX: number,
    scaleY: number,
  ) {
    for (const contour of contours) {
      const pts = contour.points;
      if (pts.length < 2) continue;

      ctx.beginPath();
      ctx.moveTo(pts[0].x * scaleX, pts[0].y * scaleY);

      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x * scaleX, pts[i].y * scaleY);
      }

      if (contour.closed) {
        ctx.closePath();
      }

      ctx.stroke();
    }
  }
}
