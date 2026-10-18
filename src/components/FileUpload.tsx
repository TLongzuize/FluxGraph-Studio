/* ───────────────────────────────────────────────
   FluxGraph — FileUpload component
   Drag-and-drop + click-to-browse file selector
   ─────────────────────────────────────────────── */

import { useCallback, useRef, useState } from 'react';
import { Film } from 'lucide-react';

const SAMPLE_VIDEO_URL = new URL('../../Video_test/東方Bad Apple!! ＰＶ影絵.mp4', import.meta.url).href;

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  visible: boolean;
}

const ACCEPTED_TYPES = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'];

export function FileUpload({ onFileSelect, visible }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isLoadingSample, setIsLoadingSample] = useState(false);
  const [sampleError, setSampleError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      // Accept any video/* type, not just the ones we list
      if (file.type.startsWith('video/') || ACCEPTED_TYPES.includes(file.type)) {
        onFileSelect(file);
      }
    },
    [onFileSelect],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      // Reset so the same file can be re-selected
      e.target.value = '';
    },
    [handleFile],
  );

  const handleLoadSample = useCallback(async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsLoadingSample(true);
    setSampleError('');

    try {
      const response = await fetch(SAMPLE_VIDEO_URL);
      if (!response.ok) throw new Error('Sample video could not be downloaded.');
      const blob = await response.blob();
      onFileSelect(new File([blob], 'Bad Apple Demo.mp4', { type: blob.type || 'video/mp4' }));
    } catch {
      setSampleError('Could not load the sample video. Try choosing a local file instead.');
    } finally {
      setIsLoadingSample(false);
    }
  }, [onFileSelect]);

  if (!visible) return null;

  return (
    <div
      id="file-upload-dropzone"
      className={`drop-zone ${isDragging ? 'drop-zone--dragging' : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <div className="drop-zone__inner" onClick={handleClick}>
        <div className="drop-zone__icon" aria-hidden="true">
          ▶
        </div>
        <div className="drop-zone__title">Drop a video to begin</div>
        <div className="drop-zone__subtitle">
          Drag & drop any video file here, or click to browse.
          <br />
          Your video stays local — nothing is uploaded.
        </div>
        <div className="drop-zone__formats">MP4 · WebM · OGV · MOV</div>
        <div className="drop-zone__actions">
          <button className="btn btn--primary drop-zone__btn" type="button">
            Choose File
          </button>
          <button
            className="btn btn--ghost drop-zone__btn drop-zone__sample"
            type="button"
            onClick={handleLoadSample}
            disabled={isLoadingSample}
            aria-busy={isLoadingSample}
          >
            <Film size={16} strokeWidth={1.8} aria-hidden="true" />
            <span>{isLoadingSample ? 'Loading sample…' : 'Load Bad Apple sample'}</span>
          </button>
        </div>
        {sampleError && <div className="drop-zone__sample-error" role="alert">{sampleError}</div>}
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className="drop-zone__input"
          onChange={handleInputChange}
          aria-label="Select a video file"
        />
      </div>
    </div>
  );
}
