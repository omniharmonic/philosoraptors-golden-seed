import { Chunk, CX, CY, CZ } from './Chunk';
import { rng, hash2 } from './noise';
import { terrainHeight } from './worldgen';
import {
  AIR, AMBER_SEED, BOULDER, CAMPFIRE, CANDLE, CLAWPRINT_STONE, DIRT,
  GREEN_LANTERN, LANTERN, MURAL_BLANK, MURAL_CARVED, OBELISK, OBELISK_GLYPH,
  OBSIDIAN_MIRROR, EGG_SHELL, PALE_TIMBER, PLANK, RED_TIMBER, SOIL_LIVING,
  SOIL_RAKED, SOLAR_GLASS, STONE, STRING_LIGHT, TERRACE_STONE, WARM_BRICK,
  WATER, WOVEN_MAT, BARK_LEDGER, CROP_RIPE, LAVENDER, SPRUCE_LOG, ASH,
} from './blocks';

export interface Landmark {
  id: string;
  name: string;
  /** Centre in world coordinates. */
  x: number;
  z: number;
  /** Half-extent used for chunk intersection tests. */
  radius: number;
  build: (w: Writer, cxWorld: number, czWorld: number, seed: number) => void;
  /** Chapter this landmark belongs to. */
  chapter: number;
  blurb: string;
}

/**
 * A clipped writer. Landmarks are authored in world coordinates and the writer
 * discards anything outside the chunk currently being generated, so a structure
 * can span any number of chunks without the generator needing to know.
 */
export class Writer {
  constructor(
    private chunk: Chunk,
    private ox: number,
    private oz: number,
    private seed: number,
  ) {}

  set(wx: number, wy: number, wz: number, id: number): void {
    const x = wx - this.ox;
    const z = wz - this.oz;
    if (x < 0 || x >= CX || z < 0 || z >= CZ || wy < 0 || wy >= CY) return;
    this.chunk.setRaw(x, wy, z, id);
  }

  get(wx: number, wy: number, wz: number): number {
    const x = wx - this.ox;
    const z = wz - this.oz;
    if (x < 0 || x >= CX || z < 0 || z >= CZ || wy < 0 || wy >= CY) return AIR;
    return this.chunk.get(x, wy, z);
  }

  /** Surface height from the base terrain function (landmark-independent). */
  ground(wx: number, wz: number): number {
    return Math.floor(terrainHeight(wx, wz, this.seed));
  }

  /** Flatten a disc to a fixed height, filling below and clearing above. */
  pad(cx: number, cz: number, r: number, y: number, fill: number, clear = 10): void {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r * r) continue;
        for (let yy = y - 6; yy <= y; yy++) this.set(cx + dx, yy, cz + dz, yy === y ? fill : DIRT);
        for (let yy = y + 1; yy <= y + clear; yy++) this.set(cx + dx, yy, cz + dz, AIR);
      }
    }
  }

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number): void {
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) this.set(x, y, z, id);
  }

  /** Hollow rectangular room with an optional gabled roof. */
  hall(
    cx: number, cz: number, y: number,
    halfW: number, halfD: number, wallH: number,
    wall: number, floor: number, roof: number,
  ): void {
    for (let dz = -halfD; dz <= halfD; dz++) {
      for (let dx = -halfW; dx <= halfW; dx++) {
        this.set(cx + dx, y, cz + dz, floor);
        const edge = Math.abs(dx) === halfW || Math.abs(dz) === halfD;
        for (let h = 1; h <= wallH; h++) {
          this.set(cx + dx, y + h, cz + dz, edge ? wall : AIR);
        }
      }
    }
    // Gabled roof.
    for (let i = 0; i <= halfW; i++) {
      const ry = y + wallH + i;
      for (let dz = -halfD; dz <= halfD; dz++) {
        this.set(cx - halfW + i, ry, cz + dz, roof);
        this.set(cx + halfW - i, ry, cz + dz, roof);
      }
    }
  }
}

// ---------------------------------------------------------------- landmarks

/**
 * The eight fixed sites, one per chapter of the Alignment arc. Positions are
 * deliberately spread so travelling between them is the game's spine, and
 * coherence-gated flight is what makes the far ones reachable.
 */
