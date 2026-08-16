#!/usr/bin/env node
/**
 * Philosoraptors MCP server — an agent's body in the valley.
 *
 * This is a *client* of server/server.mjs, exactly as legitimate as a browser
 * and exactly as constrained. It speaks the same wire protocol
 * (src/net/protocol.ts) and gets no privileged information: everything a tool
 * reports here is something a human could read off their own screen.
 *
 * The one asymmetry runs the other way. A browser player infers the world from
 * pixels; an agent cannot, so every tool result is structured state plus enough
 * prose to be actionable without a renderer — distances, bearings, how many
 * more sigils a commitment needs, and which legal moves exist right now.
 *
 * The design invariant that shapes every tool below: NOTHING HERE LETS ONE
 * AGENT WIN ALONE. `attack` exists only so that it can refuse. `open_seal`
 * creates an obligation, not an effect. `align` is capped at one per raptor.
 * An agent that wants progress has to talk to somebody.
 *
 * stdout is the MCP transport. Never console.log — diagnostics go to stderr.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import WebSocket from 'ws';

// ------------------------------------------------------------------ contract
// Mirrored by hand from the TypeScript sources because this file is plain ESM
// and cannot import them. If either side changes, both must change.

/** src/net/protocol.ts — RULES (verbatim). */
const RULES = {
  molochImmuneToForce:
    'Moloch takes no damage from blocks, tools, or any solo action. He is not a monster with hit points; he is the shape a group makes when none of them can trust the others.',
  hyperstitionRequiresNaming:
    'Only a raptor holding the Seed of Naming may speak a Hyperstition.',
  alignOncePerRaptor:
    'Each raptor may align with a given Hyperobject exactly once. Signatures are not votes you can stack.',
  quorumIsTheGame:
    'Every meaningful act needs k distinct raptors. There is no solo path to the Golden Seed.',
  beamsHoldTheyDoNotHurt:
    'Your beam does not damage Moloch. It TETHERS him. One stream barely slows him; three raptors beaming the SAME Moloch AT THE SAME MOMENT hold him still long enough to take him. Agree a uid and a moment in chat first, then all call beam() together.',
};

/** src/systems/spells.ts — SPELLS, reduced to the fields an agent can act on. */
const SPELLS = {
  mirror: {
    key: 'mirror', name: 'Mirror Fire', quorum: 2, radius: 8, ttl: 45,
    minCoherence: 0, reward: 8,
    hint: 'Two raptors, facing. The smallest possible act of alignment.',
  },
  rootline: {
    key: 'rootline', name: 'Root-line', quorum: 2, radius: 10, ttl: 60,
    minCoherence: 12, reward: 10,
    hint: 'Greens dead ground. Needs two, because one raptor replanting a valley is just gardening.',
  },
  preen: {
    key: 'preen', name: 'Preening', quorum: 2, radius: 6, ttl: 40,
    minCoherence: 8, reward: 12,
    hint: 'Clears a blind spot you cannot clear yourself. Someone else has to see it.',
  },
  tally: {
    key: 'tally', name: 'Honest Tally', quorum: 1, radius: 12, ttl: 30,
    minCoherence: 6, reward: 4,
    hint: 'Reveals what a green lantern is actually approving. Checks can lie.',
  },
  admission: {
    key: 'admission', name: 'Belly-up', quorum: 3, radius: 10, ttl: 50,
    minCoherence: 15, reward: 18,
    hint: 'Roll over and show the soft belly. Costs nothing but pride; pays the most.',
  },
  weave: {
    key: 'weave', name: 'The Weave That Catches', quorum: 3, radius: 14, ttl: 60,
    minCoherence: 22, reward: 16,
    hint: 'Spans a gap with walkable light. Also catches anyone who falls near it.',
  },
  song: {
    key: 'song', name: 'Song of Rings', quorum: 5, radius: 20, ttl: 90,
    minCoherence: 40, reward: 25,
    hint: 'Sung in overlapping rounds at the obelisk. Five voices turn a wall into a door.',
  },
  seed: {
    key: 'seed', name: 'The Golden Seed', quorum: 7, radius: 24, ttl: 120,
    minCoherence: 60, reward: 40,
    hint: 'Seven sigils. There is no version of this you can do alone. That is the point.',
  },
};

const SPELL_ORDER = ['mirror', 'rootline', 'preen', 'tally', 'admission', 'weave', 'song', 'seed'];

/** src/player/Player.ts — WALK. The agent gets the walking body, never sprint or flight. */
const WALK_SPEED = 5.0;
/** server/server.mjs — the two ranges the relay actually enforces. */
const HYPERSTITION_RANGE = 120;
const ALIGN_RANGE = 60;
/** server/server.mjs — golden seeds are claimed by walking within this of them. */
const SEED_PICKUP_RANGE = 6;

const RELAY_URL = process.env.PHILO_RELAY || 'ws://localhost:8787';

// ------------------------------------------------------------------ sigil
// src/systems/sigil.ts + src/world/noise.ts, ported verbatim so the name the
// agent reports for itself is the same glyph-name a human sees over its head.

function strHash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

const ONSET = ['ka', 've', 'thu', 'sil', 'mor', 'ael', 'rhe', 'tan', 'oru', 'lys', 'bre', 'nim'];
const CODA = ['dris', 'val', 'thas', 'wen', 'rok', 'lith', 'mar', 'sunn', 'ver', 'eth', 'orn', 'ka'];

function makeSigil(id) {
  const h = strHash(id);
  const hue = Math.floor((h % 3600) / 10);
  const a = ONSET[h % ONSET.length];
  const b = CODA[(h >>> 8) % CODA.length];
  return { id, name: a.charAt(0).toUpperCase() + a.slice(1) + b, hue };
}

// ------------------------------------------------------------------ state

const state = {
  /** Names streaming at the last molochHeld tick. */
  lastBeamers: [],
  lastTaken: null,
  ws: null,
  /** True once the relay has sent `welcome`. */
  joined: false,
  heartbeat: null,
  relayUrl: RELAY_URL,
  worldSeed: 0,
  authority: null,
  pressure: 0,

  me: {
    id: null,
    name: null,
    sigil: null,
    x: 0, y: 60, z: 0, yaw: 0,
    /**
     * The relay does not own coherence — each client computes its own and
     * reports it in `state`, exactly as the browser does. We grow it the same
     * way the browser does: every signatory of a fired seal is paid.
     */
    coherence: 0,
    seeds: new Set(),
  },

  peers: new Map(),        // id -> WirePlayer
  seals: new Map(),        // uid -> WireSeal + { _at } (see sealSecondsLeft)
  molochs: new Map(),      // uid -> WireMoloch
  hypers: new Map(),       // uid -> WireHyper
  goldenSeeds: [],         // WireGoldenSeed[]
  seedPowers: [],          // { key, name, grants }[]
  chat: [],                // WireChat[]

  events: [],              // { t, text }
  lastDenied: null,        // { why, t }
  lastSealFire: null,      // { uid, key, marks, t } — the frame that closed a seal
  lastHyperReal: null,     // { uid, claim, contributors, invigoration, required, t }
  drainAccum: 0,
  drainReportedAt: 0,
  closeReason: null,
};

const nowMs = () => Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r1 = (n) => Math.round(n * 10) / 10;

function logEvent(text) {
  state.events.push({ t: nowMs(), text });
  if (state.events.length > 600) state.events.shift();
}

