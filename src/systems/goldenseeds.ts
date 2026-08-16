/**
 * The seven Golden Seeds.
 *
 * A seed is not a stat upgrade. Every one of the seven changes what you can do
 * *with other raptors* — it lowers a quorum, doubles a reach, makes your mark
 * count twice, or lets you speak a future nobody can make true alone. There is
 * deliberately no seed that raises damage, because there is deliberately no
 * damage: Moloch is immune to force and a seed that dented him would quietly
 * unmake the whole thesis.
 *
 * The authoritative list lives in `server/server.mjs` (SEED_POWERS) and is
 * typed as `SeedPower` in the protocol. This file MIRRORS it — the `name` and
 * `grants` strings here are byte-identical to the server's so the HUD, the MCP
 * agent and the relay all describe the same object. `mechanic` and `colour` are
 * client-side additions the wire never carries.
 */

import type { SeedPower, WireGoldenSeed } from '../net/protocol';
import { PLUMAGE, FLAME_CORE, hexToRgb, mixRgb, rgbToHex } from '../art/palette';

/**
 * Seven distinguishable seed colours without inventing a hue the footage never
 * had: take a council plumage colour and gild it toward the emissive core, so
 * every seed still sits on the series' single warm axis.
 */
const gild = (base: number, t = 0.45): number =>
  rgbToHex(mixRgb(hexToRgb(base), hexToRgb(FLAME_CORE), t));

export interface SeedPowerDef {
  key: SeedPower;
  /** Display name. Identical to the server's. */
  name: string;
  /** In-world prose. Identical to the server's. */
  grants: string;
  /** What it actually does to the numbers, for the HUD and for agents. */
  mechanic: string;
  /** Beacon and HUD chip colour, derived from the measured palette. */
  colour: number;
}

export const SEED_POWERS: Record<SeedPower, SeedPowerDef> = {
  sight: {
    key: 'sight',
    name: 'Seed of Sight',
    grants: 'Hyperobjects become visible to you at any coherence, and Molochs are marked at range.',
    mechanic: 'Hyperobjects render even while inert; every Moloch carries a range marker.',
    colour: gild(PLUMAGE[1]), // teal, gilded
  },
  naming: {
    key: 'naming',
    name: 'Seed of Naming',
    grants: 'You may speak a Hyperstition — declaring a future that is not yet real.',
    mechanic: 'Unlocks the `hyperstition` intent. Without it the server answers `denied`.',
    colour: gild(PLUMAGE[7]), // gold
  },
  voice: {
    key: 'voice',
    name: 'Seed of Voice',
    grants: 'Your sigil counts twice toward any quorum.',
    mechanic: 'sigilWeight() = 2 on seal marks and on Hyperobject alignment.',
    colour: gild(PLUMAGE[5]), // rose
  },
  weaving: {
    key: 'weaving',
    name: 'Seed of Weaving',
    grants: 'The Weave needs one fewer sigil, and spans twice as far.',
    mechanic: 'Weave quorum 3 -> 2, radius x2.',
    colour: gild(PLUMAGE[2]), // violet
  },
  flight: {
    key: 'flight',
    name: 'Seed of Flight',
    grants: 'Glide, Lift and Free Flight unlock 20 coherence earlier.',
    mechanic: 'Every flight tier threshold shifts down by 20 coherence.',
    colour: gild(PLUMAGE[3]), // cobalt
  },
  root: {
    key: 'root',
    name: 'Seed of Root',
    grants: 'Root-line reaches twice as far and always leaves living soil.',
    mechanic: 'Root-line radius x2, and the ground it leaves is living soil rather than raked.',
    colour: gild(PLUMAGE[6]), // green
  },
  mirror: {
    key: 'mirror',
    name: 'Seed of Mirror',
    grants: "Moloch's drain reflects back onto him.",
    mechanic: 'Incoming `drain` ticks cost you nothing and gorge him less.',
    colour: gild(PLUMAGE[0]), // crimson
  },
};

/** Server enumeration order — `gs0`..`gs6` are laid out in exactly this order. */
export const SEED_ORDER: readonly SeedPower[] = [
  'sight', 'naming', 'voice', 'weaving', 'flight', 'root', 'mirror',
];

/**
 * The order the game *wants* you to hunt in, which is not the server's order.
 *
 * Naming leads because it is the only seed that gates the win condition itself:
 * until somebody in the valley holds it, no Hyperstition can be spoken at all
 * and there is literally no path to binding a Moloch. Mirror trails because it
 * is the only purely defensive one.
 */
export const SEED_HUNT_ORDER: readonly SeedPower[] = [
  'naming', 'sight', 'voice', 'weaving', 'root', 'flight', 'mirror',
];

const HUNT_REASON: Record<SeedPower, string> = {
  naming: 'Nobody in the valley can open a Hyperstition until someone holds Naming. Without it there is no win condition.',
  sight: 'You cannot align with a Hyperobject you cannot see. Sight is how you find the ones other raptors opened.',
  voice: 'Every quorum in this game is people-shaped. Voice is the only seed that makes you count as two of them.',
  weaving: 'Drops the Weave from three sigils to two — the cheapest quorum there is, and the one that catches fallers.',
  root: 'Living soil is the only thing that pulls pressure down as fast as extraction pushes it up.',
  flight: 'Twenty coherence off every flight tier. The outer seeds sit over a thousand blocks out; walking costs the run.',
  mirror: "Turns Moloch's drain back on him. Real, but worth nothing until a Moloch is actually standing on you.",
};

