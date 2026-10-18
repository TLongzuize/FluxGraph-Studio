import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioAnalyzer } from '../modules/audio';
import {
  DEFAULT_XY_SETTINGS,
  deriveXYParameters,
  renderAudioVisualization,
  type AudioPalette,
  type AudioVisualizationMode,
  type XYMapping,
  type XYParameters,
  type XYSettings,
} from '../modules/audio/audioVisualizers';
import type { AudioMetrics } from '../types';

interface AudioStudioProps {
  active: boolean;
  onSwitchToVideo: () => void;
}

interface TrackInfo {
  name: string;
  url: string;
  size: number;
}

interface EquationSnapshot {
  params: XYParameters;
  metrics: AudioMetrics;
}

const VISUALIZATIONS: { id: AudioVisualizationMode; label: string; note: string }[] = [
  { id: 'spectrum', label: 'Spectrum Bars', note: 'Frequency energy' },
  { id: 'waveform', label: 'Waveform', note: 'Time-domain signal' },
  { id: 'radial', label: 'Radial Spectrum', note: 'Circular frequency field' },
  { id: 'xy', label: 'XY Math Motion', note: 'Signal → mathematics' },
];

const PALETTES: { id: AudioPalette; label: string; colors: string[] }[] = [
  { id: 'aurora', label: 'Aurora', colors: ['#65f7ff', '#8b83ff', '#ff7bdd'] },
  { id: 'violet', label: 'Violet', colors: ['#bda0ff', '#7d6bff', '#69d7ff'] },
  { id: 'ember', label: 'Ember', colors: ['#ffd08c', '#ff8274', '#e66cff'] },
  { id: 'mono', label: 'Monochrome', colors: ['#ffffff', '#bcc7dd', '#7184a5'] },
];

const ZERO_METRICS: AudioMetrics = { volume: 0, bass: 0, mid: 0, treble: 0 };
const ZERO_FREQUENCY = new Uint8Array(128);
const MAX_AUDIO_CANVAS_PIXELS = 6_000_000;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  suffix = '',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="audio-control">
      <span className="audio-control__heading">
        <span>{label}</span>
        <output>{Number.isInteger(step) ? value : value.toFixed(1)}{suffix}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="settings-slider"
      />
    </label>
  );
}

