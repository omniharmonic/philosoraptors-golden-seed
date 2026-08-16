/**
 * WIRE PROTOCOL — the single source of truth shared by three implementations:
 *
 *   1. server/server.mjs   (authority)
 *   2. src/net/Net.ts      (browser client)
 *   3. mcp/server.mjs      (agent client)
 *
 * THIS FILE IS A CONTRACT. Parallel work packages code against it. Do not
 * change a field's meaning without updating all three implementations.
 *
 * Design rule: anything an AGENT must reason about lives here as structured
 * state, because an agent has no renderer and cannot infer the world from
 * pixels. That is also what keeps two browser clients from disagreeing.
 */

import type { DeclKind } from '../systems/declarations';

export type PlayerId = string;
export type Uid = string;

// ------------------------------------------------------------------ entities

export interface WirePlayer {
  id: PlayerId;
  name: string;
  hue: number;
  x: number; y: number; z: number;
  yaw: number;
  coherence: number;
  /** Golden Seed power keys this player has claimed. */
  seeds: SeedPower[];
  /** True for MCP/agent clients. */
  agent: boolean;
}

export type MolochState = 'roam' | 'reap' | 'menace' | 'banish';

export interface WireMoloch {
  uid: Uid;
  x: number; y: number; z: number;
  yaw: number;
  /** How much of the commons he has eaten. Drives size and drain radius. */
  gorge: number;
  /** 0..1. Raised by a real Hyperobject, or by enough simultaneous beams. */
  bound: number;
  state: MolochState;
  /**
   * How many raptors currently have a beam on him. This is the arcade form of
   * quorum: one stream barely slows him, three pin him in place. Held in real
   * time rather than accumulated, so it can only ever be paid by people who
   * showed up at the same moment.
   */
  tether: number;
  /** 0..1 progress toward being held long enough to be taken. */
  held: number;
}

/**
 * A Hyperobject: the material consequence of a Hyperstition.
 *
 * It spawns INERT and barely visible. Each distinct raptor who aligns with it
 * makes it fractionally more real. At `invigoration >= required` it becomes
 * true and binds the Moloch it was declared against.
 */
export interface WireHyper {
  uid: Uid;
  /** Which declaration this is; decides the effect when it becomes true. */
  kind: DeclKind;
  x: number; y: number; z: number;
  /** The declared future. Free text, written by the author. */
  claim: string;
  invigoration: number;
  required: number;
  contributors: PlayerId[];
  targetUid: Uid | null;
  authorId: PlayerId;
  remaining: number;
}

export type SeedPower =
  | 'sight' | 'naming' | 'voice' | 'weaving' | 'flight' | 'root' | 'mirror';

export interface WireGoldenSeed {
  uid: Uid;
  key: SeedPower;
  name: string;
  grants: string;
  x: number; z: number;
  claimedBy: PlayerId | null;
}

export interface WireChat {
  from: string;
  text: string;
  /** `say` = a player spoke. `omen`/`system` = the world spoke. */
  kind: 'say' | 'omen' | 'system';
  t: number;
}

// ------------------------------------------------------- client -> server

export type ClientMsg =
  | { t: 'hello'; id: PlayerId; name: string; hue: number; agent?: boolean;
      x?: number; y?: number; z?: number; coherence?: number }
  | { t: 'state'; x: number; y: number; z: number; yaw: number; coherence: number }
  | { t: 'chat'; text: string }
  | { t: 'hyperstition'; kind: DeclKind; claim: string }
  | { t: 'align'; uid: Uid;
      /** Council raptors aligning alongside you. */
      assist?: number }
  | { t: 'block'; x: number; y: number; z: number; id: number }
  | { t: 'extract'; n?: number }
  | { t: 'plant'; n?: number }
  | { t: 'attack'; uid: Uid }
  /** Continuous beam. Sent while held, ~6Hz; the server times out stale beams. */
  | { t: 'beam'; uid: Uid | null; on: boolean;
      /** Council raptors lending their streams, as counted by the client. */
      assist?: number };

// ------------------------------------------------------- server -> client

export type ServerMsg =
  | { t: 'welcome'; you: PlayerId; seed: number; molochPressure: number; authority: boolean;
      molochs: WireMoloch[]; hypers: WireHyper[];
      goldenSeeds: WireGoldenSeed[]; seedPowers: { key: SeedPower; name: string; grants: string }[];
      edits: [string, number][]; chat: WireChat[]; peers: WirePlayer[] }
  | ({ t: 'join' } & WirePlayer)
  | { t: 'leave'; id: PlayerId }
  | { t: 'state'; id: PlayerId; x: number; y: number; z: number; yaw: number; coherence: number }
  | ({ t: 'chat' } & WireChat)
  | { t: 'molochSpawn'; moloch: WireMoloch }
  | { t: 'molochBound'; uid: Uid }
  | { t: 'molochHeld'; uid: Uid; tether: number; held: number; beamers: string[];
      capped?: boolean; need?: number }
  | { t: 'molochTaken'; uid: Uid; beamers: PlayerId[]; total?: number; assist?: number }
  | { t: 'molochGone'; uid: Uid }
  | { t: 'hyperOpen'; hyper: WireHyper }
  | { t: 'hyperAlign'; uid: Uid; by: PlayerId; name: string;
      invigoration: number; required: number; contributors: PlayerId[] }
  | { t: 'hyperReal'; uid: Uid; kind: DeclKind; claim: string;
      x: number; y: number; z: number; contributors: PlayerId[] }
  | { t: 'hyperFade'; uid: Uid }
  | { t: 'seedClaimed'; uid: Uid; key: SeedPower; by: PlayerId; name: string }
  | { t: 'block'; x: number; y: number; z: number; id: number }
  | { t: 'moloch'; pressure: number }
  | { t: 'drain'; amount: number; uid: Uid }
  | { t: 'denied'; why: string }
  | { t: 'tick'; molochs: WireMoloch[]; hypers: WireHyper[]; pressure: number;
      authority: PlayerId | null };

export const RELAY_PORT = 8787;
export const relayUrl = (host = 'localhost') => `ws://${host}:${RELAY_PORT}`;

/**
 * Rules an agent (or a human) must know, stated once so every client can
 * surface them identically.
 */
export const RULES = {
  molochImmuneToForce:
    'Moloch takes no damage from blocks, tools, or any solo action. He is not a monster with hit points; he is the shape a group makes when none of them can trust the others.',
  hyperstitionRequiresNaming:
    'Only a raptor holding the Seed of Naming may speak a Hyperstition.',
  alignOncePerRaptor:
    'Each raptor may align with a given Hyperobject exactly once. Signatures are not votes you can stack.',
  quorumIsTheGame:
    'Every meaningful act needs k distinct raptors. There is no solo path to the Golden Seed.',
  declareThenAlign:
    'There is one commitment verb. You DECLARE a future that is not true yet; others ALIGN with it; at quorum it becomes true and the world changes to match. Nothing you declare is real until other raptors act as if it were.',
  beamsHoldTheyDoNotHurt:
    'Your beam does not damage Moloch. It tethers him. One stream barely slows him; three at once hold him still long enough to be taken. Cross the streams.',
} as const;

/** Spark: the fast, self-refilling resource that pays for beams and flight. */
export const SPARK_MAX = 100;
export const SPARK_REGEN = 26;        // per second, after a short delay
export const SPARK_BEAM_COST = 12;    // per second while beaming (~8s from full)
export const SPARK_FLY_COST = 11;     // per second while flying
/** Simultaneous beams needed to fully pin a Moloch. */
export const TETHER_TO_HOLD = 3;
