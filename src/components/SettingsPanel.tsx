/* ───────────────────────────────────────────────
   FluxGraph — Settings & Tuning Panel
   Allows tuning analysis threshold, visual parameters,
   color palettes, quality presets, and audio reactivity.
   ─────────────────────────────────────────────── */

import type {
  AnalysisConfig,
  ContourConfig,
  ParticleConfig,
  QualityPreset,
  RenderMode,
} from '../types';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  mode: RenderMode;
  qualityPreset: QualityPreset;
  analysisConfig: AnalysisConfig;
  particleConfig: ParticleConfig;
  contourConfig: ContourConfig;
  onUpdateAnalysis: (config: Partial<AnalysisConfig>) => void;
  onUpdateParticle: (config: Partial<ParticleConfig>) => void;
  onUpdateContour: (config: Partial<ContourConfig>) => void;
  onApplyPreset: (preset: QualityPreset) => void;
  onResetDefaults: () => void;
}

const PRESET_OPTIONS: { id: QualityPreset; label: string; icon: string; desc: string }[] = [
  { id: 'performance', label: 'Speed', icon: '↯', desc: '160×120 · DPR 1×' },
  { id: 'balanced', label: 'Balanced', icon: '◈', desc: '320×240 · DPR 1.25×' },
  { id: 'quality', label: 'Quality', icon: '✧', desc: '480×360 · DPR 1.5×' },
  { id: 'ultra', label: 'Ultra', icon: '✳', desc: '640×480 · fine detail' },
  { id: 'max', label: 'Max', icon: '✦', desc: '800×600 · bounded peak' },
];

const COLOR_PALETTE = [
  { label: 'Cyan', color: '#00e5ff' },
  { label: 'Violet', color: '#a855f7' },
  { label: 'Emerald', color: '#00ff88' },
  { label: 'Magenta', color: '#ff007f' },
  { label: 'Amber', color: '#ff9100' },
  { label: 'White', color: '#ffffff' },
  { label: 'Red', color: '#ff3b30' },
  { label: 'Blue', color: '#168cff' },
  { label: 'Yellow', color: '#ffe600' },
  { label: 'Orange', color: '#ff5e00' },
  { label: 'Lime', color: '#b7ff00' },
  { label: 'Pink', color: '#ff5cab' },
];

