/* ───────────────────────────────────────────────
   FluxGraph — Particle Renderer
   Renders binary mask data as a field of glowing
   particles on a Canvas 2D context.
   ─────────────────────────────────────────────── */

import type { AudioMetrics, BinaryMask, ParticleConfig } from '../../types';

interface Particle {
  x: number; // normalized 0–1
  y: number; // normalized 0–1
  size: number;
  opacity: number;
}

/**
 * Renders video frames as a particle field.
 * Supports configurable density, size, color, glow, trails, and stable placement.
 */
export class ParticleRenderer {
  private config: ParticleConfig;
  private lastMaskWidth = 0;
  private lastMaskHeight = 0;
  // Reusable sampling grid for stable placement
  private gridParticles: Particle[] | null = null;

  constructor(config: ParticleConfig) {
    this.config = { ...config };
  }

  updateConfig(config: Partial<ParticleConfig>) {
    const densityChanged = config.density !== undefined && config.density !== this.config.density;
    Object.assign(this.config, config);
    if (densityChanged) {
      this.gridParticles = null; // Force grid rebuild
    }
  }

  getConfig(): ParticleConfig {
    return { ...this.config };
  }

  /**
   * Build a stable grid of candidate particle positions.
   * Only foreground particles (mask=1) will be rendered.
   */
  private buildGrid(maskW: number, maskH: number): Particle[] {
    const { density, size } = this.config;
    // Step size inversely proportional to density
    // density=1 → step~2px, density=0.3 → step~5px
    const step = Math.max(1, Math.round(2 / density));
    const particles: Particle[] = [];

    for (let y = 0; y < maskH; y += step) {
      for (let x = 0; x < maskW; x += step) {
        particles.push({
          x: x / maskW,
          y: y / maskH,
          size: size * (0.7 + Math.random() * 0.6), // slight size variation
          opacity: 0.6 + Math.random() * 0.4,
        });
      }
    }

    return particles;
  }

  /**
   * Render particles from the given binary mask onto the canvas.
   * Optionally modulates size and glow if audio reactivity is enabled.
   */
  render(
    ctx: CanvasRenderingContext2D,
    mask: BinaryMask,
    canvasW: number,
    canvasH: number,
    audioMetrics?: AudioMetrics | null,
  ): number {
    const { color, trails, audioReactive, audioSensitivity = 1.0 } = this.config;

    // Calculate audio reactive multipliers
    let sizeScale = 1.0;
    let alphaBoost = 0;

    if (audioReactive && audioMetrics) {
      const bassEnergy = audioMetrics.bass * audioSensitivity;
      const volEnergy = audioMetrics.volume * audioSensitivity;
      sizeScale = 1.0 + bassEnergy * 0.8;
      alphaBoost = volEnergy * 0.25;
    }

    // Apply trails (semi-transparent clear)
    if (trails > 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${1 - trails * 0.85})`;
      ctx.fillRect(0, 0, canvasW, canvasH);
    } else {
      ctx.clearRect(0, 0, canvasW, canvasH);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvasW, canvasH);
    }

    // Rebuild grid if mask resolution or density changed
    if (
      !this.gridParticles ||
      !this.config.stablePlacement ||
      mask.width !== this.lastMaskWidth ||
      mask.height !== this.lastMaskHeight
    ) {
      this.gridParticles = this.buildGrid(mask.width, mask.height);
      this.lastMaskWidth = mask.width;
      this.lastMaskHeight = mask.height;
    }

    const grid = this.config.stablePlacement ? this.gridParticles : this.buildGrid(mask.width, mask.height);

    // Set up glow (expensive - disable for now to improve performance)
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;

    ctx.fillStyle = color;

    // Render particles that fall on foreground pixels
    let count = 0;
    const maskData = mask.data;
    const mw = mask.width;
    const mh = mask.height;

    for (let i = 0; i < grid.length; i++) {
      const p = grid[i];
      const mx = Math.floor(p.x * mw);
      const my = Math.floor(p.y * mh);
      const idx = my * mw + mx;

      if (mx >= 0 && mx < mw && my >= 0 && my < mh && maskData[idx] === 1) {
        const px = p.x * canvasW;
        const py = p.y * canvasH;
        const pSize = p.size * sizeScale;

        ctx.globalAlpha = Math.min(1, p.opacity + alphaBoost);
        ctx.beginPath();
        ctx.arc(px, py, pSize, 0, Math.PI * 2);
        ctx.fill();

        count++;
      }
    }

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;


    return count;
  }

  /**
   * Get current particle count (from last render).
   */
  getGridSize(): number {
    return this.gridParticles?.length ?? 0;
  }
}
