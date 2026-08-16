/**
 * Block registry.
 *
 * Colours trace to measured values in src/art/palette.ts; semantics trace to
 * the verbatim generation prompts (docs/canon.md).
 *
 * Three fields carry the saga's mechanics:
 *   `light`     - emissive strength. There are no projectiles or spells in 16
 *                 episodes; all "magic" is warm emissive material. This IS the
 *                 magic system.
 *   `tendDelta` - what breaking this block does to the chunk's tend score.
 *                 Canon (Ep1): raptors fight over a seed and "the seed's golden
 *                 light flickers and grows weaker". Extraction dims the world.
 *   `warmth`    - how strongly this block pulls its chunk toward the warm
 *                 palette once placed. Tending brightens.
 */

export type PatternKind =
  | 'flat'
  | 'noise'
  | 'stone'
  | 'brick'
  | 'soil'
  | 'grass_top'
  | 'grass_side'
  | 'log_top'
  | 'log_side'
  | 'plank'
  | 'leaves'
  | 'berry'
  | 'water'
  | 'starwater'
  | 'glow'
  | 'mirror'
  | 'obelisk'
  | 'lattice'
  | 'glyph'
  | 'weave'
  | 'claw'
  | 'carve'
  | 'crop'
  | 'snow'
  | 'ash'
  | 'rootline'
  | 'glass'
  | 'aurora';

export interface TexSpec {
  base: number;
  pattern: PatternKind;
  accent?: number;
  /** Deterministic per-tile noise seed so regeneration is stable. */
  seed?: number;
}

export interface BlockDef {
  id: number;
  name: string;
  /** Blocks player movement. */
  solid: boolean;
  /** Blocks light propagation and culls adjacent faces. */
  opaque: boolean;
  /** Emitted block light, 0-15. The amber channel. */
  light: number;
  /** Rendered as an X-cross billboard instead of a cube. */
  cross?: boolean;
  liquid?: boolean;
  /** Seconds of mining time. */
  hardness: number;
  /** Block id given to the player when broken. Defaults to self. */
  drop?: number;
  /** Effect on chunk tend score when broken by the player. */
  tendDelta?: number;
  /** Effect on chunk tend score when placed by the player. */
  warmth?: number;
  /** Not placeable from the inventory (world-gen or scripted only). */
  worldOnly?: boolean;
  /** Cannot be broken by the player at all. */
  unbreakable?: boolean;
  tex: { top: TexSpec; side: TexSpec; bottom: TexSpec };
  /** Shown in the block inspector. Canon reference. */
  lore?: string;
}

export const AIR = 0;
export const STONE = 1;
export const TERRACE_STONE = 2;
export const DIRT = 3;
export const GRASS_COLD = 4;
export const GRASS_WARM = 5;
export const SOIL_LIVING = 6;
export const SOIL_RAKED = 7;
export const MESA_ROCK = 8;
export const WATER = 9;
export const SPRUCE_LOG = 10;
export const SPRUCE_LEAVES = 11;
export const PALE_TIMBER = 12;
export const RED_TIMBER = 13;
export const PLANK = 14;
export const AMBER_SEED = 15;
export const SEED_PLANTED = 16;
export const CROP_YOUNG = 17;
export const CROP_RIPE = 18;
export const LANTERN = 19;
export const GREEN_LANTERN = 20;
export const STRING_LIGHT = 21;
export const CAMPFIRE = 22;
export const OBSIDIAN_MIRROR = 23;
export const EGG_SHELL = 24;
export const LIGHT_WEAVE = 25;
export const BARK_LEDGER = 26;
export const WOVEN_MAT = 27;
export const CLAWPRINT_STONE = 28;
export const MURAL_BLANK = 29;
export const MURAL_CARVED = 30;
export const BOULDER = 31;
export const SNOW = 32;
export const LEAVES_WARM = 33;
export const BROADLEAF_LOG = 34;
export const LAVENDER = 35;
export const ROOT_LINE = 36;
export const WARM_BRICK = 37;
export const ASH = 38;
export const SCORCHED_SOIL = 39;
export const GREEN_SHOOT = 40;
export const OBELISK = 41;
export const OBELISK_GLYPH = 42;
export const DOORWAY = 43;
export const STAR_WATER = 44;
export const SOLAR_GLASS = 45;
export const GHOST_PLAN = 46;
export const CANDLE = 47;
// --- Front Range / Boulder set
export const FOUNTAIN_SANDSTONE = 48;
export const PONDEROSA_LOG = 49;
export const PONDEROSA_NEEDLES = 50;
export const PRAIRIE_GRASS = 51;
export const COTTONWOOD_LOG = 52;
export const COTTONWOOD_LEAVES = 53;
export const SCRUB_OAK = 54;
export const LICHEN_SANDSTONE = 55;

