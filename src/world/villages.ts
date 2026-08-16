/**
 * Solarpunk villages.
 *
 * The eight sites in landmarks.ts are the saga's spine; this file is the
 * culture that grew up around it. Everything here is derived from a cell hash,
 * so a village is identical for every player on a given seed and needs no
 * storage of any kind.
 *
 * Two constraints shape the whole design:
 *
 *  1. A village is far larger than a chunk, so it must be re-derivable from
 *     nothing but (cellX, cellZ, seed) and then clipped, exactly like a
 *     landmark. That is why EVERY random decision is baked into the cached
 *     descriptor by villageAt() and the build pass makes no rng calls at all,
 *     using a position-keyed hash for detail noise instead. A shared rng stream
 *     during the build would desynchronise the moment an AABB test rejected a
 *     piece, and the same cottage would come out different depending on which
 *     chunk you happened to be standing in when it streamed.
 *
 *  2. stampVillages() sits on the chunk-streaming critical path, so work is
 *     gated three times: a 3x3 cell scan, a village-level AABB reject, and a
 *     per-piece AABB reject inside the build. Loops that call ground() are
 *     additionally clamped to the chunk's own columns, because terrainHeight()
 *     is the expensive call here and Writer would only have thrown the result
 *     away.
 */

import { Chunk, CX, CY, CZ } from './Chunk';
import { rng } from './noise';
import { Biome, SEA_LEVEL, SLABS, frontLine, sampleColumn, terrainHeight } from './worldgen';
import { LANDMARKS, Writer } from './landmarks';
import {
  AIR, CANDLE, CLAWPRINT_STONE, CROP_RIPE, DIRT, FOUNTAIN_SANDSTONE,
  GREEN_SHOOT, LANTERN, LAVENDER, PALE_TIMBER, PLANK, RED_TIMBER, SCRUB_OAK,
  SOIL_LIVING, SOLAR_GLASS, STRING_LIGHT, TERRACE_STONE, WARM_BRICK, WATER,
  WOVEN_MAT,
} from './blocks';

// ------------------------------------------------------------------- tuning

/** Cell edge in chunks. 12 chunks = 192 blocks: far enough apart to travel. */
const CELL_CHUNKS = 12;
const CELL = CELL_CHUNKS * CX;
/** Keep the settlement clear of the cell edge so its AABB stays in 3x3 cells. */
const CELL_MARGIN = 66;
/** Hard cap on how far anything may reach from the village centre. */
const MAX_REACH = 64;
/** Fraction of cells that are even considered. Siting rejects most of those. */
const CELL_DENSITY = 0.75;

/**
 * Positional hash in [0,1).
 *
 * The mixer in noise.ts cannot be used for thresholds here. Its last step is
 * `(h ^ (h >> 16)) >>> 0` with an ARITHMETIC shift, so bit 31 of the result is
 * always `b ^ b` = 0: it never returns 0.5 or more, and every `> 0.5` test
 * against it is dead code. It also multiplies the seed by 1.4e18, which pushes
 * the sum past 2^53 and rounds the x/z contribution away. That fix belongs in
 * noise.ts, which this package does not own, so villages carry their own mixer
 * rather than silently inheriting a half-range.
 */