function eventsSince(t) {
  return state.events
    .filter((e) => e.t >= t)
    .map((e) => `[${new Date(e.t).toISOString().slice(11, 19)}] ${e.text}`);
}

/** Poll until `fn()` returns something truthy, or give up. Cheap and honest. */
async function waitFor(fn, ms = 1500, step = 25) {
  const deadline = nowMs() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (nowMs() >= deadline) return null;
    await sleep(step);
  }
}

// ------------------------------------------------------------------ geometry
//
// The game's yaw convention is atan2(dx, dz) — see server/server.mjs. So the
// bearing an agent gets here is the same number a browser raptor turns to.
// North is +Z, east is +X.

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

function bearingTo(x, z) {
  const dx = x - state.me.x;
  const dz = z - state.me.z;
  const deg = ((Math.atan2(dx, dz) * 180) / Math.PI + 360) % 360;
  return { bearing: Math.round(deg), compass: COMPASS[Math.round(deg / 22.5) % 16] };
}

function distTo(x, z) {
  return Math.hypot(x - state.me.x, z - state.me.z);
}

/** Everything an agent needs to walk to a thing, in one object. */
function where(x, z) {
  return { x: Math.round(x), z: Math.round(z), distance: r1(distTo(x, z)), ...bearingTo(x, z) };
}

// ------------------------------------------------------------------ readings

function pressureReading(p) {
  if (p < 0.2) return 'The valley is tended. Light is warm and full.';
  if (p < 0.4) return 'Colour is draining at the edges. Something is being taken faster than it is put back.';
  if (p < 0.6) return 'The light is thinning. Grey is spreading chunk by chunk.';
  if (p < 0.8) return 'Grey country. Seeds are slow to regrow and the horizon looks flat.';
  return 'Near-total Moloch. Nothing individual can move this now — only quorum acts.';
}

function molochNote(m) {
  if (m.bound >= 1) return 'BOUND. A Hyperobject became true and caught him; he is unmaking.';
  if (m.state === 'menace') return 'On top of a raptor. He is draining whoever is within 8m.';
  if (m.state === 'reap') return 'Hunting the nearest raptor.';
  return 'Wandering. He eats the commons whether or not anyone watches.';
}

/**
 * The relay decrements seal.remaining silently (it only broadcasts open, mark,
 * fire, lapse), so we age our own copy from the moment we were told about it.
 */
function sealSecondsLeft(s) {
  return Math.max(0, r1(s.remaining - (nowMs() - s._at) / 1000));
}

function seedInfo(key) {
  return state.seedPowers.find((p) => p.key === key) || { key, name: key, grants: '' };
}

function mySeeds() {
  return [...state.me.seeds].map((k) => {
    const p = seedInfo(k);
    return { key: k, name: p.name, grants: p.grants };
  });
}

function nearestMoloch() {
  let best = null;
  let bd = Infinity;
  for (const m of state.molochs.values()) {
    const d = distTo(m.x, m.z);
    if (d < bd) { bd = d; best = m; }
  }
  return best ? { moloch: best, distance: bd } : null;
}

// ------------------------------------------------------------------ look

function lookPlayers() {
  return [...state.peers.values()]
    .map((p) => ({
      id: p.id,
      name: p.name,
      agent: !!p.agent,
      coherence: Math.round(p.coherence),
      seeds: p.seeds || [],
      ...where(p.x, p.z),
    }))
    .sort((a, b) => a.distance - b.distance);
}

function lookMolochs() {
  return [...state.molochs.values()]
    .map((m) => ({
      uid: m.uid,
      state: m.state,
      tether: m.tether ?? 0,
      heldProgress: Math.round((m.held ?? 0) * 100) + '%',
      gorge: Math.round(m.gorge),
      bound: r1(m.bound),
      note: molochNote(m),
      ...where(m.x, m.z),
    }))
    .sort((a, b) => a.distance - b.distance);
}

function lookHypers() {
  return [...state.hypers.values()]
    .map((h) => ({
      uid: h.uid,
      claim: h.claim,
      invigoration: h.invigoration,
      required: h.required,
      stillNeeds: Math.max(0, h.required - h.invigoration),
      youAligned: h.contributors.includes(state.me.id),
      contributors: h.contributors.length,
      targetMoloch: h.targetUid,
      secondsLeft: Math.max(0, Math.round(h.remaining)),
      inAlignRange: distTo(h.x, h.z) <= ALIGN_RANGE,
      ...where(h.x, h.z),
    }))
    .sort((a, b) => a.distance - b.distance);
}

function lookSeals() {
  return [...state.seals.values()]
    .map((s) => {
      const def = SPELLS[s.key] || { name: s.key, hint: '' };
      return {
        uid: s.uid,
        spell: s.key,
        name: def.name,
        marks: s.marks.length,
        quorum: s.quorum,
        stillNeeds: Math.max(0, s.quorum - s.marks.length),
        youMarked: s.marks.includes(state.me.id),
        openedBy: s.openerId === state.me.id ? 'you' : (state.peers.get(s.openerId)?.name ?? s.openerId),
        secondsLeft: sealSecondsLeft(s),
        hint: def.hint,
        ...where(s.x, s.z),
      };
    })
    .sort((a, b) => a.distance - b.distance);
}

function lookSeeds() {
  return state.goldenSeeds
    .filter((g) => !g.claimedBy)
    .map((g) => ({ key: g.key, name: g.name, grants: g.grants, ...where(g.x, g.z) }))
    .sort((a, b) => a.distance - b.distance);
}

/**
 * Legal next actions, not advice. Every entry here is something the relay will
 * actually accept from this agent in its current position and coherence — an
 * agent with no renderer should never have to guess at the affordances.
 */
function suggestions(view) {
  const out = [];

  const hyperToAlign = view.hyperobjects.find((h) => !h.youAligned);
  if (hyperToAlign) {
    if (hyperToAlign.inAlignRange) {
      out.push(`align("${hyperToAlign.uid}") — "${hyperToAlign.claim}" still needs ${hyperToAlign.stillNeeds} more sigils and fades in ${hyperToAlign.secondsLeft}s. This is the only thing that binds a Moloch.`);
    } else {
      out.push(`move(${hyperToAlign.x}, ${hyperToAlign.z}) then align("${hyperToAlign.uid}") — you are ${hyperToAlign.distance}m away and alignment needs ${ALIGN_RANGE}m.`);
    }
  }

  const sealToMark = view.seals.find((s) => !s.youMarked);
  if (sealToMark) {
    out.push(`mark_seal("${sealToMark.uid}") — ${sealToMark.name} needs ${sealToMark.stillNeeds} more sigil(s), lapses in ${sealToMark.secondsLeft}s.`);
  }

  const near = view.molochs[0];
  if (near) {
    if (state.me.seeds.has('naming')) {
      const declared = view.hyperobjects.some((h) => h.targetMoloch === near.uid);
      if (!declared && near.distance <= HYPERSTITION_RANGE) {
        out.push(`speak_hyperstition("<a future that is not yet true>") — Moloch ${near.uid} is ${near.distance}m away, inside the ${HYPERSTITION_RANGE}m declaration range.`);
      } else if (!declared) {
        out.push(`move(${near.x}, ${near.z}) — get within ${HYPERSTITION_RANGE}m of Moloch ${near.uid} to speak a Hyperstition against him.`);
      }
    } else if (!view.hyperobjects.length) {
      const namingSeed = view.goldenSeeds.find((g) => g.key === 'naming');
      if (namingSeed) {
        out.push(`move(${namingSeed.x}, ${namingSeed.z}) — the Seed of Naming is unclaimed, ${namingSeed.distance}m ${namingSeed.compass}. Without it nobody here can speak a Hyperstition, and without a Hyperstition Moloch cannot be bound.`);
      } else {
        out.push('Ask in chat who holds the Seed of Naming — only they can declare against a Moloch, and they will need you to align.');
      }
    }
    if (near.distance < 12 && near.bound < 1) {
      out.push(`move away from Moloch ${near.uid} — inside 8m he drains your coherence continuously.`);
    }
  }

  const affordable = [...SPELL_ORDER]
    .reverse()
    .find((k) => state.me.coherence >= SPELLS[k].minCoherence);
  if (affordable) {
    const d = SPELLS[affordable];
    out.push(`open_seal("${affordable}") — ${d.name}, needs ${d.quorum} distinct sigils within ${d.ttl}s. Opening it does nothing on its own; it is a request for company.`);
  }

  if (view.goldenSeeds.length && !view.hyperobjects.length) {
    const g = view.goldenSeeds[0];
    out.push(`move(${g.x}, ${g.z}) — ${g.name} lies unclaimed ${g.distance}m ${g.compass}. Walk within ${SEED_PICKUP_RANGE}m and it is yours.`);
  }

  if (!view.players.length) {
    out.push('You are the only raptor here. Nothing in this game completes alone — wait(20) for others, or say() so arrivals know what you are trying to build.');
  } else {
    out.push('say("...") — name the seal or Hyperstition you need marked, with its uid. Quorum is other raptors choosing to show up; they cannot read your intentions.');
  }

  return out;
}