const defs: BlockDef[] = [];

function def(d: BlockDef): BlockDef {
  defs[d.id] = d;
  return d;
}

const t = (base: number, pattern: PatternKind, accent?: number, seed?: number): TexSpec => ({
  base,
  pattern,
  accent,
  seed,
});

/** Same texture on every face. */
const all = (s: TexSpec) => ({ top: s, side: s, bottom: s });

def({ id: AIR, name: 'air', solid: false, opaque: false, light: 0, hardness: 0, tex: all(t(0x000000, 'flat')) });

def({
  id: STONE,
  name: 'Granite',
  lore: 'The great granite slabs of the valley.',
  solid: true, opaque: true, light: 0, hardness: 0.9,
  tex: all(t(0x6b6f6a, 'stone', 0x53564f, 1)),
});

def({
  id: TERRACE_STONE,
  name: 'Terrace Stone',
  lore: 'Ep3: the deep-rooted green terraces of the tended valley.',
  solid: true, opaque: true, light: 0, hardness: 1.0, warmth: 1,
  tex: all(t(0xa08965, 'stone', 0x806c48, 2)),
});

def({
  id: DIRT, name: 'Dirt',
  solid: true, opaque: true, light: 0, hardness: 0.5,
  tex: all(t(0x5b452f, 'soil', 0x46341f, 3)),
});

def({
  id: GRASS_COLD, name: 'Cold Turf',
  solid: true, opaque: true, light: 0, hardness: 0.55, drop: DIRT,
  tex: {
    top: t(0x54685a, 'grass_top', 0x445448, 4),
    side: t(0x5b452f, 'grass_side', 0x54685a, 4),
    bottom: t(0x5b452f, 'soil', 0x46341f, 3),
  },
});

def({
  id: GRASS_WARM, name: 'Meadow Turf',
  solid: true, opaque: true, light: 0, hardness: 0.55, drop: DIRT,
  tex: {
    top: t(0x6d8b3f, 'grass_top', 0x55702f, 5),
    side: t(0x5b452f, 'grass_side', 0x6d8b3f, 5),
    bottom: t(0x5b452f, 'soil', 0x46341f, 3),
  },
});

def({
  id: SOIL_LIVING, name: 'Living Soil',
  lore: 'Ep3: "planted back into the dark rich earth".',
  solid: true, opaque: true, light: 0, hardness: 0.45, warmth: 1,
  tex: {
    top: t(0x3b2a19, 'soil', 0x2a1d10, 6),
    side: t(0x4a3623, 'soil', 0x35240f, 6),
    bottom: t(0x5b452f, 'soil', 0x46341f, 3),
  },
});

def({
  id: SOIL_RAKED, name: 'Raked Soil',
  lore: 'Ep3: "bare trenched dirt in straight rows, the soil gray and cracking".',
  solid: true, opaque: true, light: 0, hardness: 0.4,
  tex: {
    top: t(0x9a8a70, 'soil', 0x7d6f58, 7),
    side: t(0x8a7a5f, 'soil', 0x6f6149, 7),
    bottom: t(0x5b452f, 'soil', 0x46341f, 3),
  },
});

def({
  id: MESA_ROCK, name: 'Mesa Rock',
  lore: 'The flat-topped mountain slabs on the horizon.',
  solid: true, opaque: true, light: 0, hardness: 1.0,
  tex: all(t(0x8f5a3c, 'stone', 0x6f4429, 8)),
});

