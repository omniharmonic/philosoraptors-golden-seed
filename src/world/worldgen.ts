/**
 * Worldgen — the Front Range at Boulder.
 *
 * The defining fact about Boulder's landscape is a DISCONTINUITY, not a
 * gradient: the High Plains run dead flat to the eastern horizon and then the
 * range front jumps thousands of feet in about a mile. Isotropic fBm cannot
 * produce that — it makes rolling hills in every direction — so the terrain is
 * oriented instead:
 *
 *      -X  <<-- west, uphill                    east, plains -->>  +X
 *      divide | subalpine | foothills | FRONT | mesas | prairie
 *
 * The Flatirons are not noise either. They are slabs of Fountain Formation
 * arkose tilted up on end, dipping east at roughly 50-55 degrees, so they are
 * generated as explicit geometry: a plane x = x0 - (y-y0)/tan(dip) with a
 * triangular footprint that tapers as it rises. That is what produces the
 * leaning-triangle silhouette rather than a lump.
 */

import { Chunk, CX, CY, CZ } from './Chunk';
import { fbm2, noise2, ridge2, rng, hash2 } from './noise';
import {
  AIR, AMBER_SEED, ASH, BOULDER, COTTONWOOD_LEAVES, COTTONWOOD_LOG, CROP_RIPE,
  DIRT, FOUNTAIN_SANDSTONE, GRASS_WARM, GREEN_SHOOT, LAVENDER, LICHEN_SANDSTONE,
  PONDEROSA_LOG, PONDEROSA_NEEDLES, PRAIRIE_GRASS, SCORCHED_SOIL, SCRUB_OAK,
  SNOW, SOIL_RAKED, SPRUCE_LEAVES, SPRUCE_LOG, STONE, WATER,
} from './blocks';
import { stampLandmarks } from './landmarks';

/** Boulder sits near 5,430 ft; this is our stand-in plains datum. */
export const PLAINS_Y = 36;
export const SEA_LEVEL = 30;

export enum Biome {
  Prairie,
  Mesa,
  Foothill,
  Flatiron,
  Subalpine,
  Divide,
  GrayValley,
  AshWaste,
}

export interface Sample {
  height: number;
  biome: Biome;
  /** Distance west of the range front. Negative on the plains. */
  west: number;
  /** 0 = fully extractive, 1 = fully tended. Seeds the chunk tend score. */
  vitality: number;
}

/**
 * North-south wobble of the range front, so the mountain wall is not a
 * straight line. Depends only on z, which keeps the front coherent.
 */
export function frontLine(wz: number, seed: number): number {
  return (fbm2(wz / 430, 17.5, seed + 9101, 3) - 0.5) * 150;
}

/**
 * Height gained climbing `d` blocks west of the front.
 *
 * Tuned to land under the world ceiling WITH the ridge noise on top. The
 * previous curve peaked at PLAINS_Y + 118 = 154 against a 128-block world, so
 * every high summit was silently clamped and the Divide rendered as a flat
 * plateau instead of mountains.
 */
function riseProfile(d: number): number {
  if (d < 80) return d * 0.52;                      // the abrupt mountain front
  if (d < 380) return 41.6 + (d - 80) * 0.072;      // foothills
  if (d < 820) return 63.2 + (d - 380) * 0.045;     // climbing to the divide
  return Math.min(86, 83 + (d - 820) * 0.02);       // Continental Divide
}

/** Creek centreline (Boulder Creek out of the canyon, running east). */
function creekZ(wx: number, seed: number): number {
  return 30 + (fbm2(wx / 320, 3.3, seed + 771, 3) - 0.5) * 110;
}

