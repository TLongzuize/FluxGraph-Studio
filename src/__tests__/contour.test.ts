/* ───────────────────────────────────────────────
   FluxGraph — Contour Module Tests
   
   Tests for Marching Squares extraction,
   geometry processing (RDP, smoothing),
   and edge cases.
   ─────────────────────────────────────────────── */

import { describe, it, expect } from 'vitest';
import { extractContours } from '../modules/contour/marchingSquares';
import { rdpSimplify, smoothPath, processContours } from '../modules/contour/geometryProcessing';
import type { BinaryMask, ContourPath, Point } from '../types';

/** Helper: create a BinaryMask from a 2D array of 0s and 1s. */
function makeMask(rows: number[][]): BinaryMask {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data[y * width + x] = rows[y][x];
    }
  }
  return { data, width, height };
}

// ─────────────────────────────────────────────
// Marching Squares: extractContours
// ─────────────────────────────────────────────

describe('extractContours', () => {
  it('returns empty for an all-zero mask', () => {
    const mask = makeMask([
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]);
    const contours = extractContours(mask);
    expect(contours).toHaveLength(0);
  });

  it('returns empty for an all-one mask (case 15 everywhere)', () => {
    const mask = makeMask([
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
    ]);
    const contours = extractContours(mask);
    expect(contours).toHaveLength(0);
  });

  it('extracts contours for a simple square', () => {
    const mask = makeMask([
      [0, 0, 0, 0, 0],
      [0, 1, 1, 1, 0],
      [0, 1, 1, 1, 0],
      [0, 1, 1, 1, 0],
      [0, 0, 0, 0, 0],
    ]);
    const contours = extractContours(mask);
    expect(contours.length).toBeGreaterThan(0);
    
    // Should have at least some contour points
    const totalPoints = contours.reduce((sum, c) => sum + c.points.length, 0);
    expect(totalPoints).toBeGreaterThan(2);
  });

  it('handles masks smaller than 2x2', () => {
    const mask = makeMask([[1]]);
    const contours = extractContours(mask);
    expect(contours).toHaveLength(0);
  });

  it('handles a single pixel foreground', () => {
    const mask = makeMask([
      [0, 0, 0],
      [0, 1, 0],
      [0, 0, 0],
    ]);
    const contours = extractContours(mask);
    // A single foreground pixel creates edges around it
    expect(contours.length).toBeGreaterThan(0);
  });

  it('handles multiple disconnected shapes', () => {
    const mask = makeMask([
      [0, 0, 0, 0, 0, 0, 0],
      [0, 1, 0, 0, 0, 1, 0],
      [0, 0, 0, 0, 0, 0, 0],
    ]);
    const contours = extractContours(mask);
    // Should produce contours for both disconnected pixels
    expect(contours.length).toBeGreaterThanOrEqual(2);
  });

  it('handles boundary-touching foreground', () => {
    const mask = makeMask([
      [1, 1, 0],
      [1, 1, 0],
      [0, 0, 0],
    ]);
    const contours = extractContours(mask);
    // Shape touching the boundary should still produce valid contours
    expect(contours.length).toBeGreaterThan(0);
    for (const c of contours) {
      expect(c.points.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('handles foreground filling entire edge', () => {
    const mask = makeMask([
      [1, 1, 1],
      [0, 0, 0],
      [0, 0, 0],
    ]);
    const contours = extractContours(mask);
    expect(contours.length).toBeGreaterThan(0);
  });

  it('handles ambiguous case (checkerboard pattern)', () => {
    // This creates saddle points (cases 5 and 10)
    const mask = makeMask([
      [1, 0, 1],
      [0, 1, 0],
      [1, 0, 1],
    ]);
    const contours = extractContours(mask);
    // Should produce contours without crashing
    expect(contours.length).toBeGreaterThanOrEqual(0);
    // All points should have finite coordinates
    for (const c of contours) {
      for (const p of c.points) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
      }
    }
  });

  it('contour paths have positive length', () => {
    const mask = makeMask([
      [0, 0, 0, 0],
      [0, 1, 1, 0],
      [0, 1, 1, 0],
      [0, 0, 0, 0],
    ]);
    const contours = extractContours(mask);
    for (const c of contours) {
      expect(c.length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────
// RDP Simplification
// ─────────────────────────────────────────────

describe('rdpSimplify', () => {
  it('keeps endpoints for a straight line', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ];
    const result = rdpSimplify(points, 0.5, false);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[1]).toEqual({ x: 3, y: 0 });
  });

  it('keeps corner points for an L shape', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
    ];
    const result = rdpSimplify(points, 0.5, false);
    expect(result).toHaveLength(3);
  });

  it('returns original for 2 or fewer points', () => {
    const points: Point[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    const result = rdpSimplify(points, 1, false);
    expect(result).toHaveLength(2);
  });

  it('preserves sharp corners with low tolerance', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 4, y: 8 },
    ];
    const result = rdpSimplify(points, 0.1, false);
    // Should keep the corner at (4, 0)
    expect(result.length).toBeGreaterThanOrEqual(3);
  });

  it('handles closed paths without crashing', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
      { x: 0, y: 5 },
      { x: 0, y: 0 },
    ];
    const result = rdpSimplify(points, 0.5, true);
    expect(result.length).toBeGreaterThanOrEqual(3);
  });
});