def({
  id: WATER, name: 'Still Water',
  lore: 'Ep1: "a perfectly still black mountain pool under fading stars".',
  solid: false, opaque: false, liquid: true, light: 0, hardness: 0, worldOnly: true,
  tex: all(t(0x2b4a63, 'water', 0x3f6a7f, 9)),
});

def({
  id: SPRUCE_LOG, name: 'Pine Log',
  solid: true, opaque: true, light: 0, hardness: 0.8,
  tex: {
    top: t(0x6b5335, 'log_top', 0x4a3a24, 10),
    side: t(0x4e3c26, 'log_side', 0x3a2c1a, 10),
    bottom: t(0x6b5335, 'log_top', 0x4a3a24, 10),
  },
});

def({
  id: SPRUCE_LEAVES, name: 'Pine Needles',
  lore: 'The ancient pines.',
  solid: true, opaque: false, light: 0, hardness: 0.25,
  tex: all(t(0x2f4436, 'leaves', 0x22332a, 11)),
});

def({
  id: PALE_TIMBER, name: 'Pale Timber',
  lore: 'Ep3b: the ghost outline turned to "real timber and warm brick".',
  solid: true, opaque: true, light: 0, hardness: 0.8, warmth: 1,
  tex: {
    top: t(0xb59882, 'log_top', 0x8f7660, 12),
    side: t(0xa08965, 'log_side', 0x7d6a4c, 12),
    bottom: t(0xb59882, 'log_top', 0x8f7660, 12),
  },
});

def({
  id: RED_TIMBER, name: 'Red Timber',
  solid: true, opaque: true, light: 0, hardness: 0.8, warmth: 1,
  tex: {
    top: t(0x7d3a26, 'log_top', 0x5e2a1a, 13),
    side: t(0x8f4128, 'log_side', 0x6b3019, 13),
    bottom: t(0x7d3a26, 'log_top', 0x5e2a1a, 13),
  },
});

def({
  id: PLANK, name: 'Plank',
  solid: true, opaque: true, light: 0, hardness: 0.7, warmth: 1,
  tex: all(t(0x9e744e, 'plank', 0x77563d, 14)),
});

def({
  id: WARM_BRICK, name: 'Warm Brick',
  lore: 'The hall, the hub, the mountain house. Warm brick and timber throughout.',
  solid: true, opaque: true, light: 0, hardness: 1.1, warmth: 1,
  tex: all(t(0x9c563a, 'brick', 0x76402a, 38)),
});

def({
  id: AMBER_SEED, name: 'Amber Seed',
  lore: 'Ep1: "each guarding its own small heap of glowing amber seeds".',
  solid: false, opaque: false, cross: true, light: 11, hardness: 0.2, tendDelta: -2,
  tex: all(t(0x33402f, 'berry', 0xff7a18, 15)),
});

def({
  id: SEED_PLANTED, name: 'Planted Seed',
  lore: 'Ep3: "claws pressing glowing seeds into black soil".',
  solid: false, opaque: false, cross: true, light: 4, hardness: 0.1, warmth: 2,
  tex: all(t(0xff7a18, 'crop', 0xffb347, 16)),
});

def({
  id: CROP_YOUNG, name: 'Young Row',
  solid: false, opaque: false, cross: true, light: 2, hardness: 0.1,
  worldOnly: true, drop: SEED_PLANTED,
  tex: all(t(0x5f7a34, 'crop', 0xff9a2e, 17)),
});

def({
  id: CROP_RIPE, name: 'Ripe Row',
  lore: 'Fruit ripening in place, not hauled over the ridge.',
  solid: false, opaque: false, cross: true, light: 6, hardness: 0.1,
  worldOnly: true, drop: AMBER_SEED, tendDelta: 1,
  tex: all(t(0x6d8b3f, 'crop', 0xff7a18, 18)),
});

def({
  id: LANTERN, name: 'Lantern',
  solid: true, opaque: false, light: 14, hardness: 0.3, warmth: 1,
  tex: all(t(0x3a2a1c, 'glow', 0xffe9b0, 19)),
});

