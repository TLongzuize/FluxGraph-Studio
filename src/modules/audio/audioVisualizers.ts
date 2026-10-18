import type { AudioMetrics } from '../../types';

export type AudioVisualizationMode = 'spectrum' | 'waveform' | 'radial' | 'xy';
export type XYMapping = 'signal' | 'parametric';
export type AudioPalette = 'aurora' | 'violet' | 'ember' | 'mono';

export interface XYSettings {
  mapping: XYMapping;
  sampleCount: number;
  sensitivity: number;
  frequencyInfluence: number;
  smoothing: number;
  trailPersistence: number;
  lineWidth: number;
  glow: number;
  palette: AudioPalette;
  showAxes: boolean;
  showGrid: boolean;
}

export interface XYParameters {
  amplitudeX: number;
  amplitudeY: number;
  frequencyX: number;
  frequencyY: number;
  phaseX: number;
  phaseY: number;
  phase: number;
  delta: number;
  energy: number;
  bass: number;
  mid: number;
  treble: number;
}

export const DEFAULT_XY_SETTINGS: XYSettings = {
  mapping: 'signal',
  sampleCount: 256,
  sensitivity: 1,
  frequencyInfluence: 1,
  smoothing: 0.45,
  trailPersistence: 0.32,
  lineWidth: 1.8,
  glow: 0.55,
  palette: 'aurora',
  showAxes: true,
  showGrid: true,
};

const TAU = Math.PI * 2;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Derives the exact parameters used by the XY parametric renderer. */
export function deriveXYParameters(
  metrics: AudioMetrics,
  settings: Pick<XYSettings, 'sensitivity' | 'frequencyInfluence' | 'sampleCount'>,
  currentTime: number,
): XYParameters {
  const sensitivity = clamp(settings.sensitivity, 0, 3);
  const influence = clamp(settings.frequencyInfluence, 0, 2);
  const energy = clamp(metrics.volume, 0, 1);
  const bass = clamp(metrics.bass * sensitivity, 0, 1);
  const mid = clamp(metrics.mid * sensitivity, 0, 1);
  const treble = clamp(metrics.treble * sensitivity, 0, 1);
  // Silence deliberately resolves to a static curve instead of time-only motion.
  const activePhase = energy > 0.008;
  const phaseX = activePhase ? (currentTime * (0.35 + bass * 1.5)) % TAU : 0;
  const phaseY = activePhase ? (currentTime * (0.22 + treble * 1.6) + bass * 1.2) % TAU : 0;

  return {
    amplitudeX: clamp(0.48 + bass * 0.34 * influence, 0.2, 0.95),
    amplitudeY: clamp(0.48 + treble * 0.34 * influence, 0.2, 0.95),
    frequencyX: 2 + mid * 4 * influence,
    frequencyY: 3 + treble * 5 * influence,
    phaseX,
    phaseY,
    phase: activePhase ? (currentTime * (0.18 + energy * 1.7)) % TAU : 0,
    delta: clamp(Math.round(3 + settings.sampleCount / 32), 1, 31),
    energy,
    bass,
    mid,
    treble,
  };
}

/**
 * Returns the normalized point actually used by delay-embedded XY signal mode.
 * Input samples must be normalized to [-1, 1]; mono sources work without stereo assumptions.
 */
export function getDelayEmbeddedPoint(
  samples: ArrayLike<number>,
  index: number,
  delta: number,
): { x: number; y: number } {
  if (samples.length === 0) return { x: 0, y: 0 };
  const safeIndex = ((Math.floor(index) % samples.length) + samples.length) % samples.length;
  const safeDelta = ((Math.floor(delta) % samples.length) + samples.length) % samples.length;
  return {
    x: clamp(samples[safeIndex], -1, 1),
    y: clamp(samples[(safeIndex + safeDelta) % samples.length], -1, 1),
  };
}

export interface AudioRenderInput {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  mode: AudioVisualizationMode;
  frequency: Uint8Array;
  waveform: Float32Array;
  metrics: AudioMetrics;
  settings: XYSettings;
  currentTime: number;
}

const PALETTES: Record<AudioPalette, [string, string, string]> = {
  aurora: ['#65f7ff', '#8b83ff', '#ff7bdd'],
  violet: ['#bda0ff', '#7d6bff', '#69d7ff'],
  ember: ['#ffd08c', '#ff8274', '#e66cff'],
  mono: ['#ffffff', '#bcc7dd', '#7184a5'],
};

function makeGradient(ctx: CanvasRenderingContext2D, width: number, palette: AudioPalette) {
  const gradient = ctx.createLinearGradient(0, 0, Math.max(1, width), 0);
  const colors = PALETTES[palette];
  gradient.addColorStop(0, colors[0]);
  gradient.addColorStop(0.52, colors[1]);
  gradient.addColorStop(1, colors[2]);
  return gradient;
}

