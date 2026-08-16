import * as THREE from 'three';
import { makeSigil, type Sigil } from '../systems/sigil';
import { buildRaptor, type RaptorParts } from '../entities/Raptor';
import type { SpellKey } from '../systems/spells';
import {
  relayUrl,
  type ClientMsg,
  type ServerMsg,
  type PlayerId,
  type Uid,
  type SeedPower,
  type WireChat,
  type WireGoldenSeed,
  type WireHyper,
  type WireMoloch,
  type WirePlayer,
  type WireSeal,
} from './protocol';

/**
 * Multiplayer client — a renderer of server truth plus an intent sender.
 *
 * Fails soft on purpose: if no relay is running the game is fully playable
 * solo, and the flock NPCs supply the sigils instead. Coordination stays hard
 * either way — you just negotiate with the world rather than with people.
 *
 * The mirrors below (`molochs`, `hypers`, `goldenSeeds`, `chat`, `pressure`)
 * are deliberately plain arrays of wire structs rather than richer local
 * objects. Everything that two clients could disagree about is owned by
 * `server/server.mjs`; this class never invents any of it, it only holds the
 * last thing the authority said. The entity packages (HyperObject,
 * MolochManager, SeedNode) reconcile their visuals against these mirrors.
 */

/**
 * Re-exported so a consumer needs a single import site for "what the network
 * gave me". The definitions still live in protocol.ts; this is only a door.
 */
export type {
  PlayerId, Uid, SeedPower,
  WireChat, WireGoldenSeed, WireHyper, WireMoloch, WirePlayer, WireSeal,
} from './protocol';

/** The whole welcome payload, kept as one object because it is one snapshot. */
export type Welcome = Extract<ServerMsg, { t: 'welcome' }>;

export interface Peer {
  id: PlayerId;
  sigil: Sigil;
  /** True for MCP/agent clients — rendered differently, see `buildPeerModel`. */
  agent: boolean;
  seeds: Set<SeedPower>;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  yaw: number;
  coherence: number;
  parts: RaptorParts;
  /** Smoothed ground speed, used only to scale the walk cycle. */
  speed: number;
  /** Quantised plumage level currently built, so we rebuild only on a real change. */
  band: number;
  /** Per-peer animation phase so a crowd does not march in lockstep. */
  phase: number;
}

/**
 * One callback per `ServerMsg` variant. Nothing is optional-by-omission on the
 * wire side: a package that ignores a message is making that choice explicitly,
 * which is easier to audit than a switch statement scattered across main.ts.
 */
export interface NetEvents {
  onWelcome?(w: Welcome): void;
  onJoin?(player: WirePlayer): void;
  onLeave?(id: PlayerId): void;
  onPeerState?(id: PlayerId, x: number, y: number, z: number, yaw: number, coherence: number): void;
  onChat?(msg: WireChat): void;

  onSealOpen?(seal: WireSeal): void;
  onSealMark?(uid: Uid, playerId: PlayerId, marks: PlayerId[]): void;
  onSealFire?(uid: Uid, key: SpellKey, x: number, y: number, z: number, marks: PlayerId[]): void;
  onSealLapse?(uid: Uid): void;

  onMolochSpawn?(moloch: WireMoloch): void;
  onMolochBound?(uid: Uid): void;
  /** Live tether readout while streams are on him. */
  onMolochHeld?(uid: Uid, tether: number, held: number, beamers: string[],
                capped: boolean, need: number): void;
  /** Enough streams held him long enough. */
  onMolochTaken?(uid: Uid, beamers: PlayerId[], total: number, assist: number): void;
  onMolochGone?(uid: Uid): void;

  onHyperOpen?(hyper: WireHyper): void;
  onHyperAlign?(uid: Uid, by: PlayerId, name: string,
                invigoration: number, required: number, contributors: PlayerId[]): void;
  onHyperReal?(uid: Uid, claim: string, contributors: PlayerId[]): void;
  onHyperFade?(uid: Uid): void;

  onSeedClaimed?(uid: Uid, key: SeedPower, by: PlayerId, name: string, mine: boolean): void;

