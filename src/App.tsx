/* ───────────────────────────────────────────────
   FluxGraph — Main App component
   Orchestrates media, canvas, controls, tuning panel,
   keyboard shortcuts, and application state.
   ─────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from 'react';
import { MarkGithubIcon } from '@primer/octicons-react';
import { Activity, Keyboard, Maximize, Minimize, Settings } from 'lucide-react';
import packageMetadata from '../package.json';
import { CanvasDisplay } from './components/Canvas';
import { AudioStudio } from './components/AudioStudio';
import { FileUpload } from './components/FileUpload';
import { MediaControls } from './components/MediaControls';
import { ModeSwitch } from './components/ModeSwitch';
import { PerfOverlay } from './components/PerfOverlay';
import { SettingsPanel } from './components/SettingsPanel';
import { ShortcutsModal } from './components/ShortcutsModal';
import { usePipeline } from './hooks/usePipeline';
import { useVideoExport } from './hooks/useVideoExport';
import { useVideoPlayback } from './hooks/useVideoPlayback';
import { QUALITY_PRESETS, type MediaError, type RenderMode } from './types';

const IS_DEV = import.meta.env.DEV;

export default function App() {
  const appRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const {
    videoRef,
    state,
    error,
    currentTime,
    duration,
    volume,
    isMuted,
    loadFile,
    pause,
    togglePlay,
    seek,
    replay,
    setVolume,
    toggleMute,
  } = useVideoPlayback();

  const [mode, setMode] = useState<RenderMode>('particles');
  const [activeSource, setActiveSource] = useState<'video' | 'audio'>('video');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isCssFullscreen, setIsCssFullscreen] = useState(false);
  const [showUpload, setShowUpload] = useState(true);
  const [showPerf, setShowPerf] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Pipeline: wires video → analyzer → renderer outside React render cycle
  const {
    onCanvasReady,
    perfStats,
    analysisConfig,
    particleConfig,
    contourConfig,
    qualityPreset,
    setAnalysisConfig,
    setParticleConfig,
    setContourConfig,
    applyPreset,
    resetDefaults,
  } = usePipeline(videoRef, state, mode);
  const {
    isExporting,
    isConverting,
    conversionProgress,
    error: exportError,
    downloadFrame,
    startVideoExport,
    stopVideoExport,
  } = useVideoExport(videoRef, canvasRef, mode);

  const handleFileSelect = useCallback(
    (file: File) => {
      stopVideoExport();
      setActiveSource('video');
      loadFile(file);
      setShowUpload(false);
    },
    [loadFile, stopVideoExport],
  );

  const handleCanvasReady = useCallback(
    (canvas: HTMLCanvasElement) => {
      canvasRef.current = canvas;
      onCanvasReady(canvas);
      // Draw initial blank state
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const dpr = Number(canvas.dataset.pixelRatio) || window.devicePixelRatio || 1;
        const w = canvas.clientWidth || canvas.width / dpr;
        const h = canvas.clientHeight || canvas.height / dpr;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
      }
    },
    [onCanvasReady],
  );

  const handleLoadFile = useCallback(() => {
    setActiveSource('video');
    setShowUpload(true);
  }, []);

  const handleSourceChange = useCallback((source: 'video' | 'audio') => {
    if (source === 'audio') {
      stopVideoExport();
      pause();
      setShowUpload(false);
      setShowSettings(false);
      setShowShortcuts(false);
    } else {
      setShowUpload(state === 'idle');
    }
    setActiveSource(source);
  }, [pause, state, stopVideoExport]);

  // Native Fullscreen API integration with fallback
  const toggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        setIsCssFullscreen(true);
        setIsFullscreen(true);
      }
      return;
    }

    if (isCssFullscreen) {
      setIsCssFullscreen(false);
      setIsFullscreen(false);
      return;
    }

    try {
      const app = appRef.current;
      if (!app) return;
      await app.requestFullscreen();
      setIsFullscreen(true);
    } catch {
      // Fallback to CSS fullscreen
      setIsCssFullscreen(true);
      setIsFullscreen((prev) => !prev);
    }
  }, [isCssFullscreen]);

  // Listen to fullscreen changes triggered externally (e.g. Esc key)
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isNativeFullscreen = Boolean(document.fullscreenElement);
      if (isNativeFullscreen) setIsCssFullscreen(false);
      setIsFullscreen(
        isNativeFullscreen || appRef.current?.classList.contains('app--fullscreen-fallback') === true,
      );
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when interacting with input elements
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      // Video hotkeys must never operate the hidden video while the audio
      // workspace is active.
      if (activeSource === 'audio') return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          if (state !== 'idle' && state !== 'loading') {
            togglePlay();
          }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seek(Math.max(0, currentTime - 5));
          break;
        case 'ArrowRight':
          e.preventDefault();
          seek(Math.min(duration, currentTime + 5));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setVolume(Math.min(1, volume + 0.1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume(Math.max(0, volume - 0.1));
          break;
        case 'KeyM':
          toggleMute();
          break;
        case 'KeyF':
          toggleFullscreen();
          break;
        case 'Digit1':
          setMode('particles');
          break;
        case 'Digit2':
          setMode('contours');
          break;
        case 'KeyS':
          setShowSettings((prev) => !prev);
          break;
        case 'Slash':
          if (e.shiftKey) {
            // '?' key
            setShowShortcuts((prev) => !prev);
          }
          break;
        case 'Escape':
          if (isCssFullscreen) {
            setIsCssFullscreen(false);
            setIsFullscreen(false);
          }
          if (showSettings) setShowSettings(false);
          if (showShortcuts) setShowShortcuts(false);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    state,
    currentTime,
    duration,
    volume,
    showSettings,
    showShortcuts,
    activeSource,
    isCssFullscreen,
    togglePlay,
    seek,
    setVolume,
    toggleMute,
    toggleFullscreen,
  ]);

  const showControls = state !== 'idle';
  const showDropZone = showUpload || state === 'idle';

  return (
    <div ref={appRef} className={`app ${isCssFullscreen ? 'app--fullscreen-fallback' : ''}`}>
      {/* Hidden video element — source of truth for media playback */}
      <video
        ref={videoRef}
        className={`hidden-video ${activeSource === 'audio' ? 'hidden-video--inactive' : ''}`}
        playsInline
        crossOrigin="anonymous"
        preload="auto"
      />

      {/* Header */}
      <header className="header">
        <div className="header__brand">
          <div className="header__logo" aria-hidden="true">
            <svg className="header__logo-mark" viewBox="0 0 40 40" fill="none">
              <path d="M7 32H33" stroke="#91f7ff" strokeOpacity="0.24" strokeWidth="1.3" strokeLinecap="round" />
              <path d="M6 24C10 24 10 13 15 13S20 27 25 27S30 12 35 12" stroke="url(#flux-mark-gradient)" strokeWidth="3.1" strokeLinecap="round" />
              <circle cx="6" cy="24" r="2.5" fill="#111b2b" stroke="#91f7ff" strokeWidth="1.5" />
              <circle cx="15" cy="13" r="2.5" fill="#111b2b" stroke="#73e9ff" strokeWidth="1.5" />
              <circle cx="25" cy="27" r="2.5" fill="#111b2b" stroke="#a99aff" strokeWidth="1.5" />
              <circle cx="35" cy="12" r="2.5" fill="#111b2b" stroke="#f2a5ff" strokeWidth="1.5" />
              <defs>
                <linearGradient id="flux-mark-gradient" x1="6" y1="24" x2="35" y2="12" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#91f7ff" />
                  <stop offset="0.55" stopColor="#73e9ff" />
                  <stop offset="1" stopColor="#f2a5ff" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div className="header__brand-copy">
            <div className="header__title-row">
              <h1 className="header__title">FluxGraph Studio</h1>
              <span className="release-version">v{packageMetadata.version}</span>
            </div>
            <span className="header__tagline">Turn Media Into Motion.</span>
          </div>
        </div>
        <div className="header-notice" role="status">
          <span className="header-notice__indicator" aria-hidden="true" />
          <span>FluxGraph Studio is in Alpha. More features are coming soon!</span>
        </div>
        <div className="header__actions">
          <div className="source-switch" role="group" aria-label="Media workspace">
            <button
              type="button"
              className={`source-switch__option ${activeSource === 'video' ? 'source-switch__option--active' : ''}`}
              aria-pressed={activeSource === 'video'}
              onClick={() => handleSourceChange('video')}
            >
              <span aria-hidden="true">▣</span><span>Video</span>
            </button>
            <button
              type="button"
              className={`source-switch__option ${activeSource === 'audio' ? 'source-switch__option--active' : ''}`}
              aria-pressed={activeSource === 'audio'}
              onClick={() => handleSourceChange('audio')}
            >
              <span aria-hidden="true">♫</span><span>Audio</span>
            </button>
          </div>

          {activeSource === 'video' && <ModeSwitch mode={mode} onChange={setMode} />}

          {/* Settings Drawer Button */}
          {activeSource === 'video' && <button
            id="btn-settings"
            className={`btn btn--ghost header-action-button ${showSettings ? 'btn--primary' : ''}`}
            onClick={() => setShowSettings((p) => !p)}
            aria-label="Toggle visual parameters"
            aria-expanded={showSettings}
            title="Visual Parameters & Tuning (S)"
            type="button"
          >
            <Settings size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>}

          {/* Keyboard Shortcuts Button */}
          {activeSource === 'video' && <button
            id="btn-shortcuts"
            className="btn btn--ghost header-action-button"
            onClick={() => setShowShortcuts((p) => !p)}
            aria-label="Keyboard shortcuts"
            aria-expanded={showShortcuts}
            title="Keyboard Shortcuts (?)"
            type="button"
          >
            <Keyboard size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>}

          {/* Dev Performance Overlay Toggle */}
          {IS_DEV && activeSource === 'video' && (
            <button
              id="btn-perf"
              className={`btn btn--ghost header-action-button ${showPerf ? 'btn--primary' : ''}`}
              onClick={() => setShowPerf((p) => !p)}
              aria-label="Toggle performance overlay"
              aria-pressed={showPerf}
              title="Toggle performance overlay"
              type="button"
            >
              <Activity size={18} strokeWidth={1.8} aria-hidden="true" />
            </button>
          )}

          <a
            className="btn btn--ghost header-action-button"
            href="https://github.com/TLongzuize/FluxGraph-Studio"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open FluxGraph Studio repository on GitHub"
            title="View source on GitHub"
          >
            <MarkGithubIcon size={18} aria-hidden="true" />
          </a>

          {/* Fullscreen Button */}
          <button
            id="btn-fullscreen"
            className="btn btn--ghost header-action-button"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            title={isFullscreen ? 'Exit fullscreen (F)' : 'Enter fullscreen (F)'}
            type="button"
          >
            {isFullscreen ? <Minimize size={18} strokeWidth={1.8} aria-hidden="true" /> : <Maximize size={18} strokeWidth={1.8} aria-hidden="true" />}
          </button>
        </div>
      </header>

      {/* Canvas Area */}
      {activeSource === 'video' && (
        <div className="video-workspace">
          <CanvasDisplay
            maxDevicePixelRatio={QUALITY_PRESETS[qualityPreset].maxDevicePixelRatio}
            onCanvasReady={handleCanvasReady}
          />
          {state !== 'idle' && (
            <div className="video-workspace-label">
              <span className="eyebrow">VIDEO WORKSPACE</span>
              <strong>{mode === 'particles' ? 'Particle field' : 'Contour study'}</strong>
              <span>{qualityPreset.toUpperCase()} DETAIL</span>
            </div>
          )}
          <FileUpload onFileSelect={handleFileSelect} visible={showDropZone} />
        </div>
      )}

      <AudioStudio active={activeSource === 'audio'} onSwitchToVideo={() => handleSourceChange('video')} />

      {/* Performance Overlay (dev only) */}
      {activeSource === 'video' && <PerfOverlay stats={perfStats} visible={showPerf && state === 'playing'} />}

      {/* Settings Panel */}
      {activeSource === 'video' && <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        mode={mode}
        qualityPreset={qualityPreset}
        analysisConfig={analysisConfig}
        particleConfig={particleConfig}
        contourConfig={contourConfig}
        onUpdateAnalysis={setAnalysisConfig}
        onUpdateParticle={setParticleConfig}
        onUpdateContour={setContourConfig}
        onApplyPreset={applyPreset}
        onResetDefaults={resetDefaults}
      />}

      {/* Shortcuts Modal */}
      {activeSource === 'video' && <ShortcutsModal
        isOpen={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />}

      {/* Loading Indicator */}
      {activeSource === 'video' && state === 'loading' && (
        <div className="loading-indicator" aria-live="polite">
          <div className="loading-spinner" />
        </div>
      )}

      {/* Error Banner */}
      {activeSource === 'video' && error && <ErrorBanner error={error} />}

      {/* Media Controls */}
      {activeSource === 'video' && showControls && (
        <MediaControls
          state={state}
          currentTime={currentTime}
          duration={duration}
          volume={volume}
          isMuted={isMuted}
          onTogglePlay={togglePlay}
          onSeek={seek}
          onReplay={replay}
          onVolumeChange={setVolume}
          onToggleMute={toggleMute}
          onLoadFile={handleLoadFile}
          isExporting={isExporting}
          isConverting={isConverting}
          conversionProgress={conversionProgress}
          exportError={exportError}
          onDownloadFrame={downloadFrame}
          onStartVideoExport={startVideoExport}
          onStopVideoExport={stopVideoExport}
        />
      )}

    </div>
  );
}

/* ── Error Banner sub-component ── */
function ErrorBanner({ error }: { error: MediaError }) {
  return (
    <div className="error-banner" role="alert">
      <div className="error-banner__title">⚠ {error.message}</div>
      <div className="error-banner__message">{error.actionable}</div>
    </div>
  );
}
