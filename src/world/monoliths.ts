/**
 * Monoliths — the Kubrick slab, scattered.
 *
 * One obelisk is hand-placed at the crater (see landmarks.ts, id 'crater').
 * These are the others: perfect black rectangular solids in the canonical
 * 1:4:9 ratio, standing on end in country that has no explanation for them.
 *
 * Two rules do all the work:
 *
 *  1. RARITY. Candidates live on a 512-block cell grid and jitter at most 64
 *     blocks off centre, so any two monoliths are at least 512 - 2*64 = 384
 *     blocks apart. The chunk stream only reaches VIEW_RADIUS*CX = 128 blocks
 *     and the fog closes at 260, so two can never be on screen together — the
 *     spacing guarantee is geometric, not a hope.
 *
 *  2. SITING. A candidate is only kept where the ground is open and slightly
 *     prominent (a ridgeline, a mesa cap, flat prairie), never in a hollow or
 *     a creek bed and never on a slope it would have to be bulldozed into.
 *     Everything about the object is featureless, so the only thing that can
 *     carry the read is where it stands and how cleanly it stands there.
 *
 * Placement is a pure function of (cell, seed): the same world always grows
 * the same monoliths, and `nearestMonolith` can answer for country that has
 * never been generated.
 */

import { Chunk, CX, CY, CZ } from './Chunk';
import { hash2, rng } from './noise';
import { terrainHeight, SEA_LEVEL } from './worldgen';
import { LANDMARKS, Writer } from './landmarks';
import { AIR, DIRT, OBELISK, STONE } from './blocks';

/** Spacing lattice. One candidate per cell, at most. */
export const MONOLITH_CELL = 512;

/** Max offset from the cell centre. Bounds the worst-case spacing (see above). */
const JITTER = 64;

/** Fraction of cells that even get a candidate, before terrain vetoes it. */
const PLACE_CHANCE = 0.42;

/** Largest possible pad radius (unit 3), used for cheap chunk/cell rejection. */
const MAX_PAD = 13;

export interface MonolithSite {
  /** Centre column of the slab. */
  x: number;
  z: number;
  /** Base unit. The slab is unit x 4*unit x 9*unit, the 9 standing vertical. */
  unit: number;
  /** True when the long horizontal face runs east-west. */
  axisX: boolean;
  /** World y of the ground block the slab stands on; the slab starts above it. */
  baseY: number;
  /** Radius of the cleared, flattened ring at its foot. */
  padR: number;
}

interface Candidate {
  x: number;
  z: number;
  unit: number;
  axisX: boolean;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Long horizontal half-extent, in blocks. The 4 of 1:4:9. */
const halfLongOf = (unit: number) => 2 * unit;

/** Cleared ring radius. Grows with the slab so the clearing stays in scale. */
const padRadiusOf = (unit: number) => 3 * unit + 4;

/**
 * The cheap half of placement: hashes only, no terrain. Used to reject cells
 * long before the expensive ground scan runs.
 */
function candidateAt(cellX: number, cellZ: number, seed: number): Candidate | null {
  if (hash2(cellX, cellZ, seed + 0x4d4f4e) > PLACE_CHANCE) return null;

  const r = rng((cellX * 374761393) ^ (cellZ * 668265263) ^ (seed + 0x0be115));
  const x = cellX * MONOLITH_CELL + MONOLITH_CELL / 2 + Math.round((r() * 2 - 1) * JITTER);
  const z = cellZ * MONOLITH_CELL + MONOLITH_CELL / 2 + Math.round((r() * 2 - 1) * JITTER);

  // Small ones dominate; a 3x12x27 slab should be the rarest thing in the world.
  const u = r();
  const unit = u < 0.55 ? 1 : u < 0.87 ? 2 : 3;

  return { x, z, unit, axisX: r() < 0.5 };
}

/**
 * Terrain veto for one candidate at one size. Returns null when this ground
 * cannot host a slab of this unit; the caller then tries a smaller one.
 */
function fitUnit(cand: Candidate, unit: number, seed: number): MonolithSite | null {
  const { x, z } = cand;
  const padR = padRadiusOf(unit);

  // Never crowd an authored site — the crater's obelisk in particular has to
  // stay the one you find at the end of a pilgrimage, not one of a set.
  for (const lm of LANDMARKS) {
    if (Math.hypot(lm.x - x, lm.z - z) < lm.radius + padR + 16) return null;
  }

  // Relief across the whole pad. Anything the flattening would have to cut or
  // fill by more than this is a hillside, not a place to stand something.
  let min = Infinity;
  let max = -Infinity;
  const pad2 = padR * padR;
  for (let dz = -padR; dz <= padR; dz++) {
    for (let dx = -padR; dx <= padR; dx++) {
      if (dx * dx + dz * dz > pad2) continue;
      const g = terrainHeight(x + dx, z + dz, seed);
      if (g < min) min = g;
      if (g > max) max = g;
    }
  }
  if (max - min > 3 + 3 * unit) return null;

  // Water. The creek and any lake surface sit at or below this, and a monolith
  // damming Boulder Creek with a dirt pad is exactly the wrong kind of wrong.
  if (min <= SEA_LEVEL + 2) return null;

  // Prominence: compare the centre against a ring well outside the pad. A site
  // that sits below its surroundings is a hollow or a canyon floor — the slab
  // has to be seen from away, so hollows are out and ridges are in.
  let ringSum = 0;
  const ringR = padR + 12;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ringSum += terrainHeight(x + Math.cos(a) * ringR, z + Math.sin(a) * ringR, seed);
  }
  const centre = terrainHeight(x, z, seed);
  if (centre < ringSum / 8 - 1.5) return null;