export function terrainHeight(wx: number, wz: number, seed: number): number {
  const front = frontLine(wz, seed);
  const d = front - wx; // positive = west of the front, i.e. into the mountains

  let h: number;

  if (d <= 0) {
    // ---- High Plains: flat, with a gentle eastward tilt.
    const e = -d;
    h = PLAINS_Y - e * 0.009 + (fbm2(wx / 260, wz / 260, seed + 5, 3) - 0.5) * 7;

    // Davidson / South Boulder style mesas: flat caps standing above the prairie.
    const mesaN = fbm2(wx / 340, wz / 340, seed + 4409, 3);
    if (mesaN > 0.66 && e > 120) {
      const t = smoothstep(0.66, 0.74, mesaN);
      h = h * (1 - t) + (PLAINS_Y + 16) * t;
    }
  } else {
    // ---- Foothills through the Divide.
    h = PLAINS_Y + riseProfile(d);
    // Detail grows with elevation: smooth grassy base, craggy up high.
    const rough = 5 + Math.min(d, 700) / 700 * 20;
    h += (ridge2(wx / 165, wz / 165, seed + 1301, 4) - 0.42) * rough;
    h += (fbm2(wx / 70, wz / 70, seed + 77, 3) - 0.5) * 7;
  }

  // ---- Creek / canyon carve.
  const cz = creekZ(wx, seed);
  const dz = Math.abs(wz - cz);
  if (dz < 18) {
    const t = 1 - dz / 18;
    // Deeper and steeper inside the mountains — that is the canyon.
    const depth = d > 0 ? 16 : 7;
    h -= t * t * depth;
  }

  return h;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ------------------------------------------------------------- the Flatirons

interface Slab {
  /** Centre along north-south. */
  z: number;
  /** How far west of the front the slab's foot sits. */
  westOffset: number;
  width: number;
  height: number;
  /** Dip in degrees; the Fountain Formation stands at roughly 50-55. */
  dip: number;
  thickness: number;
}

/**
 * The named clusters, north to south: Flagstaff, the Five on Green Mountain,
 * then Bear Peak and the Devil's Thumb country.
 */
export const SLABS: Slab[] = [
  // Flagstaff shoulder
  { z: 300, westOffset: 40, width: 34, height: 40, dip: 52, thickness: 5 },
  { z: 258, westOffset: 52, width: 30, height: 36, dip: 54, thickness: 4 },
  // The Five (Green Mountain's east face)
  { z: 176, westOffset: 44, width: 52, height: 70, dip: 51, thickness: 6 },
  { z: 116, westOffset: 50, width: 48, height: 64, dip: 53, thickness: 6 },
  { z: 58, westOffset: 46, width: 56, height: 78, dip: 50, thickness: 7 }, // the Third
  { z: 2, westOffset: 54, width: 44, height: 58, dip: 54, thickness: 5 },
  { z: -50, westOffset: 48, width: 40, height: 52, dip: 55, thickness: 5 },
  // Skunk Canyon / Bear Peak
  { z: -120, westOffset: 60, width: 36, height: 46, dip: 53, thickness: 5 },
  { z: -186, westOffset: 44, width: 50, height: 66, dip: 51, thickness: 6 },
  { z: -244, westOffset: 58, width: 38, height: 50, dip: 55, thickness: 5 },
  { z: -310, westOffset: 50, width: 44, height: 60, dip: 52, thickness: 6 },
  // Southern outliers
  { z: -390, westOffset: 66, width: 30, height: 38, dip: 56, thickness: 4 },
  { z: -452, westOffset: 48, width: 42, height: 56, dip: 52, thickness: 5 },
  { z: 372, westOffset: 62, width: 28, height: 34, dip: 55, thickness: 4 },
];

/** World-space bounding box of a slab, for cheap chunk rejection. */
function slabBounds(s: Slab, seed: number) {
  const front = frontLine(s.z, seed);
  const xFoot = front - s.westOffset;
  const cot = 1 / Math.tan((s.dip * Math.PI) / 180);
  // The top leans west by height*cot.
  const xTop = xFoot - s.height * cot - s.thickness;
  return {
    minX: xTop - 2,
    maxX: xFoot + 2,
    minZ: s.z - s.width / 2 - 2,
    maxZ: s.z + s.width / 2 + 2,
    xFoot,
    cot,
  };
}

/**
 * Stamp any Flatiron slabs overlapping this chunk.
 *
 * Each course of the slab is a horizontal strip whose x position walks west as
 * y rises, and whose half-width shrinks toward a point — a tilted triangle.
 */
function stampFlatirons(chunk: Chunk, seed: number): void {
  const ox = chunk.cx * CX;
  const oz = chunk.cz * CZ;

  for (const s of SLABS) {
    const b = slabBounds(s, seed);
    if (b.maxX < ox || b.minX > ox + CX) continue;
    if (b.maxZ < oz || b.minZ > oz + CZ) continue;

    const yFoot = Math.floor(terrainHeight(b.xFoot, s.z, seed));

    for (let ly = 0; ly <= s.height; ly++) {
      const t = ly / s.height;
      // Taper to a blunt point, with a slight convex swell low down.
      const half = (s.width / 2) * (1 - t) * (1 + 0.18 * Math.sin(t * Math.PI));
      if (half < 0.6) continue;

      const y = yFoot + ly;
      if (y < 1 || y >= CY - 1) continue;

      const xSurf = b.xFoot - ly * b.cot;
      const thick = Math.max(2, Math.round(s.thickness * (1 - t * 0.45)));

      const z0 = Math.ceil(s.z - half);
      const z1 = Math.floor(s.z + half);

      for (let wz = z0; wz <= z1; wz++) {
        const lz = wz - oz;
        if (lz < 0 || lz >= CZ) continue;

        // Ragged edges so the slab does not read as a machined plate.
        const edge = 1 - Math.abs(wz - s.z) / Math.max(1, half);
        const jitter = hash2(wz, ly, seed + 313) * 2.2;
        if (edge < 0.08 + jitter * 0.05) continue;

        for (let k = 0; k < thick; k++) {
          const wx = Math.round(xSurf - k);
          const lx = wx - ox;
          if (lx < 0 || lx >= CX) continue;
          // Lichen blotches on the sunlit east face.
          const face = k === 0 && hash2(wx, wz + ly, seed + 55) > 0.72;
          chunk.setRaw(lx, y, lz, face ? LICHEN_SANDSTONE : FOUNTAIN_SANDSTONE);
        }

        // Weld the slab into the hillside so it never floats.
        const wxFill = Math.round(xSurf - thick);
        const lxF = wxFill - ox;
        if (lxF >= 0 && lxF < CX) {
          const ground = Math.floor(terrainHeight(wxFill, wz, seed));
          if (y <= ground) chunk.setRaw(lxF, y, lz, FOUNTAIN_SANDSTONE);
        }
      }
    }
  }
}

// ------------------------------------------------------------------- biomes

export function sampleColumn(wx: number, wz: number, seed: number): Sample {
  const height = terrainHeight(wx, wz, seed);
  const front = frontLine(wz, seed);
  const west = front - wx;

  // The saga's damaged ground exists as rare regional overlays out on the
  // plains, so the Boulder look dominates but the story ground still exists.
  const molochN = fbm2(wx / 460, wz / 460, seed + 3607, 3);
  const ashN = fbm2(wx / 1400, wz / 1400, seed + 8123, 2);

  let biome: Biome;
  let vitality: number;

  if (west < -80 && ashN > 0.83) {
    biome = Biome.AshWaste; vitality = 0.05;
  } else if (west < -80 && molochN > 0.74) {
    biome = Biome.GrayValley; vitality = 0.12;
  } else if (west > 820 || height > PLAINS_Y + 104) {
    biome = Biome.Divide; vitality = 0.3;
  } else if (west > 380) {
    biome = Biome.Subalpine; vitality = 0.45;
  } else if (west > 20) {
    biome = Biome.Foothill; vitality = 0.62;
  } else if (west > -110) {
    // The bench right at the base — Chautauqua's meadow.
    biome = Biome.Flatiron; vitality = 0.75;
  } else if (height > PLAINS_Y + 10) {
    biome = Biome.Mesa; vitality = 0.5;
  } else {
    biome = Biome.Prairie; vitality = 0.6;
  }

  return { height, biome, west, vitality };
}

function surfaceBlock(s: Sample, y: number): number {
  if (y < SEA_LEVEL) return DIRT;
  switch (s.biome) {
    case Biome.AshWaste: return ASH;
    case Biome.GrayValley: return SOIL_RAKED;
    case Biome.Divide: return y > PLAINS_Y + 96 ? SNOW : STONE;
    case Biome.Subalpine: return STONE;
    case Biome.Foothill: return GRASS_WARM;
    case Biome.Flatiron: return GRASS_WARM;
    case Biome.Mesa: return PRAIRIE_GRASS;
    case Biome.Prairie: return PRAIRIE_GRASS;
  }
}

export function generateChunk(chunk: Chunk, seed: number): void {
  const ox = chunk.cx * CX;
  const oz = chunk.cz * CZ;
  let vitalitySum = 0;

  for (let z = 0; z < CZ; z++) {
    for (let x = 0; x < CX; x++) {
      const wx = ox + x;
      const wz = oz + z;
      const s = sampleColumn(wx, wz, seed);
      vitalitySum += s.vitality;

      const h = Math.max(1, Math.min(CY - 2, Math.floor(s.height)));
      const soilDepth = s.biome === Biome.Divide || s.biome === Biome.Subalpine
        ? 1
        : 3 + Math.floor(noise2(wx / 9, wz / 9, seed + 55) * 3);

      for (let y = 0; y <= h; y++) {
        let id: number;
        if (y === h) id = surfaceBlock(s, y);
        else if (y > h - soilDepth) id = DIRT;
        else if (s.biome === Biome.Flatiron || s.biome === Biome.Foothill) {
          // Arkose bedrock under the range front.
          id = y > h - 18 ? FOUNTAIN_SANDSTONE : STONE;
        } else id = STONE;
        chunk.setRaw(x, y, z, id);
      }

      if (h < SEA_LEVEL) {
        for (let y = h + 1; y <= SEA_LEVEL; y++) chunk.setRaw(x, y, z, WATER);
      }

      // Creek water in the carved channel.
      const cz = creekZ(wx, seed);
      if (Math.abs(wz - cz) < 4 && h > SEA_LEVEL) {
        chunk.setRaw(x, h, z, WATER);
        chunk.setRaw(x, h - 1, z, WATER);
      }

      if (h > SEA_LEVEL) scatter(chunk, x, h, z, wx, wz, s, seed);
    }
  }

  chunk.tend = Math.round((vitalitySum / (CX * CZ) - 0.5) * 24);

  stampFlatirons(chunk, seed);
  chunk.rebuildHeightMap();
  placeTrees(chunk, seed);
  stampLandmarks(chunk, seed);
}

/** Ground cover: scrub oak, prairie flowers, amber seeds, talus. */
function scatter(
  chunk: Chunk, x: number, h: number, z: number,
  wx: number, wz: number, s: Sample, seed: number,
): void {
  const r = hash2(wx, wz, seed + 777);
  const above = h + 1;
  if (above >= CY - 1) return;

  switch (s.biome) {
    case Biome.Flatiron:
      // Chautauqua meadow: grass, scattered seeds, oak at the margins.
      if (r > 0.988) chunk.setRaw(x, above, z, SCRUB_OAK);
      else if (r > 0.978) chunk.setRaw(x, above, z, AMBER_SEED);
      else if (r > 0.972) chunk.setRaw(x, above, z, LAVENDER);
      break;
    case Biome.Foothill:
      if (r > 0.982) chunk.setRaw(x, above, z, SCRUB_OAK);
      else if (r > 0.975) chunk.setRaw(x, above, z, BOULDER);
      else if (r > 0.970) chunk.setRaw(x, above, z, AMBER_SEED);
      break;
    case Biome.Prairie:
      if (r > 0.990) chunk.setRaw(x, above, z, LAVENDER);
      else if (r > 0.984) chunk.setRaw(x, above, z, CROP_RIPE);
      break;
    case Biome.Mesa:
      if (r > 0.992) chunk.setRaw(x, above, z, SCRUB_OAK);
      break;
    case Biome.Subalpine:
    case Biome.Divide:
      if (r > 0.988) chunk.setRaw(x, above, z, BOULDER);
      break;
    case Biome.GrayValley:
      if (r > 0.9975) chunk.setRaw(x, above, z, GREEN_SHOOT);
      break;
    case Biome.AshWaste:
      if (r > 0.9975) chunk.setRaw(x, above, z, GREEN_SHOOT);
      else if (r > 0.994) chunk.setRaw(x, above, z, SCORCHED_SOIL);
      break;
  }
}

const put = (c: Chunk, x: number, y: number, z: number, id: number, overwrite = false) => {
  if (x < 0 || x >= CX || z < 0 || z >= CZ || y < 0 || y >= CY) return;
  if (!overwrite && c.get(x, y, z) !== AIR) return;
  c.setRaw(x, y, z, id);
};

function placeTrees(chunk: Chunk, seed: number): void {
  const ox = chunk.cx * CX;
  const oz = chunk.cz * CZ;
  const r = rng((chunk.cx * 73856093) ^ (chunk.cz * 19349663) ^ seed);

  for (let i = 0; i < 10; i++) {
    const x = Math.floor(r() * CX);
    const z = Math.floor(r() * CZ);
    const wx = ox + x;
    const wz = oz + z;
    const s = sampleColumn(wx, wz, seed);
    const h = chunk.heightMap[z * CX + x];
    if (h <= SEA_LEVEL || h >= CY - 14) continue;

    // Don't grow trees out of the bare rock of a Flatiron face.
    const on = chunk.get(x, h, z);
    if (on === FOUNTAIN_SANDSTONE || on === LICHEN_SANDSTONE) continue;

    const nearCreek = Math.abs(wz - creekZ(wx, seed)) < 16;

    // Front Range ponderosa grow as open savanna, not closed canopy — widely
    // spaced trees over grass, with the rock faces visible between them. Dense
    // forest here would hide the Flatirons, which are the whole point.
    let density: number;
    switch (s.biome) {
      case Biome.Foothill: density = 0.20; break;
      case Biome.Flatiron: density = 0.09; break;
      case Biome.Subalpine: density = 0.30; break;
      case Biome.Divide: density = 0.06; break;
      case Biome.Prairie: density = nearCreek ? 0.28 : 0.015; break;
      case Biome.Mesa: density = 0.04; break;
      default: density = 0.03;
    }
    if (r() > density) continue;

    if (s.biome === Biome.AshWaste || s.biome === Biome.GrayValley) {
      deadTree(chunk, x, h + 1, z, r);
    } else if (nearCreek && s.west < 60) {
      cottonwood(chunk, x, h + 1, z, r);
    } else if (s.biome === Biome.Subalpine || s.biome === Biome.Divide) {
      subalpineFir(chunk, x, h + 1, z, r);
    } else {
      ponderosa(chunk, x, h + 1, z, r);
    }
  }
}

/** Ponderosa: tall bare trunk, open irregular crown. Not a Christmas tree. */
function ponderosa(c: Chunk, x: number, y: number, z: number, r: () => number): void {
  const height = 7 + Math.floor(r() * 5);
  for (let i = 0; i < height; i++) put(c, x, y + i, z, PONDEROSA_LOG, true);
  const crownBase = Math.floor(height * 0.48);
  for (let i = crownBase; i < height + 3; i++) {
    const t = (i - crownBase) / (height + 3 - crownBase);
    const rad = Math.max(1, Math.round((1 - Math.abs(t - 0.45) * 1.6) * 3));
    for (let dz = -rad; dz <= rad; dz++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (dx * dx + dz * dz > rad * rad + 1) continue;
        if (dx === 0 && dz === 0 && i < height) continue;
        if (r() > 0.78) continue; // open, airy crown
        put(c, x + dx, y + i, z + dz, PONDEROSA_NEEDLES);
      }
    }
  }
}

