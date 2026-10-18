/* ───────────────────────────────────────────────
   FluxGraph — Audio and Quality Presets Unit Tests
   ─────────────────────────────────────────────── */

import { describe, expect, it } from 'vitest';
import { AudioAnalyzer } from '../modules/audio';
import { QUALITY_PRESETS, type QualityPreset } from '../types';

describe('QUALITY_PRESETS', () => {
  it('defines all five valid and bounded quality presets', () => {
    const presets: QualityPreset[] = ['performance', 'balanced', 'quality', 'ultra', 'max'];
    for (const p of presets) {
      expect(QUALITY_PRESETS[p]).toBeDefined();
      expect(QUALITY_PRESETS[p].analysisWidth).toBeGreaterThan(0);
      expect(QUALITY_PRESETS[p].analysisHeight).toBeGreaterThan(0);
      expect(QUALITY_PRESETS[p].particleDensity).toBeGreaterThan(0);
      expect(QUALITY_PRESETS[p].particleSize).toBeGreaterThan(0);
      expect(QUALITY_PRESETS[p].maxDevicePixelRatio).toBeGreaterThan(0);
      expect(QUALITY_PRESETS[p].analysisWidth * QUALITY_PRESETS[p].analysisHeight).toBeLessThanOrEqual(800 * 600);
    }
  });

  it('maintains hierarchical resolution scaling', () => {
    expect(QUALITY_PRESETS.performance.analysisWidth).toBeLessThan(
      QUALITY_PRESETS.balanced.analysisWidth,
    );
    expect(QUALITY_PRESETS.balanced.analysisWidth).toBeLessThan(
      QUALITY_PRESETS.quality.analysisWidth,
    );
    expect(QUALITY_PRESETS.quality.analysisWidth).toBeLessThan(
      QUALITY_PRESETS.ultra.analysisWidth,
    );
    expect(QUALITY_PRESETS.ultra.analysisWidth).toBeLessThan(
      QUALITY_PRESETS.max.analysisWidth,
    );
    expect(QUALITY_PRESETS.ultra.contourSimplify).toBeLessThan(QUALITY_PRESETS.quality.contourSimplify);
    expect(QUALITY_PRESETS.max.contourSimplify).toBeLessThan(QUALITY_PRESETS.ultra.contourSimplify);
    expect(QUALITY_PRESETS.ultra.particleGlow).toBeGreaterThan(QUALITY_PRESETS.quality.particleGlow);
    expect(QUALITY_PRESETS.max.particleGlow).toBeGreaterThan(QUALITY_PRESETS.ultra.particleGlow);
    expect(QUALITY_PRESETS.max.particleSize).toBeLessThan(QUALITY_PRESETS.ultra.particleSize);
    expect(QUALITY_PRESETS.max.maxDevicePixelRatio).toBeLessThanOrEqual(2);
  });
});

describe('AudioAnalyzer', () => {
  it('initializes with zero metrics', () => {
    const analyzer = new AudioAnalyzer();
    const metrics = analyzer.getAudioMetrics();

    expect(metrics).toEqual({
      volume: 0,
      bass: 0,
      mid: 0,
      treble: 0,
    });
    expect(analyzer.isActive()).toBe(false);
  });

  it('safely handles getFrequencyData and getWaveformData before connection', () => {
    const analyzer = new AudioAnalyzer();
    expect(analyzer.getFrequencyData()).toBeNull();
    expect(analyzer.getWaveformData()).toBeNull();
  });

  it('disposes cleanly without errors', () => {
    const analyzer = new AudioAnalyzer();
    expect(() => analyzer.dispose()).not.toThrow();
    expect(analyzer.isActive()).toBe(false);
  });
});
