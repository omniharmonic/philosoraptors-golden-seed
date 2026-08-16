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
  AIR, CANDLE, CLAWPRINT_STONE, CROP_RIPE, DIRT, FOUNTAIN_SANDSTONE, GRASS_WARM,
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
 * Radius the slope survey covers.
 *
 * This has to match what a village actually OCCUPIES. The old survey probed
 * four points 22 blocks out, which is a third of the footprint: measured over
 * the real reach, 31% of villages stood on ground with 25-47 blocks of relief
 * while the gate believed it had rejected anything over 26.
 *
 * Set to MAX_REACH rather than a hand-picked number so it cannot drift out of
 * step with the footprint again — a survey that is even a few blocks short is
 * how the original bug happened.
 */
const SURVEY_R = MAX_REACH;
/**
 * Relief a settlement can terrace, measured across SURVEY_R.
 *
 * The relief histogram over 500 sites is bimodal, not a gradient: 65% of sites
 * come in under 15 blocks, almost nothing lands between 15 and 25, and the rest
 * are 25-47. That upper mode is one specific piece of ground — the abrupt range
 * front, which rises 0.52 blocks per block. That is a 27-degree wall, not a
 * hillside, and no amount of terracing makes it a village site.
 *
 * 30 across 108 blocks is a fall of 0.28, which the benches below turn into
 * retaining walls around six blocks high. Raising it further does not break the
 * terracing — measured at 34 the doors are still all reachable — but it starts
 * leaving hillside standing over the roofs, and the gain is 9% more villages.
 */
const MAX_RELIEF = 26;
/**
 * Alternate sites tried inside one cell before the cell is written off.
 *
 * Rejecting the range front outright costs 31% of all villages and empties the
 * whole Flatiron cell column. Re-rolling the jitter inside the same cell puts
 * the settlement back on the buildable ground next door instead, and it is the
 * re-roll, not a loose threshold, that pays for the strict gate: one try keeps
 * 69% of the old village count, five keeps 85%, twenty keeps 99%. Nine cold
 * cells — what a chunk entering fresh country pays, behind the cache — cost
 * 0.03ms at one try and 0.08ms at twenty.
 */
const SITE_TRIES = 20;

/** Headroom cleared above any levelled surface. Covers the tallest roof. */
const SHELL_CLEAR = 16;
/** Deepest cut or fill a pad will make. Siting keeps sites well inside this. */
const MAX_CUT = 32;
/**
 * How far below its surface a levelled rim is packed with stone.
 *
 * Filling below natural ground is invisible, so a blanket depth is cheaper and
 * more robust than working out how much of each rim ends up exposed: whatever
 * face the slope opens up is faced in TERRACE_STONE either way.
 */
const WALL_DEPTH = 8;

/** Fall-line spacing between terrace benches. */
const BENCH_STEP = 24;
/** Half depth of a bench, across the fall line. Benches abut at BENCH_STEP/2. */
const BENCH_DEEP = 12;
/** Contour spacing between the buildings on one bench. */
const BENCH_LAT = 26;
/** Benches per terrace village. 4 * BENCH_STEP / 2 = 48 blocks of reach. */
const BENCH_ROWS = 4;
/**
 * Tallest retaining wall the terrace will build.
 *
 * Siting keeps relief under MAX_RELIEF across SURVEY_R, which bounds a bench
 * riser to about six blocks — but the range front steepens as it goes, so a
 * site can survey clean and still fall away under the lowest bench. The chain
 * stops there rather than cutting a shelf at the bottom of a cliff.
 */
const MAX_RISER = 10;

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
  /**
   * Level to grow at, when the plot sits on a bench that has already been cut
   * flat. Undefined means the beds terrace themselves off natural ground.
   */
  y?: number;
}

export interface VillagePost {
  x: number;
  z: number;
  h: number;
  /**
   * Surface the post stands on. Carried in the descriptor rather than sampled
   * at build time, because a post on a bench stands on the CUT level and the
   * terrain function underneath it says something else entirely.
   */
  y: number;
}

/**
 * One cut-and-fill shelf of a terrace village.
 *
 * Benches abut along the fall line, so the downhill rim of one is the wall the
 * next one looks up at. That rim is what makes the terracing read as built.
 */