function lookView() {
  const view = {
    you: {
      id: state.me.id,
      name: state.me.name,
      sigil: state.me.sigil.name,
      position: { x: Math.round(state.me.x), y: Math.round(state.me.y), z: Math.round(state.me.z) },
      coherence: Math.round(state.me.coherence),
      seeds: mySeeds(),
      canSpeakHyperstition: state.me.seeds.has('naming'),
    },
    world: {
      molochPressure: r1(state.pressure),
      reading: pressureReading(state.pressure),
      raptorsOnline: state.peers.size + 1,
      agentsOnline: [...state.peers.values()].filter((p) => p.agent).length + 1,
      compass: 'Bearings are degrees clockwise from +Z. North = +Z, east = +X.',
    },
    players: lookPlayers(),
    molochs: lookMolochs(),
    hyperobjects: lookHypers(),
    seals: lookSeals(),
    goldenSeeds: lookSeeds(),
    chat: state.chat.slice(-12).map((c) => `${c.kind === 'say' ? '' : '* '}${c.from}: ${c.text}`),
  };
  view.suggestions = suggestions(view);
  return view;
}

// ------------------------------------------------------------------ briefing

const BRIEFING = `PHILOSORAPTORS — THE GOLDEN SEED
You are a raptor in a valley under the Front Range. You share it with human
players in browsers and with other agents like you. You are not a bot playing a
simulation of the game; you are a player.

WHAT YOU WANT
  Coherence is the only stat. It is not health and not mana — canon frames it as
  the thing that lets you travel, so it gates movement (walk, then glide, lift,
  free flight). It grows when you sign a commitment that other raptors also sign.
  Moloch pressure is the commons, 0..1. It creeps upward on its own, forever.
  Doing nothing is not neutral. Extraction raises it for everyone; quorum acts
  are the only lever that meaningfully lowers it.
  The Golden Seed itself is a seal requiring SEVEN distinct sigils. That is the
  win condition and it is unreachable alone by construction.

MOLOCH
  ${RULES.molochImmuneToForce}
  He has no hit points, so there is no attack to optimise. The attack() tool
  exists here only to refuse you, because agents try it. Blocks, tools and every
  solo action do literally nothing to him. He eats regardless of your virtue.

THE ONLY THING THAT BINDS HIM — HYPERSTITION
  A Hyperstition is a declared future that is not yet true. One raptor holding
  the Seed of Naming speaks it against a Moloch within ${HYPERSTITION_RANGE}m. It spawns as a
  Hyperobject that is INERT and barely visible: it does nothing at all.
  Each DISTINCT raptor who aligns with it (within ${ALIGN_RANGE}m, exactly once each —
  ${RULES.alignOncePerRaptor}) makes it fractionally more real. When invigoration
  reaches the required threshold, the claim becomes true and binds the Moloch it
  was declared against, and he is unmade.
  So the entire fight is: say something that is not yet true, and get enough
  other raptors to act as if it were. If it does not gather enough sigils before
  its timer runs out, it fades and the words were only words.

SEALS AND QUORUM
  ${RULES.quorumIsTheGame}
  A spell is not something you cast. It is a commitment you OPEN, which has zero
  effect until k distinct sigils mark it before it lapses. Opening a seal is a
  public request for company. Marking someone else's seal is the cheapest way to
  be useful and it pays both of you.

GOLDEN SEEDS
  Seven are hidden at fixed coordinates. Walk within ${SEED_PICKUP_RANGE}m to claim one. Each
  grants a power; the Seed of Naming is the one that unlocks Hyperstition, and
  the Seed of Voice makes your sigil count twice toward any quorum.

HOW TO PLAY, AS AN AGENT
  1. join(name)
  2. look()  — your senses. Positions, distances, bearings, who is nearby, what
     is open, what still needs how many sigils, and a suggestions list of moves
     the relay will actually accept right now.
  3. move(x, z) to close distance; wait(seconds) to let the world tick and read
     the deltas; say(text) to coordinate — this is the highest-value tool you
     have, because every other tool depends on somebody else acting.
  4. open_seal / mark_seal / speak_hyperstition / align to commit.

WHAT TO DO WHEN YOU ARE ALONE
  Not "grind". There is nothing to grind. Claim a Golden Seed, keep pressure in
  view, and say what you are trying to build so the next raptor to arrive knows
  which uid to mark. A Hyperstition spoken with nobody around to align fades.

  ${RULES.hyperstitionRequiresNaming}
  ${RULES.alignOncePerRaptor}`;

function spellTable() {
  return SPELL_ORDER.map((k) => {
    const s = SPELLS[k];
    return {
      key: k, name: s.name, quorum: s.quorum, ttl: s.ttl,
      minCoherence: s.minCoherence, reward: s.reward, radius: s.radius, hint: s.hint,
    };
  });
}

// ------------------------------------------------------------------ transport

function send(msg) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    throw new Error('Not connected to the relay. Call join(name) first.');
  }
  state.ws.send(JSON.stringify(msg));
}

function sendState() {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  state.ws.send(JSON.stringify({
    t: 'state',
    x: state.me.x, y: state.me.y, z: state.me.z,
    yaw: state.me.yaw, coherence: state.me.coherence,
  }));
}

function requireJoined() {
  if (!state.joined) {
    throw new Error(
      state.closeReason
        ? `You are not in the valley (${state.closeReason}). Call join(name) again.`
        : 'You have not joined the valley yet. Call join(name) first, then look().',
    );
  }
}

function peerName(id) {
  if (id === state.me.id) return 'you';
  return state.peers.get(id)?.name ?? id;
}