export const LANDMARKS: Landmark[] = [
  {
    id: 'pool', name: 'The Still Pool', chapter: 1, x: -430, z: 150, radius: 26,
    blurb: 'Ep1b: "a perfectly still black mountain pool under fading stars."',
    build: (w, _a, _b, seed) => {
      const cx = -430, cz = 150;
      const g = w.ground(cx, cz);
      const r = 11;
      // Carve a basin and fill it to a mirror.
      for (let dz = -r - 3; dz <= r + 3; dz++) {
        for (let dx = -r - 3; dx <= r + 3; dx++) {
          const d = Math.hypot(dx, dz);
          if (d > r + 3) continue;
          const rim = g + 1;
          for (let y = rim; y < rim + 14; y++) w.set(cx + dx, y, cz + dz, AIR);
          if (d <= r) {
            const depth = Math.round(3 * (1 - d / r)) + 1;
            for (let y = rim - depth; y < rim; y++) w.set(cx + dx, y, cz + dz, WATER);
            for (let y = rim - depth - 3; y < rim - depth; y++) w.set(cx + dx, y, cz + dz, STONE);
          } else {
            w.set(cx + dx, rim - 1, cz + dz, STONE);
          }
        }
      }
      // The single dim seed on the shore, and a granite slab to sit on.
      const rr = rng(seed ^ 0x9e11);
      w.set(cx + r + 1, g + 1, cz, BOULDER);
      w.set(cx + r + 1, g + 2, cz, AMBER_SEED);
      for (let i = 0; i < 7; i++) {
        const a = rr() * Math.PI * 2;
        const d = r + 2 + rr() * 3;
        w.set(cx + Math.round(Math.cos(a) * d), g + 1, cz + Math.round(Math.sin(a) * d), BOULDER);
      }
    },
  },

  {
    id: 'council', name: 'The Council Ring', chapter: 2, x: -34, z: 84, radius: 22,
    blurb: 'Ep2b: the circle passing a glowing feather like a talking stick.',
    build: (w) => {
      const cx = -34, cz = 84;
      const g = w.ground(cx, cz);
      w.pad(cx, cz, 14, g, STONE, 12);
      // Stone circle with seats, fire at the centre.
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const sx = cx + Math.round(Math.cos(a) * 8);
        const sz = cz + Math.round(Math.sin(a) * 8);
        w.set(sx, g + 1, sz, BOULDER);
        w.set(cx + Math.round(Math.cos(a) * 11), g + 1, cz + Math.round(Math.sin(a) * 11), WOVEN_MAT);
      }
      w.set(cx, g + 1, cz, CAMPFIRE);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        w.set(cx + dx, g + 1, cz + dz, STONE);
      }
      // Pines around the hollow.
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.4;
        const px = cx + Math.round(Math.cos(a) * 16);
        const pz = cz + Math.round(Math.sin(a) * 16);
        for (let h = 1; h <= 8; h++) w.set(px, g + h, pz, SPRUCE_LOG);
      }
    },
  },

  {
    id: 'valleys', name: 'The Two Valleys', chapter: 3, x: -300, z: -190, radius: 46,
    blurb: 'Ep3a: the extractive slope and the tended slope, side by side.',
    build: (w) => {
      const cx = -300, cz = -190;
      const g = w.ground(cx, cz);
      // A saddle to stand on and look down at both.
      w.pad(cx, cz, 7, g + 4, STONE, 10);
      w.set(cx, g + 5, cz, BARK_LEDGER);

      // LEFT: bare trenched rows, carts hauling the seeds away over the ridge.
      for (let row = 0; row < 16; row++) {
        for (let d = 8; d < 40; d++) {
          const x = cx - d;
          const z = cz - 18 + row * 2;
          const y = w.ground(x, z);
          w.set(x, y, z, row % 2 === 0 ? SOIL_RAKED : DIRT);
          for (let yy = y + 1; yy < y + 4; yy++) w.set(x, yy, z, AIR);
        }
      }
      for (let i = 0; i < 5; i++) {
        const x = cx - 14 - i * 6;
        const z = cz - 24;
        const y = w.ground(x, z) + 1;
        w.box(x - 1, y, z - 1, x + 1, y, z + 1, PLANK);
        w.set(x, y + 1, z, AMBER_SEED);
      }

      // RIGHT: layered terraces, seeds planted back into dark earth.
      for (let step = 0; step < 9; step++) {
        const baseY = g - step * 2;
        for (let d = 8 + step * 4; d < 12 + step * 4; d++) {
          for (let t = -20; t <= 20; t++) {
            const x = cx + d;
            const z = cz + t;
            w.set(x, baseY, z, SOIL_LIVING);
            w.set(x, baseY - 1, z, TERRACE_STONE);
            for (let yy = baseY + 1; yy < baseY + 4; yy++) w.set(x, yy, z, AIR);
            if ((t + step) % 3 === 0) w.set(x, baseY + 1, z, CROP_RIPE);
            else if ((t + step) % 7 === 0) w.set(x, baseY + 1, z, LAVENDER);
          }
        }
      }
    },
  },

  {
    id: 'hall', name: 'The Half-built Hall', chapter: 4, x: -150, z: 330, radius: 30,
    blurb: 'Ep4: the obsidian egg on its nest, ringed by lanterns.',
    build: (w) => {
      const cx = -150, cz = 330;
      const g = w.ground(cx, cz);
      w.pad(cx, cz, 18, g, STONE, 20);
      w.hall(cx, cz, g, 12, 10, 6, WARM_BRICK, PLANK, PALE_TIMBER);

      // Open roof beams — "stars through the open roof beams".
      for (let dz = -10; dz <= 10; dz += 3) {
        for (let dx = -12; dx <= 12; dx++) w.set(cx + dx, g + 7, cz + dz, PALE_TIMBER);
      }
      // Doorway.
      for (let h = 1; h <= 3; h++) { w.set(cx, g + h, cz - 10, AIR); w.set(cx + 1, g + h, cz - 10, AIR); }

      // The egg: an obsidian ovoid on a nest of woven gold.
      for (let dy = 0; dy < 6; dy++) {
        const rr = dy < 2 ? 2 : dy < 4 ? 2 : 1;
        for (let dz = -rr; dz <= rr; dz++) {
          for (let dx = -rr; dx <= rr; dx++) {
            if (dx * dx + dz * dz > rr * rr + 1) continue;
            w.set(cx + dx, g + 1 + dy, cz + dz, dy === 5 ? EGG_SHELL : OBSIDIAN_MIRROR);
          }
        }
      }
      for (let dz = -4; dz <= 4; dz++)
        for (let dx = -4; dx <= 4; dx++)
          if (Math.abs(dx) > 2 || Math.abs(dz) > 2) w.set(cx + dx, g + 1, cz + dz, WOVEN_MAT);

      // Lantern ring, plus the green lantern that lies.
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        w.set(cx + Math.round(Math.cos(a) * 6), g + 1, cz + Math.round(Math.sin(a) * 6), LANTERN);
      }
      w.set(cx + 7, g + 1, cz + 2, GREEN_LANTERN);
    },
  },

  {
    id: 'barn', name: 'The Red Barn & Terraces', chapter: 5, x: 480, z: -60, radius: 34,
    blurb: 'Ep5a: the once-bare valley replanted, green rushing back in waves.',
    build: (w) => {
      const cx = 480, cz = -60;
      const g = w.ground(cx, cz);
      w.pad(cx, cz, 20, g, SOIL_LIVING, 18);
      // A-frame barn.
      for (let i = 0; i <= 7; i++) {
        for (let dz = -8; dz <= 8; dz++) {
          w.set(cx - 7 + i, g + 1 + i, cz + dz, RED_TIMBER);
          w.set(cx + 7 - i, g + 1 + i, cz + dz, RED_TIMBER);
        }
      }
      w.box(cx - 7, g, cz - 8, cx + 7, g, cz + 8, PLANK);
      for (let h = 1; h <= 3; h++) { w.set(cx, g + h, cz - 8, AIR); w.set(cx - 1, g + h, cz - 8, AIR); }
      // Terraced beds stepping down to the water.
      for (let step = 1; step <= 8; step++) {
        const y = g - step;
        for (let dx = -18; dx <= 18; dx++) {
          const z = cz + 10 + step * 3;
          w.set(cx + dx, y, z, SOIL_LIVING);
          w.set(cx + dx, y, z + 1, SOIL_LIVING);
          w.set(cx + dx, y - 1, z + 2, TERRACE_STONE);
          if (dx % 3 === 0) w.set(cx + dx, y + 1, z, CROP_RIPE);
          if (dx % 5 === 0) w.set(cx + dx, y + 1, z + 1, LAVENDER);
        }
      }
      for (let i = -6; i <= 6; i += 3) w.set(cx + i, g + 9, cz - 8, STRING_LIGHT);
    },
  },

  {
    id: 'mural', name: 'The Mural Hall', chapter: 5, x: 522, z: -104, radius: 20,
    blurb: 'Ep5b: the whole saga carved into the timber as a woodcut frieze.',
    build: (w) => {
      const cx = 522, cz = -104;
      const g = w.ground(cx, cz);
      w.pad(cx, cz, 12, g, PLANK, 12);
      w.hall(cx, cz, g, 9, 6, 5, WARM_BRICK, PLANK, RED_TIMBER);
      for (let h = 1; h <= 3; h++) w.set(cx, g + h, cz - 6, AIR);
      // The carved wall. Panels light up as chapters complete (see Chapters.ts).
      for (let dx = -8; dx <= 8; dx++) {
        for (let h = 1; h <= 4; h++) {
          w.set(cx + dx, g + h, cz + 6, dx >= -8 && dx <= -4 ? MURAL_CARVED : MURAL_BLANK);
        }
      }
      for (let dx = -8; dx <= 8; dx += 2) w.set(cx + dx, g + 1, cz + 5, CANDLE);
    },
  },

  {
    id: 'crater', name: 'The Obelisk', chapter: 7, x: -1420, z: -1060, radius: 90,
    blurb: 'Ep7: "it reflects nothing at all — only honest blackness."',
    build: (w) => {
      const cx = -1420, cz = -1060;
      const g = w.ground(cx, cz);
      const R = 74;
      // Blast crater: bowl of ash, raised rim.
      for (let dz = -R; dz <= R; dz++) {
        for (let dx = -R; dx <= R; dx++) {
          const d = Math.hypot(dx, dz);
          if (d > R) continue;
          const t = d / R;
          const floorY = Math.round(g - 22 * (1 - t * t) + (t > 0.86 ? 10 * (t - 0.86) / 0.14 : 0));
          for (let y = floorY + 1; y < floorY + 30; y++) w.set(cx + dx, y, cz + dz, AIR);
          w.set(cx + dx, floorY, cz + dz, ASH);
          for (let y = floorY - 4; y < floorY; y++) w.set(cx + dx, y, cz + dz, STONE);
        }
      }
      // The monolith at dead centre.
      const baseY = g - 22;
      for (let y = 0; y < 34; y++) {
        for (let dz = -2; dz <= 2; dz++)
          for (let dx = -2; dx <= 2; dx++)
            w.set(cx + dx, baseY + y, cz + dz, OBELISK);
      }
      // The glyph of rings, high on the face — lights when the motif is sung.
      w.set(cx, baseY + 26, cz - 3, OBELISK_GLYPH);
      w.set(cx - 1, baseY + 26, cz - 3, OBELISK_GLYPH);
      w.set(cx + 1, baseY + 26, cz - 3, OBELISK_GLYPH);
    },
  },

  {
    id: 'mesatown', name: 'The Mountain House', chapter: 8, x: 770, z: 430, radius: 40,
    blurb: 'Ep8b: solar-glass roofs catching first light. "We were always going to be birds."',
    build: (w) => {
      const cx = 770, cz = 430;
      const g = w.ground(cx, cz);
      w.pad(cx, cz, 24, g, PLANK, 22);
      w.hall(cx, cz, g, 14, 11, 7, WARM_BRICK, PLANK, RED_TIMBER);
      // Solar-glass roof panels.
      for (let i = 0; i <= 14; i += 2)
        for (let dz = -11; dz <= 11; dz += 2) {
          w.set(cx - 14 + i, g + 7 + i, cz + dz, SOLAR_GLASS);
          w.set(cx + 14 - i, g + 7 + i, cz + dz, SOLAR_GLASS);
        }
      // Rooftop deck with string lights.
      for (let dx = -12; dx <= 12; dx++)
        for (let dz = -9; dz <= 9; dz++)
          if (Math.abs(dx) > 6) w.set(cx + dx, g + 8, cz + dz, PLANK);
      for (let dx = -12; dx <= 12; dx += 3) {
        w.set(cx + dx, g + 11, cz - 9, STRING_LIGHT);
        w.set(cx + dx, g + 11, cz + 9, STRING_LIGHT);
      }
      // Terraced gardens down to the river.
      for (let s = 1; s <= 10; s++)
        for (let dx = -20; dx <= 20; dx++) {
          const z = cz + 13 + s * 2;
          w.set(cx + dx, g - s, z, SOIL_LIVING);
          w.set(cx + dx, g - s - 1, z + 1, TERRACE_STONE);
          if ((dx + s) % 4 === 0) w.set(cx + dx, g - s + 1, z, CROP_RIPE);
        }
    },
  },
];