  // Sit the slab on the mean of its own footprint so it does not perch.
  const ex = axisExtents(unit, cand.axisX);
  let footSum = 0;
  let footN = 0;
  for (let dz = -ex.hz; dz <= ex.hz; dz++) {
    for (let dx = -ex.hx; dx <= ex.hx; dx++) {
      footSum += terrainHeight(x + dx, z + dz, seed);
      footN++;
    }
  }
  const baseY = Math.round(footSum / footN);

  // Fit under the 128-block ceiling with headroom for the cleared airspace,
  // and leave room below for the buried foot.
  if (baseY - 3 < 1 || baseY + 9 * unit > CY - 5) return null;

  return { x, z, unit, axisX: cand.axisX, baseY, padR };
}

/** Half-extents of the footprint along each world axis. */
function axisExtents(unit: number, axisX: boolean): { hx: number; hz: number } {
  const halfLong = halfLongOf(unit);
  const halfShort = Math.floor(unit / 2);
  return axisX ? { hx: halfLong, hz: halfShort } : { hx: halfShort, hz: halfLong };
}

/**
 * Validated sites are memoised per (seed, cell). The ground scan costs a few
 * hundred terrainHeight calls and every chunk a monolith touches would
 * otherwise repeat it, several times over, while the stream sweeps past.
 */
const siteCache = new Map<string, MonolithSite | null>();

function siteAt(cellX: number, cellZ: number, seed: number): MonolithSite | null {
  const key = `${seed}:${cellX}:${cellZ}`;
  const hit = siteCache.get(key);
  if (hit !== undefined) return hit;

  let site: MonolithSite | null = null;
  const cand = candidateAt(cellX, cellZ, seed);
  if (cand) {
    // Shrink rather than give up: a small slab often fits ground a large one
    // cannot, and a 1x4x9 in a tight spot still reads correctly.
    for (let unit = cand.unit; unit >= 1 && !site; unit--) {
      site = fitUnit(cand, unit, seed);
    }
  }

  // Bound the cache; sites are pure functions of the key so dropping them all
  // is always safe and they cost one scan to rebuild.
  if (siteCache.size > 4096) siteCache.clear();
  siteCache.set(key, site);
  return site;
}

/** True when the caller's predicate vetoes any part of the site's footprint. */
function vetoed(s: MonolithSite, exclude: (x: number, z: number) => boolean): boolean {
  if (exclude(s.x, s.z)) return true;
  const r = s.padR;
  return exclude(s.x - r, s.z) || exclude(s.x + r, s.z)
    || exclude(s.x, s.z - r) || exclude(s.x, s.z + r);
}

/**
 * Flatten, strip and clear the ground, then stand the slab in it.
 *
 * The pad is eased with a smoothstep instead of a hard disc so the ground does
 * not step down to a plate — from a distance you read a bare patch where
 * nothing grows, and only up close does it resolve into something levelled.
 */