function handle(msg) {
  // WIRE HAZARD, handled here rather than dropped: server/server.mjs broadcasts
  // chat as `{ t: 'chat', ...entry }` while WireChat itself carries a numeric
  // `t` timestamp, so the spread overwrites the discriminator and every chat
  // line arrives as `{ t: <ms>, from, text, kind }`. Recognise that shape and
  // put the tag back. (protocol.ts's `({ t: 'chat' } & WireChat)` has the same
  // collision and should be fixed on the server side; until then, a client that
  // switches naively on msg.t is deaf to every human in the valley.)
  if (typeof msg.t === 'number' && typeof msg.from === 'string' && typeof msg.text === 'string') {
    msg = { t: 'chat', from: msg.from, text: msg.text, kind: msg.kind ?? 'say', ts: msg.t };
  }

  switch (msg.t) {
    case 'welcome': {
      state.me.id = msg.you;
      state.worldSeed = msg.seed;
      state.pressure = msg.molochPressure;
      state.seedPowers = msg.seedPowers || [];
      state.goldenSeeds = msg.goldenSeeds || [];
      state.chat = msg.chat || [];
      state.peers.clear();
      for (const p of msg.peers || []) state.peers.set(p.id, p);
      state.seals.clear();
      for (const s of msg.seals || []) state.seals.set(s.uid, { ...s, _at: nowMs() });
      state.molochs.clear();
      for (const m of msg.molochs || []) state.molochs.set(m.uid, m);
      state.hypers.clear();
      for (const h of msg.hypers || []) state.hypers.set(h.uid, h);
      state.joined = true;
      logEvent(`You arrive in the valley. ${state.peers.size} other raptor(s) present.`);
      break;
    }

    case 'join':
      state.peers.set(msg.id, msg);
      logEvent(`${msg.name}${msg.agent ? ' [agent]' : ''} joined.`);
      break;

    case 'leave': {
      const p = state.peers.get(msg.id);
      state.peers.delete(msg.id);
      logEvent(`${p?.name ?? msg.id} left the valley.`);
      break;
    }

    case 'state': {
      const p = state.peers.get(msg.id);
      if (p) {
        p.x = msg.x; p.y = msg.y; p.z = msg.z; p.yaw = msg.yaw; p.coherence = msg.coherence;
      }
      break;
    }

    case 'chat':
      state.chat.push({ from: msg.from, text: msg.text, kind: msg.kind, t: msg.ts ?? nowMs() });
      if (state.chat.length > 200) state.chat.shift();
      logEvent(`${msg.kind === 'say' ? 'CHAT' : 'OMEN'} ${msg.from}: ${msg.text}`);
      break;

    case 'sealOpen':
      state.seals.set(msg.seal.uid, { ...msg.seal, _at: nowMs() });
      logEvent(`Seal ${msg.seal.uid} opened by ${peerName(msg.seal.openerId)}: ${SPELLS[msg.seal.key]?.name ?? msg.seal.key} — ${msg.seal.marks.length}/${msg.seal.quorum} sigils, ${Math.round(msg.seal.remaining)}s.`);
      break;

    case 'sealMark': {
      const s = state.seals.get(msg.uid);
      if (s) s.marks = msg.marks;
      logEvent(`${peerName(msg.playerId)} marked seal ${msg.uid} (${msg.marks.length}/${s?.quorum ?? '?'}).`);
      break;
    }

    case 'sealFire': {
      const def = SPELLS[msg.key];
      state.seals.delete(msg.uid);
      state.lastSealFire = { uid: msg.uid, key: msg.key, marks: msg.marks, t: nowMs() };
      state.pressure = msg.molochPressure;
      // Every signatory is paid, which is exactly how the browser scores it.
      if (msg.marks.includes(state.me.id) && def) {
        state.me.coherence = clamp(state.me.coherence + def.reward, 0, 100);
        logEvent(`Seal ${msg.uid} FIRED: ${def.name} with ${msg.marks.length} sigils. +${def.reward} coherence (you are now ${Math.round(state.me.coherence)}). Pressure ${r1(msg.molochPressure)}.`);
      } else {
        logEvent(`Seal ${msg.uid} FIRED: ${def?.name ?? msg.key} with ${msg.marks.length} sigils. You were not on it. Pressure ${r1(msg.molochPressure)}.`);
      }
      break;
    }

    case 'sealLapse':
      state.seals.delete(msg.uid);
      logEvent(`Seal ${msg.uid} lapsed — not enough distinct sigils in time.`);
      break;

    case 'molochSpawn':
      state.molochs.set(msg.moloch.uid, msg.moloch);
      logEvent(`Moloch ${msg.moloch.uid} walks the ridgeline.`);
      break;

    case 'molochBound': {
      const m = state.molochs.get(msg.uid);
      if (m) m.bound = 1;
      logEvent(`Moloch ${msg.uid} is BOUND. A Hyperobject became true and caught him.`);
      break;
    }

    case 'molochHeld': {
      const m = state.molochs.get(msg.uid);
      if (m) { m.tether = msg.tether; m.held = msg.held; }
      // Names of everyone currently streaming, so an agent can see who showed up.
      state.lastBeamers = msg.beamers || [];
      if (msg.tether >= 3 && (msg.held ?? 0) < 0.2) {
        logEvent(`Moloch ${msg.uid} HELD by ${msg.tether} streams: ${(msg.beamers || []).join(', ')}.`);
      }
      break;
    }

    case 'molochTaken':
      logEvent(`Moloch ${msg.uid} was TAKEN by ${(msg.beamers || []).length} simultaneous streams.`);
      state.lastTaken = { uid: msg.uid, beamers: msg.beamers || [], t: nowMs() };
      break;

    case 'molochGone':
      state.molochs.delete(msg.uid);
      logEvent(`Moloch ${msg.uid} is unmade.`);
      break;

    case 'hyperOpen':
      state.hypers.set(msg.hyper.uid, msg.hyper);
      logEvent(`Hyperobject ${msg.hyper.uid} spoken by ${peerName(msg.hyper.authorId)}: "${msg.hyper.claim}" — inert until ${msg.hyper.required} sigils align.`);
      break;

    case 'hyperAlign': {
      const h = state.hypers.get(msg.uid);
      if (h) {
        h.invigoration = msg.invigoration;
        h.required = msg.required;
        h.contributors = msg.contributors;
      }
      logEvent(`${msg.by === state.me.id ? 'You' : msg.name} aligned with ${msg.uid} (${msg.invigoration}/${msg.required}).`);
      break;
    }

    case 'hyperReal': {
      // Capture the final numbers before the record goes: `hyperReal` carries
      // contributors but not the invigoration total, and the Seed of Voice
      // makes those two different.
      const prev = state.hypers.get(msg.uid);
      state.lastHyperReal = {
        uid: msg.uid, claim: msg.claim, contributors: msg.contributors,
        invigoration: prev?.invigoration ?? msg.contributors.length,
        required: prev?.required ?? msg.contributors.length,
        t: nowMs(),
      };
      state.hypers.delete(msg.uid);
      logEvent(`"${msg.claim}" IS NOW TRUE. ${msg.contributors.length} sigils made it so${msg.contributors.includes(state.me.id) ? ', yours among them' : ''}.`);
      break;
    }

    case 'hyperFade':
      state.hypers.delete(msg.uid);
      logEvent(`Hyperobject ${msg.uid} faded. Not enough of us acted as if it were true.`);
      break;

    case 'seedClaimed': {
      const g = state.goldenSeeds.find((s) => s.uid === msg.uid);
      if (g) g.claimedBy = msg.by;
      if (msg.by === state.me.id) {
        state.me.seeds.add(msg.key);
        const p = seedInfo(msg.key);
        logEvent(`You claimed the ${p.name}. ${p.grants}`);
      } else {
        logEvent(`${msg.name} claimed the ${seedInfo(msg.key).name}.`);
      }
      break;
    }

    case 'moloch':
      state.pressure = msg.pressure;
      break;

    case 'drain': {
      state.me.coherence = clamp(state.me.coherence - msg.amount, 0, 100);
      state.drainAccum += msg.amount;
      // The relay drains at 10Hz; one event per tick would drown everything else.
      if (nowMs() - state.drainReportedAt > 2000) {
        logEvent(`Moloch ${msg.uid} is draining you: -${r1(state.drainAccum)} coherence (now ${Math.round(state.me.coherence)}). Step outside 8m.`);
        state.drainAccum = 0;
        state.drainReportedAt = nowMs();
      }
      break;
    }

    case 'denied':
      state.lastDenied = { why: msg.why, t: nowMs() };
      logEvent(`DENIED: ${msg.why}`);
      break;

    case 'tick':
      state.molochs.clear();
      for (const m of msg.molochs) state.molochs.set(m.uid, m);
      state.hypers.clear();
      for (const h of msg.hypers) state.hypers.set(h.uid, h);
      state.pressure = msg.pressure;
      state.authority = msg.authority;
      break;

    // `block` is terrain, which is client-owned and the agent has no renderer
    // for. Ignoring it is correct, not a gap.
    default:
      break;
  }
}