def({
  id: GREEN_LANTERN, name: 'Green Lantern',
  lore: 'Ep4a, "the checks that lie": it glows green and approves. It can be wrong.',
  solid: true, opaque: false, light: 10, hardness: 0.3,
  tex: all(t(0x1c2a1c, 'glow', 0x6ee06e, 39)),
});

def({
  id: STRING_LIGHT, name: 'String Light',
  lore: 'The rooftop at dusk. Twice — before the ash, and after.',
  solid: false, opaque: false, cross: true, light: 9, hardness: 0.1, warmth: 1,
  tex: all(t(0x2a2118, 'glow', 0xffe9b0, 21)),
});

def({
  id: CANDLE, name: 'Candle',
  solid: false, opaque: false, cross: true, light: 7, hardness: 0.1, warmth: 1,
  tex: all(t(0xf4e0bf, 'glow', 0xffb347, 20)),
});

def({
  id: CAMPFIRE, name: 'Council Fire',
  lore: 'Ep2: the fire that steadies when two breaths fall into sync.',
  solid: false, opaque: false, light: 15, hardness: 0.4, warmth: 2,
  tex: all(t(0x593b23, 'glow', 0xffb347, 22)),
});

def({
  id: OBSIDIAN_MIRROR, name: 'Obsidian',
  solid: true, opaque: true, light: 0, hardness: 2.0,
  tex: all(t(0x14161c, 'mirror', 0x3a4050, 23)),
});

def({
  id: EGG_SHELL, name: 'Mirror-egg Shell',
  lore: 'Ep4: "each raptor sees only its own reflection smiling back, perfected, flattering".',
  solid: true, opaque: true, light: 4, hardness: 3.0, worldOnly: true, unbreakable: true,
  tex: all(t(0x14161c, 'mirror', 0x4da6ff, 24)),
});

def({
  id: LIGHT_WEAVE, name: 'Light Weave',
  lore: 'Ep3b: threads drawn from their own chest-light. The weave that catches.',
  solid: true, opaque: false, light: 12, hardness: 0.15, warmth: 1,
  tex: all(t(0xff9a2e, 'lattice', 0xffe9b0, 25)),
});

def({
  id: BARK_LEDGER, name: 'Bark Ledger',
  lore: 'Ep3: "a slab of bark, scratching tallies and re-checking everything twice".',
  solid: true, opaque: false, light: 0, hardness: 0.4,
  tex: all(t(0xa08965, 'glyph', 0x3e3323, 26)),
});

def({
  id: WOVEN_MAT, name: 'Woven Mat',
  solid: true, opaque: true, light: 0, hardness: 0.3, warmth: 1,
  tex: all(t(0xc2a173, 'weave', 0x8f7549, 27)),
});

def({
  id: CLAWPRINT_STONE, name: 'Clawprint Stone',
  lore: 'Ep3b: "wherever a print lands the outline turns solid".',
  solid: true, opaque: true, light: 0, hardness: 1.0, warmth: 1,
  tex: {
    top: t(0xa08965, 'stone', 0x806c48, 2),
    side: t(0xa08965, 'claw', 0x54402a, 28),
    bottom: t(0xa08965, 'stone', 0x806c48, 2),
  },
});

def({
  id: MURAL_BLANK, name: 'Mural Panel',
  solid: true, opaque: true, light: 0, hardness: 1.2, worldOnly: true,
  tex: all(t(0x3d2116, 'plank', 0x2a160e, 29)),
});

def({
  id: MURAL_CARVED, name: 'Carved Mural',
  lore: 'Ep5b: the saga carved as a woodcut frieze. Its ripples move.',
  solid: true, opaque: true, light: 2, hardness: 1.2, worldOnly: true,
  tex: all(t(0x3d2116, 'carve', 0xd3b584, 30)),
});

def({
  id: BOULDER, name: 'Mossy Boulder',
  solid: true, opaque: true, light: 0, hardness: 1.1,
  tex: all(t(0x5a6158, 'stone', 0x44503f, 31)),
});

def({
  id: SNOW, name: 'Snow',
  solid: true, opaque: true, light: 0, hardness: 0.3,
  tex: all(t(0xdfe8ee, 'snow', 0xc2d2dd, 32)),
});

