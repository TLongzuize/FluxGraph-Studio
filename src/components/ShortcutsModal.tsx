/* ───────────────────────────────────────────────
   FluxGraph — ShortcutsModal component
   Accessible dialog showing keyboard shortcuts.
   ─────────────────────────────────────────────── */

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { key: 'Space', desc: 'Play / Pause video' },
  { key: '← / →', desc: 'Seek backwards / forwards 5 seconds' },
  { key: '↑ / ↓', desc: 'Adjust volume up / down' },
  { key: 'M', desc: 'Toggle mute / unmute' },
  { key: 'F', desc: 'Toggle fullscreen mode' },
  { key: '1 / 2', desc: 'Switch mode (1: Particles, 2: Contours)' },
  { key: 'S', desc: 'Toggle Settings & Tuning panel' },
  { key: 'Esc', desc: 'Close dialog / panel / exit fullscreen' },
];

export function ShortcutsModal({ isOpen, onClose }: ShortcutsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Keyboard Shortcuts"
        aria-modal="true"
      >
        <div className="modal-card__header">
          <h2 className="modal-card__title">Keyboard Shortcuts</h2>
          <button
            className="btn btn--icon btn--ghost"
            onClick={onClose}
            aria-label="Close keyboard shortcuts dialog"
            type="button"
          >
            ✕
          </button>
        </div>
        <div className="shortcuts-list">
          {SHORTCUTS.map((s) => (
            <div key={s.key} className="shortcut-row">
              <kbd className="shortcut-kbd">{s.key}</kbd>
              <span className="shortcut-desc">{s.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