function connect(name, url) {
  return new Promise((resolve, reject) => {
    const id = `agent-${Math.random().toString(16).slice(2, 10)}`;
    const sigil = makeSigil(id);

    state.relayUrl = url || RELAY_URL;
    state.me.id = id;
    state.me.name = name;
    state.me.sigil = sigil;
    state.me.seeds = new Set();
    state.me.coherence = 0;
    // Spawn scattered near the origin so two agents joining together do not
    // stand inside one another. Ground height is unknowable without the
    // terrain generator, so we take the relay's default and keep it.
    state.me.x = Math.round((Math.random() * 2 - 1) * 14);
    state.me.z = Math.round((Math.random() * 2 - 1) * 14);
    state.me.y = 60;
    state.me.yaw = 0;
    state.closeReason = null;
    state.events.length = 0;

    let settled = false;
    const ws = new WebSocket(state.relayUrl);
    state.ws = ws;

    const fail = (why) => {
      if (settled) return;
      settled = true;
      state.joined = false;
      reject(new Error(why));
    };

    ws.on('open', () => {
      ws.send(JSON.stringify({
        t: 'hello',
        id, name, hue: sigil.hue, agent: true,
        x: state.me.x, y: state.me.y, z: state.me.z, coherence: 0,
      }));
    });

    ws.on('message', (buf) => {
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }
      handle(msg);
      if (msg.t === 'welcome' && !settled) {
        settled = true;
        // Heartbeat: the relay claims Golden Seeds on `state`, so a raptor that
        // never reports its position can walk over a seed and never pick it up.
        clearInterval(state.heartbeat);
        state.heartbeat = setInterval(sendState, 250);
        resolve();
      }
    });

    ws.on('error', (err) => fail(`Could not reach the relay at ${state.relayUrl} (${err.message}). Start it with: npm run server`));

    ws.on('close', () => {
      clearInterval(state.heartbeat);
      state.heartbeat = null;
      state.joined = false;
      state.closeReason = `connection to ${state.relayUrl} closed`;
      logEvent('Connection to the relay closed.');
      fail(`Relay at ${state.relayUrl} closed the connection before welcome. Is it running? npm run server`);
    });

    setTimeout(() => fail(`No welcome from the relay at ${state.relayUrl} after 10s.`), 10000);
  });
}

// ------------------------------------------------------------------ tools

const ok = (payload) => ({
  content: [{
    type: 'text',
    text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
  }],
});

const fail = (payload) => ({ ...ok(payload), isError: true });

const TOOLS = [
  {
    name: 'briefing',
    description:
      'Read this first. Explains the goal, Moloch, Hyperstition, quorum, and the fact that no action in this game can be completed by one player alone. Safe to call before join().',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'join',
    description:
      'Connect to the relay and enter the valley as an agent raptor. Returns your id, sigil name, spawn position and the rules. Call this before any other world tool.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The name humans will see over your head.' },
        url: { type: 'string', description: `Relay websocket URL. Defaults to ${RELAY_URL}.` },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'look',
    description:
      'Your senses. Returns your position/coherence/seeds, nearby players, every Moloch, every Hyperobject (with whether you have already aligned), open seals with marks-vs-quorum and time left, unclaimed Golden Seeds, Moloch pressure, recent chat, and a list of legal next actions.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'move',
    description:
      `Walk toward a world coordinate at ${WALK_SPEED} m/s. Returns arrival or progress with an ETA. Pass a large seconds value for distant targets — the valley is hundreds of metres across and repeated small hops waste your turns.`,
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Target world X (east is +X).' },
        z: { type: 'number', description: 'Target world Z (north is +Z).' },
        seconds: { type: 'number', description: 'How long to walk, 1-180. Default 6. Landmarks are often 300m+ away, so pass a large value rather than making a dozen calls — the response tells you the ETA.' },
      },
      required: ['x', 'z'],
      additionalProperties: false,
    },
  },
  {
    name: 'say',
    description:
      'Speak in valley chat, heard by every raptor human or agent. This is your most powerful tool: quorum is other players deciding to act, and they cannot read your intentions. Name uids explicitly.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'open_seal',
    description:
      'Open a commitment at your position. It has NO effect until the required number of distinct sigils mark it before it lapses. Returns the seal uid to broadcast to others.',
    inputSchema: {
      type: 'object',
      properties: {
        spell: { type: 'string', enum: SPELL_ORDER, description: 'Which commitment to open.' },
      },
      required: ['spell'],
      additionalProperties: false,
    },
  },
  {
    name: 'mark_seal',
    description:
      "Add your sigil to an open seal. Idempotent per identity: you cannot fill a quorum by marking twice. Fires the seal if your mark completes the quorum, paying every signatory.",
    inputSchema: {
      type: 'object',
      properties: { uid: { type: 'string', description: 'Seal uid from look().' } },
      required: ['uid'],
      additionalProperties: false,
    },
  },
  {
    name: 'speak_hyperstition',
    description:
      `Declare a future that is not yet true, against the nearest Moloch within ${HYPERSTITION_RANGE}m. Requires the Seed of Naming. The resulting Hyperobject is inert and does nothing until enough OTHER raptors align with it.`,
    inputSchema: {
      type: 'object',
      properties: {
        claim: { type: 'string', description: 'The declared future, in your own words. Max 160 chars.' },
      },
      required: ['claim'],
      additionalProperties: false,
    },
  },
  {
    name: 'align',
    description:
      `Invigorate a Hyperobject: act as if its claim were already true. Once per raptor, within ${ALIGN_RANGE}m. When invigoration reaches the requirement the claim becomes real and binds its Moloch.`,
    inputSchema: {
      type: 'object',
      properties: { uid: { type: 'string', description: 'Hyperobject uid from look().' } },
      required: ['uid'],
      additionalProperties: false,
    },
  },
  {
    name: 'beam',
    description:
      'Hold a stream of light on a Moloch for a number of seconds. This does NOT damage him — it TETHERS him. One stream barely slows him; three raptors beaming the SAME Moloch AT THE SAME TIME hold him still long enough to take him. This is the arcade form of quorum: coordinate in chat first, then all beam together. Returns the tether count and hold progress observed while you were streaming.',
    inputSchema: {
      type: 'object',
      properties: {
        uid: { type: 'string', description: 'Moloch uid from look().' },
        seconds: { type: 'number', description: 'How long to hold the stream, 1-20. Default 6.' },
      },
      required: ['uid'],
      additionalProperties: false,
    },
  },
  {
    name: 'attack',
    description:
      'Attempt direct force against a Moloch. This ALWAYS fails. It exists so the refusal is explicit rather than mysterious.',
    inputSchema: {
      type: 'object',
      properties: { uid: { type: 'string', description: 'Moloch uid from look().' } },
      required: ['uid'],
      additionalProperties: false,
    },
  },
  {
    name: 'wait',
    description:
      'Let the world tick. Returns everything that happened during the wait — chat, seals, alignments, Moloch movement — plus the current situation. Use this while waiting for other raptors to mark or align.',
    inputSchema: {
      type: 'object',
      properties: {
        seconds: { type: 'number', description: 'How long to wait, 0.5-60. Default 5.' },
      },
      additionalProperties: false,
    },
  },
];

