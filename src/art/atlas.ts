/**
 * Procedural texture atlas.
 *
 * Every tile is drawn at runtime from the block registry's TexSpec, so there
 * are no image assets to ship and every colour provably comes from the measured
 * palette rather than from memory.
 *
 * Layout: TILE x TILE pixels, GRID x GRID tiles. NearestFilter, no mipmaps —
 * the crunchy look is the point, and heavy fog covers the distance aliasing.
 */

import * as THREE from 'three';
import { BLOCKS, type PatternKind, type TexSpec } from '../world/blocks';
import { hash2 } from '../world/noise';

export const TILE = 16;
export const GRID = 16;
const SIZE = TILE * GRID;

/** Face slot indices within a block's 3-tile run. */
export const FACE_TOP = 0;
export const FACE_SIDE = 1;
export const FACE_BOTTOM = 2;

type Px = { r: number; g: number; b: number; a: number };

const unpack = (hex: number): Px => ({
  r: (hex >> 16) & 0xff,
  g: (hex >> 8) & 0xff,
  b: hex & 0xff,
  a: 255,
});

const shade = (c: Px, f: number): Px => ({
  r: Math.max(0, Math.min(255, Math.round(c.r * f))),
  g: Math.max(0, Math.min(255, Math.round(c.g * f))),
  b: Math.max(0, Math.min(255, Math.round(c.b * f))),
  a: c.a,
});

const mix = (a: Px, b: Px, t: number): Px => ({
  r: Math.round(a.r + (b.r - a.r) * t),
  g: Math.round(a.g + (b.g - a.g) * t),
  b: Math.round(a.b + (b.b - a.b) * t),
  a: Math.round(a.a + (b.a - a.a) * t),
});

/**
 * Draw one 16x16 tile. `x`/`y` are pixel coords within the tile.
 * Returns null for fully transparent pixels (cross-plant cutouts).
 */
