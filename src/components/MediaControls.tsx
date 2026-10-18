/* ───────────────────────────────────────────────
   FluxGraph — MediaControls component
   Timeline, play/pause, seek, volume, replay
   ─────────────────────────────────────────────── */

import { useCallback, useState } from 'react';
import { Download, Film, FolderOpen, Image as ImageIcon, Square, Volume1, Volume2, VolumeX } from 'lucide-react';
import type { VideoExportFormat } from '../hooks/useVideoExport';
import type { PlaybackState } from '../types';

interface MediaControlsProps {
  state: PlaybackState;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onReplay: () => void;
  onVolumeChange: (vol: number) => void;
  onToggleMute: () => void;
  onLoadFile: () => void;
  isExporting: boolean;
  exportError: string | null;
  onDownloadFrame: () => void;
  onStartVideoExport: (format: VideoExportFormat) => void;
  onStopVideoExport: () => void;
  isConverting: boolean;
  conversionProgress: number | null;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function MediaControls({
  state,
  currentTime,
  duration,
  volume,
  isMuted,
  onTogglePlay,
  onSeek,
  onReplay,
  onVolumeChange,
  onToggleMute,
  onLoadFile,
  isExporting,
  exportError,
  onDownloadFrame,
  onStartVideoExport,
  onStopVideoExport,
  isConverting,
  conversionProgress,
}: MediaControlsProps) {
  const [isDownloadMenuOpen, setIsDownloadMenuOpen] = useState(false);
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const isActive = state !== 'idle' && state !== 'loading';

  const handleTimelineClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isActive) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onSeek(ratio * duration);
    },
    [isActive, duration, onSeek],
  );

  const handlePlayClick = useCallback(() => {
    if (state === 'ended') {
      onReplay();
    } else {
      onTogglePlay();
    }
  }, [state, onTogglePlay, onReplay]);

  const getPlayIcon = () => {
    switch (state) {
      case 'playing':
        return '❚❚';
      case 'ended':
        return '↺';
      case 'loading':
        return '⏳';
      default:
        return '▶';
    }
  };

  const getPlayLabel = () => {
    switch (state) {
      case 'playing':
        return 'Pause';
      case 'ended':
        return 'Replay';
      case 'loading':
        return 'Loading';
      default:
        return 'Play';
    }
  };

  const getVolumeIcon = () => {
    if (isMuted || volume === 0) return <VolumeX size={17} aria-hidden="true" />;
    if (volume < 0.5) return <Volume1 size={17} aria-hidden="true" />;
    return <Volume2 size={17} aria-hidden="true" />;
  };

  return (
    <div className="bottom-bar">
      <div className="media-controls">
        {/* Timeline */}
        <div className="timeline">
          <div
            id="timeline-bar"
            className="timeline__bar-wrap"
            onClick={handleTimelineClick}
            onKeyDown={(event) => {
              if (!isActive || duration <= 0) return;
              let nextTime: number | null = null;
              switch (event.key) {
                case 'ArrowLeft': nextTime = currentTime - Math.max(1, duration * 0.01); break;
                case 'ArrowRight': nextTime = currentTime + Math.max(1, duration * 0.01); break;
                case 'PageDown': nextTime = currentTime - 10; break;
                case 'PageUp': nextTime = currentTime + 10; break;
                case 'Home': nextTime = 0; break;
                case 'End': nextTime = duration; break;
                default: return;
              }
              event.preventDefault();
              event.stopPropagation();
              onSeek(Math.max(0, Math.min(duration, nextTime)));
            }}
            role="slider"
            aria-label="Playback position"
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={currentTime}
            aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
            tabIndex={0}
          >
            <div
              className="timeline__bar-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="timeline__time">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>

        {/* Playback row */}
        <div className="playback-row">
          <div className="playback-row__left">
            <button
              id="btn-play-pause"
              className="btn btn--icon"
              onClick={handlePlayClick}
              disabled={state === 'idle' || state === 'loading'}
              aria-label={getPlayLabel()}
              title={getPlayLabel()}
              type="button"
            >
              {getPlayIcon()}
            </button>

            <div className="volume-group">
              <button
                id="btn-mute"
                className="btn btn--icon btn--ghost"
                onClick={onToggleMute}
                aria-label={isMuted ? 'Unmute' : 'Mute'}
                title={isMuted ? 'Unmute' : 'Mute'}
                type="button"
              >
                {getVolumeIcon()}
              </button>
              <input
                id="volume-slider"
                type="range"
                className="volume-slider"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                aria-label="Volume"
              />
            </div>
          </div>

          <div className="playback-row__right">
            <div className="download-control">
              {isExporting ? (
                <button
                  className="btn btn--primary download-control__stop"
                  onClick={onStopVideoExport}
                  disabled={isConverting}
                  type="button"
                  aria-label={isConverting ? 'Converting MP4' : 'Stop recording and download video'}
                >
                  {isConverting ? <Film size={15} aria-hidden="true" /> : <Square size={15} aria-hidden="true" />}
                  <span>{isConverting ? 'Converting MP4...' : 'Stop & Download'}</span>
                </button>
              ) : (
                <>
                  <button
                    id="btn-download"
                    className="btn download-control__trigger"
                    onClick={() => setIsDownloadMenuOpen((open) => !open)}
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={isDownloadMenuOpen}
                    aria-label="Download rendered video or frame"
                    title="Download rendered output"
                  >
                    <Download size={16} aria-hidden="true" />
                    <span>Download</span>
                  </button>
                  {isDownloadMenuOpen && (
                    <div className="download-menu" role="menu" aria-label="Download options">
                      <button
                        role="menuitem"
                        onClick={() => {
                          onDownloadFrame();
                          setIsDownloadMenuOpen(false);
                        }}
                        type="button"
                      >
                        <ImageIcon size={16} aria-hidden="true" />
                        <span>PNG frame</span>
                      </button>
                      <button
                        role="menuitem"
                        onClick={() => {
                          onStartVideoExport('webm');
                          setIsDownloadMenuOpen(false);
                        }}
                        type="button"
                      >
                        <Film size={16} aria-hidden="true" />
                        <span>Full video (WebM)</span>
                      </button>
                      <button
                        role="menuitem"
                        onClick={() => {
                          onStartVideoExport('mp4');
                          setIsDownloadMenuOpen(false);
                        }}
                        type="button"
                      >
                        <Film size={16} aria-hidden="true" />
                        <span>Full video (MP4)</span>
                      </button>
                      <p>Uses the current render mode and settings. Video exports start from the beginning.</p>
                    </div>
                  )}
                </>
              )}
            {isConverting && (
              <div className="download-progress">
                <span>
                  {conversionProgress === null
                    ? 'Preparing MP4...'
                    : `Converting MP4: ${conversionProgress}%`}
                </span>
                {conversionProgress !== null && (
                  <progress
                    aria-label="MP4 conversion progress"
                    max={100}
                    value={conversionProgress}
                  />
                )}
              </div>
            )}
            </div>
            <button
              id="btn-load-file"
              className="btn btn--ghost"
              onClick={onLoadFile}
              type="button"
              title="Load a different video"
            >
              <FolderOpen size={16} aria-hidden="true" />
              <span>Load</span>
            </button>
          </div>
        </div>
        {exportError && <div className="download-error" role="alert">{exportError}</div>}
      </div>
    </div>
  );
}