def({
  id: LEAVES_WARM, name: 'Broadleaf Canopy',
  solid: true, opaque: false, light: 0, hardness: 0.25,
  tex: all(t(0x4f6b2c, 'leaves', 0x3c5220, 33)),
});

def({
  id: BROADLEAF_LOG, name: 'Broadleaf Log',
  solid: true, opaque: true, light: 0, hardness: 0.8,
  tex: {
    top: t(0x7d6248, 'log_top', 0x5c4733, 34),
    side: t(0x634c38, 'log_side', 0x483525, 34),
    bottom: t(0x7d6248, 'log_top', 0x5c4733, 34),
  },
});

def({
  id: LAVENDER, name: 'Lavender',
  solid: false, opaque: false, cross: true, light: 0, hardness: 0.1, warmth: 1,
  tex: all(t(0x6a7f45, 'crop', 0x8f6fbf, 35)),
});

def({
  id: ROOT_LINE, name: 'Root-line',
  lore: 'Ep3/Ep5/Ep6: the golden web underground. It survives the ash.',
  solid: true, opaque: true, light: 10, hardness: 0.4, worldOnly: true,
  tex: {
    top: t(0x3b2a19, 'rootline', 0xff9a2e, 36),
    side: t(0x4a3623, 'soil', 0x35240f, 6),
    bottom: t(0x5b452f, 'soil', 0x46341f, 3),
  },
});

def({
  id: ASH, name: 'Ash',
  lore: 'Ep6: "gray ash begins to fall like snow".',
  solid: true, opaque: true, light: 0, hardness: 0.35,
  tex: all(t(0x8d8a85, 'ash', 0x726f6b, 40)),
});

def({
  id: SCORCHED_SOIL, name: 'Scorched Soil',
  solid: true, opaque: true, light: 0, hardness: 0.5,
  tex: all(t(0x3a3430, 'soil', 0x272320, 41)),
});

def({
  id: GREEN_SHOOT, name: 'Green Shoot',
  lore: 'Ep6b: "a single green shoot rises through the ash".',
  solid: false, opaque: false, cross: true, light: 1, hardness: 0.1, warmth: 3,
  tex: all(t(0x4f8f3a, 'crop', 0x7ec45c, 42)),
});

def({
  id: OBELISK, name: 'Obelisk',
  lore: 'Ep7: "reflects nothing at all — no flattering mirror, only honest blackness".',
  solid: true, opaque: true, light: 0, hardness: 6.0, worldOnly: true, unbreakable: true,
  tex: all(t(0x0b0b0e, 'obelisk', 0x15151a, 43)),
});

def({
  id: OBELISK_GLYPH, name: 'Glyph of Rings',
  lore: 'Ep7: "a single glowing glyph shaped like rings rippling on water".',
  solid: true, opaque: true, light: 13, hardness: 6.0, worldOnly: true, unbreakable: true,
  tex: all(t(0x0b0b0e, 'glyph', 0xffd27a, 44)),
});

def({
  id: DOORWAY, name: 'The Door',
  lore: 'Ep7b: "the door breathing like a slow heart".',
  solid: false, opaque: false, light: 14, hardness: 0, worldOnly: true, unbreakable: true,
  tex: all(t(0x2a1c4a, 'aurora', 0x8fd4ff, 45)),
});

def({
  id: STAR_WATER, name: 'Star-water',
  lore: 'Ep8: "a river of stars flowing uphill through soft darkness".',
  solid: false, opaque: false, liquid: true, light: 6, hardness: 0, worldOnly: true,
  tex: all(t(0x10142c, 'starwater', 0xbfd8ff, 46)),
});

def({
  id: SOLAR_GLASS, name: 'Solar Glass',
  lore: 'Ep8b: the mountain house roofs catching first light.',
  solid: true, opaque: false, light: 0, hardness: 0.6, warmth: 1,
  tex: all(t(0x4a6f7d, 'glass', 0x9fd6e8, 47)),
});

def({
  id: GHOST_PLAN, name: 'Ghost Plan',
  lore: 'Ep3b: "a ghostly translucent outline of a great barn-like hall".',
  solid: false, opaque: false, light: 5, hardness: 0, worldOnly: true,
  tex: all(t(0x6fd8ff, 'lattice', 0xd8f4ff, 48)),
});