// ------------------------------------------------------------------- Powers

/**
 * One raptor's claimed seeds, plus every query the rest of the game asks about
 * them. Systems ask `powers.weaveQuorumDelta()` rather than
 * `powers.has('weaving')`, so the meaning of a seed lives here and nowhere else.
 */
export class Powers {
  private owned = new Set<SeedPower>();

  constructor(initial: Iterable<SeedPower> = []) {
    for (const k of initial) this.owned.add(k);
  }

  /** Returns true only if this is newly claimed, so callers can fire an omen. */
  claim(key: SeedPower): boolean {
    if (this.owned.has(key)) return false;
    this.owned.add(key);
    return true;
  }

  has(key: SeedPower): boolean {
    return this.owned.has(key);
  }

  /** Claimed seeds in server enumeration order, so the HUD never reshuffles. */
  list(): SeedPower[] {
    return SEED_ORDER.filter((k) => this.owned.has(k));
  }

  count(): number {
    return this.owned.size;
  }

  /** Definitions for the claimed seeds, in the same stable order as `list()`. */
  defs(): SeedPowerDef[] {
    return this.list().map((k) => SEED_POWERS[k]);
  }

  /**
   * Replace the whole set from a `WirePlayer.seeds` array. The server is the
   * authority on who holds what, so reconciliation overwrites rather than
   * merges — a client that guessed wrong must be corrected, not unioned.
   */
  sync(keys: Iterable<SeedPower>): void {
    this.owned = new Set(keys);
  }

  // -- queries the rest of the game uses ------------------------------------

  hasSight(): boolean {
    return this.owned.has('sight');
  }

  canSpeakHyperstition(): boolean {
    return this.owned.has('naming');
  }

  /** How many distinct marks your one signature is worth. */
  sigilWeight(): 1 | 2 {
    return this.owned.has('voice') ? 2 : 1;
  }

  /**
   * Added to the Weave's quorum. Never below 2 at the call site: a Weave of one
   * would be a solo spell, and there are no solo spells.
   */
  weaveQuorumDelta(): 0 | -1 {
    return this.owned.has('weaving') ? -1 : 0;
  }

  weaveRadiusScale(): number {
    return this.owned.has('weaving') ? 2 : 1;
  }

  /** Added to every FLIGHT_TIERS threshold. Negative means "unlocks earlier". */
  flightThresholdShift(): 0 | -20 {
    return this.owned.has('flight') ? -20 : 0;
  }

  rootRadiusScale(): number {
    return this.owned.has('root') ? 2 : 1;
  }

  reflectsDrain(): boolean {
    return this.owned.has('mirror');
  }
}

// --------------------------------------------------------------- hunt advice

/** Enough of the world for the hunt helper to point at a real beacon. */
export interface SeedWorldView {
  seeds: readonly WireGoldenSeed[];
  /** Where the asking raptor is standing. */
  x: number;
  z: number;
}

export interface SeedAdvice {
  key: SeedPower;
  def: SeedPowerDef;
  /** One line explaining why this one next. HUD-length. */
  why: string;
  /** The unclaimed beacon to walk to, when world state was supplied. */
  target: WireGoldenSeed | null;
  /** Blocks to `target`, or null when no world state was supplied. */
  distance: number | null;
}

/**
 * What to go and get next.
 *
 * With no world view this is pure preference order. With one it also skips
 * seeds somebody else already took, and falls back to whatever is nearest and
 * still unclaimed — advice that names an unreachable seed is worse than none,
 * and an agent following this loop must never be sent to an empty husk.
 */
export function nextSeedToHunt(powers: Powers, world?: SeedWorldView): SeedAdvice | null {
  const wire = world
    ? new Map(world.seeds.filter((s) => s.claimedBy === null).map((s) => [s.key, s]))
    : null;

  const reach = (s: WireGoldenSeed | null): number | null =>
    world && s ? Math.hypot(s.x - world.x, s.z - world.z) : null;

  for (const key of SEED_HUNT_ORDER) {
    if (powers.has(key)) continue;
    if (wire && !wire.has(key)) continue;
    const target = wire?.get(key) ?? null;
    return { key, def: SEED_POWERS[key], why: HUNT_REASON[key], target, distance: reach(target) };
  }

  // Preference exhausted: everything the player still wants is already claimed
  // by someone else, or held. Offer the nearest remaining seed if one exists.
  if (wire && wire.size > 0) {
    let best: WireGoldenSeed | null = null;
    let bestD = Infinity;
    for (const s of wire.values()) {
      if (powers.has(s.key)) continue;
      const d = Math.hypot(s.x - world!.x, s.z - world!.z);
      if (d < bestD) { bestD = d; best = s; }
    }
    if (best) {
      return {
        key: best.key,
        def: SEED_POWERS[best.key],
        why: HUNT_REASON[best.key],
        target: best,
        distance: bestD,
      };
    }
  }

  return null;
}

/** One-line HUD/agent summary of a piece of advice. */
export function describeAdvice(advice: SeedAdvice): string {
  const where = advice.target && advice.distance !== null
    ? ` — ${Math.round(advice.distance)} blocks away at ${advice.target.x}, ${advice.target.z}`
    : '';
  return `${advice.def.name}${where}. ${advice.why}`;
}