// ─────────────────────────────────────────────
// Smoothing
// ─────────────────────────────────────────────

describe('smoothPath', () => {
  it('returns original for factor=0', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 0 },
    ];
    const result = smoothPath(points, 0, false);
    expect(result).toEqual(points);
  });

  it('generates more points with smoothing', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
      { x: 0, y: 5 },
    ];
    const result = smoothPath(points, 0.5, false);
    // Chaikin smoothing increases point count
    expect(result.length).toBeGreaterThan(points.length);
  });

  it('smoothed points stay near original path', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const result = smoothPath(points, 0.5, false);
    // All smoothed points should be within the bounding box (with margin)
    for (const p of result) {
      expect(p.x).toBeGreaterThanOrEqual(-1);
      expect(p.x).toBeLessThanOrEqual(11);
      expect(p.y).toBeGreaterThanOrEqual(-1);
      expect(p.y).toBeLessThanOrEqual(11);
    }
  });

  it('handles closed path smoothing', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
      { x: 0, y: 5 },
    ];
    const result = smoothPath(points, 0.5, true);
    expect(result.length).toBeGreaterThan(points.length);
  });

  it('returns original for fewer than 3 points', () => {
    const points: Point[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    const result = smoothPath(points, 1, false);
    expect(result).toEqual(points);
  });
});

// ─────────────────────────────────────────────
// processContours (filter + simplify + smooth)
// ─────────────────────────────────────────────

describe('processContours', () => {
  it('filters out short paths', () => {
    const paths: ContourPath[] = [
      { points: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }], closed: false, length: 0.5 },
      { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], closed: false, length: 10 },
    ];
    const result = processContours(paths, 5, 0, 0);
    expect(result).toHaveLength(1);
    expect(result[0].length).toBeGreaterThanOrEqual(5);
  });

  it('returns empty for empty input', () => {
    const result = processContours([], 0, 0, 0);
    expect(result).toHaveLength(0);
  });

  it('preserves paths when minLength is 0', () => {
    const paths: ContourPath[] = [
      { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], closed: false, length: 1 },
      { points: [{ x: 0, y: 0 }, { x: 2, y: 0 }], closed: false, length: 2 },
    ];
    const result = processContours(paths, 0, 0, 0);
    expect(result).toHaveLength(2);
  });

  it('simplifies and smooths without crashing', () => {
    const points: Point[] = [];
    for (let i = 0; i < 50; i++) {
      points.push({ x: i, y: Math.sin(i * 0.2) * 5 });
    }
    const paths: ContourPath[] = [
      { points, closed: false, length: 50 },
    ];
    const result = processContours(paths, 0, 1.0, 0.5);
    expect(result).toHaveLength(1);
    // Simplified should have fewer points, smoothing adds some back
    expect(result[0].points.length).toBeGreaterThan(2);
  });
});

// ─────────────────────────────────────────────
// Integration: full mask → contours pipeline
// ─────────────────────────────────────────────

describe('full contour pipeline', () => {
  it('produces contours from a ring shape', () => {
    const mask = makeMask([
      [0, 0, 0, 0, 0, 0],
      [0, 1, 1, 1, 1, 0],
      [0, 1, 0, 0, 1, 0],
      [0, 1, 0, 0, 1, 0],
      [0, 1, 1, 1, 1, 0],
      [0, 0, 0, 0, 0, 0],
    ]);
    const contours = extractContours(mask);
    // A ring should produce contours for both outer and inner edges
    expect(contours.length).toBeGreaterThanOrEqual(2);
  });

  it('L-shaped mask produces valid contours', () => {
    const mask = makeMask([
      [0, 0, 0, 0, 0],
      [0, 1, 0, 0, 0],
      [0, 1, 0, 0, 0],
      [0, 1, 1, 1, 0],
      [0, 0, 0, 0, 0],
    ]);
    const contours = extractContours(mask);
    expect(contours.length).toBeGreaterThan(0);
    const totalPoints = contours.reduce((s, c) => s + c.points.length, 0);
    expect(totalPoints).toBeGreaterThan(4);
  });

  it('processContours preserves approximate geometry after simplify+smooth', () => {
    // Create a circle-like mask
    const size = 20;
    const rows: number[][] = [];
    const cx = size / 2;
    const cy = size / 2;
    const r = 7;
    for (let y = 0; y < size; y++) {
      const row: number[] = [];
      for (let x = 0; x < size; x++) {
        const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        row.push(d < r ? 1 : 0);
      }
      rows.push(row);
    }
    const mask = makeMask(rows);
    const raw = extractContours(mask);
    const processed = processContours(raw, 2, 0.5, 0.3);
    
    expect(processed.length).toBeGreaterThan(0);
    
    // Check that processed points stay roughly near the circle
    for (const c of processed) {
      for (const p of c.points) {
        // Points should be within the mask bounds
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(size);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(size);
      }
    }
  });
});