function pixel(spec: TexSpec, pattern: PatternKind, x: number, y: number): Px | null {
  const base = unpack(spec.base);
  const accent = unpack(spec.accent ?? spec.base);
  const s = spec.seed ?? 0;
  const n = hash2(x, y, s);
  const n2 = hash2(x * 3 + 11, y * 3 + 7, s + 91);

  switch (pattern) {
    case 'flat':
      return base;

    case 'noise':
      return shade(base, 0.88 + n * 0.24);

    case 'stone': {
      // Blocky mottling with a few darker cracks.
      const cell = hash2(Math.floor(x / 4), Math.floor(y / 4), s);
      let c = mix(base, accent, cell * 0.7);
      c = shade(c, 0.9 + n * 0.2);
      if (n2 > 0.955) c = shade(c, 0.7);
      return c;
    }

    case 'brick': {
      // Running bond: 8x4 bricks, offset every other course.
      const row = Math.floor(y / 4);
      const off = (row % 2) * 4;
      const bx = (x + off) % 8;
      const by = y % 4;
      if (by === 0 || bx === 0) return shade(base, 0.62); // mortar
      const jitter = hash2(Math.floor((x + off) / 8), row, s);
      return shade(mix(base, accent, jitter * 0.5), 0.92 + n * 0.16);
    }

    case 'soil': {
      const c = mix(base, accent, n * 0.8);
      return shade(c, 0.9 + n2 * 0.2);
    }

    case 'grass_top': {
      const c = mix(base, accent, n * 0.9);
      return shade(c, 0.88 + n2 * 0.24);
    }

    case 'grass_side': {
      // Turf overhang on the top few rows, dirt below.
      const lip = 3 + Math.floor(hash2(x, 0, s) * 2.5);
      if (y < lip) return shade(mix(accent, base, n * 0.35), 0.9 + n2 * 0.2);
      return shade(mix(base, unpack(0x46341f), n * 0.7), 0.9 + n2 * 0.18);
    }

    case 'log_top': {
      // Concentric rings.
      const dx = x - 7.5;
      const dy = y - 7.5;
      const r = Math.sqrt(dx * dx + dy * dy);
      const ring = Math.sin(r * 2.2) * 0.5 + 0.5;
      return shade(mix(base, accent, ring * 0.75), 0.92 + n * 0.14);
    }

    case 'log_side': {
      // Vertical bark striations.
      const v = hash2(x, Math.floor(y / 6), s);
      return shade(mix(base, accent, v * 0.85), 0.9 + n * 0.18);
    }

    case 'plank': {
      const board = Math.floor(y / 4);
      const seam = y % 4 === 0;
      if (seam) return shade(base, 0.68);
      const grain = hash2(x, board, s);
      return shade(mix(base, accent, grain * 0.55), 0.93 + n * 0.14);
    }

    case 'leaves': {
      // Dense clumps with cutout gaps so canopy reads as foliage.
      if (n > 0.86) return null;
      const c = mix(base, accent, n2 * 0.9);
      return shade(c, 0.82 + n * 0.34);
    }

    case 'berry': {
      // Glowing amber seeds clustered on a dark bush.
      const cx = x - 8;
      const cy = y - 9;
      const spots = [
        [4, 5, 2.4],
        [11, 7, 2.1],
        [7, 11, 2.6],
        [12, 12, 1.8],
        [3, 11, 1.7],
      ];
      for (const [sx, sy, sr] of spots) {
        const d = Math.hypot(x - sx, y - sy);
        if (d < sr) return shade(accent, 1.0 - (d / sr) * 0.3);
      }
      if (Math.hypot(cx, cy) > 8.4) return null;
      if (n > 0.72) return null;
      return shade(base, 0.8 + n * 0.35);
    }

    case 'crop': {
      // A stalk with an accent head — used for seeds, rows, lavender, shoots.
      const stalk = Math.abs(x - 8) <= 1 && y > 4;
      if (stalk) return shade(base, 0.95 + n * 0.12);
      const d = Math.hypot(x - 8, y - 4);
      if (d < 3.6) return shade(accent, 0.9 + n * 0.2);
      const leaf =
        (Math.abs(x - 8) < 4 && y > 8 && y < 12 && hash2(x, y, s) > 0.45) ||
        (Math.abs(x - 8) < 3 && y >= 12 && hash2(x, y, s + 5) > 0.55);
      if (leaf) return shade(base, 0.85 + n * 0.25);
      return null;
    }

    case 'water': {
      const w = Math.sin((x + y * 0.6) * 0.7) * 0.5 + 0.5;
      const c = mix(base, accent, w * 0.5 + n * 0.15);
      return { ...c, a: 190 };
    }

    case 'starwater': {
      // Dark water with drifting stars.
      let c = mix(base, unpack(0x1a2050), n * 0.6);
      if (n2 > 0.972) c = accent;
      else if (n2 > 0.95) c = mix(c, accent, 0.5);
      return { ...c, a: 215 };
    }

    case 'glow': {
      // Warm core falling off to a dark housing.
      const d = Math.hypot(x - 7.5, y - 7.5);
      const f = Math.max(0, 1 - d / 7.5);
      return mix(base, accent, f * f * (0.9 + n * 0.2));
    }

    case 'mirror': {
      // Polished black with a curved highlight — it reflects you back.
      const d = Math.hypot(x - 5, y - 4);
      const hi = Math.max(0, 1 - d / 9);
      let c = mix(base, accent, hi * 0.8);
      c = shade(c, 0.94 + n * 0.12);
      return c;
    }

    case 'obelisk': {
      // Honest blackness: matte, almost featureless. Reflects nothing.
      return shade(mix(base, accent, n * 0.22), 0.97 + n2 * 0.06);
    }

    case 'lattice': {
      // Woven grid of light with bright knots.
      const gx = x % 4 === 0;
      const gy = y % 4 === 0;
      if (gx && gy) return accent;
      if (gx || gy) return mix(base, accent, 0.45 + n * 0.2);
      return null;
    }

    case 'glyph': {
      // Four-stroke tallies, as scratched on the bark ledger.
      const col = Math.floor(x / 4);
      const inGroup = x % 4 < 3;
      const band = y > 3 && y < 13;
      if (band && inGroup && (x % 4) - 0 === (col % 3 === 2 ? 1 : x % 4)) {
        // vertical strokes
      }
      if (band && x % 4 < 3 && hash2(col, Math.floor(y / 10), s) > 0.25) {
        if (x % 4 === 0 || x % 4 === 2) return accent;
      }
      // the diagonal fifth stroke
      if (band && col % 3 === 2 && Math.abs(x - 4 * col - 1 - (y - 4) * 0.25) < 0.8) return accent;
      return shade(base, 0.9 + n * 0.16);
    }

    case 'weave': {
      // Over-under basket weave.
      const cx = Math.floor(x / 4);
      const cy = Math.floor(y / 4);
      const over = (cx + cy) % 2 === 0;
      const band = over ? y % 4 : x % 4;
      const f = band === 0 ? 0.7 : band === 3 ? 0.85 : 1.0;
      return shade(mix(base, accent, over ? 0.25 : 0.55), f * (0.95 + n * 0.1));
    }

    case 'claw': {
      // Three-toed print pressed into the face.
      const toes: [number, number, number][] = [
        [5, 6, 1.6],
        [8, 5, 1.7],
        [11, 6, 1.6],
      ];
      for (const [tx, ty, tr] of toes) {
        if (Math.hypot(x - tx, y - ty) < tr) return shade(accent, 0.9);
      }
      if (Math.hypot(x - 8, y - 10.5) < 2.6) return shade(accent, 0.9);
      return shade(mix(base, unpack(0x806c48), n * 0.5), 0.93 + n2 * 0.14);
    }

    case 'carve': {
      // Woodcut relief: pale carved lines on dark timber.
      const line =
        Math.sin(x * 0.9 + Math.sin(y * 0.55) * 2.1) > 0.72 ||
        Math.sin(y * 1.1 + Math.cos(x * 0.4) * 1.6) > 0.85;
      if (line) return shade(accent, 0.9 + n * 0.18);
      return shade(base, 0.9 + n * 0.16);
    }

    case 'snow': {
      const c = mix(base, accent, n * 0.5);
      return shade(c, 0.95 + n2 * 0.1);
    }

    case 'ash': {
      const c = mix(base, accent, n * 0.7);
      return shade(c, 0.93 + n2 * 0.14);
    }

    case 'rootline': {
      // Golden veins branching through dark soil.
      const v =
        Math.abs(Math.sin(x * 0.55 + Math.sin(y * 0.42) * 2.4)) > 0.86 ||
        Math.abs(Math.sin(y * 0.5 + Math.cos(x * 0.33) * 2.0)) > 0.9;
      if (v) return shade(accent, 0.92 + n * 0.18);
      return shade(mix(base, unpack(0x2a1d10), n * 0.6), 0.92 + n2 * 0.14);
    }

    case 'glass': {
      const edge = x === 0 || y === 0 || x === TILE - 1 || y === TILE - 1;
      if (edge) return { ...shade(base, 0.8), a: 235 };
      const streak = (x + y) % 7 === 0;
      const c = mix(base, accent, streak ? 0.6 : 0.15 + n * 0.15);
      return { ...c, a: 110 };
    }

    case 'aurora': {
      const band = Math.sin(y * 0.4 + Math.sin(x * 0.25) * 2.0) * 0.5 + 0.5;
      const c = mix(base, accent, band * (0.6 + n * 0.4));
      return { ...c, a: 200 };
    }

    default:
      return base;
  }
}

