/* ───────────────────────────────────────────────
   FluxGraph — Marching Squares Contour Extraction
   
   Extracts connected contour paths from a binary mask
   using all 16 Marching Squares configurations,
   including saddle-point (ambiguous) case resolution.
   ─────────────────────────────────────────────── */

import type { BinaryMask, ContourPath, Point } from '../../types';

/**
 * For each of the 16 marching squares cases, define which edges are connected.
 * Each entry is an array of [edge1, edge2] pairs representing line segments.
 *
 * Cell corners:  TL(0,0)---TR(1,0)
 *                  |           |
 *                BL(0,1)---BR(1,1)
 *
 * Edges: 0=top, 1=right, 2=bottom, 3=left
 * 
 * Case index = TL*8 + TR*4 + BR*2 + BL*1
 */
const CASE_EDGES: number[][][] = [
  [],               // 0:  0000 — empty
  [[3, 2]],         // 1:  0001 — BL
  [[2, 1]],         // 2:  0010 — BR
  [[3, 1]],         // 3:  0011 — BL+BR
  [[0, 1]],         // 4:  0100 — TR
  [[0, 1], [2, 3]], // 5:  0101 — TR+BL (saddle, resolved by center)
  [[0, 2]],         // 6:  0110 — TR+BR
  [[0, 3]],         // 7:  0111 — TR+BR+BL
  [[0, 3]],         // 8:  1000 — TL
  [[0, 2]],         // 9:  1001 — TL+BL
  [[0, 3], [1, 2]], // 10: 1010 — TL+BR (saddle, resolved by center)
  [[0, 1]],         // 11: 1011 — TL+BL+BR
  [[3, 1]],         // 12: 1100 — TL+TR
  [[2, 1]],         // 13: 1101 — TL+TR+BL
  [[3, 2]],         // 14: 1110 — TL+TR+BR
  [],               // 15: 1111 — full
];

/**
 * Get the interpolated position on a cell edge.
 * For binary masks (no interpolation needed), this returns the midpoint.
 */
function edgePoint(cx: number, cy: number, edge: number): Point {
  switch (edge) {
    case 0: return { x: cx + 0.5, y: cy };       // top edge midpoint
    case 1: return { x: cx + 1,   y: cy + 0.5 }; // right edge midpoint
    case 2: return { x: cx + 0.5, y: cy + 1 };   // bottom edge midpoint
    case 3: return { x: cx,       y: cy + 0.5 }; // left edge midpoint
    default: return { x: cx, y: cy };
  }
}

/**
 * Unique key for an edge at a cell position, used for path stitching.
 * encodes (cellX, cellY, edgeId) into a single integer.
 */
function edgeKey(cx: number, cy: number, edge: number, width: number): number {
  return (cy * width + cx) * 4 + edge;
}

/**
 * Get the neighboring cell and corresponding edge for a given edge.
 * When we exit a cell through an edge, we enter the neighboring cell
 * through the opposite edge.
 */
function neighborCell(
  cx: number, cy: number, edge: number,
): { nx: number; ny: number; ne: number } {
  switch (edge) {
    case 0: return { nx: cx, ny: cy - 1, ne: 2 }; // top → neighbor's bottom
    case 1: return { nx: cx + 1, ny: cy, ne: 3 }; // right → neighbor's left
    case 2: return { nx: cx, ny: cy + 1, ne: 0 }; // bottom → neighbor's top
    case 3: return { nx: cx - 1, ny: cy, ne: 1 }; // left → neighbor's right
    default: return { nx: cx, ny: cy, ne: edge };
  }
}

/**
 * Extract contour paths from a binary mask using Marching Squares.
 * 
 * The algorithm:
 * 1. Compute the case index for each cell (2×2 pixel block).
 * 2. Enumerate all line segments from the lookup table.
 * 3. Stitch segments into connected paths by following edges through neighboring cells.
 * 4. Detect closed loops.
 *
 * Handles ambiguous saddle-point cases (5, 10) by examining the center value.
 */
