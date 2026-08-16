/**
 * Declarations — the game's single commitment mechanic.
 *
 * This replaces the old seal system entirely. There used to be two parallel
 * ways to make a group commitment: "seals" (open one, others mark it with their
 * sigil, it fires at quorum) and "hyperstition" (declare a future, others align
 * with it, it becomes true at quorum). Those are the same mechanic wearing two
 * sets of nouns, and having both meant eight number keys were spent on a system
 * most players never understood while the one they did understand had no room.
 *
 * So there is now one verb. You DECLARE a future that is not true yet. Others
 * ALIGN with it. When enough have, it becomes true and the world changes to
 * match. That is the whole system, and it is also the game's thesis stated as a
 * control scheme: nothing you declare is real until other people act as if it
 * were.
 */

import type { SeedPower } from '../net/protocol';

export type DeclKind =
  | 'green'      // the ground comes back
  | 'catch'      // nobody falls here
  | 'preen'      // we see each other's backs
  | 'honest'     // our measures tell the truth
  | 'admit'      // we were wrong
  | 'bind'       // this Moloch is already unmade
  | 'door'       // there is a way through
  | 'seed';      // the third attractor, planted

export interface Declaration {
  kind: DeclKind;
  /** Short label for the selector. */
  name: string;
  /** What it does, in words a player can act on. */
  plain: string;
  /** The claim spoken aloud when declared. */
  claim: string;
  /** Distinct raptors who must align before it becomes true. */
  quorum: number;
  /** Coherence needed to declare it at all. */
  minCoherence: number;
  /** Effect radius in blocks. */
  radius: number;
  /** Seconds before an un-aligned declaration fades. */
  ttl: number;
  /** Coherence paid to everyone who aligned, when it comes true. */
  reward: number;
  colour: number;
  /** Must be spoken at a Moloch. */
  needsMoloch?: boolean;
  lore: string;
}

export const DECLARATIONS: Record<DeclKind, Declaration> = {
  green: {
    kind: 'green', name: 'The Ground Returns', plain: 'dead soil comes back to life',
    claim: 'This ground grows food again, and our grandchildren will not know it was ever bare.',
    quorum: 2, minCoherence: 0, radius: 12, ttl: 70, reward: 10, colour: 0x8fe04a,
    lore: 'Ep5a: "green rushes back in slow waves behind them."',
  },
  catch: {
    kind: 'catch', name: 'The Weave That Catches', plain: 'a bridge of light over a gap',
    claim: 'Nobody falls here. If one of us slips, the rest are already holding.',
    quorum: 3, minCoherence: 12, radius: 14, ttl: 80, reward: 16, colour: 0xff7a18,
    lore: 'Ep3b: "the woven net of light swings out and catches it softly."',
  },
  preen: {
    kind: 'preen', name: 'Preening', plain: 'clears the blind spot you cannot see',
    claim: 'I cannot see my own back. Will you preen me?',
    quorum: 2, minCoherence: 0, radius: 8, ttl: 60, reward: 12, colour: 0xffe9b0,
    lore: 'Ep4b: the line the hatchling speaks the moment it is born.',
  },
  honest: {
    kind: 'honest', name: 'The Honest Tally', plain: 'exposes checks that lie',
    claim: 'Our measures will tell the truth even when the truth is unflattering.',
    quorum: 2, minCoherence: 6, radius: 14, ttl: 60, reward: 8, colour: 0xd3b584,
    lore: 'Ep4a: "the light said yes and the egg was hollow."',
  },
  admit: {
    kind: 'admit', name: 'Belly-up', plain: 'admit a mistake together',
    claim: 'We were wrong, and we would rather say so than be right alone.',
    quorum: 3, minCoherence: 10, radius: 12, ttl: 70, reward: 18, colour: 0xf4e0bf,
    lore: "Ep4b: the flock's gesture for admitting a mistake.",
  },
  bind: {
    kind: 'bind', name: 'The Horned One Is Unmade', plain: 'binds a Moloch outright',
    claim: 'The horned one is already unmade. We simply have not caught up to it yet.',
    quorum: 3, minCoherence: 25, radius: 24, ttl: 150, reward: 25, colour: 0x4da6ff,
    needsMoloch: true,
    lore: 'A hyperstition proper: it is true because acting on it makes it true.',
  },
  door: {
    kind: 'door', name: 'The Song Becomes a Door', plain: 'opens the obelisk',
    claim: 'There is a way through, and it opens to a song rather than a key.',
    quorum: 4, minCoherence: 40, radius: 20, ttl: 120, reward: 25, colour: 0xffd27a,
    lore: 'Ep7b: "their song being written into a language of light."',
  },
  seed: {
    kind: 'seed', name: 'The Golden Seed', plain: 'plant the third attractor — wins the game',
    claim: 'A regenerative civilisation, with aligned incentives and interbeing at the core.',
    quorum: 7, minCoherence: 55, radius: 24, ttl: 180, reward: 40, colour: 0xffe9b0,
    lore: 'The seed of the third attractor, planted in material form.',
  },
};

/** Selector order. Roughly the order a player will unlock them. */
export const DECL_ORDER: DeclKind[] = [
  'green', 'preen', 'honest', 'catch', 'admit', 'bind', 'door', 'seed',
];

export const declOf = (k: DeclKind): Declaration => DECLARATIONS[k];

/** The Seed of Naming lets you declare anything, coherence or not. */
export const canDeclare = (
  d: Declaration,
  coherence: number,
  seeds: readonly SeedPower[],
): boolean => seeds.includes('naming') || coherence >= d.minCoherence;

/** Why a declaration is refused, phrased so it names the way forward. */
export function refusal(d: Declaration, coherence: number): string {
  return `"${d.name}" needs ${d.minCoherence} coherence — you have ${Math.floor(coherence)}. ` +
    'Sweep the stream over dead ground to earn more, or take a Moloch with the flock.';
}