function colorToRgb(color: string): [number, number, number] {
  const hex = /^#[\da-f]{6}$/i.test(color) ? color.slice(1) : '000000';
  return [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16)) as [number, number, number];
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function ColorPicker({ color, onChange }: { color: string; onChange: (color: string) => void }) {
  const rgb = colorToRgb(color);
  const channels = ['R', 'G', 'B'] as const;

  return (
    <div className="custom-color">
      <div className="custom-color__picker-row">
        <label className="control-label" htmlFor="custom-video-color">Custom RGB</label>
        <input
          id="custom-video-color"
          type="color"
          value={/^#[\da-f]{6}$/i.test(color) ? color : '#000000'}
          onChange={(event) => onChange(event.target.value)}
          className="custom-color__native"
          aria-label="Choose custom video color"
        />
        <output className="custom-color__hex">{color.toUpperCase()}</output>
      </div>
      <div className="rgb-inputs">
        {channels.map((channel, index) => (
          <label className="rgb-channel" key={channel}>
            <span>{channel}</span>
            <input
              type="number"
              min="0"
              max="255"
              step="1"
              value={rgb[index]}
              onChange={(event) => {
                const nextRgb: [number, number, number] = [...rgb];
                nextRgb[index] = Math.max(0, Math.min(255, Number(event.target.value) || 0));
                onChange(rgbToHex(nextRgb));
              }}
              aria-label={`${channel} color value`}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

export function SettingsPanel({
  isOpen,
  onClose,
  mode,
  qualityPreset,
  analysisConfig,
  particleConfig,
  contourConfig,
  onUpdateAnalysis,
  onUpdateParticle,
  onUpdateContour,
  onApplyPreset,
  onResetDefaults,
}: SettingsPanelProps) {
  if (!isOpen) return null;

  return (
    <aside
      className="settings-drawer"
      aria-label="Visualization Settings"
      role="dialog"
      aria-modal="true"
    >
      <div className="settings-drawer__header">
        <div className="settings-drawer__title-wrap">
          <span className="settings-drawer__icon">⚙</span>
          <h2 className="settings-drawer__title">Visual Parameters</h2>
        </div>
        <button
          className="btn btn--icon btn--ghost"
          onClick={onClose}
          aria-label="Close settings"
          title="Close settings (Esc)"
          type="button"
        >
          ✕
        </button>
      </div>

      <div className="settings-drawer__content">
        {/* Quality Presets */}
        <section className="settings-section">
          <label className="settings-section__title">Video detail profile</label>
          <p className="control-hint">Higher profiles increase analysis resolution and canvas detail. Max is capped to protect memory.</p>
          <div className="preset-grid preset-grid--five">
            {PRESET_OPTIONS.map((p) => (
              <button
                key={p.id}
                className={`preset-card ${qualityPreset === p.id ? 'preset-card--active' : ''}`}
                onClick={() => onApplyPreset(p.id)}
                type="button"
                title={p.desc}
                aria-pressed={qualityPreset === p.id}
              >
                <span className="preset-card__icon">{p.icon}</span>
                <span className="preset-card__label">{p.label}</span>
                <span className="preset-card__desc">{p.desc}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Global Frame Analysis */}
        <section className="settings-section">
          <label className="settings-section__title">Analysis & Binarization</label>
          <div className="control-group">
            <div className="control-group__header">
              <span className="control-label">Mask Threshold</span>
              <span className="control-value">{analysisConfig.threshold}</span>
            </div>
            <input
              type="range"
              min="10"
              max="245"
              step="1"
              value={analysisConfig.threshold}
              onChange={(e) => onUpdateAnalysis({ threshold: Number(e.target.value) })}
              className="settings-slider"
              aria-label="Mask Threshold"
            />
            <span className="control-hint">
              Controls contrast cutoff for separating foreground from background.
            </span>
          </div>
        </section>

        {/* Audio Reactivity */}
        <section className="settings-section">
          <label className="settings-section__title">Audio Reactivity</label>
          <div className="toggle-row">
            <span className="control-label">Enable Audio Reactivity</span>
            <input
              type="checkbox"
              checked={
                mode === 'particles'
                  ? (particleConfig.audioReactive ?? true)
                  : (contourConfig.audioReactive ?? true)
              }
              onChange={(e) => {
                const checked = e.target.checked;
                if (mode === 'particles') {
                  onUpdateParticle({ audioReactive: checked });
                } else {
                  onUpdateContour({ audioReactive: checked });
                }
              }}
              className="settings-checkbox"
              id="toggle-audio-reactive"
            />
          </div>

          <div className="control-group" style={{ marginTop: 'var(--space-2)' }}>
            <div className="control-group__header">
              <span className="control-label">Beat Sensitivity</span>
              <span className="control-value">
                {(
                  (mode === 'particles'
                    ? particleConfig.audioSensitivity
                    : contourConfig.audioSensitivity) ?? 1.0
                ).toFixed(1)}
                x
              </span>
            </div>
            <input
              type="range"
              min="0.2"
              max="2.5"
              step="0.1"
              value={
                (mode === 'particles'
                  ? particleConfig.audioSensitivity
                  : contourConfig.audioSensitivity) ?? 1.0
              }
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (mode === 'particles') {
                  onUpdateParticle({ audioSensitivity: val });
                } else {
                  onUpdateContour({ audioSensitivity: val });
                }
              }}
              className="settings-slider"
              aria-label="Beat Sensitivity"
            />
          </div>
        </section>

        {/* Mode Specific: Particles */}
        {mode === 'particles' && (
          <section className="settings-section">
            <label className="settings-section__title">Particle Styling</label>

            {/* Color Palette */}
            <div className="control-group">
              <span className="control-label">Color Theme</span>
              <div className="color-palette">
                <button
                  className={`color-swatch color-swatch--white ${particleConfig.color === '#ffffff' ? 'color-swatch--active' : ''}`}
                  onClick={() => onUpdateParticle({ color: '#ffffff' })}
                  title="Pure white (#FFFFFF)"
                  type="button"
                  aria-label="Select pure white color"
                  aria-pressed={particleConfig.color === '#ffffff'}
                />
                {COLOR_PALETTE.filter((color) => color.color !== '#ffffff').map((c) => (
                  <button
                    key={c.color}
                    className={`color-swatch ${particleConfig.color === c.color ? 'color-swatch--active' : ''}`}
                    style={{ backgroundColor: c.color }}
                    onClick={() => onUpdateParticle({ color: c.color })}
                    title={c.label}
                    type="button"
                    aria-label={`Select ${c.label} color`}
                  />
                ))}
              </div>
              <ColorPicker color={particleConfig.color} onChange={(color) => onUpdateParticle({ color })} />
            </div>

            {/* Density */}
            <div className="control-group">
              <div className="control-group__header">
                <span className="control-label">Density</span>
                <span className="control-value">{particleConfig.density.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.2"
                max="1.2"
                step="0.05"
                value={particleConfig.density}
                onChange={(e) => onUpdateParticle({ density: parseFloat(e.target.value) })}
                className="settings-slider"
                aria-label="Particle Density"
              />
            </div>

            {/* Size */}
            <div className="control-group">
              <div className="control-group__header">
                <span className="control-label">Particle Radius</span>
                <span className="control-value">{particleConfig.size.toFixed(1)} px</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="4.0"
                step="0.25"
                value={particleConfig.size}
                onChange={(e) => onUpdateParticle({ size: parseFloat(e.target.value) })}
                className="settings-slider"
                aria-label="Particle Radius"
              />
            </div>

            {/* Glow */}
            <div className="control-group">
              <div className="control-group__header">
                <span className="control-label">Glow Intensity</span>
                <span className="control-value">{Math.round(particleConfig.glow * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={particleConfig.glow}
                onChange={(e) => onUpdateParticle({ glow: parseFloat(e.target.value) })}
                className="settings-slider"
                aria-label="Glow Intensity"
              />
            </div>

            {/* Trails */}
            <div className="control-group">
              <div className="control-group__header">
                <span className="control-label">Motion Trails</span>
                <span className="control-value">{Math.round(particleConfig.trails * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="0.8"
                step="0.05"
                value={particleConfig.trails}
                onChange={(e) => onUpdateParticle({ trails: parseFloat(e.target.value) })}
                className="settings-slider"
                aria-label="Motion Trails"
              />
            </div>

            {/* Stable Placement Toggle */}
            <div className="toggle-row">
              <span className="control-label">Stable Grid Placement</span>
              <input
                type="checkbox"
                checked={particleConfig.stablePlacement}
                onChange={(e) => onUpdateParticle({ stablePlacement: e.target.checked })}
                className="settings-checkbox"
                id="toggle-stable-placement"
              />
            </div>
          </section>
        )}

        {/* Mode Specific: Contours */}
        {mode === 'contours' && (
          <section className="settings-section">
            <label className="settings-section__title">Contour Styling</label>

            {/* Color Palette */}
            <div className="control-group">
              <span className="control-label">Color Theme</span>
              <div className="color-palette">
                <button
                  className={`color-swatch color-swatch--white ${contourConfig.color === '#ffffff' ? 'color-swatch--active' : ''}`}
                  onClick={() => onUpdateContour({ color: '#ffffff' })}
                  title="Pure white (#FFFFFF)"
                  type="button"
                  aria-label="Select pure white color"
                  aria-pressed={contourConfig.color === '#ffffff'}
                />
                {COLOR_PALETTE.filter((color) => color.color !== '#ffffff').map((c) => (
                  <button
                    key={c.color}
                    className={`color-swatch ${contourConfig.color === c.color ? 'color-swatch--active' : ''}`}
                    style={{ backgroundColor: c.color }}
                    onClick={() => onUpdateContour({ color: c.color })}
                    title={c.label}
                    type="button"
                    aria-label={`Select ${c.label} color`}
                  />
                ))}
              </div>
              <ColorPicker color={contourConfig.color} onChange={(color) => onUpdateContour({ color })} />
            </div>

            {/* Line Width */}
            <div className="control-group">
              <div className="control-group__header">
                <span className="control-label">Stroke Width</span>
                <span className="control-value">{contourConfig.lineWidth.toFixed(1)} px</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="4.0"
                step="0.25"
                value={contourConfig.lineWidth}
                onChange={(e) => onUpdateContour({ lineWidth: parseFloat(e.target.value) })}
                className="settings-slider"
                aria-label="Stroke Width"
              />
            </div>

            {/* Glow */}
            <div className="control-group">
              <div className="control-group__header">
                <span className="control-label">Glow Intensity</span>
                <span className="control-value">{Math.round(contourConfig.glow * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={contourConfig.glow}
                onChange={(e) => onUpdateContour({ glow: parseFloat(e.target.value) })}
                className="settings-slider"
                aria-label="Glow Intensity"
              />
            </div>

            {/* Smoothing */}
            <div className="control-group">
              <div className="control-group__header">
                <span className="control-label">Corner Smoothing</span>
                <span className="control-value">{Math.round(contourConfig.smoothing * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="0.9"
                step="0.05"
                value={contourConfig.smoothing}
                onChange={(e) => onUpdateContour({ smoothing: parseFloat(e.target.value) })}
                className="settings-slider"
                aria-label="Corner Smoothing"
              />
              <span className="control-hint">Chaikin subdivision algorithm for organic silhouettes.</span>
            </div>

            {/* Simplification Tolerance */}
            <div className="control-group">
              <div className="control-group__header">
                <span className="control-label">Simplification Tolerance</span>
                <span className="control-value">{contourConfig.simplifyTolerance.toFixed(1)} px</span>
              </div>
              <input
                type="range"
                min="0.2"
                max="3.0"
                step="0.1"
                value={contourConfig.simplifyTolerance}
                onChange={(e) =>
                  onUpdateContour({ simplifyTolerance: parseFloat(e.target.value) })
                }
                className="settings-slider"
                aria-label="Simplification Tolerance"
              />
              <span className="control-hint">Ramer–Douglas–Peucker reduction parameter.</span>
            </div>

            {/* Min Path Length */}
            <div className="control-group">
              <div className="control-group__header">
                <span className="control-label">Min Path Length</span>
                <span className="control-value">{contourConfig.minLength} px</span>
              </div>
              <input
                type="range"
                min="1"
                max="25"
                step="1"
                value={contourConfig.minLength}
                onChange={(e) => onUpdateContour({ minLength: parseInt(e.target.value, 10) })}
                className="settings-slider"
                aria-label="Min Path Length"
              />
              <span className="control-hint">Discards short contours and small image noise.</span>
            </div>
          </section>
        )}
      </div>

      <div className="settings-drawer__footer">
        <button
          className="btn btn--ghost btn--full"
          onClick={onResetDefaults}
          type="button"
        >
          ↺ Reset to Defaults
        </button>
      </div>
    </aside>
  );
}