export function extractContours(mask: BinaryMask): ContourPath[] {
  const { data, width: w, height: h } = mask;

  if (w < 2 || h < 2) return [];

  // Number of cells is (w-1) × (h-1)
  const cellsW = w - 1;
  const cellsH = h - 1;

  // Precompute case index for each cell
  const caseGrid = new Uint8Array(cellsW * cellsH);
  for (let cy = 0; cy < cellsH; cy++) {
    for (let cx = 0; cx < cellsW; cx++) {
      const tl = data[cy * w + cx];
      const tr = data[cy * w + cx + 1];
      const br = data[(cy + 1) * w + cx + 1];
      const bl = data[(cy + 1) * w + cx];
      caseGrid[cy * cellsW + cx] = (tl << 3) | (tr << 2) | (br << 1) | bl;
    }
  }

  // Build a map of all edge segments: for each edge, store which other edge it connects to.
  // This is used for path stitching.
  // Key: edgeKey → { cx, cy, otherEdge } — the other end of the segment in this cell
  const edgeSegments = new Map<number, { cx: number; cy: number; edge: number }>();
  // Track which edges have been visited
  const visited = new Set<number>();

  for (let cy = 0; cy < cellsH; cy++) {
    for (let cx = 0; cx < cellsW; cx++) {
      let caseIdx = caseGrid[cy * cellsW + cx];

      // Handle ambiguous saddle cases by checking the average of the 4 corners
      if (caseIdx === 5 || caseIdx === 10) {
        const tl = data[cy * w + cx];
        const tr = data[cy * w + cx + 1];
        const br = data[(cy + 1) * w + cx + 1];
        const bl = data[(cy + 1) * w + cx];
        const center = (tl + tr + br + bl) / 4;
        
        // For case 5 (TR+BL): if center >= 0.5, connect horizontally (becomes like case 12+3)
        // For case 10 (TL+BR): if center >= 0.5, connect vertically (becomes like case 9+6)
        if (caseIdx === 5 && center >= 0.5) {
          // Swap to the alternative connectivity: [[0, 3], [1, 2]]
          caseIdx = 10; // Use case 10's edges as the alternative for case 5
        } else if (caseIdx === 10 && center >= 0.5) {
          caseIdx = 5;  // Use case 5's edges as the alternative for case 10
        }
      }

      const edges = CASE_EDGES[caseIdx];
      for (const [e1, e2] of edges) {
        const k1 = edgeKey(cx, cy, e1, cellsW);
        const k2 = edgeKey(cx, cy, e2, cellsW);
        edgeSegments.set(k1, { cx, cy, edge: e2 });
        edgeSegments.set(k2, { cx, cy, edge: e1 });
      }
    }
  }

  // Stitch segments into paths
  const paths: ContourPath[] = [];

  for (const [startKey] of edgeSegments) {
    if (visited.has(startKey)) continue;

    const points: Point[] = [];
    let currentKey = startKey;
    let closed = false;

    // Follow the chain of edges
    while (true) {
      if (visited.has(currentKey)) {
        if (currentKey === startKey && points.length > 1) {
          closed = true;
        }
        break;
      }
      visited.add(currentKey);

      const seg = edgeSegments.get(currentKey);
      if (!seg) break;

      // Add the point at the current edge
      const { cx, cy, edge: exitEdge } = seg;
      // Decode the entry edge from currentKey
      const entryEdge = currentKey - (cy * cellsW + cx) * 4;
      
      // Only add the entry point (not the exit, to avoid duplicates)
      points.push(edgePoint(cx, cy, entryEdge >= 0 && entryEdge <= 3 ? entryEdge : 0));

      // Mark the exit edge as visited too
      const exitKey = edgeKey(cx, cy, exitEdge, cellsW);
      visited.add(exitKey);

      // Add the exit point
      points.push(edgePoint(cx, cy, exitEdge));

      // Move to the neighboring cell through the exit edge
      const { nx, ny, ne } = neighborCell(cx, cy, exitEdge);

      // Check bounds
      if (nx < 0 || nx >= cellsW || ny < 0 || ny >= cellsH) {
        break; // Path ends at boundary
      }

      currentKey = edgeKey(nx, ny, ne, cellsW);
    }

    if (points.length >= 2) {
      // Remove consecutive duplicate points
      const cleaned = deduplicatePoints(points);
      if (cleaned.length >= 2) {
        paths.push({
          points: cleaned,
          closed,
          length: computePathLength(cleaned),
        });
      }
    }
  }

  return paths;
}

/**
 * Remove consecutive duplicate points.
 */
function deduplicatePoints(points: Point[]): Point[] {
  if (points.length === 0) return [];
  const result: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    if (Math.abs(curr.x - prev.x) > 0.001 || Math.abs(curr.y - prev.y) > 0.001) {
      result.push(curr);
    }
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