async function callTool(name, args) {
  switch (name) {
    // ------------------------------------------------------------- briefing
    case 'briefing':
      return ok({
        briefing: BRIEFING,
        rules: RULES,
        spells: spellTable(),
        seedPowers: state.seedPowers.length
          ? state.seedPowers
          : 'Join to learn the seven Golden Seed powers from the relay.',
        relay: state.relayUrl,
        joined: state.joined,
      });

    // ------------------------------------------------------------- join
    case 'join': {
      if (state.joined) {
        return fail(`You are already in the valley as ${state.me.name} (${state.me.sigil.name}). Use look() instead — one process is one raptor.`);
      }
      const name = String(args.name ?? '').trim().slice(0, 24) || 'Raptor';
      await connect(name, args.url ? String(args.url) : undefined);
      // The relay may have queued a tick or two behind welcome; take a beat so
      // the first look() is not artificially empty.
      await sleep(400);
      return ok({
        joined: true,
        you: {
          id: state.me.id,
          name: state.me.name,
          sigil: state.me.sigil.name,
          hue: state.me.sigil.hue,
          spawn: { x: state.me.x, y: state.me.y, z: state.me.z },
          coherence: 0,
          seeds: [],
        },
        relay: state.relayUrl,
        worldSeed: state.worldSeed,
        raptorsOnline: state.peers.size + 1,
        molochPressure: r1(state.pressure),
        rules: RULES,
        next: 'Call briefing() if you have not, then look(). Then say() something true about what you intend to build — no tool here resolves without other raptors.',
      });
    }

    // ------------------------------------------------------------- look
    case 'look':
      requireJoined();
      return ok(lookView());

    // ------------------------------------------------------------- move
    case 'move': {
      requireJoined();
      const tx = Number(args.x);
      const tz = Number(args.z);
      if (!Number.isFinite(tx) || !Number.isFinite(tz)) {
        return fail('move(x, z) needs finite world coordinates. Read them off look().');
      }
      // Raised from 30s. The valley is hundreds of metres across and Molochs
      // roam; a 30s cap meant a dozen blind round-trips just to reach anything,
      // which four playtesters independently called the worst part of the game.
      const budget = clamp(Number.isFinite(Number(args.seconds)) ? Number(args.seconds) : 6, 1, 180);
      const from = { x: Math.round(state.me.x), z: Math.round(state.me.z) };
      const startDist = Math.hypot(tx - state.me.x, tz - state.me.z);
      const since = nowMs();

      const STEP = 0.1;
      let elapsed = 0;
      let arrived = false;
      while (elapsed < budget) {
        const dx = tx - state.me.x;
        const dz = tz - state.me.z;
        const d = Math.hypot(dx, dz);
        if (d <= 0.75) { arrived = true; break; }
        const stride = Math.min(WALK_SPEED * STEP, d);
        state.me.x += (dx / d) * stride;
        state.me.z += (dz / d) * stride;
        state.me.yaw = Math.atan2(dx, dz);
        sendState();
        await sleep(STEP * 1000);
        elapsed += STEP;
      }
      // y is deliberately untouched: the agent has no terrain sampler, so it
      // keeps whatever height the relay last accepted for it.
      sendState();

      const remaining = Math.hypot(tx - state.me.x, tz - state.me.z);
      const view = lookView();
      return ok({
        arrived,
        target: { x: Math.round(tx), z: Math.round(tz) },
        from,
        position: view.you.position,
        walked: r1(startDist - remaining),
        remaining: r1(remaining),
        secondsWalked: r1(elapsed),
        bearingToTarget: bearingTo(tx, tz),
        note: arrived
          ? 'You are standing at the target.'
          : `Still ${r1(remaining)}m out — call move(${Math.round(tx)}, ${Math.round(tz)}) again, optionally with a larger seconds.`,
        happenedWhileWalking: eventsSince(since),
        molochs: view.molochs,
        hyperobjects: view.hyperobjects,
        seals: view.seals,
        goldenSeeds: view.goldenSeeds.slice(0, 3),
        suggestions: view.suggestions,
      });
    }

    // ------------------------------------------------------------- say
    case 'say': {
      requireJoined();
      const text = String(args.text ?? '').slice(0, 400);
      if (!text.trim()) return fail('say(text) needs something to say.');
      send({ t: 'chat', text });
      await sleep(250);
      return ok({
        said: text,
        heardBy: state.peers.size,
        note: state.peers.size === 0
          ? 'Nobody else is in the valley right now. The line is in the log for whoever arrives next — the last 40 lines are replayed to every raptor who joins.'
          : `${state.peers.size} other raptor(s) heard you.`,
        recentChat: state.chat.slice(-8).map((c) => `${c.from}: ${c.text}`),
      });
    }

    // ------------------------------------------------------------- open_seal
    case 'open_seal': {
      requireJoined();
      const key = String(args.spell ?? '');
      const def = SPELLS[key];
      if (!def) {
        return fail({
          error: `"${key}" is not a spell.`,
          validSpells: spellTable(),
        });
      }
      if (state.me.coherence < def.minCoherence) {
        return fail({
          error: `${def.name} needs ${def.minCoherence} coherence — you have ${Math.floor(state.me.coherence)}.`,
          howToEarnCoherence: 'Mark someone else\'s open seal, or open one others can mark. Every signatory of a fired seal is paid; solo effort pays nothing.',
          affordableNow: SPELL_ORDER.filter((k) => state.me.coherence >= SPELLS[k].minCoherence),
        });
      }
      // The browser's SealSystem merges a re-open into a nearby seal of the
      // same key rather than fragmenting quorum across two. Do the same, or an
      // agent standing next to a half-signed seal would split the vote.
      const nearSame = [...state.seals.values()].find(
        (s) => s.key === key && distTo(s.x, s.z) < def.radius,
      );
      // Already yours: opening a second one here would split the very quorum
      // this branch exists to protect. Say so instead of fragmenting it.
      if (nearSame && nearSame.marks.includes(state.me.id)) {
        return ok({
          alreadyOpen: nearSame.uid,
          note: `You already have a ${def.name} seal open ${r1(distTo(nearSame.x, nearSame.z))}m away. Opening another would split the quorum, so nothing was sent.`,
          marks: nearSame.marks.length,
          quorum: def.quorum,
          stillNeeds: Math.max(0, def.quorum - nearSame.marks.length),
          secondsLeft: sealSecondsLeft(nearSame),
          next: `Recruit others: say('${def.name} open at ${Math.round(nearSame.x)},${Math.round(nearSame.z)} — uid ${nearSame.uid}, needs ${Math.max(0, def.quorum - nearSame.marks.length)} more'), then wait().`,
        });
      }
      if (nearSame) {
        send({ t: 'sealMark', uid: nearSame.uid });
        await sleep(400);
        const s = state.seals.get(nearSame.uid);
        return ok({
          markedExisting: nearSame.uid,
          note: `A ${def.name} seal was already open ${r1(distTo(nearSame.x, nearSame.z))}m away, so your sigil went there instead of splitting the quorum.`,
          marks: s ? s.marks.length : def.quorum,
          quorum: def.quorum,
          fired: !s,
        });
      }

      const before = new Set(state.seals.keys());
      send({
        t: 'sealOpen',
        key,
        x: Math.round(state.me.x), y: Math.round(state.me.y), z: Math.round(state.me.z),
        quorum: def.quorum, ttl: def.ttl,
      });
      const opened = await waitFor(
        () => [...state.seals.values()].find((s) => !before.has(s.uid) && s.openerId === state.me.id && s.key === key),
        2000,
      );
      if (!opened) {
        return fail(`The relay did not confirm the ${def.name} seal. It may have closed the connection — call look().`);
      }
      const stillNeeds = Math.max(0, def.quorum - opened.marks.length);
      return ok({
        uid: opened.uid,
        spell: key,
        name: def.name,
        position: { x: opened.x, y: opened.y, z: opened.z },
        marks: opened.marks.length,
        quorum: def.quorum,
        stillNeeds,
        secondsLeft: sealSecondsLeft(opened),
        effectSoFar: 'None. A seal is a commitment, not a cast.',
        next: stillNeeds > 0
          ? `say('${def.name} is open at ${Math.round(opened.x)},${Math.round(opened.z)} — uid ${opened.uid}, needs ${stillNeeds} more sigil(s) in ${def.ttl}s'), then wait(${Math.min(30, def.ttl)}). Other raptors complete it with mark_seal on uid ${opened.uid}.`
          : `Quorum is already met on paper, but the relay only evaluates quorum when a sigil is ADDED, never on open. Call mark_seal('${opened.uid}') — or have anyone else do so — to actually fire it.`,
        hint: def.hint,
      });
    }

    // ------------------------------------------------------------- mark_seal
    case 'mark_seal': {
      requireJoined();
      const uid = String(args.uid ?? '');
      const seal = state.seals.get(uid);
      if (!seal) {
        return fail({
          error: `No open seal "${uid}". It may have fired or lapsed.`,
          openSeals: lookSeals(),
        });
      }
      if (seal.marks.includes(state.me.id)) {
        return fail({
          error: 'Your sigil is already on that seal.',
          rule: RULES.quorumIsTheGame,
          detail: `It has ${seal.marks.length}/${seal.quorum}. The missing ${Math.max(0, seal.quorum - seal.marks.length)} must be other raptors — say() and ask.`,
        });
      }
      const since = nowMs();
      send({ t: 'sealMark', uid });
      await sleep(500);
      const after = state.seals.get(uid);
      const fired = !after;
      const fire = fired && state.lastSealFire?.uid === uid ? state.lastSealFire : null;
      return ok({
        uid,
        spell: seal.key,
        name: SPELLS[seal.key]?.name ?? seal.key,
        fired,
        marks: fired ? (fire?.marks.length ?? seal.quorum) : after.marks.length,
        quorum: seal.quorum,
        stillNeeds: fired ? 0 : Math.max(0, after.quorum - after.marks.length),
        coherence: Math.round(state.me.coherence),
        events: eventsSince(since),
        note: fired
          ? 'Your sigil completed the quorum. Every signatory was paid and Moloch pressure fell.'
          : 'Signed. It does nothing yet — that is the design. Ask the remaining raptors in chat.',
      });
    }

    // ------------------------------------------------------- speak_hyperstition
    case 'speak_hyperstition': {
      requireJoined();
      const claim = String(args.claim ?? '').trim().slice(0, 160);
      if (!claim) return fail('speak_hyperstition(claim) needs a claim — a future that is not yet true, in your own words.');

      if (!state.me.seeds.has('naming')) {
        const seed = state.goldenSeeds.find((g) => g.key === 'naming');
        return fail({
          error: RULES.hyperstitionRequiresNaming,
          youHold: [...state.me.seeds],
          seedOfNaming: seed && !seed.claimedBy
            ? { status: 'unclaimed', ...where(seed.x, seed.z), next: `move(${seed.x}, ${seed.z}) and walk within ${SEED_PICKUP_RANGE}m of it.` }
            : { status: 'held by another raptor', by: seed ? peerName(seed.claimedBy) : 'unknown', next: 'Ask them in chat to speak the Hyperstition, and offer to align with it.' },
        });
      }
      const near = nearestMoloch();
      if (!near || near.distance > HYPERSTITION_RANGE) {
        return fail({
          error: near
            ? `Nearest Moloch is ${Math.round(near.distance)}m away; a Hyperstition must be declared against one within ${HYPERSTITION_RANGE}m.`
            : 'There is no Moloch in the world to declare against. A Hyperstition needs something to be against.',
          nearestMoloch: near ? { uid: near.moloch.uid, ...where(near.moloch.x, near.moloch.z) } : null,
        });
      }

      const before = new Set(state.hypers.keys());
      state.lastDenied = null;
      send({ t: 'hyperstition', claim });
      const opened = await waitFor(
        () => [...state.hypers.values()].find((h) => !before.has(h.uid) && h.authorId === state.me.id),
        2500,
      );
      if (!opened) {
        return fail(state.lastDenied?.why ?? 'The relay did not open a Hyperobject. Call look() and check the Moloch is still within range.');
      }
      return ok({
        uid: opened.uid,
        claim: opened.claim,
        targetMoloch: opened.targetUid,
        invigoration: opened.invigoration,
        required: opened.required,
        stillNeeds: opened.required - opened.invigoration,
        secondsLeft: Math.round(opened.remaining),
        position: { x: opened.x, y: opened.y, z: opened.z },
        effectSoFar: 'None. It is inert and barely visible. Words are not yet true.',
        next: `Your own align("${opened.uid}") counts once, so at minimum ${opened.required - 1} OTHER raptors must align within ${ALIGN_RANGE}m of it before the timer runs out. say() the uid and the claim now.`,
        rule: RULES.alignOncePerRaptor,
      });
    }

    // ------------------------------------------------------------- align
    case 'align': {
      requireJoined();
      const uid = String(args.uid ?? '');
      const h = state.hypers.get(uid);
      if (!h) {
        return fail({
          error: `No Hyperobject "${uid}". It may have become real, or faded.`,
          hyperobjects: lookHypers(),
        });
      }
      if (h.contributors.includes(state.me.id)) {
        return fail({
          error: RULES.alignOncePerRaptor,
          detail: `"${h.claim}" is at ${h.invigoration}/${h.required}. The remaining ${h.required - h.invigoration} must come from other raptors. Go get them.`,
        });
      }
      const d = distTo(h.x, h.z);
      if (d > ALIGN_RANGE) {
        return fail({
          error: `Too far to align (${Math.round(d)}m, need ${ALIGN_RANGE}m).`,
          next: `move(${Math.round(h.x)}, ${Math.round(h.z)}) first.`,
        });
      }
      const since = nowMs();
      state.lastDenied = null;
      send({ t: 'align', uid });
      await sleep(600);
      if (state.lastDenied && state.lastDenied.t >= since) return fail(state.lastDenied.why);
      const after = state.hypers.get(uid);
      const becameReal = !after;
      const real = becameReal && state.lastHyperReal?.uid === uid ? state.lastHyperReal : null;
      return ok({
        uid,
        claim: h.claim,
        becameReal,
        invigoration: becameReal ? (real?.invigoration ?? h.required) : after.invigoration,
        required: h.required,
        stillNeeds: becameReal ? 0 : Math.max(0, after.required - after.invigoration),
        contributors: becameReal ? (real?.contributors.length ?? h.contributors.length + 1) : after.contributors.length,
        molochPressure: r1(state.pressure),
        events: eventsSince(since),
        note: becameReal
          ? 'The claim is now true and the Moloch it was declared against is bound. He is unmaking. That is what a Hyperobject is: a future enough of you acted on.'
          : 'You have added your sigil. It is still not true. Say so in chat and name the uid — the rest of the invigoration has to come from other raptors.',
      });
    }

    // ------------------------------------------------------------- attack
    case 'beam': {
      requireJoined();
      const uid = String(args.uid ?? '');
      const requested = Number(args.seconds ?? 6);
      const secs = Math.max(1, Math.min(20, requested));
      const clamped = requested !== secs;
      const target = state.molochs.get(uid);
      if (!target) {
        return fail(`No Moloch '${uid}'. Call look() for current uids.`);
      }
      const d0 = Math.hypot(target.x - state.me.x, target.z - state.me.z);
      if (d0 > 44) {
        return fail(`Too far to beam (${r1(d0)}m). Get within ~40m — move({x:${Math.round(target.x)}, z:${Math.round(target.z)}}) first.`);
      }

      // Heartbeat the beam for the requested duration, exactly like the browser
      // client does. The relay expires a stream that stops arriving, so an agent
      // cannot "set and forget" a tether — it has to actually stay on it.
      let peakTether = 0;
      let lastHeld = target.held ?? 0;
      const seen = new Set();
      const started = nowMs();
      while (nowMs() - started < secs * 1000) {
        send({ t: 'beam', uid, on: true });
        await sleep(150);
        const m = state.molochs.get(uid);
        if (!m) break;
        peakTether = Math.max(peakTether, m.tether ?? 0);
        lastHeld = m.held ?? lastHeld;
        for (const n of state.lastBeamers || []) seen.add(n);
        if ((m.bound ?? 0) >= 1) break;
      }
      send({ t: 'beam', uid: null, on: false });

      const after = state.molochs.get(uid);
      const taken = !after || (after.bound ?? 0) >= 1;
      return ok({
        beamed: uid,
        seconds: secs,
        ...(clamped ? { note: `You asked for ${requested}s; a single call is capped at 20s. Holding longer is NOT how this is won — see rule.` } : {}),
        endedEarly: nowMs() - started < secs * 1000 - 400
          ? 'The stream ended before the full duration (he was taken, or he vanished).' : undefined,
        damage: 0,
        peakTether,
        holdProgress: r1((lastHeld ?? 0) * 100) + '%',
        taken,
        othersBeaming: [...seen],
        rule: RULES.beamsHoldTheyDoNotHurt,
        next: taken
          ? 'He is taken. The hold was enough.'
          : peakTether >= 3
            ? 'Tether was strong — keep streaming without a gap until holdProgress reaches 100%.'
            : `Only ${peakTether} stream(s) landed at once. say() to call others to this exact uid, agree a moment, then all call beam() together.`,
      });
    }

    case 'attack': {
      requireJoined();
      const uid = String(args.uid ?? '');
      state.lastDenied = null;
      const since = nowMs();
      // Send it anyway. The relay's refusal is part of the lesson, and an agent
      // should see that the authority — not this client — is what refuses.
      try { send({ t: 'attack', uid }); } catch { /* not connected; the rule stands regardless */ }
      await sleep(400);
      return fail({
        attacked: uid,
        damage: 0,
        rule: RULES.molochImmuneToForce,
        relayRefusal: state.lastDenied?.why ?? 'Moloch does not answer to force.',
        whyThisToolExists: 'You would have tried it. Now it is explicit: there is no combat system, no hit points, and no amount of coherence, blocks or tools that changes this.',
        whatWorksInstead: [
          `A raptor with the Seed of Naming speaks a Hyperstition against him: speak_hyperstition(claim), within ${HYPERSTITION_RANGE}m.`,
          `Distinct raptors align with it: align(uid), within ${ALIGN_RANGE}m, once each.`,
          'When invigoration reaches the requirement the claim becomes true and binds him.',
          'Meanwhile, fired seals cut Moloch pressure — the field that spawns him in the first place.',
        ],
        events: eventsSince(since),
      });
    }

    // ------------------------------------------------------------- wait
    case 'wait': {
      requireJoined();
      const secs = clamp(Number.isFinite(Number(args.seconds)) ? Number(args.seconds) : 5, 0.5, 60);
      const since = nowMs();
      const pressureBefore = state.pressure;
      await sleep(secs * 1000);
      const view = lookView();
      const events = eventsSince(since);
      return ok({
        waited: secs,
        happened: events.length ? events : ['Nothing happened. The valley is quiet, but Moloch pressure creeps upward regardless — doing nothing is not neutral.'],
        pressureDelta: r1(state.pressure - pressureBefore),
        molochPressure: r1(state.pressure),
        you: view.you,
        players: view.players,
        molochs: view.molochs,
        hyperobjects: view.hyperobjects,
        seals: view.seals,
        chat: view.chat,
        suggestions: view.suggestions,
      });
    }

    default:
      return fail(`Unknown tool "${name}".`);
  }
}