function subalpineFir(c: Chunk, x: number, y: number, z: number, r: () => number): void {
  const height = 7 + Math.floor(r() * 5);
  for (let i = 0; i < height; i++) put(c, x, y + i, z, SPRUCE_LOG, true);
  for (let i = 2; i < height + 2; i++) {
    const t = i / (height + 2);
    const rad = Math.max(0, Math.round((1 - t) * 2.8));
    if (rad === 0) { put(c, x, y + i, z, SPRUCE_LEAVES); continue; }
    for (let dz = -rad; dz <= rad; dz++)
      for (let dx = -rad; dx <= rad; dx++) {
        if (Math.abs(dx) + Math.abs(dz) > rad + 1) continue;
        if (dx === 0 && dz === 0 && i < height) continue;
        put(c, x + dx, y + i, z + dz, SPRUCE_LEAVES);
      }
  }
}

function cottonwood(c: Chunk, x: number, y: number, z: number, r: () => number): void {
  const height = 6 + Math.floor(r() * 4);
  for (let i = 0; i < height; i++) put(c, x, y + i, z, COTTONWOOD_LOG, true);
  const top = y + height;
  for (let dy = -2; dy <= 2; dy++) {
    const rad = dy === 2 ? 2 : dy === -2 ? 3 : 4;
    for (let dz = -rad; dz <= rad; dz++)
      for (let dx = -rad; dx <= rad; dx++) {
        if (dx * dx + dz * dz > rad * rad + 1) continue;
        if (r() > 0.85) continue;
        put(c, x + dx, top + dy, z + dz, COTTONWOOD_LEAVES);
      }
  }
}

