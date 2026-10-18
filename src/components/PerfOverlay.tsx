/* ───────────────────────────────────────────────
   FluxGraph — PerfOverlay component
   Development-only performance statistics overlay.
   Shows FPS, frame analysis time, render time,
   analysis resolution, and particle count.
   ─────────────────────────────────────────────── */

import type { PerfStats } from '../types';

interface PerfOverlayProps {
  stats: PerfStats;
  visible: boolean;
}

export function PerfOverlay({ stats, visible }: PerfOverlayProps) {
  if (!visible) return null;

  return (
    <div className="perf-overlay" id="perf-overlay">
      <div className="perf-overlay__row">
        <span className="perf-overlay__label">FPS</span>
        <span className="perf-overlay__value">{stats.fps}</span>
      </div>
      <div className="perf-overlay__row">
        <span className="perf-overlay__label">Frame</span>
        <span className="perf-overlay__value">{stats.frameTime.toFixed(1)} ms</span>
      </div>
      <div className="perf-overlay__row">
        <span className="perf-overlay__label">Analysis</span>
        <span className="perf-overlay__value">{stats.analysisTime.toFixed(1)} ms</span>
      </div>
      <div className="perf-overlay__row">
        <span className="perf-overlay__label">Render</span>
        <span className="perf-overlay__value">{stats.renderTime.toFixed(1)} ms</span>
      </div>
      <div className="perf-overlay__row">
        <span className="perf-overlay__label">Resolution</span>
        <span className="perf-overlay__value">{stats.analysisResolution}</span>
      </div>
      <div className="perf-overlay__row">
        <span className="perf-overlay__label">Particles</span>
        <span className="perf-overlay__value">{stats.particleCount.toLocaleString()}</span>
      </div>
      {stats.contourCount > 0 && (
        <div className="perf-overlay__row">
          <span className="perf-overlay__label">Contours</span>
          <span className="perf-overlay__value">{stats.contourCount}</span>
        </div>
      )}
      {stats.audioActive && (
        <div className="perf-overlay__row">
          <span className="perf-overlay__label">Audio</span>
          <span className="perf-overlay__value">⚡ {stats.audioLevel}%</span>
        </div>
      )}
    </div>
  );
}