function build(w: Writer, s: MonolithSite, ox: number, oz: number): void {
  const { x, z, unit, padR, baseY } = s;
  const core = halfLongOf(unit) + 2;
  const topY = baseY + 9 * unit;
  const pad2 = padR * padR;

  // Clamp to the chunk being written. The Writer would clip anyway; this just
  // keeps a 27x27 column sweep from running once per chunk the pad touches.
  const dx0 = Math.max(-padR, ox - x);
  const dx1 = Math.min(padR, ox + CX - 1 - x);
  const dz0 = Math.max(-padR, oz - z);
  const dz1 = Math.min(padR, oz + CZ - 1 - z);

  for (let dz = dz0; dz <= dz1; dz++) {
    for (let dx = dx0; dx <= dx1; dx++) {
      const d2 = dx * dx + dz * dz;
      if (d2 > pad2) continue;
      const wx = x + dx;
      const wz = z + dz;
      const g = w.ground(wx, wz);
      const t = 1 - smoothstep(core, padR, Math.sqrt(d2));
      const target = Math.round(g + (baseY - g) * t);

      // Fill under the new surface so raising the ground never leaves a gap.
      for (let y = Math.min(target, g) - 1; y < target; y++) w.set(wx, y, wz, DIRT);
      // Scoured stone at the foot, bare earth out to the rim. No plants, ever.
      w.set(wx, target, wz, d2 <= core * core ? STONE : DIRT);
      // Clear the airspace past the crown: no tree, boulder or hillside gets
      // to swallow it, and the silhouette stays unbroken against the sky.
      // +16, not +3: a ponderosa on the pad reaches ground+height+3 with
      // height up to 11, so a 3-block margin decapitates it and leaves the
      // crown hanging beside the slab.
      for (let y = target + 1; y <= topY + 16; y++) w.set(wx, y, wz, AIR);
    }
  }

  const ex = axisExtents(unit, s.axisX);
  // Even edge counts round toward -x/-z; the slab is featureless, so which way
  // the half-block lands is invisible as long as it is deterministic.
  const x0 = x - ex.hx;
  const x1 = x0 + (s.axisX ? 4 * unit : unit) - 1;
  const z0 = z - ex.hz;
  const z1 = z0 + (s.axisX ? unit : 4 * unit) - 1;

  // Three courses buried: the slab is keyed into the ground, never floating,
  // and the 9*unit that shows above the pad is the whole visible object.
  for (let y = baseY - 2; y <= topY; y++) {
    for (let wz = z0; wz <= z1; wz++) {
      for (let wx = x0; wx <= x1; wx++) w.set(wx, y, wz, OBELISK);
    }
  }
}

/**
 * Stamp any monolith whose pad overlaps this chunk.
 *
 * Call from worldgen.generateChunk immediately AFTER stampLandmarks(chunk,
 * seed) — landmarks must win any overlap, and the height map is rebuilt here
 * for the chunks that were actually written.
 *
 * @param exclude optional veto in world coordinates (villages, reserved land).
 */
export function stampMonoliths(
  chunk: Chunk,
  seed: number,
  exclude?: (x: number, z: number) => boolean,
): void {
  const ox = chunk.cx * CX;
  const oz = chunk.cz * CZ;

  const c0x = Math.floor((ox - MAX_PAD) / MONOLITH_CELL);
  const c1x = Math.floor((ox + CX - 1 + MAX_PAD) / MONOLITH_CELL);
  const c0z = Math.floor((oz - MAX_PAD) / MONOLITH_CELL);
  const c1z = Math.floor((oz + CZ - 1 + MAX_PAD) / MONOLITH_CELL);

  let touched = false;

  for (let cz = c0z; cz <= c1z; cz++) {
    for (let cx = c0x; cx <= c1x; cx++) {
      // Cheap hash-only pass first: most cells hold nothing, and the ones that
      // do are usually hundreds of blocks from this chunk.
      const cand = candidateAt(cx, cz, seed);
      if (!cand) continue;
      if (cand.x + MAX_PAD < ox || cand.x - MAX_PAD > ox + CX - 1) continue;
      if (cand.z + MAX_PAD < oz || cand.z - MAX_PAD > oz + CZ - 1) continue;

      const site = siteAt(cx, cz, seed);
      if (!site) continue;
      if (site.x + site.padR < ox || site.x - site.padR > ox + CX - 1) continue;
      if (site.z + site.padR < oz || site.z - site.padR > oz + CZ - 1) continue;
      if (exclude && vetoed(site, exclude)) continue;

      build(new Writer(chunk, ox, oz, seed), site, ox, oz);
      touched = true;
    }
  }

  // The Writer uses setRaw, which leaves the height map stale — entities stand
  // on heightAt, so without this they walk through a 27-block slab.
  if (touched) chunk.rebuildHeightMap();
}

/**
 * Nearest monolith to a world position, or null if none is within reach.
 *
 * Pure: works for country that has never been generated, so the compass and
 * any distance cue can point at one long before its chunks load. Searches the
 * 5x5 cell block around the point, which covers everything within one cell.
 */
export function nearestMonolith(
  x: number,
  z: number,
  seed: number,
  exclude?: (x: number, z: number) => boolean,
): { x: number; z: number; unit: number } | null {
  const cx = Math.floor(x / MONOLITH_CELL);
  const cz = Math.floor(z / MONOLITH_CELL);

  let best: MonolithSite | null = null;
  let bd = Infinity;

  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const cand = candidateAt(cx + dx, cz + dz, seed);
      if (!cand) continue;
      // Cheap distance reject before the ground scan.
      const cd = Math.hypot(cand.x - x, cand.z - z);
      if (cd >= bd) continue;

      const site = siteAt(cx + dx, cz + dz, seed);
      if (!site) continue;
      if (exclude && vetoed(site, exclude)) continue;

      const d = Math.hypot(site.x - x, site.z - z);
      if (d < bd) { bd = d; best = site; }
    }
  }

  return best ? { x: best.x, z: best.z, unit: best.unit } : null;
}
