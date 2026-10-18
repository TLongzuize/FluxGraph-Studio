/* ───────────────────────────────────────────────
   FluxGraph — Canvas component
   Manages the display canvas and its sizing.
   Rendering logic is driven externally, not inside React.
   ─────────────────────────────────────────────── */

import { useCallback, useEffect, useRef } from 'react';

interface CanvasDisplayProps {
  maxDevicePixelRatio: number;
  onCanvasReady: (canvas: HTMLCanvasElement) => void;
}

const MAX_CANVAS_PIXELS = 12_000_000;

export function CanvasDisplay({ maxDevicePixelRatio, onCanvasReady }: CanvasDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();

    // Use container size for canvas dimensions
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    if (width <= 0 || height <= 0) return;

    const deviceDpr = window.devicePixelRatio || 1;
    const pixelBudgetDpr = Math.sqrt(MAX_CANVAS_PIXELS / (width * height));
    // Keep the backing store under the pixel budget even on exceptionally large displays.
    const dpr = Math.min(deviceDpr, maxDevicePixelRatio, pixelBudgetDpr);

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.dataset.pixelRatio = String(dpr);

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
    }
  }, [maxDevicePixelRatio]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) {
      console.error('[Canvas] Canvas or container ref is null on mount!');
      return;
    }

    const timer = requestAnimationFrame(() => {
      resize();
      onCanvasReady(canvas);
    });

    const observer = new ResizeObserver(() => {
      resize();
    });
    observer.observe(container);

    return () => {
      cancelAnimationFrame(timer);
      observer.disconnect();
    };
  }, [resize, onCanvasReady]);

  return (
    <div
      ref={containerRef}
      className="canvas-area"
    >
      <canvas
        ref={canvasRef}
        className="canvas-area__canvas"
        id="main-canvas"
        aria-label="Video visualization canvas"
      />
    </div>
  );
}
