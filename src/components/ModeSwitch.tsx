/* ───────────────────────────────────────────────
   FluxGraph — ModeSwitch component
   Toggle between Particles and Contours
   ─────────────────────────────────────────────── */

import type { RenderMode } from '../types';

interface ModeSwitchProps {
  mode: RenderMode;
  onChange: (mode: RenderMode) => void;
}

export function ModeSwitch({ mode, onChange }: ModeSwitchProps) {
  return (
    <div className="mode-switch" role="radiogroup" aria-label="Visualization mode">
      <button
        id="mode-particles"
        className={`mode-switch__option ${mode === 'particles' ? 'mode-switch__option--active' : ''}`}
        role="radio"
        aria-checked={mode === 'particles'}
        onClick={() => onChange('particles')}
        type="button"
      >
        ● Particles
      </button>
      <button
        id="mode-contours"
        className={`mode-switch__option ${mode === 'contours' ? 'mode-switch__option--active' : ''}`}
        role="radio"
        aria-checked={mode === 'contours'}
        onClick={() => onChange('contours')}
        type="button"
      >
        ◌ Contours
      </button>
    </div>
  );
}
