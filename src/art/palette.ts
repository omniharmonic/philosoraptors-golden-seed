/**
 * Palette measured directly off the five Alignment episodes.
 *
 * Method: saturated-pixel clustering (S > 0.55, V > 0.45) over sampled frames,
 * plus a full-frame ambient ramp via ffmpeg palettegen. See
 * docs/visual-lore-extraction.md for the raw numbers.
 *
 * The finding that drives everything below: the series lives on two hues and
 * almost nothing between them. Ep1 clusters at 200-210 degrees (cold blue);
 * Ep2-5 cluster at 20-40 degrees (amber). So the world is graded along a single
 * COLD <-> WARM axis, and every other colour decision hangs off that axis.
 */

export type RGB = [number, number, number];

export const hexToRgb = (hex: number): RGB => [
  ((hex >> 16) & 0xff) / 255,
  ((hex >> 8) & 0xff) / 255,
  (hex & 0xff) / 255,
];

export const mixRgb = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export const rgbToHex = (c: RGB): number =>
  (Math.round(Math.max(0, Math.min(1, c[0])) * 255) << 16) |
  (Math.round(Math.max(0, Math.min(1, c[1])) * 255) << 8) |
  Math.round(Math.max(0, Math.min(1, c[2])) * 255);

/** Ep1 "The Pool" ambient ramp — the one cold episode. */
export const COLD_RAMP = [0x040608, 0x15212c, 0x294152, 0x59819c, 0x8eb7c9];

/** Ep3 "The Two Valleys" ambient ramp — golden hour. */
export const WARM_RAMP = [0x18150f, 0x3e3323, 0x675638, 0xa08965, 0xe9d6b6];

/** Ep5 "The World Tended" ramp — sunset gold into candlelight. */
export const TENDED_RAMP = [0x130b0e, 0x3d2d22, 0x746048, 0xb59882, 0xdec09c];

/**
 * The emissive accent. This is the magic system: one warm material that does
 * eight different structural jobs across the series (stored energy, carried
 * purpose, connection, bridge, blueprint, restoration, new mind).
 */
export const EMBER = 0xff7a18;
export const FLAME = 0xffb347;
export const FLAME_CORE = 0xffe9b0;

/**
 * The single cold light in the entire series: the fissures in the obsidian egg
 * in Ep4. Reserved exclusively for the genuinely unknown — do not reuse it.
 */
export const EGG_BLUE = 0x4da6ff;

/** Sky/fog endpoints for the two biomes. */
export const SKY_COLD = 0x2d3f52;
export const SKY_WARM = 0xd9b98a;
export const FOG_COLD = 0x1f3241;
export const FOG_WARM = 0xc6ae8e;

/** Light channel tints. Block light is amber; sky light carries the biome. */
export const BLOCKLIGHT_TINT: RGB = hexToRgb(EMBER);
export const SKYLIGHT_COLD: RGB = hexToRgb(0x8eb7c9);
export const SKYLIGHT_WARM: RGB = hexToRgb(0xffe6c0);

/** Council raptor plumage, read off Ep4/Ep5. Colour arrives with culture. */
export const PLUMAGE = [
  0xc4432f, // crimson
  0x2f8f8a, // teal
  0x7a4b9c, // violet
  0x2f5fa8, // cobalt
  0xd98c2b, // ochre
  0xc75f8a, // rose
  0x4f9c46, // green
  0xd4c04a, // gold
];

/** Ep1 wild raptors: drab, scaly, pre-culture. */
export const WILD_HIDE = [0x4a5348, 0x3f4a45, 0x55584a, 0x46504f];