  onBlock?(x: number, y: number, z: number, id: number): void;
  onMoloch?(pressure: number): void;
  onDrain?(amount: number, uid: Uid): void;
  /** The authority refused an intent. Always surface this: refusals are content. */
  onDenied?(why: string): void;
  onTick?(molochs: WireMoloch[], hypers: WireHyper[], pressure: number, authority: PlayerId | null): void;

  /** Human-readable connection chatter, for the HUD ticker. */
  onStatus?(text: string): void;
}

/** Coherence 0..100 maps onto plumage the same way `Coherence.plumage` does. */
const PLUMAGE_BAND = (coherence: number): number =>
  Math.round(Math.min(1, Math.max(0, coherence / 85)) * 4) / 4;

const CHAT_KEEP = 200;
const SEND_HZ = 12;

/** Dispose a peer model's GPU resources. Peers churn; leaks would accumulate. */
function disposeModel(root: THREE.Object3D): void {
  root.removeFromParent();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) for (const m of mat) m.dispose();
    else mat.dispose();
  });
}

export class Net {
  readonly group = new THREE.Group();
  readonly peers = new Map<PlayerId, Peer>();
  readonly id: PlayerId;
  readonly sigil: Sigil;

  connected = false;

  // ---- authoritative mirrors. Never written except from a ServerMsg.
  molochs: WireMoloch[] = [];
  hypers: WireHyper[] = [];
  goldenSeeds: WireGoldenSeed[] = [];
  seedPowers: { key: SeedPower; name: string; grants: string }[] = [];
  chat: WireChat[] = [];
  mySeeds = new Set<SeedPower>();

  /**
   * Whether this client simulates Moloch's effect on the ground. Solo play is
   * authoritative by definition — there is nobody else to defer to — so this
   * starts true and only drops when the relay names someone else.
   */
  isAuthority = true;

  /** The commons Moloch is eating, 0..1. */
  pressure = 0;

  private ws: WebSocket | null = null;
  private readonly events: NetEvents;
  private sendTimer = 0;
  /** Set once we have deliberately closed, so `onclose` stays quiet. */
  private closing = false;