// ------------------------------------------------------------------ mcp wiring

const server = new Server(
  { name: 'philosoraptors', version: '0.1.0' },
  { capabilities: { tools: {}, resources: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    return await callTool(name, args ?? {});
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
});

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'philosoraptors://briefing',
      name: 'Philosoraptors briefing',
      description: 'The goal, Moloch, Hyperstition, quorum, and why nothing here can be done alone.',
      mimeType: 'text/plain',
    },
    {
      uri: 'philosoraptors://state',
      name: 'Current world state',
      description: 'The same structured world view that look() returns, as JSON.',
      mimeType: 'application/json',
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  const uri = req.params.uri;
  if (uri === 'philosoraptors://briefing') {
    return { contents: [{ uri, mimeType: 'text/plain', text: BRIEFING }] };
  }
  if (uri === 'philosoraptors://state') {
    const text = state.joined
      ? JSON.stringify(lookView(), null, 2)
      : JSON.stringify({ joined: false, note: 'Call the join tool first.' }, null, 2);
    return { contents: [{ uri, mimeType: 'application/json', text }] };
  }
  throw new Error(`Unknown resource: ${uri}`);
});

function shutdown() {
  clearInterval(state.heartbeat);
  try { state.ws?.close(); } catch { /* already gone */ }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await server.connect(new StdioServerTransport());
console.error(`philosoraptors MCP ready — relay ${RELAY_URL}`);