export interface VillageBench {
  x: number;
  z: number;
  hw: number;
  hd: number;
  y: number;
}

/** A flight of steps cut into a bench, joining it to the one above. */
export interface VillageStair {
  x: number;
  z: number;
  /** Unit vector pointing downhill; exactly one component is non-zero. */
  dx: number;
  dz: number;
  yTop: number;
  yBot: number;
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
  /** Cut shelves, uphill first. Empty unless the layout is 'terrace'. */
  benches: VillageBench[];
  /** Steps between consecutive benches. Empty unless the layout is 'terrace'. */
  stairs: VillageStair[];
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

/**
 * Relief across the ground a village would actually stand on.
 *
 * Three rings of eight probes out to SURVEY_R, for 25 terrainHeight() calls
 * instead of ~1800 — this runs on the chunk-streaming path, once per cell,
 * behind the cache.
 *
 * It UNDER-READS, by 0.41 blocks on average and 8.7 at worst when measured
 * against a full 2-block grid over 500 accepted sites. MAX_RELIEF is set below
 * what the terracing can handle by more than that worst case, so a site that
 * surveys clean is genuinely buildable rather than merely probably buildable.
 */
function surveyRelief(x: number, z: number, seed: number): number {
  let lo = terrainHeight(x, z, seed);
  let hi = lo;
  for (let ring = 1; ring <= 3; ring++) {
    const rr = (SURVEY_R * ring) / 3;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const h = terrainHeight(x + Math.cos(a) * rr, z + Math.sin(a) * rr, seed);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  }
  return hi - lo;
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

  // Site the settlement. A cell gets several attempts rather than one, because
  // the cells that fail are the ones sitting against the range front, and the
  // buildable bench is usually only a few dozen blocks away inside the same
  // cell.
  const span = CELL - CELL_MARGIN * 2;
  let cx = 0;
  let cz = 0;
  let relief = 0;
  let sited = false;
  for (let attempt = 0; attempt < SITE_TRIES; attempt++) {
    const px = Math.round(cellX * CELL + CELL_MARGIN + r() * span);
    const pz = Math.round(cellZ * CELL + CELL_MARGIN + r() * span);
    const site = sampleColumn(px, pz, seed);
    if (!liveable(site.biome)) continue;
    if (site.height < SEA_LEVEL + 3) continue;
    if (nearLandmark(px, pz) || underSlab(px, pz, seed)) continue;
    // Survey last: it is the only expensive test in the list.
    const rel = surveyRelief(px, pz, seed);
    if (rel > MAX_RELIEF) continue;
    cx = px;
    cz = pz;
    relief = rel;
    sited = true;
    break;
  }
  if (!sited) return remember(key, null);

  const y0 = terrainHeight(cx, cz, seed);

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
    benches: [],
    stairs: [],
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
  // Benches are levelled ground, so they have to be inside the AABB or a chunk
  // holding nothing but shelf would never be told to cut it.
  for (const b of v.benches) {
    reach = Math.max(reach, Math.abs(b.x - cx) + b.hw + 2, Math.abs(b.z - cz) + b.hd + 2);
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
  level?: number,
): boolean {
  const rect: Rect = { x, z, hw: spec.hw, hd: spec.hd };
  for (const b of v.buildings) if (overlaps(rect, b, 4)) return false;

  // On a terrace the floor is the bench level, not the ground under the middle
  // of the footprint: the whole point of cutting a shelf is that every building
  // on it shares one datum.
  const y = level ?? Math.floor(terrainHeight(x, z, seed));
  // Leave headroom for the tallest roof this plan can grow.
  if (y < SEA_LEVEL + 2 || y > CY - 28) return false;

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
  return true;
}

function pushPlot(
  v: Village, x: number, z: number, hw: number, hd: number,
  alongX: boolean, r: () => number, level?: number,
): void {
  const rect: Rect = { x, z, hw, hd };
  // 3 is the minimum that clears both margins: a building pad runs two blocks
  // past its walls and a plot kerb one block past its beds.
  for (const b of v.buildings) if (overlaps(rect, b, 3)) return;
  for (const p of v.plots) if (overlaps(rect, p, 2)) return;
  v.plots.push({ x, z, hw, hd, alongX, key: Math.floor(r() * 0xffff), y: level });
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
      const px = Math.round(v.x + Math.cos(a) * 10);
      const pz = Math.round(v.z + Math.sin(a) * 10);
      v.posts.push({ x: px, z: pz, h: 4, y: Math.floor(terrainHeight(px, pz, seed)) });
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
      const px = Math.round(v.x + (alongX ? i * 7 : 4));
      const pz = Math.round(v.z + (alongX ? 4 : i * 7));
      v.posts.push({ x: px, z: pz, h: 4, y: Math.floor(terrainHeight(px, pz, seed)) });
    }
    // The well head stands in the middle of the street, where both rows of
    // frontage can reach it.
    v.water = { x: v.x, z: v.z, y: v.y, fountain: false };
    return;
  }

