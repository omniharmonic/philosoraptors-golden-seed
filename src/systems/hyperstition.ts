/**
 * Hyperstitions — fictions that make themselves true by being acted upon.
 *
 * This is the only mechanic in the game that can touch Moloch, and it is
 * deliberately built so that no single raptor can operate it. One player with
 * the Seed of Naming *speaks* a future that is not yet real; the declaration
 * creates a Hyperobject with `invigoration = 0`, which is to say: a claim with
 * nothing behind it is exactly as powerful as silence. Only distinct OTHER
 * raptors turning up and acting as if it were already true move the number, and
 * only when it reaches `required` does the server mark it real and bind the
 * Moloch it was declared against.
 *
 * So the file below is mostly predicates and a state mirror. It performs no
 * networking and holds no authority — the server owns every number here, and
 * these helpers exist so the HUD and the agent can *ask the same questions the
 * server will answer* before spending an action on a refusal.
 */

import type { PlayerId, SeedPower, ServerMsg, Uid, WireHyper } from '../net/protocol';

// ------------------------------------------------------------------ constants
// These mirror server/server.mjs exactly. If the server moves, move them here.

/** Horizontal metres inside which `align` is accepted. */
export const ALIGN_RANGE = 60;
/** Horizontal metres from a Moloch inside which a Hyperstition may be spoken. */
export const DECLARE_RANGE = 120;
/** The server truncates claims at this length. */
export const MAX_CLAIM_LEN = 160;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

// --------------------------------------------------------------------- claims

export type ClaimTheme =
  | 'regeneration'
  | 'incentives'
  | 'interbeing'
  | 'possible';

export interface ClaimSuggestion {
  /** Short stable handle, so an agent can say `speak('soil-returns')`. */
  id: string;
  theme: ClaimTheme;
  /** The declared future, in the first person plural. Sent verbatim as `claim`. */
  text: string;
  /** When this one is the right thing to say. Shown as a hint, never sent. */
  when: string;
}

/**
 * Suggested Hyperstitions.
 *
 * Every one of these is phrased as an accomplished fact rather than a wish,
 * because that is the whole trick: a hyperstition is not "we should" — it is
 * "this is so", spoken early, and then made retroactively honest by the people
 * who act on it. A player is free to type their own; these exist so that a new
 * raptor (or an agent with no taste) has somewhere true to start.
 */
export const SUGGESTED_CLAIMS: ClaimSuggestion[] = [
  // --- regenerative civilisation
  {
    id: 'soil-returns',
    theme: 'regeneration',
    text: 'The ground we stripped grows food again, and our grandchildren will not know it was ever bare.',
    when: 'Standing on ash or raked soil, where the damage is visible.',
  },
  {
    id: 'tools-that-mend',
    theme: 'regeneration',
    text: 'From here on every tool we make leaves the ground richer than it found it.',
    when: 'After a round of extraction — aimed at how we build, not at what we built.',
  },
  {
    id: 'two-for-one',
    theme: 'regeneration',
    text: 'We plant two seeds for every one we lift, and we do it when nobody is counting.',
    when: 'When pressure is climbing and the group is still arguing about blame.',
  },
  {
    id: 'creek-runs-clear',
    theme: 'regeneration',
    text: 'The creek runs clear from the Divide to the plain, and the fish come back up it.',
    when: 'At water. The most concrete claim on the list; good for a first attempt.',
  },

  // --- aligned incentives
  {
    id: 'honest-tally',
    theme: 'incentives',
    text: 'Every tally is read aloud before it is acted on, so no one profits from a number nobody checked.',
    when: 'Ep3. When the group is trusting a green lantern it has not verified.',
  },
  {
    id: 'no-one-races',
    theme: 'incentives',
    text: 'No raptor gains by moving first, so none of us has to.',
    when: 'The purest anti-Moloch claim: it dissolves the race rather than winning it.',
  },
  {
    id: 'taker-carries-cost',
    theme: 'incentives',
    text: 'Whoever takes from the commons carries the cost of taking, in full, in public.',
    when: 'When one player is drawing down a shared valley faster than the rest.',
  },
  {
    id: 'defection-stops-paying',
    theme: 'incentives',
    text: 'Cutting the corner stops paying, and so it quietly stops happening.',
    when: 'Late, against a heavily gorged Moloch — it targets the payoff, not the player.',
  },

  // --- interbeing
  {
    id: 'your-back-is-mine',
    theme: 'interbeing',
    text: 'I cannot see my own back and you cannot see yours, so from now on we preen each other.',
    when: 'Ep4b. Pairs well with an open Preening seal.',
  },
  {
    id: 'one-valley',
    theme: 'interbeing',
    text: 'There is no my valley and your valley. There is the valley.',
    when: 'Ep3, at the ridge between the tended and the grey ground.',
  },
  {
    id: 'breath-steadies-fire',
    theme: 'interbeing',
    text: 'Our breathing falls into sync, and with each shared breath the fire steadies.',
    when: 'Ep2a. Short, easy to align with; a good claim for a small flock.',
  },
  {
    id: 'the-stranger-eats',
    theme: 'interbeing',
    text: 'A raptor we will never meet eats tonight because of what we decide here.',
    when: 'When the group is deciding something whose cost lands on absent people.',
  },

  // --- the more beautiful world our hearts know is possible
  {
    id: 'beautiful-world',
    theme: 'possible',
    text: 'The more beautiful world our hearts know is possible is already underway, and we are standing inside it.',
    when: 'The canonical hyperstition. Needs many sigils; do not speak it alone and early.',
  },
  {
    id: 'moloch-is-a-shape',
    theme: 'possible',
    text: 'Moloch is only the shape we make when we cannot trust each other, and we can.',
    when: 'Face to face with him. Names the antagonist as a relation rather than a body.',
  },
  {
    id: 'seed-was-never-mine',
    theme: 'possible',
    text: "The Golden Seed was never one raptor's to carry, and it never had to be.",
    when: 'Near the end of the arc, when someone is still trying to solo it.',
  },
  {
    id: 'language-of-light',
    theme: 'possible',
    text: 'Our song is written into a language of light, and everyone who comes after can read it.',
    when: 'Ep7b, at the obelisk. Claims the future for people not yet in the game.',
  },
];