export interface Atlas {
  texture: THREE.Texture;
  /** Tile index for a given block id and face slot. */
  tileOf(blockId: number, face: number): number;
  /** UV origin (u0, v0) and tile size in UV space. */
  uvSize: number;
}

let cached: Atlas | null = null;

export function buildAtlas(): Atlas {
  if (cached) return cached;

  const data = new Uint8Array(SIZE * SIZE * 4);

  // Each block occupies 3 consecutive tiles: top, side, bottom.
  const tileForBlock = (id: number, face: number) => id * 3 + face;

  for (const b of BLOCKS) {
    if (!b) continue;
    const faces: TexSpec[] = [b.tex.top, b.tex.side, b.tex.bottom];
    for (let f = 0; f < 3; f++) {
      const tileIndex = tileForBlock(b.id, f);
      if (tileIndex >= GRID * GRID) {
        throw new Error(
          `Texture atlas overflow: block ${b.id} needs tile ${tileIndex}, capacity ${GRID * GRID}. Increase GRID.`,
        );
      }
      const tx = (tileIndex % GRID) * TILE;
      const ty = Math.floor(tileIndex / GRID) * TILE;
      const spec = faces[f];
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const p = pixel(spec, spec.pattern, x, y);
          const o = ((ty + y) * SIZE + (tx + x)) * 4;
          if (!p) {
            data[o] = 0;
            data[o + 1] = 0;
            data[o + 2] = 0;
            data[o + 3] = 0;
          } else {
            data[o] = p.r;
            data[o + 1] = p.g;
            data[o + 2] = p.b;
            data[o + 3] = p.a;
          }
        }
      }
    }
  }

  const texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  cached = {
    texture,
    tileOf: tileForBlock,
    uvSize: 1 / GRID,
  };
  return cached;
}