  // ---- terrace: read the fall line and step the village down it.
  const gx = terrainHeight(v.x + 16, v.z, seed) - terrainHeight(v.x - 16, v.z, seed);
  const gz = terrainHeight(v.x, v.z + 16, seed) - terrainHeight(v.x, v.z - 16, seed);
  // Downhill is the direction the ground FALLS in. gx is the height gained
  // walking east, so gx > 0 means east is UPHILL and downhill is -X. Getting
  // this backwards sent every terrace village marching up its own slope and
  // turned every front door into the bank behind it; snapping to an axis is
  // what keeps the benches reading as cut steps rather than a ramp.
  const downX = Math.abs(gx) >= Math.abs(gz) ? (gx > 0 ? -1 : 1) : 0;
  const downZ = downX === 0 ? (gz > 0 ? -1 : 1) : 0;
  const acrossX = downZ;
  const acrossZ = downX;
  // Everything on a terrace is described by its extent ACROSS the fall line and
  // its extent ALONG the contour; these two put that on the right world axis.
  const fallIsX = downX !== 0;
  const xOf = (fall: number, lat: number) => (fallIsX ? fall : lat);
  const zOf = (fall: number, lat: number) => (fallIsX ? lat : fall);

  let placed = 0;
  for (let step = 0; step < BENCH_ROWS && placed < n; step++) {
    // Benches straddle the centre so the village sits ON its own site rather
    // than trailing off downhill from it: 4 rows at 24 reach 48 either way,
    // which is exactly what the siting survey measured.
    const depth = (step - (BENCH_ROWS - 1) / 2) * BENCH_STEP;
    const bx = Math.round(v.x + downX * depth);
    const bz = Math.round(v.z + downZ * depth);
    const by = Math.floor(terrainHeight(bx, bz, seed));
    if (by < SEA_LEVEL + 2 || by > CY - 28) break;
    const above = v.benches[v.benches.length - 1];
    if (above && above.y - by > MAX_RISER) break;

    // The top bench carries the one communal building; the rest carry a row.
    const perRow = step === 0 ? 1 : 3;
    let maxLat = 0;
    let any = false;
    for (let k = 0; k < perRow && placed < n; k++) {
      const spec = planFor(placed, r);
      // On a slope a building runs ALONG the contour: long axis across the fall
      // line. That is how hillside building actually works, and it is also what
      // keeps the row short enough for three of them to share a bench.
      const short = Math.min(spec.hw, spec.hd);
      const long = Math.max(spec.hw, spec.hd);
      spec.hw = xOf(short, long);
      spec.hd = zOf(short, long);

      const lat = (k - (perRow - 1) / 2) * BENCH_LAT;
      // Sit the shell against the uphill rim so the bench in front of the door
      // stays open. Without the shift the pad fills the shelf and the doorway
      // opens straight onto the retaining wall.
      const set = depth - 4;
      const ok = pushBuilding(
        v,
        Math.round(v.x + downX * set + acrossX * lat),
        Math.round(v.z + downZ * set + acrossZ * lat),
        spec,
        downX !== 0 ? (downX > 0 ? 3 : 2) : (downZ > 0 ? 1 : 0),
        r, wallStock, seed, by,
      );
      placed++;
      if (!ok) continue;
      any = true;
      maxLat = Math.max(maxLat, Math.abs(lat) + Math.max(spec.hw, spec.hd) + 3);
    }
    if (!any) continue;

    // The bench also has to carry the lamp row out to lat 20, and on the top
    // bench the well head at lat 22. 38 is the widest that still leaves the
    // whole village inside MAX_REACH.
    if (step === 0) maxLat = Math.max(maxLat, 27);
    const hw = Math.min(38, Math.max(22, maxLat));
    v.benches.push({
      x: bx, z: bz,
      hw: xOf(BENCH_DEEP, hw),
      hd: zOf(BENCH_DEEP, hw),
      y: by,
    });

    // Kitchen beds fill the open strip in front of the doors, level with the
    // bench. House row, garden, retaining wall — that is the whole terrace.
    const plotLat = hw - 3;
    pushPlot(
      v,
      Math.round(v.x + downX * (depth + 9) + acrossX * 0),
      Math.round(v.z + downZ * (depth + 9) + acrossZ * 0),
      xOf(2, plotLat), zOf(2, plotLat),
      downZ !== 0, r, by,
    );

    // Lamps along the front of the bench, close enough to string together.
    // Offset off the bay centres: buildings sit on multiples of BENCH_LAT and
    // their doors open straight down the fall line, so a post on a bay centre
    // stands in a doorway. 6 clear of the nearest one is as far as the 13-block
    // string spacing allows.
    for (let k = -2; k <= 1; k++) {
      const lat = k * 13 + 7;
      v.posts.push({
        x: Math.round(v.x + downX * (depth + 6) + acrossX * lat),
        z: Math.round(v.z + downZ * (depth + 6) + acrossZ * lat),
        h: 4,
        y: by,
      });
    }
  }