/** Small repeating sites so the far world is never empty. */
function scatterSite(chunk: Chunk, seed: number): void {
  // One candidate per 6x6 chunk cell.
  const gx = Math.floor(chunk.cx / 6);
  const gz = Math.floor(chunk.cz / 6);
  const r = hash2(gx, gz, seed + 5150);
  if (r < 0.55) return;

  const rr = rng((gx * 40503) ^ (gz * 22067) ^ seed);
  const wx = (gx * 6 + Math.floor(rr() * 6)) * CX + 8;
  const wz = (gz * 6 + Math.floor(rr() * 6)) * CZ + 8;
  if (Math.floor(wx / CX) !== chunk.cx || Math.floor(wz / CZ) !== chunk.cz) return;

  const w = new Writer(chunk, chunk.cx * CX, chunk.cz * CZ, seed);
  const g = w.ground(wx, wz);
  const kind = rr();

  if (kind < 0.3) {
    // A cairn with a seed cache — Ep1's guarded heaps.
    for (let i = 0; i < 4; i++) w.set(wx, g + 1 + i, wz, BOULDER);
    w.set(wx, g + 5, wz, AMBER_SEED);
  } else if (kind < 0.55) {
    // An abandoned cart from the hauling caravan.
    w.box(wx - 1, g + 1, wz - 1, wx + 1, g + 1, wz + 1, PLANK);
    w.set(wx, g + 2, wz, AMBER_SEED);
    for (let d = 0; d < 7; d++) w.set(wx + d, g, wz + 3, SOIL_RAKED);
  } else if (kind < 0.8) {
    // A tally post left by the careful raptor.
    w.set(wx, g + 1, wz, SPRUCE_LOG);
    w.set(wx, g + 2, wz, SPRUCE_LOG);
    w.set(wx, g + 3, wz, BARK_LEDGER);
  } else {
    // A clawprint stone: someone signed this place.
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) w.set(wx + dx, g + 1, wz + dz, CLAWPRINT_STONE);
    w.set(wx, g + 2, wz, LANTERN);
  }
}

export function stampLandmarks(chunk: Chunk, seed: number): void {
  const ox = chunk.cx * CX;
  const oz = chunk.cz * CZ;

  for (const lm of LANDMARKS) {
    // Cheap AABB reject against this chunk.
    if (lm.x + lm.radius < ox || lm.x - lm.radius > ox + CX) continue;
    if (lm.z + lm.radius < oz || lm.z - lm.radius > oz + CZ) continue;
    const w = new Writer(chunk, ox, oz, seed);
    lm.build(w, ox, oz, seed);
  }

  scatterSite(chunk, seed);
}

/** Nearest landmark to a point, for the compass and chapter tracking. */
export function nearestLandmark(x: number, z: number): { lm: Landmark; dist: number } {
  let best = LANDMARKS[0];
  let bd = Infinity;
  for (const lm of LANDMARKS) {
    const d = Math.hypot(lm.x - x, lm.z - z);
    if (d < bd) { bd = d; best = lm; }
  }
  return { lm: best, dist: bd };
}