export const claimById = (id: string): ClaimSuggestion | undefined =>
  SUGGESTED_CLAIMS.find((c) => c.id === id);

export const claimsByTheme = (theme: ClaimTheme): ClaimSuggestion[] =>
  SUGGESTED_CLAIMS.filter((c) => c.theme === theme);

/** Clip free text to what the server will actually store. */
export const truncateClaim = (text: string): string =>
  text.length <= MAX_CLAIM_LEN ? text : `${text.slice(0, MAX_CLAIM_LEN - 1)}…`;

// ----------------------------------------------------------------- predicates

/** Only the Seed of Naming lets you declare a future that is not yet true. */
export const canSpeak = (seeds: readonly SeedPower[]): boolean =>
  seeds.includes('naming');

/** The Seed of Voice makes your sigil count twice toward any quorum. */
export const alignWeight = (seeds: readonly SeedPower[]): number =>
  (seeds.includes('voice') ? 2 : 1);

/**
 * One raptor, one alignment. Signatures are not votes you can stack — if this
 * were per-action rather than per-identity, a single player could invigorate a
 * Hyperobject alone and the whole thesis would collapse.
 */
export const canAlign = (hyper: WireHyper, playerId: PlayerId): boolean =>
  !hyper.contributors.includes(playerId);

/** Horizontal only, matching the server's own check. */
export const distanceTo = (hyper: WireHyper, pos: { x: number; z: number }): number =>
  Math.hypot(hyper.x - pos.x, hyper.z - pos.z);

export const distanceOk = (hyper: WireHyper, pos: { x: number; z: number }): boolean =>
  distanceTo(hyper, pos) <= ALIGN_RANGE;

/** A Hyperstition must be spoken against a Moloch you can actually see. */
export const canDeclareAgainst = (
  pos: { x: number; z: number },
  moloch: { x: number; z: number },
): boolean => Math.hypot(moloch.x - pos.x, moloch.z - pos.z) <= DECLARE_RANGE;

/** 0..1. Shared with HyperObject so the visual and the HUD never disagree. */
export const invigorationRatio = (invigoration: number, required: number): number =>
  clamp01(invigoration / Math.max(1, required));

export const progress = (hyper: WireHyper): number =>
  invigorationRatio(hyper.invigoration, hyper.required);

/** Sigils still needed. Never negative; the server fires the moment it hits 0. */
export const stillNeeded = (hyper: WireHyper): number =>
  Math.max(0, hyper.required - hyper.invigoration);

/** One line an agent or the HUD can read without knowing the wire format. */
export const describe = (hyper: WireHyper): string =>
  `"${hyper.claim}" — ${hyper.invigoration}/${hyper.required} sigils, ` +
  `${Math.max(0, Math.round(hyper.remaining))}s left`;

// ------------------------------------------------------------- state mirror

export interface HyperStateEvents {
  onOpen?(hyper: WireHyper): void;
  onAlign?(hyper: WireHyper, by: PlayerId, name: string): void;
  /** The claim came true. The server has already deleted it and bound the Moloch. */
  onReal?(hyper: WireHyper): void;
  /** Nobody showed up in time. */
  onFade?(hyper: WireHyper): void;
}