/** Evaluates the same x(t), y(t) equations displayed by XY Math Motion. */
export function getParametricPoint(params: XYParameters, t: number): { x: number; y: number } {
  return {
    x: params.amplitudeX * Math.sin(params.frequencyX * t + params.phaseX),
    y: params.amplitudeY * Math.sin(params.frequencyY * t + params.phaseY),
  };
}

const linearGradientCache = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasGradient>>();
const ambientGradientCache = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasGradient>>();

function getCachedLinearGradient(ctx: CanvasRenderingContext2D, width: number, palette: AudioPalette) {
  let cache = linearGradientCache.get(ctx);
  if (!cache) {
    cache = new Map();
    linearGradientCache.set(ctx, cache);
  }
  const key = `${Math.round(width)}:${palette}`;
  let gradient = cache.get(key);
  if (!gradient) {
    gradient = makeGradient(ctx, width, palette);
    cache.set(key, gradient);
    if (cache.size > 20) cache.delete(cache.keys().next().value!);
  }
  return gradient;
}

function getCachedAmbientGradient(ctx: CanvasRenderingContext2D, width: number, height: number) {
  let cache = ambientGradientCache.get(ctx);
  if (!cache) {
    cache = new Map();
    ambientGradientCache.set(ctx, cache);
  }
  const key = `${Math.round(width)}:${Math.round(height)}`;
  let gradient = cache.get(key);
  if (!gradient) {
    gradient = ctx.createRadialGradient(
      width * 0.5, height * 0.5, 0,
      width * 0.5, height * 0.5, Math.max(width, height) * 0.66,
    );
    gradient.addColorStop(0, 'rgba(35, 70, 105, 0.08)');
    gradient.addColorStop(1, 'rgba(5, 9, 19, 0)');
    cache.set(key, gradient);
    if (cache.size > 12) cache.delete(cache.keys().next().value!);
  }
  return gradient;
}

function drawSpectrum(input: AudioRenderInput, gradient: CanvasGradient) {
  const { ctx, width, height, frequency } = input;
  const count = Math.min(92, Math.max(12, Math.floor(width / 7)));
  const gap = Math.max(2, width * 0.003);
  const barWidth = Math.max(1, (width - gap * (count + 1)) / count);
  const bottom = height * 0.83;
  ctx.fillStyle = gradient;
  for (let i = 0; i < count; i++) {
    const dataIndex = Math.min(frequency.length - 1, Math.floor((i / count) ** 1.7 * frequency.length));
    const magnitude = frequency[dataIndex] / 255;
    const barHeight = Math.max(2, magnitude ** 0.78 * height * 0.7);
    const x = gap + i * (barWidth + gap);
    ctx.globalAlpha = 0.55 + magnitude * 0.45;
    ctx.fillRect(x, bottom - barHeight, barWidth, barHeight);
    ctx.globalAlpha = 0.2 + magnitude * 0.4;
    ctx.fillRect(x, bottom - barHeight - 3, barWidth, 2);
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(125, 156, 190, 0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, bottom + 0.5);
  ctx.lineTo(width, bottom + 0.5);
  ctx.stroke();
}

function drawWaveform(input: AudioRenderInput, gradient: CanvasGradient) {
  const { ctx, width, height, waveform } = input;
  if (waveform.length < 2) return;
  const centerY = height * 0.5;
  const amplitude = height * 0.36;
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < waveform.length; i++) {
    const x = (i / (waveform.length - 1)) * width;
    const y = centerY - waveform[i] * amplitude;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = 'rgba(112, 248, 255, 0.035)';
  ctx.lineTo(width, centerY);
  ctx.lineTo(0, centerY);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(125, 156, 190, 0.19)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.stroke();
}

function drawRadial(input: AudioRenderInput, gradient: CanvasGradient) {
  const { ctx, width, height, frequency, metrics } = input;
  const cx = width / 2;
  const cy = height / 2;
  const minDimension = Math.min(width, height);
  const baseRadius = minDimension * 0.19;
  const maxBar = minDimension * 0.27;
  const count = Math.min(160, frequency.length);
  ctx.strokeStyle = gradient;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const value = frequency[Math.floor((i / count) * frequency.length)] / 255;
    const angle = (i / count) * TAU - Math.PI / 2;
    const r1 = baseRadius;
    const r2 = baseRadius + value ** 0.82 * maxBar * (0.5 + metrics.volume * 0.8);
    ctx.globalAlpha = 0.28 + value * 0.72;
    ctx.lineWidth = Math.max(1, minDimension * 0.0035);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * r1, cy + Math.sin(angle) * r1);
    ctx.lineTo(cx + Math.cos(angle) * r2, cy + Math.sin(angle) * r2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(112, 248, 255, 0.10)';
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(3, baseRadius * 0.07), 0, TAU);
  ctx.fill();
}

function drawXYGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  settings: XYSettings,
): { cx: number; cy: number; scale: number } {
  const cx = width / 2;
  const cy = height / 2;
  const scale = Math.max(1, Math.min((width - 48) / 2, (height - 42) / 2));
  if (settings.showGrid) {
    ctx.strokeStyle = 'rgba(112, 168, 205, 0.095)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const step = Math.max(18, scale / 4);
    for (let x = cx % step; x <= width; x += step) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
    }
    for (let y = cy % step; y <= height; y += step) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
    }
    ctx.stroke();
  }
  if (settings.showAxes) {
    ctx.strokeStyle = 'rgba(180, 206, 230, 0.52)';
    ctx.fillStyle = 'rgba(180, 206, 230, 0.68)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(18, cy + 0.5);
    ctx.lineTo(width - 18, cy + 0.5);
    ctx.moveTo(cx + 0.5, 18);
    ctx.lineTo(cx + 0.5, height - 18);
    ctx.stroke();
    const tick = Math.max(18, scale / 4);
    ctx.beginPath();
    for (let x = cx - tick; x > 8; x -= tick) {
      ctx.moveTo(x, cy - 4);
      ctx.lineTo(x, cy + 4);
    }
    for (let x = cx + tick; x < width - 8; x += tick) {
      ctx.moveTo(x, cy - 4);
      ctx.lineTo(x, cy + 4);
    }
    for (let y = cy - tick; y > 8; y -= tick) {
      ctx.moveTo(cx - 4, y);
      ctx.lineTo(cx + 4, y);
    }
    for (let y = cy + tick; y < height - 8; y += tick) {
      ctx.moveTo(cx - 4, y);
      ctx.lineTo(cx + 4, y);
    }
    ctx.stroke();
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText('x', width - 22, cy - 9);
    ctx.fillText('y', cx + 9, 18);
    ctx.fillText('0', cx + 7, cy + 14);
  }
  return { cx, cy, scale };
}

function drawXY(input: AudioRenderInput, gradient: CanvasGradient) {
  const { ctx, width, height, waveform, metrics, settings, currentTime } = input;
  const { cx, cy, scale } = drawXYGrid(ctx, width, height, settings);
  const params = deriveXYParameters(metrics, settings, currentTime);
  const count = clamp(Math.round(settings.sampleCount), 64, 720);
  const palette = PALETTES[settings.palette];

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  ctx.lineWidth = settings.lineWidth;
  ctx.strokeStyle = gradient;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = palette[0];
  ctx.shadowBlur = settings.glow * 28;
  ctx.globalAlpha = 0.95;
  ctx.beginPath();

  if (settings.mapping === 'signal' && waveform.length > 1) {
    const n = waveform.length;
    for (let i = 0; i < count; i++) {
      const index = Math.min(n - 1, Math.floor((i / Math.max(1, count - 1)) * n));
      const delay = ((params.delta % n) + n) % n;
      const px = cx + clamp(waveform[index], -1, 1) * scale;
      const py = cy - clamp(waveform[(index + delay) % n], -1, 1) * scale;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
  } else {
    for (let i = 0; i < count; i++) {
      const t = (i / Math.max(1, count - 1)) * TAU;
      const point = getParametricPoint(params, t);
      const px = cx + point.x * scale;
      const py = cy - point.y * scale;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
  }
  ctx.stroke();

  // Fine, low-opacity inner stroke gives the curve a glass filament quality.
  ctx.shadowBlur = 0;
  ctx.strokeStyle = palette[2];
  ctx.lineWidth = Math.max(0.6, settings.lineWidth * 0.42);
  ctx.globalAlpha = 0.46;
  ctx.stroke();
  ctx.restore();
}

/** Draws one frame of a local audio track into an already sized 2D canvas. */
export function renderAudioVisualization(input: AudioRenderInput): void {
  const { ctx, width, height, mode, settings } = input;
  if (width <= 0 || height <= 0) return;

  if (mode === 'xy' && settings.trailPersistence > 0) {
    const alpha = 1 - clamp(settings.trailPersistence, 0, 0.92) * 0.83;
    ctx.fillStyle = `rgba(5, 9, 19, ${alpha})`;
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.fillStyle = '#070b15';
    ctx.fillRect(0, 0, width, height);
  }

  // Soft stage illumination remains subordinate to the signal itself.
  ctx.fillStyle = getCachedAmbientGradient(ctx, width, height);
  ctx.fillRect(0, 0, width, height);

  const gradient = getCachedLinearGradient(ctx, width, settings.palette);
  ctx.save();
  ctx.shadowColor = PALETTES[settings.palette][0];
  ctx.shadowBlur = mode === 'xy' ? settings.glow * 24 : 10;
  if (mode === 'spectrum') drawSpectrum(input, gradient);
  else if (mode === 'waveform') drawWaveform(input, gradient);
  else if (mode === 'radial') drawRadial(input, gradient);
  else drawXY(input, gradient);
  ctx.restore();
}