  // Steps down each retaining wall, cut into the bench below and kept clear of
  // both building rows by sitting in the gap between them.
  for (let i = 1; i < v.benches.length; i++) {
    const up = v.benches[i - 1];
    const lo = v.benches[i];
    if (lo.y >= up.y) continue;
    const edge = (fallIsX ? up.hw : up.hd) + 1;
    v.stairs.push({
      x: Math.round(up.x + downX * edge + acrossX * 13),
      z: Math.round(up.z + downZ * edge + acrossZ * 13),
      dx: downX,
      dz: downZ,
      yTop: up.y,
      yBot: lo.y,
    });
  }

  const top = v.benches[0];
  if (top) {
    const wx = Math.round(top.x + acrossX * 22);
    const wz = Math.round(top.z + acrossZ * 22);
    v.water = { x: wx, z: wz, y: top.y, fountain: false };
  } else {
    const wx = Math.round(v.x + acrossX * 22);
    const wz = Math.round(v.z + acrossZ * 22);
    v.water = { x: wx, z: wz, y: Math.floor(terrainHeight(wx, wz, seed)), fountain: false };
  }
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
 * Cut and fill a rectangle to `y`, and face the exposed edge in stone.
 *
 * Writer.pad() is a disc that only reaches six blocks down, which leaves a
 * floating shelf on exactly the kind of benched ground villages sit on. This
 * differs from the old rectangular version in two ways that matter on a slope:
 *
 *  - the RIM is packed with `rim` stone rather than dirt, down past whatever
 *    the fall line exposes, so a pad on a slope shows a retaining wall instead
 *    of a raw dirt scarp. Packing below natural ground is invisible, so a
 *    blanket depth is cheaper than working out the exposed height per column.
 *  - the clear reaches `g + 16` as well as `y + SHELL_CLEAR`, so a cut never
 *    leaves the hillside — or the ponderosa rooted on it, placeTrees having run
 *    long before this — standing over the roof it was cut for.
 */
function padRect(
  s: Site, cx: number, cz: number, hw: number, hd: number, y: number,
  top: number, rimTop = top, rimFill = TERRACE_STONE,
): void {
  for (let z = s.loZ(cz - hd); z <= s.hiZ(cz + hd); z++) {
    for (let x = s.loX(cx - hw); x <= s.hiX(cx + hw); x++) {
      const g = s.w.ground(x, z);
      const rim = x === cx - hw || x === cx + hw || z === cz - hd || z === cz + hd;
      s.w.set(x, y, z, rim ? rimTop : top);
      const want = rim ? Math.min(y - WALL_DEPTH, g - 1) : Math.min(y - 1, g - 1);
      const base = Math.max(y - MAX_CUT, want);
      for (let yy = base; yy < y; yy++) s.w.set(x, yy, z, rim ? rimFill : DIRT);
      const clearTo = Math.max(y + SHELL_CLEAR, Math.min(g + 16, y + MAX_CUT + 16));
      for (let yy = y + 1; yy <= clearTo; yy++) s.w.set(x, yy, z, AIR);
    }
  }
}

/**
 * Face the cut bank standing just outside a levelled rectangle.
 *
 * The pad stops at its own edge, so on the uphill side the untouched hillside
 * stands beside it as a bare dirt wall up to six blocks tall. One ring of
 * TERRACE_STONE turns that into the revetment a cut terrace actually has.
 */
function revetCut(
  s: Site, v: Village, cx: number, cz: number, hw: number, hd: number, y: number,
): void {
  if (!s.hitsRect(cx, cz, hw + 1, hd + 1)) return;
  for (let z = s.loZ(cz - hd - 1); z <= s.hiZ(cz + hd + 1); z++) {
    for (let x = s.loX(cx - hw - 1); x <= s.hiX(cx + hw + 1); x++) {
      if (Math.abs(x - cx) <= hw && Math.abs(z - cz) <= hd) continue;
      // Another shelf may already own this column at a different level; its
      // surface must win or the revetment grows out of the middle of a bench.
      if (onLevelled(v, x, z)) continue;
      const g = s.w.ground(x, z);
      const face = Math.min(g, y + MAX_CUT);
      for (let yy = y + 1; yy <= face; yy++) s.w.set(x, yy, z, TERRACE_STONE);
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

/** onPad, plus the terrace benches. Anything that cuts terrain must respect it. */
function onLevelled(v: Village, x: number, z: number): boolean {
  for (const b of v.benches) {
    if (Math.abs(b.x - x) <= b.hw && Math.abs(b.z - z) <= b.hd) return true;
  }
  return onPad(v, x, z);
}

/** Cut one terrace bench: grass shelf, stone rim, stone wall down the fall. */
function buildBench(s: Site, b: VillageBench): void {
  if (!s.hitsRect(b.x, b.z, b.hw, b.hd)) return;
  padRect(s, b.x, b.z, b.hw, b.hd, b.y, GRASS_WARM, TERRACE_STONE);
}

/**
 * Steps down a retaining wall.
 *
 * One tread per block of drop, cut into the LOWER bench, so the flight lands on
 * a surface that is already level instead of on the slope it replaced.
 */
function buildStair(s: Site, st: VillageStair): void {
  const drop = st.yTop - st.yBot;
  if (drop <= 0) return;
  // Tangent along the wall: the flight is three blocks wide.
  const tx = st.dz;
  const tz = st.dx;
  if (!s.hitsRect(
    st.x + (st.dx * drop) / 2, st.z + (st.dz * drop) / 2,
    Math.abs(st.dx) * drop + 2, Math.abs(st.dz) * drop + 2,
  )) return;

  for (let k = 0; k < drop; k++) {
    const level = st.yTop - 1 - k;
    const px = st.x + st.dx * k;
    const pz = st.z + st.dz * k;
    for (let t = -1; t <= 1; t++) {
      const x = px + tx * t;
      const z = pz + tz * t;
      if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
      s.w.set(x, level, z, TERRACE_STONE);
      for (let yy = Math.max(0, st.yBot - 1); yy < level; yy++) {
        s.w.set(x, yy, z, TERRACE_STONE);
      }
      for (let yy = level + 1; yy <= st.yTop + SHELL_CLEAR; yy++) s.w.set(x, yy, z, AIR);
    }
  }
}

/**
 * Steps from a doorstep down (or up) to natural ground.
 *
 * A pad on rolling ground leaves a step of up to six blocks between its rim and
 * the path that runs to it, which is simply not walkable. The flight stops the
 * moment it meets another levelled surface, which is why a terrace building
 * gets none: the bench in front of its door is already its own floor level.
 */
function doorSteps(s: Site, v: Village, b: VillageBuilding): void {
  const nx = b.facing === 2 ? -1 : b.facing === 3 ? 1 : 0;
  const nz = b.facing === 0 ? -1 : b.facing === 1 ? 1 : 0;
  const tx = nz;
  const tz = nx;
  let level = b.y;

  for (let step = 1; step <= 12; step++) {
    const px = b.x + nx * (b.hw + 2 + step);
    const pz = b.z + nz * (b.hd + 2 + step);
    if (onLevelled(v, px, pz)) return;
    const g = s.w.ground(px, pz);
    if (level === g) return;
    level += level > g ? -1 : 1;
    for (let t = -1; t <= 1; t++) {
      const x = px + tx * t;
      const z = pz + tz * t;
      if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
      s.w.set(x, level, z, TERRACE_STONE);
      const base = Math.max(0, level - WALL_DEPTH);
      for (let yy = base; yy < level; yy++) s.w.set(x, yy, z, TERRACE_STONE);
      const clearTo = Math.max(level + 6, Math.min(g + 2, level + MAX_CUT));
      for (let yy = level + 1; yy <= clearTo; yy++) s.w.set(x, yy, z, AIR);
    }
  }
}

/**
 * A terrain-following ribbon of paving, with headroom cleared above it.
 *
 * Cells already claimed by a pad or a bench are skipped: a path cuts its
 * headroom at natural terrain level, so running one across flattened ground
 * would saw a trench through the fill holding that ground up. A pad is paved in
 * the same stone anyway, and a bench IS the route, so a skipped cell never
 * breaks the read.
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
        if (onLevelled(v, x, z)) continue;
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

/**
 * Terraced kitchen beds in bands of colour.
 *
 * Each band takes one level, which is what terraces a plot on a slope without
 * the plot needing to know the slope direction. Two things make that survive on
 * real ground: the soil is carried on a TERRACE_STONE riser packed down to
 * natural grade, so a band running out over a fall does not hang in the air;
 * and a column where the hillside has climbed more than a block above the band
 * is left alone rather than trenched, so a bed meets a bank instead of
 * disappearing into it.
 */
function buildPlot(s: Site, p: VillagePlot, accent: number, seed: number): void {
  if (!s.hitsRect(p.x, p.z, p.hw + 2, p.hd + 2)) return;

  const bands = p.alongX ? p.hd : p.hw;
  const runHalf = p.alongX ? p.hw : p.hd;

  // One band past each end is the kerb, so it sits at the level of the bed it
  // edges rather than on whatever the untouched ground happens to be doing.
  for (let band = -bands - 1; band <= bands + 1; band++) {
    const inner = Math.max(-bands, Math.min(bands, band));
    const bx = p.alongX ? p.x : p.x + inner;
    const bz = p.alongX ? p.z + inner : p.z;
    const cx = p.alongX ? p.x : p.x + band;
    const cz = p.alongX ? p.z + band : p.z;
    if (!s.hits(
      p.alongX ? p.x - runHalf - 1 : cx, p.alongX ? cz : p.z - runHalf - 1,
      p.alongX ? p.x + runHalf + 1 : cx, p.alongX ? cz : p.z + runHalf + 1,
    )) continue;

    // A plot on a bench shares the bench's datum; anywhere else each band
    // levels itself off the ground under its own centre line.
    const by = p.y ?? s.w.ground(bx, bz);
    const lo = p.alongX ? s.loX(p.x - runHalf - 1) : s.loZ(p.z - runHalf - 1);
    const hi = p.alongX ? s.hiX(p.x + runHalf + 1) : s.hiZ(p.z + runHalf + 1);

    for (let t = lo; t <= hi; t++) {
      const x = p.alongX ? t : cx;
      const z = p.alongX ? cz : t;
      const run = p.alongX ? t - p.x : t - p.z;
      const kerb = Math.abs(band) > bands || Math.abs(run) > runHalf;
      const g = s.w.ground(x, z);
      // Where the hill has risen clear of the bed, stop: the plot has run into
      // a bank and cutting it in would leave a garden at the bottom of a slot.
      // A bench plot is exempt — the shelf under it has already been cut to
      // `by`, and terrainHeight() still describes the hillside that was there.
      if (p.y === undefined && g > by + 2) continue;

      s.w.set(x, by, z, kerb ? TERRACE_STONE : SOIL_LIVING);
      // Riser under the bed, down to grade. Below grade it is invisible.
      const base = Math.max(by - MAX_CUT, Math.min(by - 1, g - 1));
      for (let yy = base; yy < by; yy++) s.w.set(x, yy, z, TERRACE_STONE);
      // Same reason as the paths: clear a whole tree's worth or the garden
      // grows under a floating canopy.
      for (let h = 1; h <= 14; h++) s.w.set(x, by + h, z, AIR);
      if (kerb) continue;

      const kind = ((band % 3) + 3) % 3;
      if (kind === 0) s.w.set(x, by + 1, z, CROP_RIPE);
      else if (kind === 1) s.w.set(x, by + 1, z, accent);
      else if (h2(x, z, seed + p.key) > 0.45) s.w.set(x, by + 1, z, GREEN_SHOOT);
    }
  }
}

/** Timber posts with lights strung between consecutive pairs. */
function buildLights(s: Site, v: Village): void {
  const posts = v.posts;
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    if (s.hitsRect(p.x, p.z, 1, 1) && !onPad(v, p.x, p.z)) {
      // p.y, not the terrain: a post on a bench stands on the cut level.
      for (let h = 0; h < p.h; h++) s.w.set(p.x, p.y + h, p.z, v.trim);
      s.w.set(p.x, p.y + p.h, p.z, LANTERN);
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
      // The span interpolates between the two post TOPS, so a string across a
      // stepped bench stays a straight run instead of following the ground.
      const ly = Math.round(p.y + (q.y - p.y) * t) + p.h;
      s.w.set(lx, ly - (Math.abs(t - 0.5) < 0.28 ? 1 : 0), lz, STRING_LIGHT);
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

  // Order matters. Levelling clears the air above it, so everything that stands
  // up — plants, posts, lights, furniture — has to be written after every pad
  // is already down, including pads belonging to neighbouring buildings.
  //
  // Benches go first and DOWNHILL FIRST, so where two abut, the upper bench's
  // rim wins the shared column: that column is the retaining wall the lower
  // bench looks up at, and it has to be packed to the upper level.
  for (let i = v.benches.length - 1; i >= 0; i--) buildBench(s, v.benches[i]);
  for (const st of v.stairs) buildStair(s, st);

  for (const b of v.buildings) {
    if (!s.hitsRect(b.x, b.z, b.hw + 3, b.hd + 3)) continue;
    padRect(s, b.x, b.z, b.hw + 2, b.hd + 2, b.y, TERRACE_STONE);
  }
  // Revet the cut banks only once every pad exists, so a bank shared with a
  // neighbouring shelf is recognised as somebody's floor rather than faced over.
  for (const b of v.benches) revetCut(s, v, b.x, b.z, b.hw, b.hd, b.y);
  for (const b of v.buildings) revetCut(s, v, b.x, b.z, b.hw + 2, b.hd + 2, b.y);

  if (v.water.fountain) buildFountain(s, v.water.x, v.water.z, v.water.y);
  else buildWell(s, v.water.x, v.water.z, v.water.y);

  // Paths run from the centre out to each doorstep.
  for (const b of v.buildings) {
    const nx = b.facing === 2 ? -1 : b.facing === 3 ? 1 : 0;
    const nz = b.facing === 0 ? -1 : b.facing === 1 ? 1 : 0;
    path(s, v, v.x, v.z, b.x + nx * (b.hw + 4), b.z + nz * (b.hd + 4), 1);
  }
  // After the paths: the flight bridges the pad rim to the path that ends at
  // its foot, so it has to be the thing that wins that ground.
  for (const b of v.buildings) {
    if (s.hitsRect(b.x, b.z, b.hw + 16, b.hd + 16)) doorSteps(s, v, b);
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