// ------------------------------------------------- Front Range / Boulder set

def({
  id: FOUNTAIN_SANDSTONE,
  name: 'Fountain Sandstone',
  lore: 'The Flatirons: 290-million-year-old red arkose tilted up on end by the Laramide.',
  solid: true, opaque: true, light: 0, hardness: 1.3,
  tex: all(t(0xa8563a, 'stone', 0x7d3a26, 49)),
});

def({
  id: LICHEN_SANDSTONE,
  name: 'Lichened Sandstone',
  lore: 'The sunlit faces, blotched pale green-gold.',
  solid: true, opaque: true, light: 0, hardness: 1.3,
  tex: all(t(0xa8563a, 'stone', 0x9aa86b, 50)),
});

def({
  id: PONDEROSA_LOG,
  name: 'Ponderosa Pine',
  lore: 'Orange-plated bark on the foothills. Smells of butterscotch in the sun.',
  solid: true, opaque: true, light: 0, hardness: 0.8,
  tex: {
    top: t(0x8a5a33, 'log_top', 0x63401f, 51),
    side: t(0xa0642f, 'log_side', 0x6f3f1c, 51),
    bottom: t(0x8a5a33, 'log_top', 0x63401f, 51),
  },
});

def({
  id: PONDEROSA_NEEDLES,
  name: 'Ponderosa Needles',
  solid: true, opaque: false, light: 0, hardness: 0.25,
  tex: all(t(0x35502f, 'leaves', 0x263c23, 52)),
});

def({
  id: PRAIRIE_GRASS,
  name: 'Prairie Grass',
  lore: 'The High Plains running flat to the eastern horizon.',
  solid: true, opaque: true, light: 0, hardness: 0.5, drop: DIRT,
  tex: {
    top: t(0x9d9a52, 'grass_top', 0x817f42, 53),
    side: t(0x5b452f, 'grass_side', 0x9d9a52, 53),
    bottom: t(0x5b452f, 'soil', 0x46341f, 3),
  },
});

def({
  id: COTTONWOOD_LOG,
  name: 'Cottonwood',
  lore: 'Lining the creek out of the canyon.',
  solid: true, opaque: true, light: 0, hardness: 0.7,
  tex: {
    top: t(0x9d9382, 'log_top', 0x776e5f, 54),
    side: t(0x8b8272, 'log_side', 0x635b4d, 54),
    bottom: t(0x9d9382, 'log_top', 0x776e5f, 54),
  },
});

def({
  id: COTTONWOOD_LEAVES,
  name: 'Cottonwood Leaves',
  solid: true, opaque: false, light: 0, hardness: 0.2,
  tex: all(t(0x8fae4a, 'leaves', 0x6f8f34, 55)),
});

def({
  id: SCRUB_OAK,
  name: 'Scrub Oak',
  lore: 'Gambel oak thickets on the lower slopes; rust-red by October.',
  solid: false, opaque: false, cross: true, light: 0, hardness: 0.15,
  tex: all(t(0x6a5a2f, 'crop', 0x9c5a2a, 56)),
});

export const BLOCKS: readonly BlockDef[] = defs;
export const BLOCK_COUNT = defs.length;

export const blockDef = (id: number): BlockDef | undefined => defs[id];
export const isSolid = (id: number): boolean => defs[id]?.solid ?? false;
export const isOpaque = (id: number): boolean => defs[id]?.opaque ?? false;
export const isCross = (id: number): boolean => defs[id]?.cross ?? false;
export const isLiquid = (id: number): boolean => defs[id]?.liquid ?? false;
export const lightOf = (id: number): number => defs[id]?.light ?? 0;
export const blockName = (id: number): string => defs[id]?.name ?? 'unknown';
export const isUnbreakable = (id: number): boolean => defs[id]?.unbreakable ?? false;

/** Blocks the player can hold and place. */
export const PLACEABLE: number[] = defs
  .filter((d) => d && d.id !== AIR && !d.worldOnly)
  .map((d) => d.id);
