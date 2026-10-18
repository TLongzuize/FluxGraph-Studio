/* ───────────────────────────────────────────────
   FluxGraph — Geometry Processing
   
   Post-processing for contour paths:
   - Ramer–Douglas–Peucker simplification
   - Conservative smoothing
   - Path length filtering
   ─────────────────────────────────────────────── */

import type { ContourPath, Point } from '../../types';

/**
 * Filter, simplify, and smooth contour paths.
 */
export function processContours(
  paths: ContourPath[],
  minLength: number,
  simplifyTolerance: number,
  smoothingFactor: number,
): ContourPath[] {
  const result: ContourPath[] = [];

  for (const path of paths) {
    // 1. Discard very short paths (noise)
    if (path.length < minLength) continue;

    let points = path.points;

    // 2. Simplify with Ramer–Douglas–Peucker
    if (simplifyTolerance > 0 && points.length > 3) {
      points = rdpSimplify(points, simplifyTolerance, path.closed);
    }

    // 3. Apply conservative smoothing
    if (smoothingFactor > 0 && points.length > 2) {
      points = smoothPath(points, smoothingFactor, path.closed);
    }

    if (points.length >= 2) {
      result.push({
        points,
        closed: path.closed,
        length: computePathLength(points),
      });
    }
  }

  return result;
}

/**
 * Ramer–Douglas–Peucker polyline simplification.
 * Reduces the number of points while preserving overall shape.
 *
 * For closed paths, we find the farthest point from the first point
 * and split there to avoid artifacts at the closure seam.
 */
export function rdpSimplify(points: Point[], tolerance: number, closed: boolean): Point[] {
  if (points.length <= 2) return points;

  if (closed && points.length > 4) {
    // For closed paths, find the point farthest from the first point
    // and rotate the array so we split at a meaningful location
    let maxDist = 0;
    let maxIdx = 0;
    const first = points[0];
    for (let i = 1; i < points.length; i++) {
      const d = distSq(first, points[i]);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }

    // Split the closed path into two open halves, simplify each, and rejoin
    const half1 = points.slice(0, maxIdx + 1);
    const half2 = points.slice(maxIdx).concat([points[0]]);

    const s1 = rdpSimplifyOpen(half1, tolerance);
    const s2 = rdpSimplifyOpen(half2, tolerance);

    // Merge: s1 + s2 (skip duplicate join point)
    const merged = s1.concat(s2.slice(1, -1));
    return merged.length >= 3 ? merged : points;
  }

  return rdpSimplifyOpen(points, tolerance);
}

/**
 * RDP simplification for an open polyline.
 */
function rdpSimplifyOpen(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points;

  const tolSq = tolerance * tolerance;

  // Find the point with maximum distance from the line segment [first, last]
  let maxDistSq = 0;
  let maxIdx = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const d = pointToSegmentDistSq(points[i], first, last);
    if (d > maxDistSq) {
      maxDistSq = d;
      maxIdx = i;
    }
  }

  if (maxDistSq > tolSq) {
    // Recursively simplify both halves
    const left = rdpSimplifyOpen(points.slice(0, maxIdx + 1), tolerance);
    const right = rdpSimplifyOpen(points.slice(maxIdx), tolerance);
    return left.slice(0, -1).concat(right);
  }

  // All intermediate points are within tolerance — keep only endpoints
  return [first, last];
}

/**
 * Squared distance from point to line segment.
 */
function pointToSegmentDistSq(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) return distSq(p, a);

  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = a.x + t * dx;
  const projY = a.y + t * dy;

  return (p.x - projX) * (p.x - projX) + (p.y - projY) * (p.y - projY);
}

/**
 * Squared distance between two points.
 */
function distSq(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * Conservative smoothing using Chaikin's corner-cutting algorithm.
 * smoothingFactor controls iterations (0–1 mapped to 0–3 iterations).
 * Preserves overall silhouette shape while removing jagged staircase artifacts.
 */
export function smoothPath(points: Point[], factor: number, closed: boolean): Point[] {
  const iterations = Math.min(3, Math.max(0, Math.round(factor * 3)));
  let result = points;

  for (let iter = 0; iter < iterations; iter++) {
    result = chaikinSmooth(result, closed);
  }

  return result;
}

/**
 * One pass of Chaikin's corner-cutting.
 * For each pair of consecutive points, generates two new points at 1/4 and 3/4.
 */
function chaikinSmooth(points: Point[], closed: boolean): Point[] {
  if (points.length < 3) return points;

  const result: Point[] = [];
  const n = points.length;

  if (closed) {
    for (let i = 0; i < n; i++) {
      const p0 = points[i];
      const p1 = points[(i + 1) % n];
      result.push({
        x: 0.75 * p0.x + 0.25 * p1.x,
        y: 0.75 * p0.y + 0.25 * p1.y,
      });
      result.push({
        x: 0.25 * p0.x + 0.75 * p1.x,
        y: 0.25 * p0.y + 0.75 * p1.y,
      });
    }
  } else {
    // Keep first point
    result.push(points[0]);
    for (let i = 0; i < n - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      result.push({
        x: 0.75 * p0.x + 0.25 * p1.x,
        y: 0.75 * p0.y + 0.25 * p1.y,
      });
      result.push({
        x: 0.25 * p0.x + 0.75 * p1.x,
        y: 0.25 * p0.y + 0.75 * p1.y,
      });
    }
    // Keep last point
    result.push(points[n - 1]);
  }

  return result;
}

/**
 * Compute approximate polyline length.
 */
function computePathLength(points: Point[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}