function deadTree(c: Chunk, x: number, y: number, z: number, r: () => number): void {
  const height = 4 + Math.floor(r() * 4);
  for (let i = 0; i < height; i++) put(c, x, y + i, z, SPRUCE_LOG, true);
  for (let i = 0; i < 3; i++) {
    const by = y + 2 + Math.floor(r() * Math.max(1, height - 2));
    const dir = Math.floor(r() * 4);
    put(c, x + (dir === 0 ? 1 : dir === 1 ? -1 : 0), by, z + (dir === 2 ? 1 : dir === 3 ? -1 : 0), SPRUCE_LOG);
  }
}

export function surfaceY(wx: number, wz: number, seed: number): number {
  return Math.max(1, Math.min(CY - 2, Math.floor(terrainHeight(wx, wz, seed))));
}

export function biomeAt(wx: number, wz: number, seed: number): Biome {
  return sampleColumn(wx, wz, seed).biome;
}

export const BIOME_NAMES: Record<Biome, string> = {
  [Biome.Prairie]: 'High Plains',
  [Biome.Mesa]: 'Mesa',
  [Biome.Foothill]: 'Foothills',
  [Biome.Flatiron]: 'The Flatirons',
  [Biome.Subalpine]: 'Subalpine',
  [Biome.Divide]: 'Continental Divide',
  [Biome.GrayValley]: 'The Gray Valley',
  [Biome.AshWaste]: 'Ash Waste',
};
