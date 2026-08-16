/**
 * Spells, seals and quorum.
 *
 * The design claim: a coordination problem should be a coordination problem in
 * the code, not a metaphor for one. So a spell is not something you cast — it
 * is a *commitment you open*, which does nothing at all until enough distinct
 * parties have marked it with their own sigil before it lapses.
 *
 * That makes the Golden Seed genuinely un-soloable in the way Moloch is
 * genuinely un-soloable: no amount of personal power substitutes for other
 * people showing up and signing.
 */

import type { Sigil } from './sigil';

export type SpellKey =
  | 'mirror'
  | 'rootline'
  | 'weave'
  | 'preen'
  | 'admission'
  | 'tally'
  | 'song'
  | 'seed';

export interface SpellDef {
  key: SpellKey;
  name: string;
  /** Distinct sigils required before the seal fires. */
  quorum: number;
  /** Effect radius in blocks. */
  radius: number;
  /** Seconds before an unfilled seal lapses. */
  ttl: number;
  /** Coherence the caster must already hold to open this seal. */
  minCoherence: number;
  /** Coherence granted to every signatory when it fires. */
  reward: number;
  colour: number;
  lore: string;
  hint: string;
}

export const SPELLS: Record<SpellKey, SpellDef> = {
  mirror: {
    key: 'mirror', name: 'Mirror Fire', quorum: 2, radius: 8, ttl: 45,
    minCoherence: 0, reward: 8, colour: 0xffb347,
    lore: 'Ep2a: "they begin mirroring each other\'s slow movements across the fire."',
    hint: 'Two raptors, facing. The smallest possible act of alignment.',
  },
  rootline: {
    key: 'rootline', name: 'Root-line', quorum: 2, radius: 10, ttl: 60,
    minCoherence: 12, reward: 10, colour: 0xff9a2e,
    lore: 'Ep5a: "green rushes back in slow waves behind them."',
    hint: 'Greens dead ground. Needs two, because one raptor replanting a valley is just gardening.',
  },
  preen: {
    key: 'preen', name: 'Preening', quorum: 2, radius: 6, ttl: 40,
    minCoherence: 8, reward: 12, colour: 0xffe9b0,
    lore: 'Ep4b: "I cannot see my own back — will you preen me?"',
    hint: 'Clears a blind spot you cannot clear yourself. Someone else has to see it.',
  },
  tally: {
    key: 'tally', name: 'Honest Tally', quorum: 1, radius: 12, ttl: 30,
    minCoherence: 6, reward: 4, colour: 0xd3b584,
    lore: 'Ep3: "scratching tallies and re-checking everything twice."',
    hint: 'Reveals what a green lantern is actually approving. Checks can lie.',
  },
  admission: {
    key: 'admission', name: 'Belly-up', quorum: 3, radius: 10, ttl: 50,
    minCoherence: 15, reward: 18, colour: 0xf4e0bf,
    lore: "Ep4b: the flock's gesture for admitting a mistake.",
    hint: 'Roll over and show the soft belly. Costs nothing but pride; pays the most.',
  },
  weave: {
    key: 'weave', name: 'The Weave That Catches', quorum: 3, radius: 14, ttl: 60,
    minCoherence: 22, reward: 16, colour: 0xff7a18,
    lore: 'Ep3b: "the woven net of light swings out and catches it softly."',
    hint: 'Spans a gap with walkable light. Also catches anyone who falls near it.',
  },
  song: {
    key: 'song', name: 'Song of Rings', quorum: 5, radius: 20, ttl: 90,
    minCoherence: 40, reward: 25, colour: 0xffd27a,
    lore: 'Ep7b: "their song being written into a language of light."',
    hint: 'Sung in overlapping rounds at the obelisk. Five voices turn a wall into a door.',
  },
  seed: {
    key: 'seed', name: 'The Golden Seed', quorum: 7, radius: 24, ttl: 120,
    minCoherence: 60, reward: 40, colour: 0xffe9b0,
    lore: 'The seed of the third attractor, planted in material form.',
    hint: 'Seven sigils. There is no version of this you can do alone. That is the point.',
  },
};

export const SPELL_ORDER: SpellKey[] = [
  'mirror', 'rootline', 'preen', 'tally', 'admission', 'weave', 'song', 'seed',
];

export interface Seal {
  uid: string;
  key: SpellKey;
  x: number;
  y: number;
  z: number;
  /** Sigils that have marked this seal, keyed by player/NPC id. */
  marks: Map<string, Sigil>;
  quorum: number;
  /** Seconds remaining before it lapses. */
  remaining: number;
  fired: boolean;
  /** Who opened it. */
  openerId: string;
  /** Rising 0..1 while firing, for the visual. */
  burst: number;
}

export interface SealEvents {
  onOpen?(seal: Seal): void;
  onMark?(seal: Seal, sigil: Sigil): void;
  onFire?(seal: Seal, def: SpellDef): void;
  onLapse?(seal: Seal): void;
}

let uidCounter = 0;

export class SealSystem {
  readonly seals: Seal[] = [];
  private events: SealEvents;

  constructor(events: SealEvents = {}) {
    this.events = events;
  }

  /** Open a commitment at a point. Returns null if the spell is unavailable. */
  open(
    key: SpellKey,
    x: number,
    y: number,
    z: number,
    opener: Sigil,
    coherence: number,
  ): Seal | { error: string } {
    const def = SPELLS[key];
    if (coherence < def.minCoherence) {
      return { error: `${def.name} needs ${def.minCoherence} coherence — you have ${Math.floor(coherence)}.` };
    }
    // Re-opening the same spell near an existing seal marks it instead.
    const near = this.seals.find(
      (s) => !s.fired && s.key === key && Math.hypot(s.x - x, s.y - y, s.z - z) < def.radius,
    );
    if (near) {
      this.mark(near, opener);
      return near;
    }

    const seal: Seal = {
      uid: `seal${++uidCounter}`,
      key,
      x, y, z,
      marks: new Map([[opener.id, opener]]),
      quorum: def.quorum,
      remaining: def.ttl,
      fired: false,
      openerId: opener.id,
      burst: 0,
    };
    this.seals.push(seal);
    this.events.onOpen?.(seal);
    this.checkFire(seal);
    return seal;
  }

  /** Add a sigil to an existing seal. Idempotent per identity. */
  mark(seal: Seal, sigil: Sigil): boolean {
    if (seal.fired) return false;
    if (seal.marks.has(sigil.id)) return false;
    seal.marks.set(sigil.id, sigil);
    this.events.onMark?.(seal, sigil);
    this.checkFire(seal);
    return true;
  }

  /** Seals within range of a point that still need marks. */
  openSealsNear(x: number, y: number, z: number, range = 12): Seal[] {
    return this.seals.filter(
      (s) => !s.fired && Math.hypot(s.x - x, s.y - y, s.z - z) <= range,
    );
  }

  private checkFire(seal: Seal): void {
    if (seal.fired) return;
    if (seal.marks.size < seal.quorum) return;
    seal.fired = true;
    seal.burst = 0.0001;
    this.events.onFire?.(seal, SPELLS[seal.key]);
  }

  update(dt: number): void {
    for (let i = this.seals.length - 1; i >= 0; i--) {
      const s = this.seals[i];
      if (s.fired) {
        s.burst += dt * 1.6;
        if (s.burst >= 1) this.seals.splice(i, 1);
        continue;
      }
      s.remaining -= dt;
      if (s.remaining <= 0) {
        this.events.onLapse?.(s);
        this.seals.splice(i, 1);
      }
    }
  }
}
