/* ───────────────────────────────────────────────
   FluxGraph — Contour Module Public API
   
   Combines Marching Squares extraction with
   geometry post-processing into a single call.
   ─────────────────────────────────────────────── */

import type { BinaryMask, ContourConfig, ContourPath } from '../../types';
import { extractContours } from './marchingSquares';
import { processContours } from './geometryProcessing';

export { extractContours } from './marchingSquares';
export { processContours, rdpSimplify, smoothPath } from './geometryProcessing';

/**
 * Full contour pipeline: extract from mask → filter → simplify → smooth.
 */
export function extractAndProcessContours(
  mask: BinaryMask,
  config: ContourConfig,
): ContourPath[] {
  const raw = extractContours(mask);
  return processContours(
    raw,
    config.minLength,
    config.simplifyTolerance,
    config.smoothing,
  );
}
