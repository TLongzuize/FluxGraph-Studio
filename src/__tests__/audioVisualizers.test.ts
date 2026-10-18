import { describe, expect, it } from 'vitest';
import type { AudioMetrics } from '../types';
import {
  DEFAULT_XY_SETTINGS,
  deriveXYParameters,
  getDelayEmbeddedPoint,
  getParametricPoint,
} from '../modules/audio/audioVisualizers';

const silent: AudioMetrics = { volume: 0, bass: 0, mid: 0, treble: 0 };
const active: AudioMetrics = { volume: 0.62, bass: 0.8, mid: 0.42, treble: 0.7 };

describe('XY Math Motion signal mappings', () => {
  it('maps a mono-compatible normalized signal through delay embedding', () => {
    const samples = new Float32Array([-1, -0.5, 0, 0.5, 1]);
    expect(getDelayEmbeddedPoint(samples, 1, 2)).toEqual({ x: -0.5, y: 0.5 });
    expect(getDelayEmbeddedPoint(samples, 4, 1)).toEqual({ x: 1, y: -1 });
  });

  it('wraps indices and handles empty or single-sample waveforms', () => {
    expect(getDelayEmbeddedPoint(new Float32Array(0), 0, 4)).toEqual({ x: 0, y: 0 });
    expect(getDelayEmbeddedPoint(new Float64Array([0.4]), -3, 9)).toEqual({ x: 0.4, y: 0.4 });
  });

  it('keeps phase stationary during silence instead of animating on elapsed time alone', () => {
    const atStart = deriveXYParameters(silent, DEFAULT_XY_SETTINGS, 0);
    const later = deriveXYParameters(silent, DEFAULT_XY_SETTINGS, 90);
    expect(atStart.phase).toBe(0);
    expect(later.phase).toBe(0);
    expect(atStart.phaseX).toBe(0);
    expect(later.phaseX).toBe(0);
    expect(atStart.phaseY).toBe(0);
    expect(later.phaseY).toBe(0);
    expect(atStart.amplitudeX).toBe(later.amplitudeX);
    expect(atStart.frequencyY).toBe(later.frequencyY);
  });

  it('changes parametric amplitudes, ratios, and phase from real analysis metrics', () => {
    const lowEnergy = deriveXYParameters({ volume: 0.002, bass: 0, mid: 0, treble: 0 }, DEFAULT_XY_SETTINGS, 5);
    const moving = deriveXYParameters(active, DEFAULT_XY_SETTINGS, 5);
    expect(moving.amplitudeX).toBeGreaterThan(lowEnergy.amplitudeX);
    expect(moving.amplitudeY).toBeGreaterThan(lowEnergy.amplitudeY);
    expect(moving.frequencyX).toBeGreaterThan(2);
    expect(moving.frequencyY).toBeGreaterThan(3);
    expect(moving.phaseX).not.toBe(0);
  });

  it('applies sensitivity, frequency influence, and curve density to real parameters', () => {
    const restrained = deriveXYParameters(active, {
      ...DEFAULT_XY_SETTINGS,
      sensitivity: 0.2,
      frequencyInfluence: 0.1,
      sampleCount: 80,
    }, 4);
    const expressive = deriveXYParameters(active, {
      ...DEFAULT_XY_SETTINGS,
      sensitivity: 2,
      frequencyInfluence: 2,
      sampleCount: 720,
    }, 4);
    expect(expressive.amplitudeX).toBeGreaterThan(restrained.amplitudeX);
    expect(expressive.amplitudeY).toBeGreaterThan(restrained.amplitudeY);
    expect(expressive.frequencyX).toBeGreaterThan(restrained.frequencyX);
    expect(expressive.frequencyY).toBeGreaterThan(restrained.frequencyY);
    expect(expressive.delta).toBeGreaterThan(restrained.delta);
  });

  it('evaluates the same parametric equations shown in the live readout', () => {
    const params = deriveXYParameters(active, DEFAULT_XY_SETTINGS, 5);
    const t = 0.73;
    const point = getParametricPoint(params, t);
    expect(point.x).toBeCloseTo(params.amplitudeX * Math.sin(params.frequencyX * t + params.phaseX), 10);
    expect(point.y).toBeCloseTo(params.amplitudeY * Math.sin(params.frequencyY * t + params.phaseY), 10);
  });

  it('exposes safe bounded quality-independent curve density and delay', () => {
    const params = deriveXYParameters(active, { ...DEFAULT_XY_SETTINGS, sampleCount: 720 }, 3);
    expect(params.delta).toBeGreaterThanOrEqual(1);
    expect(params.delta).toBeLessThanOrEqual(31);
    expect(params.amplitudeX).toBeLessThanOrEqual(0.95);
    expect(params.amplitudeY).toBeLessThanOrEqual(0.95);
  });
});
