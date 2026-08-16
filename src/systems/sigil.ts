/**
 * Sigils — the in-world stand-in for a signature.
 *
 * A sigil is deterministically derived from a player id, so the same raptor
 * always draws the same mark and other players learn to recognise it. It is not
 * cryptography and does not pretend to be: the property the game actually needs
 * is that a commitment can record *which distinct parties marked it*, and a
 * visible glyph does that better than an opaque blob because you can read a
 * seal at a glance and see who is already on it.
 */

import { hash2 } from '../world/noise';

export const SIGIL_N = 7;

export interface Sigil {
  id: string;
  name: string;
  /** SIGIL_N x SIGIL_N booleans, mirrored on the vertical axis. */
  cells: boolean[];
  /** Hue in degrees; drives the glyph's glow and the raptor's plumage. */
  hue: number;
  css: string;
}

const ONSET = ['ka', 've', 'thu', 'sil', 'mor', 'ael', 'rhe', 'tan', 'oru', 'lys', 'bre', 'nim'];
const CODA = ['dris', 'val', 'thas', 'wen', 'rok', 'lith', 'mar', 'sunn', 'ver', 'eth', 'orn', 'ka'];

function strHash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function makeSigil(id: string): Sigil {
  const h = strHash(id);
  const cells: boolean[] = new Array(SIGIL_N * SIGIL_N).fill(false);
  const half = Math.ceil(SIGIL_N / 2);

  // Build the left half, mirror it. Symmetry makes glyphs read as marks
  // rather than as noise.
  for (let y = 0; y < SIGIL_N; y++) {
    for (let x = 0; x < half; x++) {
      const on = hash2(x, y, h) > 0.47;
      cells[y * SIGIL_N + x] = on;
      cells[y * SIGIL_N + (SIGIL_N - 1 - x)] = on;
    }
  }
  // Guarantee a connected spine so no sigil is a scatter of dots.
  for (let y = 1; y < SIGIL_N - 1; y++) cells[y * SIGIL_N + (half - 1)] = true;

  const hue = Math.floor((h % 3600) / 10);
  const nameA = ONSET[h % ONSET.length];
  const nameB = CODA[(h >>> 8) % CODA.length];

  return {
    id,
    name: nameA.charAt(0).toUpperCase() + nameA.slice(1) + nameB,
    cells,
    hue,
    css: `hsl(${hue} 78% 62%)`,
  };
}

/** Draw a sigil into a canvas context, filling the given square. */
export function drawSigil(
  ctx: CanvasRenderingContext2D,
  sig: Sigil,
  x: number,
  y: number,
  size: number,
  alpha = 1,
): void {
  const cell = size / SIGIL_N;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = sig.css;
  ctx.shadowBlur = cell * 0.9;
  ctx.fillStyle = sig.css;
  for (let cy = 0; cy < SIGIL_N; cy++) {
    for (let cx = 0; cx < SIGIL_N; cx++) {
      if (!sig.cells[cy * SIGIL_N + cx]) continue;
      ctx.fillRect(
        Math.round(x + cx * cell) + 0.5,
        Math.round(y + cy * cell) + 0.5,
        Math.ceil(cell) - 1,
        Math.ceil(cell) - 1,
      );
    }
  }
  ctx.restore();
}

/** Render a sigil to a standalone canvas — used for HUD chips and seals. */
export function sigilCanvas(sig: Sigil, size = 64): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  drawSigil(ctx, sig, 0, 0, size);
  return c;
}