function h2(x: number, z: number, k: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ Math.imul(k | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

export type VillageLayout = 'commons' | 'lane' | 'terrace';

/** 0 cottage, 1 longhouse, 2 round hall, 3 tower/granary, 4 greenhouse. */
export type BuildingPlan = 0 | 1 | 2 | 3 | 4;

/** Door side: 0 = -Z, 1 = +Z, 2 = -X, 3 = +X. */
export type Facing = 0 | 1 | 2 | 3;

export interface VillageBuilding {
  /** Footprint centre, world coordinates. */
  x: number;
  z: number;
  /** Half extents of the wall line: the footprint is (2*hw+1) by (2*hd+1). */
  hw: number;
  hd: number;
  /** Floor level. Walls occupy y+1 .. y+wallH. */
  y: number;
  wallH: number;
  plan: BuildingPlan;
  wall: number;
  roof: number;
  floor: number;
  facing: Facing;
  /** Roof rise per horizontal step: 0.5 shallow, 1 steep. */
  pitch: number;
  /** Stable per-building noise key, so detail never depends on build order. */
  key: number;
}

export interface VillagePlot {
  x: number;
  z: number;
  hw: number;
  hd: number;
  /** true = beds run along X, false = along Z. */
  alongX: boolean;
  key: number;
}

export interface VillagePost {
  x: number;
  z: number;
  h: number;
}

export interface Village {
  cellX: number;
  cellZ: number;
  /** Centre, world coordinates. */
  x: number;
  z: number;
  /** Ground level at the centre. */
  y: number;
  name: string;
  /** Building count: 3-4 is a hamlet, 10-12 a proper village. */
  size: number;
  /** Half-extent for AABB rejection. */
  radius: number;
  layout: VillageLayout;
  /** The planting accent that gives this village its colour band. */
  accent: number;
  /** Timber used for posts, benches and trim. */
  trim: number;
  buildings: VillageBuilding[];
  plots: VillagePlot[];
  /** Lamp posts. Consecutive entries are strung with lights. */
  posts: VillagePost[];
  /** The fountain or well. Every settlement is built around drawn water. */
  water: VillageWater;
}

export interface VillageWater {
  x: number;
  z: number;
  y: number;
  /** A raised basin on the green, versus a plain well head on the street. */
  fountain: boolean;
}

// --------------------------------------------------------------------- names

/**
 * The same onset/coda construction as makeSigil() in systems/sigil.ts —
 * villages and raptors have to sound like they come from one language.
 */
const ONSET = ['ka', 've', 'thu', 'sil', 'mor', 'ael', 'rhe', 'tan', 'oru', 'lys', 'bre', 'nim'];
const CODA = ['dris', 'val', 'thas', 'wen', 'rok', 'lith', 'mar', 'sunn', 'ver', 'eth', 'orn', 'ka'];
const TAIL = [
  'Hollow', 'Bench', 'Ford', 'Rise', 'Green', 'Terrace',
  'Wells', 'Gate', 'Meadow', 'Crossing', 'Orchard', 'Commons',
];

function villageName(h: number): string {
  const a = ONSET[h % ONSET.length];
  const b = CODA[(h >>> 7) % CODA.length];
  const t = TAIL[(h >>> 15) % TAIL.length];
  return `${a.charAt(0).toUpperCase()}${a.slice(1)}${b} ${t}`;
}

// -------------------------------------------------------------------- siting

/** Ground this culture would actually settle on. */
function liveable(b: Biome): boolean {
  return b === Biome.Flatiron || b === Biome.Foothill
    || b === Biome.Prairie || b === Biome.Mesa;
}

/**
 * True if a village here would sit on or under a Flatiron slab. The slabs are
 * explicit geometry stamped on top of the heightfield, so terrainHeight() knows
 * nothing about them and a village sited there would be buried alive.
 */
function underSlab(x: number, z: number, seed: number): boolean {
  for (const s of SLABS) {
    if (Math.abs(z - s.z) > s.width / 2 + MAX_REACH) continue;
    const xFoot = frontLine(s.z, seed) - s.westOffset;
    const cot = 1 / Math.tan((s.dip * Math.PI) / 180);
    const xTop = xFoot - s.height * cot - s.thickness;
    if (x > xTop - MAX_REACH && x < xFoot + MAX_REACH) return true;
  }
  return false;
}

/** Landmarks own their ground; villages keep a generous berth. */
function nearLandmark(x: number, z: number): boolean {
  for (const lm of LANDMARKS) {
    const clear = lm.radius + MAX_REACH + 24;
    if (Math.abs(lm.x - x) < clear && Math.abs(lm.z - z) < clear) return true;
  }
  return false;
}

// --------------------------------------------------------------- descriptors

const cache = new Map<string, Village | null>();
const CACHE_CAP = 1024;

function remember(key: string, v: Village | null): Village | null {
  cache.set(key, v);
  // Insertion-ordered eviction rather than a wholesale clear: nearestVillage()
  // sweeps 25 cells, and dropping them all would re-derive the lot next frame.
  while (cache.size > CACHE_CAP) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
  return v;
}

/** The village occupying a cell, or null. Cached; cheap to call in a loop. */
export function villageAt(cellX: number, cellZ: number, seed: number): Village | null {
  const key = `${cellX},${cellZ},${seed}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  if (h2(cellX, cellZ, seed + 0x5e11) > CELL_DENSITY) return remember(key, null);

  const nameHash = (h2(cellX * 3 + 1, cellZ * 5 + 7, seed + 0x71d) * 0x100000000) >>> 0;
  const r = rng(Math.imul(cellX, 0x27d4eb2d) ^ Math.imul(cellZ, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1));

  const span = CELL - CELL_MARGIN * 2;
  const cx = Math.round(cellX * CELL + CELL_MARGIN + r() * span);
  const cz = Math.round(cellZ * CELL + CELL_MARGIN + r() * span);

  const site = sampleColumn(cx, cz, seed);
  if (!liveable(site.biome)) return remember(key, null);
  if (site.height < SEA_LEVEL + 3) return remember(key, null);
  if (nearLandmark(cx, cz) || underSlab(cx, cz, seed)) return remember(key, null);

  // Slope survey: four probes across the footprint. A village needs ground it
  // can terrace, not a cliff.
  const y0 = terrainHeight(cx, cz, seed);
  let lo = y0;
  let hi = y0;
  for (const [dx, dz] of [[-22, 0], [22, 0], [0, -22], [0, 22]]) {
    const yy = terrainHeight(cx + dx, cz + dz, seed);
    if (yy < lo) lo = yy;
    if (yy > hi) hi = yy;
  }
  const relief = hi - lo;
  if (relief > 26) return remember(key, null);

  const v: Village = {
    cellX,
    cellZ,
    x: cx,
    z: cz,
    y: Math.floor(y0),
    name: villageName(nameHash),
    size: 3 + Math.floor(r() * 10),
    radius: 0,
    layout: relief > 10 ? 'terrace' : r() < 0.5 ? 'commons' : 'lane',
    accent: [LAVENDER, CROP_RIPE, GREEN_SHOOT, SCRUB_OAK][Math.floor(r() * 4)],
    trim: r() < 0.68 ? PALE_TIMBER : RED_TIMBER,
    buildings: [],
    plots: [],
    posts: [],
    // Overwritten by layoutVillage once it knows where the open ground is.
    water: { x: cx, z: cz, y: Math.floor(y0), fountain: false },
  };

  layoutVillage(v, r, r() < 0.55 ? WARM_BRICK : PALE_TIMBER, seed);
  if (v.buildings.length < 3) return remember(key, null);

  // Radius comes from what actually got placed, so a hamlet rejects far more
  // chunks than a full village does.
  let reach = 16;
  for (const b of v.buildings) {
    reach = Math.max(reach, Math.abs(b.x - cx) + b.hw + 5, Math.abs(b.z - cz) + b.hd + 5);
  }
  for (const p of v.plots) {
    reach = Math.max(reach, Math.abs(p.x - cx) + p.hw + 3, Math.abs(p.z - cz) + p.hd + 3);
  }
  for (const p of v.posts) {
    reach = Math.max(reach, Math.abs(p.x - cx) + 2, Math.abs(p.z - cz) + 2);
  }
  const wr = waterPad(v) + 2;
  reach = Math.max(reach, Math.abs(v.water.x - cx) + wr, Math.abs(v.water.z - cz) + wr);
  v.radius = Math.min(MAX_REACH, reach);
  v.size = v.buildings.length;

  return remember(key, v);
}

// -------------------------------------------------------------------- layout

/** Half-extent of the flattened apron under a village's water feature. */
function waterPad(v: Village): number {
  return v.water.fountain ? 7 : 3;
}

interface Rect { x: number; z: number; hw: number; hd: number }

function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return Math.abs(a.x - b.x) <= a.hw + b.hw + gap
    && Math.abs(a.z - b.z) <= a.hd + b.hd + gap;
}

interface PlanSpec { plan: BuildingPlan; hw: number; hd: number; wallH: number }

/** Pick a plan and a footprint for building index `i`. */
function planFor(i: number, r: () => number): PlanSpec {
  const roll = r();
  // Building 0 is always communal. A settlement reads as a settlement because
  // it has one structure that is obviously not somebody's house.
  if (i === 0) {
    return roll < 0.55
      ? { plan: 2, hw: 6, hd: 6, wallH: 5 }
      : { plan: 1, hw: 4, hd: 8, wallH: 5 };
  }
  if (roll < 0.40) {
    const hw = 3 + Math.floor(r() * 2);
    return { plan: 0, hw, hd: hw + Math.floor(r() * 2), wallH: 4 + Math.floor(r() * 2) };
  }
  if (roll < 0.58) return { plan: 1, hw: 3, hd: 6 + Math.floor(r() * 3), wallH: 4 };
  if (roll < 0.72) return { plan: 4, hw: 3, hd: 4 + Math.floor(r() * 3), wallH: 4 };
  if (roll < 0.84) return { plan: 3, hw: 2, hd: 2, wallH: 8 + Math.floor(r() * 4) };
  return { plan: 2, hw: 4, hd: 4, wallH: 4 };
}

function faceToward(bx: number, bz: number, tx: number, tz: number): Facing {
  const dx = tx - bx;
  const dz = tz - bz;
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 3 : 2;
  return dz > 0 ? 1 : 0;
}

function pushBuilding(
  v: Village, x: number, z: number, spec: PlanSpec,
  facing: Facing, r: () => number, wallStock: number, seed: number,
): void {
  const rect: Rect = { x, z, hw: spec.hw, hd: spec.hd };
  for (const b of v.buildings) if (overlaps(rect, b, 4)) return;

  const y = Math.floor(terrainHeight(x, z, seed));
  // Leave headroom for the tallest roof this plan can grow.
  if (y < SEA_LEVEL + 2 || y > CY - 28) return;

  const glass = spec.plan === 4;
  v.buildings.push({
    x, z, hw: spec.hw, hd: spec.hd, y, wallH: spec.wallH, plan: spec.plan,
    wall: glass ? PALE_TIMBER : spec.plan === 3 ? WARM_BRICK : wallStock,
    roof: glass || r() < 0.28
      ? SOLAR_GLASS
      : v.trim === PALE_TIMBER ? RED_TIMBER : PALE_TIMBER,
    floor: glass ? SOIL_LIVING : PLANK,
    facing,
    pitch: spec.plan === 1 ? 0.5 : r() < 0.4 ? 0.6 : 1,
    key: Math.floor(r() * 0xffff),
  });
}

function pushPlot(
  v: Village, x: number, z: number, hw: number, hd: number,
  alongX: boolean, r: () => number,
): void {
  const rect: Rect = { x, z, hw, hd };
  // 3 is the minimum that clears both margins: a building pad runs two blocks
  // past its walls and a plot kerb one block past its beds.
  for (const b of v.buildings) if (overlaps(rect, b, 3)) return;
  for (const p of v.plots) if (overlaps(rect, p, 2)) return;
  v.plots.push({ x, z, hw, hd, alongX, key: Math.floor(r() * 0xffff) });
}

function layoutVillage(v: Village, r: () => number, wallStock: number, seed: number): void {
  const n = v.size;

  if (v.layout === 'commons') {
    // A green with a fountain on it and every frontage turned inward. The
    // centre stays clear — the void IS the public space.
    const ring = 17 + n;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r() * 0.35;
      const spec = planFor(i, r);
      const rad = ring + (i % 2) * 8;
      const bx = Math.round(v.x + Math.cos(a) * rad);
      const bz = Math.round(v.z + Math.sin(a) * rad);
      pushBuilding(v, bx, bz, spec, faceToward(bx, bz, v.x, v.z), r, wallStock, seed);
    }
    // Beds ring the outside of the frontage. Offsetting them half a bay round
    // puts each one in the gap BETWEEN two houses, which is the only way the
    // box overlap test lets a garden sit this close to a pad.
    for (let i = 0; i < 8; i++) {
      const a = ((i + 0.5) / 8) * Math.PI * 2;
      const rad = ring + 22;
      pushPlot(
        v, Math.round(v.x + Math.cos(a) * rad), Math.round(v.z + Math.sin(a) * rad),
        4 + Math.floor(r() * 3), 4 + Math.floor(r() * 3), r() < 0.5, r,
      );
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      v.posts.push({
        x: Math.round(v.x + Math.cos(a) * 10),
        z: Math.round(v.z + Math.sin(a) * 10),
        h: 4,
      });
    }
    v.water = { x: v.x, z: v.z, y: v.y, fountain: true };
    return;
  }

  if (v.layout === 'lane') {
    // Two rows of frontage along a street, kitchen beds out the back.
    const alongX = r() < 0.5;
    // Frontages advance every second building (one per side), so the street is
    // ceil(n/2) bays long. Start half a run back so the village straddles its
    // own centre instead of trailing off east.
    let cursor = -Math.round((Math.ceil(n / 2) - 1) * 6);
    for (let i = 0; i < n; i++) {
      const spec = planFor(i, r);
      const side = i % 2 === 0 ? 1 : -1;
      const off = 9 + (alongX ? spec.hd : spec.hw);
      const bx = Math.round(v.x + (alongX ? cursor : side * off));
      const bz = Math.round(v.z + (alongX ? side * off : cursor));
      const facing: Facing = alongX ? (side > 0 ? 0 : 1) : (side > 0 ? 2 : 3);
      pushBuilding(v, bx, bz, spec, facing, r, wallStock, seed);
      if (i % 2 === 1) cursor += 11 + Math.floor(r() * 4);
    }
    for (let i = 0; i < 6; i++) {
      const t = (i - 2.5) * 13;
      const side = i % 2 === 0 ? 1 : -1;
      // 40 clears the deepest frontage (offset 9 + a half-depth of up to 9).
      pushPlot(
        v,
        Math.round(v.x + (alongX ? t : side * 40)),
        Math.round(v.z + (alongX ? side * 40 : t)),
        4, 4, alongX, r,
      );
    }
    for (let i = -4; i <= 4; i++) {
      v.posts.push({
        x: Math.round(v.x + (alongX ? i * 7 : 4)),
        z: Math.round(v.z + (alongX ? 4 : i * 7)),
        h: 4,
      });
    }
    // The well head stands in the middle of the street, where both rows of
    // frontage can reach it.
    v.water = { x: v.x, z: v.z, y: v.y, fountain: false };
    return;
  }

  // ---- terrace: read the fall line and step the village down it.
  const gx = terrainHeight(v.x + 16, v.z, seed) - terrainHeight(v.x - 16, v.z, seed);
  const gz = terrainHeight(v.x, v.z + 16, seed) - terrainHeight(v.x, v.z - 16, seed);
  // Downhill snapped to an axis, so the terraces read as clean cut steps.
  const downX = Math.abs(gx) >= Math.abs(gz) ? (gx > 0 ? 1 : -1) : 0;
  const downZ = downX === 0 ? (gz > 0 ? 1 : -1) : 0;
  const acrossX = downZ;
  const acrossZ = downX;

  let placed = 0;
  for (let step = 0; placed < n && step < 4; step++) {
    // 17 apart on the fall line: any two footprints reach at most 6 each once
    // they are turned side-on below, so this is the tightest spacing that still
    // leaves a bench to walk and garden on between rows.
    const depth = step * 17;
    const perRow = step === 0 ? 1 : 3;
    for (let k = 0; k < perRow && placed < n; k++) {
      const spec = planFor(placed, r);
      // On a slope a building runs ALONG the contour: long axis across the fall
      // line. That is how hillside building actually works, and it is also what
      // keeps consecutive terraces far enough apart to garden between.
      const short = Math.min(spec.hw, spec.hd);
      const long = Math.max(spec.hw, spec.hd);
      spec.hw = downX !== 0 ? short : long;
      spec.hd = downX !== 0 ? long : short;

      const lat = (k - (perRow - 1) / 2) * 22;
      pushBuilding(
        v,
        Math.round(v.x + downX * depth + acrossX * lat),
        Math.round(v.z + downZ * depth + acrossZ * lat),
        spec,
        downX !== 0 ? (downX > 0 ? 3 : 2) : (downZ > 0 ? 1 : 0),
        r, wallStock, seed,
      );
      placed++;
    }
    // Kitchen beds on the flanks of each bench, long axis along the contour.
    for (const flank of [-42, 42]) {
      pushPlot(
        v,
        Math.round(v.x + downX * depth + acrossX * flank),
        Math.round(v.z + downZ * depth + acrossZ * flank),
        downX !== 0 ? 3 : 8,
        downX !== 0 ? 8 : 3,
        downZ !== 0,
        r,
      );
    }
  }
  // Lamps down the bench edge, between the middle house and the east row.
  for (let i = 0; i < 8; i++) {
    v.posts.push({
      x: Math.round(v.x + downX * i * 8 + acrossX * 12),
      z: Math.round(v.z + downZ * i * 8 + acrossZ * 12),
      h: 4,
    });
  }
  // The top bench carries only one building, so the well goes on its flank
  // where the whole village can walk uphill to it.
  const wx = Math.round(v.x + acrossX * 22);
  const wz = Math.round(v.z + acrossZ * 22);
  v.water = { x: wx, z: wz, y: Math.floor(terrainHeight(wx, wz, seed)), fountain: false };
}

// -------------------------------------------------------------- build context

/**
 * Writer plus the current chunk's world AABB. Every piece is rejected against
 * the box before it spends a set() call, and loops that sample terrain are
 * clamped to the chunk's own columns.
 */
class Site {
  readonly x1: number;
  readonly z1: number;

  constructor(
    readonly w: Writer,
    readonly x0: number,
    readonly z0: number,
    readonly seed: number,
  ) {
    this.x1 = x0 + CX - 1;
    this.z1 = z0 + CZ - 1;
  }

  hits(ax0: number, az0: number, ax1: number, az1: number): boolean {
    return ax1 >= this.x0 && ax0 <= this.x1 && az1 >= this.z0 && az0 <= this.z1;
  }

  hitsRect(x: number, z: number, hw: number, hd: number): boolean {
    return this.hits(x - hw, z - hd, x + hw, z + hd);
  }

  loX(v: number): number { return Math.max(v, this.x0); }
  hiX(v: number): number { return Math.min(v, this.x1); }
  loZ(v: number): number { return Math.max(v, this.z0); }
  hiZ(v: number): number { return Math.min(v, this.z1); }
}

/**
 * Flatten a rectangular pad to `y` and weld it into the slope beneath.
 *
 * Writer.pad() is a disc that only reaches six blocks down, which leaves a
 * floating shelf on exactly the kind of benched ground villages sit on.
 */
function padRect(
  s: Site, cx: number, cz: number, hw: number, hd: number, y: number, top: number,
): void {
  for (let z = s.loZ(cz - hd); z <= s.hiZ(cz + hd); z++) {
    for (let x = s.loX(cx - hw); x <= s.hiX(cx + hw); x++) {
      const g = s.w.ground(x, z);
      s.w.set(x, y, z, top);
      const base = Math.max(y - 24, Math.min(y - 1, g - 1));
      for (let yy = base; yy < y; yy++) s.w.set(x, yy, z, DIRT);
      for (let yy = y + 1; yy <= y + 14; yy++) s.w.set(x, yy, z, AIR);
    }
  }
}

/** True if (x,z) sits on a flattened apron: a building pad or the water. */
function onPad(v: Village, x: number, z: number): boolean {
  const wr = waterPad(v);
  if (Math.abs(v.water.x - x) <= wr && Math.abs(v.water.z - z) <= wr) return true;
  for (const b of v.buildings) {
    if (Math.abs(b.x - x) <= b.hw + 2 && Math.abs(b.z - z) <= b.hd + 2) return true;
  }
  return false;
}

/**
 * A terrain-following ribbon of paving, with headroom cleared above it.
 *
 * Cells already claimed by a pad are skipped: a path cuts its headroom at
 * natural terrain level, so running one across a flattened pad would saw a
 * trench through the fill holding that pad up. The pad is paved in the same
 * stone anyway, so the route still reads as continuous.
 */
function path(
  s: Site, v: Village, x0: number, z0: number, x1: number, z1: number, half: number,
): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
  if (steps === 0) return;
  if (!s.hits(
    Math.min(x0, x1) - half, Math.min(z0, z1) - half,
    Math.max(x0, x1) + half, Math.max(z0, z1) + half,
  )) return;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = Math.round(x0 + (x1 - x0) * t);
    const pz = Math.round(z0 + (z1 - z0) * t);
    for (let z = s.loZ(pz - half); z <= s.hiZ(pz + half); z++) {
      for (let x = s.loX(px - half); x <= s.hiX(px + half); x++) {
        if (onPad(v, x, z)) continue;
        const g = s.w.ground(x, z);
        // Prints signed into the paving — Ep3b, "wherever a print lands".
        s.w.set(x, g, z, h2(x, z, s.seed + 4404) > 0.86 ? CLAWPRINT_STONE : TERRACE_STONE);
        // 14, not 4: placeTrees runs BEFORE this and grows 7-11 block trunks
        // with crowns to h+14. Clearing only 4 saws them off at the ankles and
        // leaves the trunk and canopy floating over the path.
        for (let yy = g + 1; yy <= g + 14; yy++) s.w.set(x, yy, z, AIR);
      }
    }
  }
}

// ----------------------------------------------------------------- buildings

/** Doorway, jambs, lintel, and the woven awning over the threshold. */
function doorway(s: Site, b: VillageBuilding): void {
  const y = b.y;
  // Outward normal of the facing wall, and the tangent along it.
  const nx = b.facing === 2 ? -1 : b.facing === 3 ? 1 : 0;
  const nz = b.facing === 0 ? -1 : b.facing === 1 ? 1 : 0;
  const tx = nz;
  const tz = nx;
  const px = b.x + nx * b.hw;
  const pz = b.z + nz * b.hd;

  if (!s.hitsRect(px, pz, 4, 4)) return;

  // Two blocks wide so it reads as a door from across the green.
  for (let h = 1; h <= 3; h++) {
    s.w.set(px, y + h, pz, AIR);
    s.w.set(px + tx, y + h, pz + tz, AIR);
    s.w.set(px - tx, y + h, pz - tz, PALE_TIMBER);
    s.w.set(px + tx * 2, y + h, pz + tz * 2, PALE_TIMBER);
  }
  for (let k = -1; k <= 2; k++) s.w.set(px + tx * k, y + 4, pz + tz * k, PALE_TIMBER);

  // Awning on two posts, and the lantern every house is lit by at dusk.
  for (let o = 1; o <= 2; o++) {
    s.w.set(px + nx * o, y + 4, pz + nz * o, WOVEN_MAT);
    s.w.set(px + tx + nx * o, y + 4, pz + tz + nz * o, WOVEN_MAT);
  }
  for (let h = 1; h <= 3; h++) {
    s.w.set(px + nx * 2, y + h, pz + nz * 2, PALE_TIMBER);
    s.w.set(px + tx + nx * 2, y + h, pz + tz + nz * 2, PALE_TIMBER);
  }
  s.w.set(px - tx + nx * 2, y + 3, pz - tz + nz * 2, LANTERN);
}

/** Cottage, longhouse and greenhouse share one rectangular shell. */
function buildRect(s: Site, b: VillageBuilding): void {
  const { x, z, hw, hd, y, wallH } = b;
  const glass = b.plan === 4;

  for (let dz = -hd; dz <= hd; dz++) {
    for (let dx = -hw; dx <= hw; dx++) {
      const wx = x + dx;
      const wz = z + dz;
      s.w.set(wx, y, wz, b.floor);
      const onWall = Math.abs(dx) === hw || Math.abs(dz) === hd;
      const corner = Math.abs(dx) === hw && Math.abs(dz) === hd;
      for (let h = 1; h <= wallH; h++) {
        if (!onWall) { s.w.set(wx, y + h, wz, AIR); continue; }
        let id = b.wall;
        if (glass) {
          // Timber frame on a three-block rhythm, glazing between.
          id = corner || (dx + hw) % 3 === 0 || (dz + hd) % 3 === 0 ? PALE_TIMBER : SOLAR_GLASS;
        } else if (!corner && (h === 2 || (wallH >= 5 && h === 4))) {
          const along = Math.abs(dx) === hw ? dz + hd : dx + hw;
          if (along % 2 === 1) id = SOLAR_GLASS;
        }
        s.w.set(wx, y + h, wz, id);
      }
    }
  }

  // The ridge runs along the long axis; the roof steps in over the short one.
  const ridgeAlongZ = hw <= hd;
  const span = ridgeAlongZ ? hw : hd;
  const cross = ridgeAlongZ ? hd : hw;
  for (let i = 0; i <= span; i++) {
    const ry = y + wallH + 1 + Math.floor(i * b.pitch);
    const over = i === 0 ? 1 : 0; // eaves overhang by one at the bottom course
    for (let c = -cross - over; c <= cross + over; c++) {
      if (ridgeAlongZ) {
        s.w.set(x - hw + i, ry, z + c, b.roof);
        s.w.set(x + hw - i, ry, z + c, b.roof);
      } else {
        s.w.set(x + c, ry, z - hd + i, b.roof);
        s.w.set(x + c, ry, z + hd - i, b.roof);
      }
    }
    // Gable infill, so the roof never floats over an open triangle.
    for (let h = y + wallH + 1; h < ry; h++) {
      if (ridgeAlongZ) {
        s.w.set(x - hw + i, h, z - hd, b.wall);
        s.w.set(x - hw + i, h, z + hd, b.wall);
        s.w.set(x + hw - i, h, z - hd, b.wall);
        s.w.set(x + hw - i, h, z + hd, b.wall);
      } else {
        s.w.set(x - hw, h, z - hd + i, b.wall);
        s.w.set(x + hw, h, z - hd + i, b.wall);
        s.w.set(x - hw, h, z + hd - i, b.wall);
        s.w.set(x + hw, h, z + hd - i, b.wall);
      }
    }
  }

  if (glass) {
    // Beds under the glass, so a greenhouse reads as one from outside too.
    for (let dz = -hd + 1; dz <= hd - 1; dz++) {
      for (let dx = -hw + 1; dx <= hw - 1; dx++) {
        const wx = x + dx;
        const wz = z + dz;
        s.w.set(wx, y, wz, SOIL_LIVING);
        if ((dz + hd) % 2 === 0) {
          s.w.set(wx, y + 1, wz, h2(wx, wz, s.seed + 88) > 0.4 ? CROP_RIPE : GREEN_SHOOT);
        }
      }
    }
  } else if (b.plan === 1) {
    // Longhouse: a line of hearth candles you can see through the open door.
    for (let dz = -hd + 2; dz <= hd - 2; dz += 3) s.w.set(x, y + 1, z + dz, CANDLE);
  }

  doorway(s, b);
}

function buildRound(s: Site, b: VillageBuilding): void {
  const { x, z, y, wallH } = b;
  const r = b.hw;
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const d = Math.hypot(dx, dz);
      if (d > r + 0.5) continue;
      s.w.set(x + dx, y, z + dz, b.floor);
      const onWall = d > r - 1;
      for (let h = 1; h <= wallH; h++) {
        if (!onWall) { s.w.set(x + dx, y + h, z + dz, AIR); continue; }
        const window = h === 2 && h2(dx, dz, b.key) > 0.55;
        s.w.set(x + dx, y + h, z + dz, window ? SOLAR_GLASS : b.wall);
      }
    }
  }
  // Conical roof, drawn as shrinking rings.
  for (let i = 0; i <= r + 1; i++) {
    const rr = r + 1 - i;
    const ry = y + wallH + 1 + i;
    for (let dz = -rr; dz <= rr; dz++) {
      for (let dx = -rr; dx <= rr; dx++) {
        const d = Math.hypot(dx, dz);
        if (d > rr + 0.5 || d < rr - 1.2) continue;
        s.w.set(x + dx, ry, z + dz, b.roof);
      }
    }
  }
  s.w.set(x, y + wallH + r + 2, z, LANTERN);
  // The meeting floor: a ring of candles, the way the Council Ring is lit.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    s.w.set(
      x + Math.round(Math.cos(a) * (r - 2)), y + 1,
      z + Math.round(Math.sin(a) * (r - 2)), CANDLE,
    );
  }
  doorway(s, b);
}

function buildTower(s: Site, b: VillageBuilding): void {
  const { x, z, hw, y, wallH } = b;
  for (let h = 0; h <= wallH; h++) {
    for (let dz = -hw; dz <= hw; dz++) {
      for (let dx = -hw; dx <= hw; dx++) {
        if (h === 0) { s.w.set(x + dx, y, z + dz, b.floor); continue; }
        const onWall = Math.abs(dx) === hw || Math.abs(dz) === hw;
        if (!onWall) { s.w.set(x + dx, y + h, z + dz, AIR); continue; }
        // Slit windows every third course, away from the corners.
        const slit = h % 3 === 2 && Math.abs(dx) !== Math.abs(dz);
        s.w.set(x + dx, y + h, z + dz, slit ? SOLAR_GLASS : b.wall);
      }
    }
  }
  // Flat deck with a parapet: the granary lookout over the beds.
  const deck = y + wallH + 1;
  for (let dz = -hw - 1; dz <= hw + 1; dz++) {
    for (let dx = -hw - 1; dx <= hw + 1; dx++) {
      s.w.set(x + dx, deck, z + dz, PLANK);
      if (Math.abs(dx) === hw + 1 || Math.abs(dz) === hw + 1) {
        s.w.set(x + dx, deck + 1, z + dz, b.roof);
      }
    }
  }
  s.w.set(x, deck + 1, z, LANTERN);
  for (let dx = -hw; dx <= hw; dx += 2) {
    s.w.set(x + dx, deck + 2, z - hw - 1, STRING_LIGHT);
    s.w.set(x + dx, deck + 2, z + hw + 1, STRING_LIGHT);
  }
  doorway(s, b);
}

function buildBuilding(s: Site, b: VillageBuilding): void {
  const reach = Math.max(b.hw, b.hd) + 4;
  if (!s.hitsRect(b.x, b.z, reach, reach)) return;
  switch (b.plan) {
    case 2: buildRound(s, b); break;
    case 3: buildTower(s, b); break;
    default: buildRect(s, b); break;
  }
}

// ----------------------------------------------------------------- furniture

/** Raised-basin fountain. This is the piece that says "this place is kept". */
function buildFountain(s: Site, x: number, z: number, y: number): void {
  if (!s.hitsRect(x, z, 8, 8)) return;
  padRect(s, x, z, 7, 7, y, TERRACE_STONE);

  for (let dz = -5; dz <= 5; dz++) {
    for (let dx = -5; dx <= 5; dx++) {
      const d = Math.hypot(dx, dz);
      if (d > 4.4) continue;
      if (d > 3.2) { s.w.set(x + dx, y + 1, z + dz, FOUNTAIN_SANDSTONE); continue; }
      s.w.set(x + dx, y + 1, z + dz, FOUNTAIN_SANDSTONE);
      // Rim of sandstone holding a still sheet of water one course up.
      s.w.set(x + dx, y + 2, z + dz, d > 2.2 ? FOUNTAIN_SANDSTONE : WATER);
    }
  }
  for (let h = 2; h <= 4; h++) s.w.set(x, y + h, z, FOUNTAIN_SANDSTONE);
  s.w.set(x, y + 5, z, WATER);

  for (const [dx, dz] of [[6, 0], [-6, 0], [0, 6], [0, -6]]) {
    for (let h = 1; h <= 3; h++) s.w.set(x + dx, y + h, z + dz, PALE_TIMBER);
    s.w.set(x + dx, y + 4, z + dz, LANTERN);
  }
}

/** Well head: the same drawn water, at the scale of a street rather than a green. */
function buildWell(s: Site, x: number, z: number, y: number): void {
  if (!s.hitsRect(x, z, 5, 5)) return;
  padRect(s, x, z, 3, 3, y, TERRACE_STONE);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      s.w.set(x + dx, y + 1, z + dz, dx === 0 && dz === 0 ? WATER : FOUNTAIN_SANDSTONE);
    }
  }
  // Winch frame over the shaft, with the lantern that marks it after dark.
  for (let h = 2; h <= 4; h++) {
    s.w.set(x - 1, y + h, z, PALE_TIMBER);
    s.w.set(x + 1, y + h, z, PALE_TIMBER);
  }
  s.w.set(x, y + 4, z, PALE_TIMBER);
  s.w.set(x, y + 3, z, LANTERN);
}

/** Terraced kitchen beds in bands of colour. */
function buildPlot(s: Site, p: VillagePlot, accent: number, seed: number): void {
  if (!s.hitsRect(p.x, p.z, p.hw + 2, p.hd + 2)) return;

  const bands = p.alongX ? p.hd : p.hw;
  const runHalf = p.alongX ? p.hw : p.hd;

  for (let band = -bands; band <= bands; band++) {
    // Each band takes its level from its own centre, which is what terraces a
    // plot on a slope without the plot needing to know the slope direction.
    const bx = p.alongX ? p.x : p.x + band;
    const bz = p.alongX ? p.z + band : p.z;
    if (!s.hits(
      p.alongX ? p.x - runHalf : bx, p.alongX ? bz : p.z - runHalf,
      p.alongX ? p.x + runHalf : bx, p.alongX ? bz : p.z + runHalf,
    )) continue;

    const by = s.w.ground(bx, bz);
    const lo = p.alongX ? s.loX(p.x - runHalf) : s.loZ(p.z - runHalf);
    const hi = p.alongX ? s.hiX(p.x + runHalf) : s.hiZ(p.z + runHalf);

    for (let t = lo; t <= hi; t++) {
      const x = p.alongX ? t : bx;
      const z = p.alongX ? bz : t;
      s.w.set(x, by, z, SOIL_LIVING);
      s.w.set(x, by - 1, z, TERRACE_STONE);
      // Same reason as the paths: clear a whole tree's worth or the garden
      // grows under a floating canopy.
      for (let h = 1; h <= 14; h++) s.w.set(x, by + h, z, AIR);

      const kind = ((band % 3) + 3) % 3;
      if (kind === 0) s.w.set(x, by + 1, z, CROP_RIPE);
      else if (kind === 1) s.w.set(x, by + 1, z, accent);
      else if (h2(x, z, seed + p.key) > 0.45) s.w.set(x, by + 1, z, GREEN_SHOOT);
    }
  }

  // Stone kerb, so a plot reads as built rather than spilled.
  for (let x = s.loX(p.x - p.hw - 1); x <= s.hiX(p.x + p.hw + 1); x++) {
    for (const z of [p.z - p.hd - 1, p.z + p.hd + 1]) {
      if (z < s.z0 || z > s.z1) continue;
      s.w.set(x, s.w.ground(x, z), z, TERRACE_STONE);
    }
  }
  for (let z = s.loZ(p.z - p.hd - 1); z <= s.hiZ(p.z + p.hd + 1); z++) {
    for (const x of [p.x - p.hw - 1, p.x + p.hw + 1]) {
      if (x < s.x0 || x > s.x1) continue;
      s.w.set(x, s.w.ground(x, z), z, TERRACE_STONE);
    }
  }
}

/** Timber posts with lights strung between consecutive pairs. */
function buildLights(s: Site, v: Village): void {
  const posts = v.posts;
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    if (s.hitsRect(p.x, p.z, 1, 1) && !onPad(v, p.x, p.z)) {
      const g = s.w.ground(p.x, p.z);
      for (let h = 0; h < p.h; h++) s.w.set(p.x, g + h, p.z, v.trim);
      s.w.set(p.x, g + p.h, p.z, LANTERN);
    }

    // A line is not a loop: only the commons ring closes back on itself.
    if (i === posts.length - 1 && v.layout !== 'commons') continue;
    const q = posts[(i + 1) % posts.length];
    const steps = Math.max(Math.abs(q.x - p.x), Math.abs(q.z - p.z));
    if (steps < 2 || steps > 14) continue;
    if (!s.hits(
      Math.min(p.x, q.x), Math.min(p.z, q.z),
      Math.max(p.x, q.x), Math.max(p.z, q.z),
    )) continue;

    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      const lx = Math.round(p.x + (q.x - p.x) * t);
      const lz = Math.round(p.z + (q.z - p.z) * t);
      if (lx < s.x0 || lx > s.x1 || lz < s.z0 || lz > s.z1) continue;
      if (onPad(v, lx, lz)) continue;
      // Catenary sag: the middle of a span hangs a block lower than its posts.
      s.w.set(lx, s.w.ground(lx, lz) + p.h - (Math.abs(t - 0.5) < 0.28 ? 1 : 0), lz, STRING_LIGHT);
    }
  }
}

/** Benches, planters and mats around the green — places to actually sit. */
function buildCommonsFurniture(s: Site, v: Village): void {
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.4;
    const bx = v.x + Math.round(Math.cos(a) * 7);
    const bz = v.z + Math.round(Math.sin(a) * 7);
    if (!s.hitsRect(bx, bz, 2, 2)) continue;
    // The fountain apron flattened this whole disc, so use its level, not the
    // untouched terrain underneath it.
    const g = v.water.y;

    if (i % 2 === 0) {
      // Bench: a mat seat on a timber frame.
      const alongX = Math.abs(Math.cos(a)) < 0.5;
      for (let t = -1; t <= 1; t++) {
        s.w.set(bx + (alongX ? t : 0), g + 1, bz + (alongX ? 0 : t), v.trim);
      }
      s.w.set(bx, g + 2, bz, WOVEN_MAT);
    } else {
      // Planter: a stone kerb carrying the village's accent colour.
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          s.w.set(bx + dx, g + 1, bz + dz, dx !== 0 || dz !== 0 ? TERRACE_STONE : SOIL_LIVING);
        }
      }
      s.w.set(bx, g + 2, bz, v.accent);
    }
  }
}

// ------------------------------------------------------------------ stamping

function buildVillage(chunk: Chunk, v: Village, seed: number): void {
  const ox = chunk.cx * CX;
  const oz = chunk.cz * CZ;
  const s = new Site(new Writer(chunk, ox, oz, seed), ox, oz, seed);

  // Order matters. Pads clear the air above them, so everything that stands up
  // — plants, posts, lights, furniture — has to be written after every pad is
  // already down, including pads belonging to neighbouring buildings.
  for (const b of v.buildings) {
    if (!s.hitsRect(b.x, b.z, b.hw + 3, b.hd + 3)) continue;
    padRect(s, b.x, b.z, b.hw + 2, b.hd + 2, b.y, TERRACE_STONE);
  }
  if (v.water.fountain) buildFountain(s, v.water.x, v.water.z, v.water.y);
  else buildWell(s, v.water.x, v.water.z, v.water.y);

  // Paths run from the centre out to each doorstep.
  for (const b of v.buildings) {
    const nx = b.facing === 2 ? -1 : b.facing === 3 ? 1 : 0;
    const nz = b.facing === 0 ? -1 : b.facing === 1 ? 1 : 0;
    path(s, v, v.x, v.z, b.x + nx * (b.hw + 4), b.z + nz * (b.hd + 4), 1);
  }

  for (const p of v.plots) buildPlot(s, p, v.accent, seed);
  for (const b of v.buildings) buildBuilding(s, b);

  if (v.water.fountain) buildCommonsFurniture(s, v);
  buildLights(s, v);
}

/**
 * Stamp any village overlapping this chunk.
 *
 * Call from generateChunk() as the LAST world-gen step, on the line right after
 * `stampLandmarks(chunk, seed);`. It has to run after placeTrees() so a
 * ponderosa never grows through a roof, and after stampLandmarks() so the fixed
 * sites win any tie — villages are already sited clear of them, but ordering
 * makes that guarantee unconditional.
 */
export function stampVillages(chunk: Chunk, seed: number): void {
  const ox = chunk.cx * CX;
  const oz = chunk.cz * CZ;
  const gx = Math.floor(ox / CELL);
  const gz = Math.floor(oz / CELL);
  let touched = false;

  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const v = villageAt(gx + dx, gz + dz, seed);
      if (!v) continue;
      // Cheap AABB reject, the same shape stampLandmarks() uses.
      if (v.x + v.radius < ox || v.x - v.radius > ox + CX) continue;
      if (v.z + v.radius < oz || v.z - v.radius > oz + CZ) continue;
      buildVillage(chunk, v, seed);
      touched = true;
    }
  }

  // Writer goes through setRaw(), which does not maintain the height map, and
  // World.heightAt() reads it for spawning and block placement. Rebuild only
  // when a village really wrote here — this is the streaming path.
  if (touched) chunk.rebuildHeightMap();
}

/** Nearest village to a point, for the compass and the map. */
export function nearestVillage(
  x: number, z: number, seed: number,
): { x: number; z: number; name: string; size: number } | null {
  const gx = Math.floor(x / CELL);
  const gz = Math.floor(z / CELL);
  let best: Village | null = null;
  let bd = Infinity;

  // Two rings is 5x5 cells, 960 blocks across. Anything further away is not a
  // useful compass target, and every lookup in here is cached.
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const v = villageAt(gx + dx, gz + dz, seed);
      if (!v) continue;
      const d = Math.hypot(v.x - x, v.z - z);
      if (d < bd) { bd = d; best = v; }
    }
  }
  if (!best) return null;
  return { x: best.x, z: best.z, name: best.name, size: best.size };
}

/** Every village centred within `range` blocks of a point — for the map view. */
export function villagesNear(x: number, z: number, range: number, seed: number): Village[] {
  const cells = Math.ceil(range / CELL) + 1;
  const gx = Math.floor(x / CELL);
  const gz = Math.floor(z / CELL);
  const out: Village[] = [];
  for (let dz = -cells; dz <= cells; dz++) {
    for (let dx = -cells; dx <= cells; dx++) {
      const v = villageAt(gx + dx, gz + dz, seed);
      if (v && Math.hypot(v.x - x, v.z - z) <= range) out.push(v);
    }
  }
  return out;
}