export function AudioStudio({ active, onSwitchToVideo }: AudioStudioProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const analyzerRef = useRef<AudioAnalyzer | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const modeRef = useRef<AudioVisualizationMode>('xy');
  const settingsRef = useRef<XYSettings>(DEFAULT_XY_SETTINGS);
  const metricsRef = useRef<AudioMetrics>({ ...ZERO_METRICS });
  const waveformRef = useRef<Float32Array | null>(null);
  const lastDrawRef = useRef<(() => void) | null>(null);
  const scheduledDrawRef = useRef<number | null>(null);
  const lastEquationUiUpdateRef = useRef(0);

  // Coalesce one-shot redraw requests and make them cancellable on unmount.
  const scheduleDraw = useCallback(() => {
    if (scheduledDrawRef.current !== null) return;
    scheduledDrawRef.current = requestAnimationFrame(() => {
      scheduledDrawRef.current = null;
      lastDrawRef.current?.();
    });
  }, []);
  const [track, setTrack] = useState<TrackInfo | null>(null);
  const [mode, setMode] = useState<AudioVisualizationMode>('xy');
  const [settings, setSettings] = useState<XYSettings>(DEFAULT_XY_SETTINGS);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.82);
  const [isMuted, setIsMuted] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [equation, setEquation] = useState<EquationSnapshot>({
    params: deriveXYParameters(ZERO_METRICS, DEFAULT_XY_SETTINGS, 0),
    metrics: { ...ZERO_METRICS },
  });

  modeRef.current = mode;
  settingsRef.current = settings;

  const patchSettings = useCallback((patch: Partial<XYSettings>) => {
    setSettings((previous) => ({ ...previous, ...patch }));
  }, []);

  const drawCurrentFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    const analyzer = analyzerRef.current;
    if (!canvas || !audio) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width <= 0 || height <= 0) return;

    const liveSettings = settingsRef.current;
    const rawFrequency = analyzer?.getFrequencyData() ?? ZERO_FREQUENCY;
    const rawWaveform = analyzer?.getWaveformData();
    const rawMetrics = analyzer?.getAudioMetrics() ?? ZERO_METRICS;
    let waveform = waveformRef.current;
    if (!rawWaveform) {
      waveform = waveform ?? new Float32Array(256);
      waveform.fill(0);
      waveformRef.current = waveform;
    } else {
      if (!waveform || waveform.length !== rawWaveform.length) {
        waveform = new Float32Array(rawWaveform.length);
        waveformRef.current = waveform;
      }
      const smoothingAlpha = 1 - clamp(liveSettings.smoothing, 0, 0.92) * 0.88;
      for (let i = 0; i < rawWaveform.length; i++) {
        const target = (rawWaveform[i] - 128) / 128;
        waveform[i] += (target - waveform[i]) * smoothingAlpha;
      }
    }

    const smoothed = metricsRef.current;
    const metricAlpha = 1 - clamp(liveSettings.smoothing, 0, 0.92) * 0.82;
    smoothed.volume += (rawMetrics.volume - smoothed.volume) * metricAlpha;
    smoothed.bass += (rawMetrics.bass - smoothed.bass) * metricAlpha;
    smoothed.mid += (rawMetrics.mid - smoothed.mid) * metricAlpha;
    smoothed.treble += (rawMetrics.treble - smoothed.treble) * metricAlpha;

    renderAudioVisualization({
      ctx,
      width,
      height,
      mode: modeRef.current,
      frequency: rawFrequency,
      waveform: waveform ?? new Float32Array(0),
      metrics: smoothed,
      settings: liveSettings,
      currentTime: audio.currentTime || 0,
    });

    const now = performance.now();
    if (now - lastEquationUiUpdateRef.current >= 125 || audio.paused) {
      const params = deriveXYParameters(smoothed, liveSettings, audio.currentTime || 0);
      setEquation({ params, metrics: { ...smoothed } });
      lastEquationUiUpdateRef.current = now;
    }
  }, []);

  lastDrawRef.current = drawCurrentFrame;

  // The media element and AudioAnalyzer are stable across source/mode switches;
  // replacement updates only the object URL, avoiding duplicate AudioContexts.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const analyzer = new AudioAnalyzer();
    analyzerRef.current = analyzer;
    analyzer.connect(audio);

    const onLoadedMetadata = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
      setCurrentTime(Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
      setIsReady(true);
      setError(null);
      scheduleDraw();
    };
    const onTimeUpdate = () => setCurrentTime(Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(Number.isFinite(audio.duration) ? audio.duration : audio.currentTime);
    };
    const onCanPlay = () => {
      setIsReady(true);
      setError(null);
    };
    const onError = () => {
      setIsReady(false);
      setIsPlaying(false);
      const code = audio.error?.code;
      setError(code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
        ? 'This audio format is not supported by this browser. Try MP3 or WAV.'
        : 'The audio file could not be decoded. Try another local file.');
    };

    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('error', onError);

    return () => {
      if (scheduledDrawRef.current !== null) {
        cancelAnimationFrame(scheduledDrawRef.current);
        scheduledDrawRef.current = null;
      }
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('error', onError);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      analyzer.dispose();
      if (analyzerRef.current === analyzer) analyzerRef.current = null;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    };
  }, [scheduleDraw]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = clamp(volume, 0, 1);
    audio.muted = isMuted;
  }, [volume, isMuted]);

  useEffect(() => {
    if (!active && audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
    }
  }, [active]);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;
    const resize = () => {
      const rect = stage.getBoundingClientRect();
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);
      if (width < 1 || height < 1) return;
      const deviceDpr = window.devicePixelRatio || 1;
      const pixelBudgetDpr = Math.sqrt(MAX_AUDIO_CANVAS_PIXELS / (width * height));
      const dpr = Math.min(deviceDpr, 2, pixelBudgetDpr);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const context = canvas.getContext('2d');
      context?.setTransform(dpr, 0, 0, dpr, 0, 0);
      scheduleDraw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();
    return () => observer.disconnect();
  }, [scheduleDraw]);

  // Exactly one RAF chain exists while active playback is running. Settings and
  // mode are read through refs to avoid stale closures or loop restarts.
  useEffect(() => {
    const audio = audioRef.current;
    if (!active || !isPlaying || !audio || audio.paused) {
      if (active) scheduleDraw();
      return;
    }

    let rafId = 0;
    const tick = () => {
      if (!audio.paused && !audio.ended) {
        lastDrawRef.current?.();
        rafId = requestAnimationFrame(tick);
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [active, isPlaying, scheduleDraw]);

  useEffect(() => {
    if (!isPlaying) scheduleDraw();
  }, [mode, settings, isPlaying, track, scheduleDraw]);

  const chooseFile = useCallback((file: File) => {
    const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
    const supportedExtension = ['.mp3', '.wav', '.ogg', '.oga', '.m4a', '.aac', '.flac', '.opus', '.webm'].includes(ext);
    if (!file.type.startsWith('audio/') && !supportedExtension) {
      setError('Choose an audio file such as MP3, WAV, OGG, M4A, or AAC.');
      return;
    }

    const audio = audioRef.current;
    const nextUrl = URL.createObjectURL(file);
    const previousUrl = objectUrlRef.current;
    audio?.pause();
    if (audio) {
      audio.src = nextUrl;
      audio.load();
    }
    objectUrlRef.current = nextUrl;
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    setTrack({ name: file.name, url: nextUrl, size: file.size });
    setIsReady(false);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setError(null);
    waveformRef.current = null;
    metricsRef.current = { ...ZERO_METRICS };
    scheduleDraw();
  }, [scheduleDraw]);

  const onDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) chooseFile(file);
  }, [chooseFile]);

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !track) return;
    setError(null);
    if (!audio.paused) {
      audio.pause();
      return;
    }
    if (audio.ended) audio.currentTime = 0;
    try {
      await analyzerRef.current?.resume();
      await audio.play();
    } catch (playError) {
      setError(playError instanceof Error && playError.name === 'NotAllowedError'
        ? 'Playback was blocked by the browser. Press Play again to allow audio.'
        : 'The browser could not play this file. Try another format.');
    }
  }, [track]);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = clamp(time, 0, audio.duration);
    setCurrentTime(audio.currentTime);
    scheduleDraw();
  }, [scheduleDraw]);

  const onDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);
  const onDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.currentTarget === event.target) setIsDragging(false);
  }, []);

  const eq = equation.params;
  const level = Math.round(equation.metrics.volume * 100);

  return (
    <section
      className={`audio-studio ${active ? '' : 'audio-studio--inactive'} ${isDragging ? 'audio-studio--dragging' : ''}`}
      aria-label="Audio visualization studio"
      onDrop={onDrop}
      onDragOver={onDragEnter}
      onDragLeave={onDragLeave}
      aria-hidden={!active}
    >
      <audio ref={audioRef} preload="metadata" />

      <div className="audio-studio__topline">
        <div className="audio-studio__track-meta">
          <span className="eyebrow">AUDIO WORKSPACE / LOCAL SIGNAL</span>
          <strong title={track?.name ?? 'No track selected'}>{track?.name ?? 'No track loaded'}</strong>
          <span
            className={`audio-status ${isPlaying ? 'audio-status--playing' : ''}`}
            role="status"
            aria-live="polite"
          >
            <span className="audio-status__dot" />
            {isPlaying ? 'Playing' : isReady ? 'Ready · Paused' : track ? 'Loading track…' : 'Awaiting audio'}
          </span>
        </div>
        <div className="audio-studio__top-actions">
          {track && <span className="audio-file-size">{formatBytes(track.size)}</span>}
          <button type="button" className="btn btn--ghost" onClick={() => fileInputRef.current?.click()}>
            <span aria-hidden="true">＋</span> {track ? 'Replace track' : 'Choose audio'}
          </button>
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept="audio/*,.mp3,.wav,.ogg,.oga,.m4a,.aac,.flac,.opus,.webm"
            aria-label="Choose local audio file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) chooseFile(file);
              event.target.value = '';
            }}
          />
        </div>
      </div>

      <div className="audio-studio__main">
        <div className="audio-studio__visual-column">
          <div className="audio-studio__visual-head">
            <div>
              <span className="eyebrow">LIVE RENDER / 2D CANVAS</span>
              <h2>{VISUALIZATIONS.find((item) => item.id === mode)?.label}</h2>
              <p>{mode === 'xy'
                ? 'The current waveform and frequency bands become a living mathematical curve.'
                : VISUALIZATIONS.find((item) => item.id === mode)?.note}</p>
            </div>
            <span className="signal-chip"><span className="signal-chip__pulse" /> REAL SIGNAL</span>
          </div>

          <div ref={stageRef} className="audio-visual-stage">
            <canvas ref={canvasRef} className="audio-visual-stage__canvas" aria-label={`${mode} audio visualization`} />
            {!track && (
              <div className="audio-empty-state">
                <div className="audio-empty-state__glyph" aria-hidden="true">∿</div>
                <h3>Give the signal a source.</h3>
                <p>Drop an MP3, WAV, OGG, M4A, or AAC file here. Analysis stays in your browser.</p>
                <button type="button" className="btn btn--primary" onClick={() => fileInputRef.current?.click()}>
                  Choose local audio
                </button>
              </div>
            )}
            {isDragging && <div className="audio-drop-indicator">Release to load audio</div>}
          </div>

          {mode === 'xy' && (
            <div className="xy-equations" aria-live="off">
              <div className="xy-equations__heading">
                <div>
                  <span className="eyebrow">ACTIVE TRANSFORM</span>
                  <h3>Mathematical readout</h3>
                </div>
                <span className="xy-equations__level">SIGNAL {level}%</span>
              </div>
              {settings.mapping === 'signal' ? (
                <div className="equation-stack">
                  <p className="equation-line"><span className="equation-line__label">x[n]</span><span>= s[n]</span></p>
                  <p className="equation-line"><span className="equation-line__label">y[n]</span><span>= s[(n + Δ) mod N]</span></p>
                  <div className="equation-footnote">s[n] is the normalized mono-compatible waveform · Δ = {eq.delta} samples · N = {waveformRef.current?.length ?? 256}</div>
                </div>
              ) : (
                <div className="equation-stack">
                  <p className="equation-line"><span className="equation-line__label">x(t)</span><span>= {eq.amplitudeX.toFixed(2)} sin({eq.frequencyX.toFixed(2)}t + {eq.phaseX.toFixed(2)})</span></p>
                  <p className="equation-line"><span className="equation-line__label">y(t)</span><span>= {eq.amplitudeY.toFixed(2)} sin({eq.frequencyY.toFixed(2)}t + {eq.phaseY.toFixed(2)})</span></p>
                  <div className="equation-footnote">Amplitude follows bass / treble · frequency ratios follow mid / treble · phase advances only with measured signal energy</div>
                </div>
              )}
              <div className="band-readouts">
                {(() => {
                  const colors = PALETTES.find((palette) => palette.id === settings.palette)?.colors ?? PALETTES[0].colors;
                  return ([
                    ['Bass', equation.metrics.bass, colors[0]],
                    ['Mid', equation.metrics.mid, colors[1]],
                    ['Treble', equation.metrics.treble, colors[2]],
                  ] as [string, number, string][]).map(([label, value, color]) => (
                    <div className="band-readout" key={label}>
                      <div className="band-readout__heading"><span>{label}</span><span>{Math.round(value * 100)}%</span></div>
                      <div className="band-readout__track"><span style={{ width: `${clamp(value * 100, 0, 100)}%`, background: color }} /></div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          )}
        </div>

        <aside className="audio-studio__sidebar" aria-label="Audio visualization controls">
          <div className="audio-sidebar-section">
            <div className="audio-sidebar-section__heading"><span className="eyebrow">01 / RENDER MODE</span><span className="section-count">04 MODES</span></div>
            <div className="audio-mode-list">
              {VISUALIZATIONS.map((visualization, index) => (
                <button
                  key={visualization.id}
                  type="button"
                  className={`audio-mode-card ${mode === visualization.id ? 'audio-mode-card--active' : ''}`}
                  onClick={() => setMode(visualization.id)}
                  aria-pressed={mode === visualization.id}
                >
                  <span className={`audio-mode-card__icon audio-mode-card__icon--${visualization.id}`} aria-hidden="true">
                    {visualization.id === 'spectrum' ? '▥' : visualization.id === 'waveform' ? '∿' : visualization.id === 'radial' ? '◉' : '⌘'}
                  </span>
                  <span className="audio-mode-card__copy"><strong>{visualization.label}</strong><small>{visualization.note}</small></span>
                  <span className="audio-mode-card__index">0{index + 1}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="audio-sidebar-section audio-sidebar-section--settings">
            <div className="audio-sidebar-section__heading"><span className="eyebrow">02 / SIGNAL SHAPING</span></div>
            {mode === 'xy' && (
              <>
                <div className="audio-control">
                  <span className="audio-control__heading"><span>Curve mapping</span></span>
                  <div className="segmented-switch" role="group" aria-label="XY curve mapping">
                    <button type="button" aria-pressed={settings.mapping === 'signal'} className={settings.mapping === 'signal' ? 'is-active' : ''} onClick={() => patchSettings({ mapping: 'signal' as XYMapping })}>Waveform XY</button>
                    <button type="button" aria-pressed={settings.mapping === 'parametric'} className={settings.mapping === 'parametric' ? 'is-active' : ''} onClick={() => patchSettings({ mapping: 'parametric' as XYMapping })}>Parametric</button>
                  </div>
                </div>
                <RangeControl label="Curve density" value={settings.sampleCount} min={80} max={720} step={16} suffix=" pts" onChange={(sampleCount) => patchSettings({ sampleCount: Math.round(sampleCount) })} />
                <RangeControl label="Sensitivity" value={settings.sensitivity} min={0.2} max={2.5} step={0.1} suffix="×" onChange={(sensitivity) => patchSettings({ sensitivity })} />
                <RangeControl label="Frequency influence" value={settings.frequencyInfluence} min={0} max={2} step={0.1} onChange={(frequencyInfluence) => patchSettings({ frequencyInfluence })} />
                <RangeControl label="Smoothing" value={settings.smoothing} min={0} max={0.92} step={0.04} onChange={(smoothing) => patchSettings({ smoothing })} />
                <RangeControl label="Trail persistence" value={settings.trailPersistence} min={0} max={0.9} step={0.05} onChange={(trailPersistence) => patchSettings({ trailPersistence })} />
                <RangeControl label="Line width" value={settings.lineWidth} min={0.6} max={4} step={0.2} suffix=" px" onChange={(lineWidth) => patchSettings({ lineWidth })} />
                <RangeControl label="Glow" value={settings.glow} min={0} max={1} step={0.05} onChange={(glow) => patchSettings({ glow })} />
                <div className="audio-control">
                  <span className="audio-control__heading"><span>Palette</span><output>{PALETTES.find((palette) => palette.id === settings.palette)?.label}</output></span>
                  <div className="audio-palette-list">
                    {PALETTES.map((palette) => (
                      <button
                        key={palette.id}
                        type="button"
                        className={`audio-palette-swatch ${settings.palette === palette.id ? 'audio-palette-swatch--active' : ''}`}
                        aria-label={`${palette.label} palette`}
                        aria-pressed={settings.palette === palette.id}
                        title={palette.label}
                        onClick={() => patchSettings({ palette: palette.id })}
                      >
                        <span>{palette.colors.map((color) => <i key={color} style={{ background: color }} />)}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="audio-toggle-row">
                  <label htmlFor="xy-show-axes">Coordinate axes</label>
                  <input id="xy-show-axes" type="checkbox" checked={settings.showAxes} onChange={(event) => patchSettings({ showAxes: event.target.checked })} />
                </div>
                <div className="audio-toggle-row">
                  <label htmlFor="xy-show-grid">Coordinate grid</label>
                  <input id="xy-show-grid" type="checkbox" checked={settings.showGrid} onChange={(event) => patchSettings({ showGrid: event.target.checked })} />
                </div>
              </>
            )}
            {mode !== 'xy' && (
              <div className="audio-mode-note">
                <span aria-hidden="true">↗</span>
                <p>Choose <strong>XY Math Motion</strong> to shape the Cartesian curve, map frequency bands, and read the live equations.</p>
              </div>
            )}
          </div>
          <div className="audio-sidebar-footer"><span>LOCAL ANALYSIS</span><span>WEB AUDIO API</span></div>
        </aside>
      </div>

      {error && <div className="audio-error" role="alert"><strong>Audio issue</strong><span>{error}</span></div>}

      <div className="audio-transport">
        <div className="audio-transport__timeline">
          <span>{formatTime(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={Math.max(duration, 0.01)}
            step={0.01}
            value={Math.min(currentTime, duration || 0)}
            disabled={!track || !duration}
            onChange={(event) => seek(Number(event.target.value))}
            aria-label="Audio playback position"
          />
          <span>{formatTime(duration)}</span>
        </div>
        <div className="audio-transport__row">
          <div className="audio-transport__identity">
            <div className={`audio-disc ${isPlaying ? 'audio-disc--playing' : ''}`} aria-hidden="true"><span>FG</span></div>
            <div><strong>{track?.name ?? 'No audio selected'}</strong><small>{track ? (isReady ? 'Browser-decoded audio' : 'Preparing local file') : 'Your files never leave this device'}</small></div>
          </div>
          <div className="audio-transport__center">
            <button type="button" className="btn btn--icon btn--ghost" onClick={() => seek(0)} disabled={!track} aria-label="Restart audio" title="Restart">↺</button>
            <button type="button" className="audio-play-button" onClick={togglePlayback} disabled={!track || !isReady} aria-label={isPlaying ? 'Pause audio' : 'Play audio'} title={isPlaying ? 'Pause' : 'Play'}>
              {isPlaying ? 'Ⅱ' : '▶'}
            </button>
            <button type="button" className="btn btn--icon btn--ghost" onClick={() => seek(duration)} disabled={!track || !duration} aria-label="Seek to end" title="End">↠</button>
          </div>
          <div className="audio-transport__volume">
            <button type="button" className="btn btn--icon btn--ghost" onClick={() => setIsMuted((muted) => !muted)} disabled={!track} aria-label={isMuted ? 'Unmute audio' : 'Mute audio'} title={isMuted ? 'Unmute' : 'Mute'}>{isMuted || volume === 0 ? '⌁' : '♫'}</button>
            <input type="range" min={0} max={1} step={0.01} value={isMuted ? 0 : volume} disabled={!track} onChange={(event) => setVolume(Number(event.target.value))} aria-label="Audio volume" />
            <button type="button" className="btn btn--ghost audio-video-return" onClick={onSwitchToVideo}>Video studio ↗</button>
          </div>
        </div>
      </div>
    </section>
  );
}