/**
 * A read-only mirror of the server's Hyperobject table.
 *
 * It deliberately owns no socket. `Net.ts` (package A) hands messages in;
 * `main.ts` hands the events back out to spawn and retire `HyperObject`
 * visuals. Keeping this class dumb is what lets the browser client, the agent
 * client and the tests all share one interpretation of the same bytes.
 */
export class HyperState {
  private readonly byUid = new Map<Uid, WireHyper>();
  private readonly events: HyperStateEvents;

  constructor(events: HyperStateEvents = {}) {
    this.events = events;
  }

  /** Live Hyperobjects, in the order the server declared them. */
  get active(): WireHyper[] {
    return [...this.byUid.values()];
  }

  get count(): number {
    return this.byUid.size;
  }

  get(uid: Uid): WireHyper | undefined {
    return this.byUid.get(uid);
  }

  /** Feed every server message in; non-Hyperobject traffic is ignored. */
  ingest(msg: ServerMsg): void {
    switch (msg.t) {
      case 'welcome':
        this.syncAll(msg.hypers);
        break;
      case 'tick':
        this.syncAll(msg.hypers);
        break;
      case 'hyperOpen':
        this.open(msg.hyper);
        break;
      case 'hyperAlign':
        this.align(msg.uid, msg.by, msg.name, msg.invigoration, msg.required, msg.contributors);
        break;
      case 'hyperReal':
        this.real(msg.uid, msg.claim, msg.contributors);
        break;
      case 'hyperFade':
        this.fade(msg.uid);
        break;
      default:
        break;
    }
  }

  open(hyper: WireHyper): void {
    if (this.byUid.has(hyper.uid)) return;
    const copy: WireHyper = { ...hyper, contributors: [...hyper.contributors] };
    this.byUid.set(copy.uid, copy);
    this.events.onOpen?.(copy);
  }

  align(
    uid: Uid,
    by: PlayerId,
    name: string,
    invigoration: number,
    required: number,
    contributors: readonly PlayerId[],
  ): void {
    const h = this.byUid.get(uid);
    if (!h) return;
    h.invigoration = invigoration;
    h.required = required;
    h.contributors = [...contributors];
    this.events.onAlign?.(h, by, name);
  }

  real(uid: Uid, claim: string, contributors: readonly PlayerId[]): void {
    const h = this.byUid.get(uid);
    if (!h) return;
    // Snapshot the final truth before handing it over: the server sends the
    // authoritative contributor list with this message and then forgets the
    // object, so this is the last chance to get the credits right.
    h.claim = claim;
    h.contributors = [...contributors];
    h.invigoration = Math.max(h.invigoration, h.required);
    this.byUid.delete(uid);
    this.events.onReal?.(h);
  }

  fade(uid: Uid): void {
    const h = this.byUid.get(uid);
    if (!h) return;
    this.byUid.delete(uid);
    this.events.onFade?.(h);
  }

  /**
   * Reconcile against a full server list (`welcome` and every `tick`).
   * Anything the server has stopped listing has ended; we report it as a fade
   * because a real one always arrives as its own message first, so a leftover
   * here means we dropped a packet rather than that a claim came true.
   */
  syncAll(list: readonly WireHyper[]): void {
    const seen = new Set<Uid>();
    for (const w of list) {
      seen.add(w.uid);
      const h = this.byUid.get(w.uid);
      if (!h) {
        this.open(w);
        continue;
      }
      // Mutate in place — HyperObject visuals hold this reference.
      h.x = w.x; h.y = w.y; h.z = w.z;
      h.claim = w.claim;
      h.invigoration = w.invigoration;
      h.required = w.required;
      h.contributors = [...w.contributors];
      h.remaining = w.remaining;
    }
    for (const uid of [...this.byUid.keys()]) {
      if (!seen.has(uid)) this.fade(uid);
    }
  }

  /** Smooth the countdown between ticks. Purely cosmetic; the server decides. */
  update(dt: number): void {
    for (const h of this.byUid.values()) {
      h.remaining = Math.max(0, h.remaining - dt);
    }
  }

  /** Nearest live Hyperobject to a point, or null. */
  nearest(pos: { x: number; z: number }): WireHyper | null {
    let best: WireHyper | null = null;
    let bd = Infinity;
    for (const h of this.byUid.values()) {
      const d = distanceTo(h, pos);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }

  /** Everything this player could align with right now, closest first. */
  alignableBy(playerId: PlayerId, pos: { x: number; z: number }): WireHyper[] {
    return this.active
      .filter((h) => canAlign(h, playerId) && distanceOk(h, pos))
      .sort((a, b) => distanceTo(a, pos) - distanceTo(b, pos));
  }

  clear(): void {
    this.byUid.clear();
  }
}