  constructor(events: NetEvents = {}) {
    this.events = events;
    // Stable per-browser identity so your sigil persists across reloads.
    let stored: string | null = null;
    try {
      stored = localStorage.getItem('philo-id');
      if (!stored) {
        stored = `r${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem('philo-id', stored);
      }
    } catch {
      // Private-mode browsers throw on storage. An ephemeral identity is a
      // worse game (nobody learns your mark) but still a playable one.
      stored = stored ?? `r${Math.random().toString(36).slice(2, 10)}`;
    }
    this.id = stored;
    this.sigil = makeSigil(stored);
    this.group.name = 'peers';
  }

  // ------------------------------------------------------------- connection

  /**
   * Attempt a relay connection. Never throws and never logs: a missing relay
   * is the normal single-player case, not an error, and a console full of
   * WebSocket noise would train players to ignore the console.
   */
  connect(url: string = relayUrl(location.hostname || 'localhost')): void {
    if (this.ws) return;
    this.closing = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.events.onStatus?.('No relay found — playing solo.');
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this.events.onStatus?.('Connected to the flock.');
      this.send({ t: 'hello', id: this.id, name: this.sigil.name, hue: this.sigil.hue });
    };

    ws.onerror = () => {
      // Silent: solo is a legitimate mode, not an error state.
    };

    ws.onclose = () => {
      // Guard against a stale socket's close event clobbering a newer
      // connection: after disconnect()->connect(), the OLD socket's onclose
      // would otherwise null out `this.ws` (now the live socket) and tear down
      // the peers, making send() a permanent silent no-op.
      if (this.ws !== ws) return;
      this.ws = null;
      const wasConnected = this.connected;
      this.connected = false;
      this.teardown();
      if (!this.closing && wasConnected) this.events.onStatus?.('Relay closed — playing solo.');
      else if (!this.closing) this.events.onStatus?.('No relay found — playing solo.');
    };

    ws.onmessage = (ev) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      this.handle(raw);
    };
  }

  /** Close the socket without the "relay closed" status noise. */
  disconnect(): void {
    this.closing = true;
    const ws = this.ws;
    this.ws = null;
    this.connected = false;
    try { ws?.close(); } catch { /* already dead */ }
    this.teardown();
  }

  /**
   * Drop every scrap of server-owned state. The entity packages are told the
   * molochs and hyperobjects are gone rather than being left holding meshes
   * for things that no longer have an authority behind them.
   */
  private teardown(): void {
    for (const p of this.peers.values()) disposeModel(p.parts.root);
    this.peers.clear();
    for (const m of this.molochs) this.events.onMolochGone?.(m.uid);
    for (const h of this.hypers) this.events.onHyperFade?.(h.uid);
    this.molochs = [];
    this.hypers = [];
    // Solo again: you are the only thing simulating the valley.
    this.isAuthority = true;
  }

  // --------------------------------------------------------------- receiving

  /**
   * Chat is the one frame that cannot be discriminated on `t`.
   *
   * The relay broadcasts it as `{ t: 'chat', ...entry }`, and WireChat carries
   * its own `t` (a millisecond timestamp) which wins the spread — so a chat
   * frame arrives with a NUMBER where every other frame has a tag. TypeScript
   * agrees: `{t:'chat'} & WireChat` reduces to `never`, so the union has no
   * chat member to switch on at all. Sniffing the shape here is the honest
   * fix available to a client that does not own the wire contract.
   */
  private handle(raw: unknown): void {
    if (typeof raw !== 'object' || raw === null) return;
    const probe = raw as { t?: unknown; from?: unknown; text?: unknown; kind?: unknown };

    if (typeof probe.t === 'number') {
      if (typeof probe.from !== 'string' || typeof probe.text !== 'string') return;
      const kind = probe.kind === 'omen' || probe.kind === 'system' ? probe.kind : 'say';
      const entry: WireChat = { from: probe.from, text: probe.text, kind, t: probe.t };
      this.chat.push(entry);
      if (this.chat.length > CHAT_KEEP) this.chat.shift();
      this.events.onChat?.(entry);
      return;
    }

    const m = raw as ServerMsg;
    switch (m.t) {
      case 'welcome': {
        this.pressure = m.molochPressure;
        this.isAuthority = m.authority;
        this.molochs = m.molochs;
        this.hypers = m.hypers;
        this.goldenSeeds = m.goldenSeeds;
        this.seedPowers = m.seedPowers;
        this.chat = m.chat.slice(-CHAT_KEEP);
        // A reconnecting raptor keeps whatever it already found in the ground.
        this.mySeeds.clear();
        for (const gs of m.goldenSeeds) if (gs.claimedBy === this.id) this.mySeeds.add(gs.key);
        for (const p of m.peers) this.addPeer(p);
        this.events.onWelcome?.(m);
        break;
      }

      case 'join': {
        this.addPeer(m);
        this.events.onJoin?.(m);
        break;
      }

      case 'leave': {
        const p = this.peers.get(m.id);
        if (p) {
          disposeModel(p.parts.root);
          this.peers.delete(m.id);
        }
        this.events.onLeave?.(m.id);
        break;
      }

      case 'state': {
        const p = this.peers.get(m.id);
        if (p) {
          p.target.set(m.x, m.y, m.z);
          p.yaw = m.yaw;
          p.coherence = m.coherence;
        }
        this.events.onPeerState?.(m.id, m.x, m.y, m.z, m.yaw, m.coherence);
        break;
      }

      case 'sealOpen':
        this.events.onSealOpen?.(m.seal);
        break;

      case 'sealMark':
        this.events.onSealMark?.(m.uid, m.playerId, m.marks);
        break;

      case 'sealFire':
        this.pressure = m.molochPressure;
        this.events.onSealFire?.(m.uid, m.key, m.x, m.y, m.z, m.marks);
        this.events.onMoloch?.(m.molochPressure);
        break;

      case 'sealLapse':
        this.events.onSealLapse?.(m.uid);
        break;

      case 'molochSpawn': {
        const i = this.molochs.findIndex((x) => x.uid === m.moloch.uid);
        if (i >= 0) this.molochs[i] = m.moloch;
        else this.molochs.push(m.moloch);
        this.events.onMolochSpawn?.(m.moloch);
        break;
      }

      case 'molochBound': {
        const mo = this.molochs.find((x) => x.uid === m.uid);
        if (mo) { mo.bound = 1; mo.state = 'banish'; }
        this.events.onMolochBound?.(m.uid);
        break;
      }

      case 'molochHeld': {
        const mo = this.molochs.find((x) => x.uid === m.uid);
        if (mo) { mo.tether = m.tether; mo.held = m.held; }
        this.events.onMolochHeld?.(m.uid, m.tether, m.held, m.beamers,
                                   m.capped ?? false, m.need ?? 0);
        break;
      }

      case 'molochTaken': {
        const mo = this.molochs.find((x) => x.uid === m.uid);
        if (mo) { mo.bound = 1; mo.held = 1; }
        this.events.onMolochTaken?.(m.uid, m.beamers,
                                    m.total ?? m.beamers.length, m.assist ?? 0);
        break;
      }

      case 'molochGone':
        this.molochs = this.molochs.filter((x) => x.uid !== m.uid);
        this.events.onMolochGone?.(m.uid);
        break;

      case 'hyperOpen': {
        const i = this.hypers.findIndex((x) => x.uid === m.hyper.uid);
        if (i >= 0) this.hypers[i] = m.hyper;
        else this.hypers.push(m.hyper);
        this.events.onHyperOpen?.(m.hyper);
        break;
      }

      case 'hyperAlign': {
        const h = this.hypers.find((x) => x.uid === m.uid);
        if (h) {
          h.invigoration = m.invigoration;
          h.required = m.required;
          h.contributors = m.contributors;
        }
        this.events.onHyperAlign?.(m.uid, m.by, m.name, m.invigoration, m.required, m.contributors);
        break;
      }

      case 'hyperReal':
        this.hypers = this.hypers.filter((x) => x.uid !== m.uid);
        this.events.onHyperReal?.(m.uid, m.claim, m.contributors);
        break;

      case 'hyperFade':
        this.hypers = this.hypers.filter((x) => x.uid !== m.uid);
        this.events.onHyperFade?.(m.uid);
        break;

      case 'seedClaimed': {
        const gs = this.goldenSeeds.find((x) => x.uid === m.uid);
        if (gs) gs.claimedBy = m.by;
        const mine = m.by === this.id;
        if (mine) this.mySeeds.add(m.key);
        const peer = this.peers.get(m.by);
        peer?.seeds.add(m.key);
        this.events.onSeedClaimed?.(m.uid, m.key, m.by, m.name, mine);
        break;
      }

      case 'block':
        this.events.onBlock?.(m.x, m.y, m.z, m.id);
        break;

      case 'moloch':
        this.pressure = m.pressure;
        this.events.onMoloch?.(m.pressure);
        break;

      case 'drain':
        this.events.onDrain?.(m.amount, m.uid);
        break;

      case 'denied':
        // A refusal is the game explaining itself. If nobody wired a handler,
        // it still reaches the status ticker rather than vanishing.
        if (this.events.onDenied) this.events.onDenied(m.why);
        else this.events.onStatus?.(m.why);
        break;

      case 'tick':
        this.molochs = m.molochs;
        this.hypers = m.hypers;
        this.pressure = m.pressure;
        this.isAuthority = m.authority === this.id;
        this.events.onTick?.(m.molochs, m.hypers, m.pressure, m.authority);
        break;

      default:
        // Unknown variants are ignored rather than thrown on, so a newer relay
        // can add messages without breaking older clients mid-session.
        break;
    }
  }

  // ---------------------------------------------------------------- sending

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  /**
   * Position/pose, throttled to ~12 Hz. Everything else on the wire is
   * event-driven, so this is the only recurring cost of being online.
   */
  sendState(dt: number, x: number, y: number, z: number, yaw: number, coherence: number): void {
    this.sendTimer += dt;
    if (!this.connected || this.sendTimer < 1 / SEND_HZ) return;
    this.sendTimer = 0;
    this.send({ t: 'state', x, y, z, yaw, coherence });
  }

  say(text: string): void {
    const t = text.trim();
    if (t) this.send({ t: 'chat', text: t.slice(0, 400) });
  }

  openSeal(key: SpellKey, x: number, y: number, z: number, quorum: number, ttl: number): void {
    this.send({ t: 'sealOpen', key, x, y, z, quorum, ttl });
  }

  markSeal(uid: Uid): void {
    this.send({ t: 'sealMark', uid });
  }

  /** Declare a future that is not yet true. Requires the Seed of Naming. */
  speakHyperstition(claim: string): void {
    this.send({ t: 'hyperstition', claim: claim.slice(0, 160) });
  }

  /** Act as if a declared future were already true. Once per raptor, per hyper. */
  align(uid: Uid, assist = 0): void {
    this.send({ t: 'align', uid, assist });
  }

  /**
   * Beam heartbeat. Resent while the stream is held; the server treats silence
   * as a release, so a dropped client cannot leave a phantom tether behind.
   */
  private beamTimer = 0;
  private beamLast: Uid | null | undefined = undefined;

  beam(dt: number, uid: Uid | null, on: boolean, assist = 0): void {
    this.beamTimer += dt;
    const changed = on !== (this.beamLast !== null && this.beamLast !== undefined) ||
                    uid !== this.beamLast;
    // Send immediately on any change, then heartbeat at ~6Hz while held.
    if (!changed && this.beamTimer < 1 / 6) return;
    this.beamTimer = 0;
    this.beamLast = on ? uid : null;
    this.send({ t: 'beam', uid, on, assist });
  }

  setBlock(x: number, y: number, z: number, id: number): void {
    this.send({ t: 'block', x, y, z, id });
  }

  /** Taking from the commons. Raises pressure for everyone, including you. */
  reportExtract(n = 1): void {
    this.send({ t: 'extract', n });
  }

  reportPlant(n = 1): void {
    this.send({ t: 'plant', n });
  }

  /**
   * Swing at a Moloch. The server answers with a refusal, every time, by
   * design — he is not a monster with hit points. Sending it anyway is the
   * point: the player has to be told, in the fiction's own voice, why force
   * is the wrong tool.
   */
  attack(uid: Uid): void {
    this.send({ t: 'attack', uid });
  }

  // ------------------------------------------------------------------ peers

  /**
   * A peer's glyph is always derived from its id so that the same raptor draws
   * the same mark everywhere. Name and hue, though, are whatever the client
   * announced — an agent may choose its own — so those are taken off the wire.
   */
  private peerSigil(p: WirePlayer): Sigil {
    const base = makeSigil(p.id);
    if (p.name === base.name && p.hue === base.hue) return base;
    return { ...base, name: p.name, hue: p.hue, css: `hsl(${p.hue} 78% 62%)` };
  }

  private addPeer(p: WirePlayer): void {
    const existing = this.peers.get(p.id);
    if (existing) {
      existing.target.set(p.x, p.y, p.z);
      existing.yaw = p.yaw;
      existing.coherence = p.coherence;
      existing.seeds = new Set(p.seeds);
      return;
    }
    const sigil = this.peerSigil(p);
    const band = PLUMAGE_BAND(p.coherence);
    const peer: Peer = {
      id: p.id,
      sigil,
      agent: p.agent,
      seeds: new Set(p.seeds),
      pos: new THREE.Vector3(p.x, p.y, p.z),
      target: new THREE.Vector3(p.x, p.y, p.z),
      yaw: p.yaw,
      coherence: p.coherence,
      parts: this.buildPeerModel(sigil.hue, band, p.agent),
      speed: 0,
      band,
      phase: Math.random() * 10,
    };
    peer.parts.root.position.copy(peer.pos);
    peer.parts.root.rotation.y = peer.yaw;
    this.group.add(peer.parts.root);
    this.peers.set(p.id, peer);
  }

  /**
   * Agents are marked by the 'thoughtful' archetype — the six tiny clockwork
   * songbirds orbiting the head from Ep3. Chosen over a badge or a tint
   * because it reads at distance, costs nothing in the palette (the birds are
   * already ochre), and says the right thing: a mind that is present in the
   * valley without being of it. Humans get 'exuberant', which adds nothing.
   */
  private buildPeerModel(hue: number, band: number, agent: boolean): RaptorParts {
    return buildRaptor(hue, band, agent ? 'thoughtful' : 'exuberant');
  }

  /**
   * Rebuild a peer's model when its plumage band actually changes. Plumage is
   * baked into the geometry (feather fans only exist above a threshold), so
   * "colour arrives with culture" has to be a rebuild rather than a uniform.
   */
  private reband(peer: Peer): void {
    const band = PLUMAGE_BAND(peer.coherence);
    if (band === peer.band) return;
    disposeModel(peer.parts.root);
    peer.band = band;
    peer.parts = this.buildPeerModel(peer.sigil.hue, band, peer.agent);
    peer.parts.root.position.copy(peer.pos);
    peer.parts.root.rotation.y = peer.yaw;
    this.group.add(peer.parts.root);
  }

  /**
   * Drive the local raptor's uplink and every peer's animation.
   * Called once per frame from main.ts.
   */
  update(dt: number, x: number, y: number, z: number, yaw: number, coherence: number): void {
    this.sendState(dt, x, y, z, yaw, coherence);

    const step = Math.min(1, dt * 9);
    for (const p of this.peers.values()) {
      // Smooth remote motion — the wire rate is far below the frame rate.
      const before = p.pos.x, beforeZ = p.pos.z;
      p.pos.lerp(p.target, step);
      const moved = Math.hypot(p.pos.x - before, p.pos.z - beforeZ) / Math.max(dt, 1e-4);
      p.speed += (moved - p.speed) * Math.min(1, dt * 8);

      this.reband(p);

      const root = p.parts.root;
      root.position.copy(p.pos);
      // Shortest-arc yaw so a peer turning past north does not spin the model.
      let d = p.yaw - root.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      root.rotation.y += d * Math.min(1, dt * 8);

      // Leg-swing walk cycle, amplitude gated on measured speed.
      p.phase += dt;
      const gait = Math.min(1, p.speed / 5);
      const s = Math.sin(p.phase * 9) * gait;
      p.parts.legL.rotation.x = s * 0.7;
      p.parts.legR.rotation.x = -s * 0.7;
      p.parts.armL.rotation.x = -s * 0.25;
      p.parts.armR.rotation.x = s * 0.25;
      p.parts.body.rotation.x = 0.1 + gait * 0.12;
      p.parts.body.position.y = 0.95 + Math.abs(s) * 0.05;
      p.parts.tail.rotation.y = s * 0.18;

      // The agent's songbirds keep their own orbit whether it moves or not.
      const birds = p.parts.birds;
      if (birds) {
        birds.rotation.y = p.phase * 0.8;
        for (const b of birds.children) {
          const ph = (b.userData.phase as number) + p.phase * 0.8;
          b.position.set(Math.cos(ph) * 0.6, Math.sin(ph * 2.1) * 0.12, Math.sin(ph) * 0.6);
          b.rotation.y = -ph;
        }
      }
    }
  }

  // ---------------------------------------------------------------- queries

  /**
   * Resolve a sigil for any id that can appear in a `marks` or `contributors`
   * list. The Seed of Voice makes the server record a second mark as `id#2`,
   * so that suffix is stripped here rather than in every consumer.
   */
  sigilFor(id: PlayerId): Sigil {
    const base = id.endsWith('#2') ? id.slice(0, -2) : id;
    if (base === this.id) return this.sigil;
    return this.peers.get(base)?.sigil ?? makeSigil(base);
  }

  peerList(from: THREE.Vector3): { sigil: Sigil; dist: number; agent: boolean }[] {
    return [...this.peers.values()]
      .map((p) => ({ sigil: p.sigil, dist: p.pos.distanceTo(from), agent: p.agent }))
      .sort((a, b) => a.dist - b.dist);
  }

  getMoloch(uid: Uid): WireMoloch | undefined {
    return this.molochs.find((m) => m.uid === uid);
  }

  getHyper(uid: Uid): WireHyper | undefined {
    return this.hypers.find((h) => h.uid === uid);
  }

  /** Nearest Moloch to a point, or null if the valley is briefly clean. */
  nearestMoloch(from: THREE.Vector3): WireMoloch | null {
    let best: WireMoloch | null = null;
    let bd = Infinity;
    for (const m of this.molochs) {
      const d = Math.hypot(m.x - from.x, m.z - from.z);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  hasSeed(key: SeedPower): boolean {
    return this.mySeeds.has(key);
  }
}
