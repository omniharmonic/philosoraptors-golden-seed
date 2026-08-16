/**
 * Philosoraptors relay — authoritative for everything two clients could
 * otherwise disagree about.
 *
 * The browser is a renderer of server truth plus an input device. The MCP
 * server (mcp/server.mjs) is a second, equally legitimate client that speaks
 * JSON instead of pixels, so agents and humans play the same game.
 *
 * Server owns: players, chat, seals, Molochs, Hyperobjects, Golden Seeds,
 * and the Moloch pressure commons.
 * Clients own: terrain (deterministic from seed) and block edits.
 */

import { WebSocketServer } from 'ws';
import { networkInterfaces } from 'node:os';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const SEED = 20260816;

const wss = new WebSocketServer({ port: PORT });

// ---------------------------------------------------------------- state

/** id -> player */
const players = new Map();
/** uid -> seal */
const seals = new Map();
/** uid -> moloch */
const molochs = new Map();
/** uid -> hyperobject */
const hypers = new Map();
/** "x,y,z" -> blockId */
const edits = new Map();

const chat = [];
let nextUid = 1;

const world = {
  seed: SEED,
  molochPressure: 0.18,
  quorumActs: 0,
  banished: 0,
};

// ---------------------------------------------------------------- golden seeds

/**
 * The Golden Seeds. Deterministic positions so every client and agent agrees
 * where they are without the server having to know the terrain. Each grants a
 * power; you need them to stand a chance against a gorged Moloch.
 */
export const SEED_POWERS = [
  { key: 'sight',   name: 'Seed of Sight',   grants: 'Hyperobjects become visible to you at any coherence, and Molochs are marked at range.' },
  { key: 'naming',  name: 'Seed of Naming',  grants: 'You may speak a Hyperstition — declaring a future that is not yet real.' },
  { key: 'voice',   name: 'Seed of Voice',   grants: 'Your sigil counts twice toward any quorum.' },
  { key: 'weaving', name: 'Seed of Weaving', grants: 'The Weave needs one fewer sigil, and spans twice as far.' },
  { key: 'flight',  name: 'Seed of Flight',  grants: 'Glide, Lift and Free Flight unlock 20 coherence earlier.' },
  { key: 'root',    name: 'Seed of Root',    grants: 'Root-line reaches twice as far and always leaves living soil.' },
  { key: 'mirror',  name: 'Seed of Mirror',  grants: "Moloch's drain reflects back onto him." },
];

function hash(n) {
  let h = (n * 374761393 + SEED * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const goldenSeeds = SEED_POWERS.map((p, i) => {
  const a = hash(i * 7 + 1) * Math.PI * 2;
  const r = 240 + hash(i * 13 + 5) * 1500;
  return {
    uid: `gs${i}`,
    key: p.key,
    name: p.name,
    grants: p.grants,
    x: Math.round(Math.cos(a) * r),
    z: Math.round(Math.sin(a) * r),
    claimedBy: null,
  };
});

// ---------------------------------------------------------------- helpers

const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };

const broadcast = (msg, exceptId = null) => {
  const raw = JSON.stringify(msg);
  for (const [id, p] of players) {
    if (id === exceptId) continue;
    if (p.ws.readyState === 1) p.ws.send(raw);
  }
};

const sealWire = (s) => ({
  uid: s.uid, key: s.key, x: s.x, y: s.y, z: s.z,
  quorum: s.quorum, remaining: s.remaining, openerId: s.openerId,
  marks: [...s.marks],
});

const molochWire = (m) => ({
  uid: m.uid, x: m.x, y: m.y, z: m.z, yaw: m.yaw,
  gorge: m.gorge, bound: m.bound, state: m.state,
  tether: (m.beams ? m.beams.size : 0) + (m.assist ?? 0), held: m.held ?? 0,
});

const TETHER_TO_HOLD = 3;
/** Coherence at which a raptor may declare a future without the Seed of Naming. */
const NAMING_COHERENCE = 25;

/**
 * Declarations — the single commitment mechanic, replacing seals.
 * Mirrors src/systems/declarations.ts; the server is the authority on quorum.
 */
const DECLARATIONS = {
  green:  { quorum: 2, min: 0,  ttl: 70,  radius: 12, needsMoloch: false },
  preen:  { quorum: 2, min: 0,  ttl: 60,  radius: 8,  needsMoloch: false },
  honest: { quorum: 2, min: 6,  ttl: 60,  radius: 14, needsMoloch: false },
  catch:  { quorum: 3, min: 12, ttl: 80,  radius: 14, needsMoloch: false },
  admit:  { quorum: 3, min: 10, ttl: 70,  radius: 12, needsMoloch: false },
  bind:   { quorum: 3, min: 25, ttl: 150, radius: 24, needsMoloch: true },
  door:   { quorum: 4, min: 40, ttl: 120, radius: 20, needsMoloch: false },
  seed:   { quorum: 7, min: 55, ttl: 180, radius: 24, needsMoloch: false },
};
/** A beam intent older than this is treated as released. */
const BEAM_TIMEOUT_MS = 700;

const hyperWire = (h) => ({
  uid: h.uid, kind: h.kind, x: h.x, y: h.y, z: h.z,
  claim: h.claim, invigoration: h.invigoration, required: h.required,
  contributors: [...h.contributors], targetUid: h.targetUid,
  authorId: h.authorId, remaining: h.remaining,
});

const playerWire = (id, p) => ({
  id, name: p.name, hue: p.hue, x: p.x, y: p.y, z: p.z, yaw: p.yaw,
  coherence: p.coherence, seeds: [...p.seeds], agent: !!p.agent,
});

/** The lowest-id browser client simulates Moloch ground damage. */
function authorityId() {
  const ids = [...players.entries()].filter(([, p]) => !p.agent).map(([id]) => id).sort();
  return ids[0] ?? null;
}

function pushChat(from, text, kind = 'say') {
  const entry = { from, text, kind, t: Date.now() };
  chat.push(entry);
  if (chat.length > 200) chat.shift();
  broadcast({ t: 'chat', ...entry });
  return entry;
}

// ---------------------------------------------------------------- moloch

function spawnMoloch(nearX, nearZ) {
  const uid = `m${nextUid++}`;
  const a = Math.random() * Math.PI * 2;
  // 45-95m: visible from where you stand, a short walk away, not a hunt.
  const d = 45 + Math.random() * 50;
  const m = {
    uid,
    x: Math.round(nearX + Math.cos(a) * d),
    y: 60,
    z: Math.round(nearZ + Math.sin(a) * d),
    yaw: 0,
    gorge: 0,
    bound: 0,
    state: 'roam',
    tx: 0, tz: 0,
    dead: false,
    // playerId -> last beam heartbeat. Real-time quorum: only raptors beaming
    // him RIGHT NOW count, so a tether can never be accumulated alone.
    beams: new Map(),
    held: 0,
    assist: 0,
    assistAt: 0,
  };
  m.tx = m.x; m.tz = m.z;
  molochs.set(uid, m);
  broadcast({ t: 'molochSpawn', moloch: molochWire(m) });
  pushChat('the valley', 'Something horned is walking the ridgeline.', 'omen');
  return m;
}

function tickMolochs(dt) {
  for (const [uid, m] of molochs) {
    if (m.dead) { molochs.delete(uid); broadcast({ t: 'molochGone', uid }); continue; }

    if (m.bound >= 1) {
      m.state = 'banish';
      m.banishT = (m.banishT ?? 0) + dt;
      if (m.banishT > 3.2) {
        m.dead = true;
        world.banished++;
        world.molochPressure = Math.max(0, world.molochPressure - 0.25);
        pushChat('the valley', 'The horned one is unmade. The web remembers.', 'omen');
        broadcast({ t: 'moloch', pressure: world.molochPressure });
      }
      continue;
    }

    // ---- beams: expire stale heartbeats, then count who is holding him.
    const nowMs = Date.now();
    for (const [pid, at] of m.beams) {
      if (nowMs - at > BEAM_TIMEOUT_MS) m.beams.delete(pid);
    }
    if (m.assistAt && nowMs - m.assistAt > BEAM_TIMEOUT_MS) { m.assist = 0; m.assistAt = 0; }
    // Distinct raptors streaming him right now, plus any council flock the
    // authority client reports as lending their own streams. Both are real
    // contributors; neither can be faked into existence by one raptor holding
    // the button for longer.
    const assist = Math.max(0, Math.min(4, m.assist ?? 0));
    const contributors = m.beams.size + assist;
    const tether = contributors;

    if (contributors > 0) {
      /*
       * CEILING, NOT RATE. This is the load-bearing line of the whole game.
       *
       * The first version raised `held` at a rate proportional to grip^2 with
       * no upper bound, so a lone raptor still crawled to 1.0 in ten seconds
       * and took him — while the API returned the "you need three" rule in the
       * same payload. A slower solo is not an impossible solo.
       *
       * So the number of concurrent contributors sets a hard CAP on how far
       * the hold can ever progress. Below quorum you physically cannot finish,
       * no matter how long you hold it. Coordination is not the fast path; it
       * is the only path.
       */
      const ceiling = contributors >= TETHER_TO_HOLD
        ? 1
        : (contributors / TETHER_TO_HOLD) * 0.9;
      const grip = Math.min(1, contributors / TETHER_TO_HOLD);
      m.held = Math.min(ceiling, m.held + dt * grip * 0.55);

      if (m.held >= 1 && contributors >= TETHER_TO_HOLD) {
        m.bound = 1;
        // Report the FULL count. beams.keys() is networked players only, so the
        // payoff banner was reading "1 streams at once" at the exact moment the
        // chat line said "Held by 4" — the worst place in the game to undercount.
        broadcast({
          t: 'molochTaken', uid: m.uid,
          beamers: [...m.beams.keys()],
          total: contributors,
          assist,
        });
        pushChat('the valley',
          `Held by ${contributors} streams at once. The horned one is taken.`, 'omen');
      }
      broadcast({
        t: 'molochHeld', uid: m.uid, tether: contributors, held: m.held,
        capped: contributors < TETHER_TO_HOLD,
        need: Math.max(0, TETHER_TO_HOLD - contributors),
        beamers: [...m.beams.keys()].map((id) => players.get(id)?.name ?? id),
      });
    } else if (m.held > 0) {
      // Let go and he shrugs it off quickly. Coordination has to be sustained.
      m.held = Math.max(0, m.held - dt * 0.55);
    }

    // A tethered Moloch moves slower, and a fully held one not at all.
    const drag = 1 - Math.min(1, contributors / TETHER_TO_HOLD) * 0.85;

    // Head for the nearest player, else wander.
    let best = null; let bd = Infinity;
    for (const [, p] of players) {
      const d = Math.hypot(p.x - m.x, p.z - m.z);
      if (d < bd) { bd = d; best = p; }
    }
    if (best && bd < 90) {
      m.state = bd < 16 ? 'menace' : 'reap';
      m.tx = best.x; m.tz = best.z;
    } else {
      m.state = 'roam';
      if (Math.hypot(m.tx - m.x, m.tz - m.z) < 3) {
        m.tx = m.x + (Math.random() * 2 - 1) * 60;
        m.tz = m.z + (Math.random() * 2 - 1) * 60;
      }
    }
    const dx = m.tx - m.x;
    const dz = m.tz - m.z;
    const len = Math.hypot(dx, dz) || 1;
    const sp = (m.state === 'menace' ? 2.1 : 1.5) * drag;
    m.x += (dx / len) * sp * dt;
    m.z += (dz / len) * sp * dt;
    m.yaw = Math.atan2(dx, dz);

    // He takes, continuously. Pressure is the commons he is eating.
    // Capped. Scale and drain radius derive from gorge, so an uncapped value
    // turns him into a screen-filling black wall after a few idle minutes —
    // which reads as broken rather than as menacing.
    m.gorge = Math.min(60, m.gorge + dt * (1.2 + world.molochPressure));
    world.molochPressure = Math.min(1, world.molochPressure + dt * 0.0012);

    // Drain anyone standing too close.
    for (const [pid, p] of players) {
      if (Math.hypot(p.x - m.x, p.z - m.z) < 8) {
        send(p.ws, { t: 'drain', amount: dt * 2.2, uid: m.uid });
        void pid;
      }
    }
  }
}

// ---------------------------------------------------------------- hyperobjects

function tickHypers(dt) {
  for (const [uid, h] of hypers) {
    h.remaining -= dt;
    if (h.invigoration >= h.required) {
      // It became real. Bind whatever Moloch it was declared against.
      const m = molochs.get(h.targetUid);
      if (m) {
        m.bound = 1;
        broadcast({ t: 'molochBound', uid: m.uid });
      }
      pushChat('the web', `"${h.claim}" is now true. ${h.contributors.size} of us made it so.`, 'omen');
      broadcast({
        t: 'hyperReal', uid, kind: h.kind, claim: h.claim,
        x: h.x, y: h.y, z: h.z,
        contributors: [...h.contributors],
      });
      hypers.delete(uid);
      world.quorumActs++;
      world.molochPressure = Math.max(0, world.molochPressure - 0.12);
      broadcast({ t: 'moloch', pressure: world.molochPressure });
      continue;
    }
    if (h.remaining <= 0) {
      pushChat('the web', `"${h.claim}" faded. Not enough of us acted as if it were true.`, 'omen');
      broadcast({ t: 'hyperFade', uid });
      hypers.delete(uid);
    }
  }
}

// ---------------------------------------------------------------- connection

wss.on('connection', (ws) => {
  let id = null;

  ws.on('message', (buf) => {
    let m;
    try { m = JSON.parse(buf.toString()); } catch { return; }

    switch (m.t) {
      case 'hello': {
        id = m.id;
        players.set(id, {
          ws, name: m.name, hue: m.hue ?? 40, agent: !!m.agent,
          x: m.x ?? 0, y: m.y ?? 60, z: m.z ?? 0, yaw: 0,
          coherence: m.coherence ?? 0, seeds: new Set(),
        });
        send(ws, {
          t: 'welcome',
          you: id,
          seed: world.seed,
          molochPressure: world.molochPressure,
          authority: authorityId() === id,
          seals: [...seals.values()].map(sealWire),
          molochs: [...molochs.values()].map(molochWire),
          hypers: [...hypers.values()].map(hyperWire),
          goldenSeeds,
          seedPowers: SEED_POWERS,
          edits: [...edits.entries()],
          chat: chat.slice(-40),
          peers: [...players.entries()].filter(([pid]) => pid !== id).map(([pid, p]) => playerWire(pid, p)),
        });
        broadcast({ t: 'join', ...playerWire(id, players.get(id)) }, id);
        pushChat(m.name, `${m.name} arrives in the valley.`, 'system');
        console.log(`+ ${m.name}${m.agent ? ' [agent]' : ''} (${id}) — ${players.size} online`);
        break;
      }

      case 'state': {
        const p = players.get(id);
        if (!p) return;
        p.x = m.x; p.y = m.y; p.z = m.z; p.yaw = m.yaw; p.coherence = m.coherence;
        broadcast({ t: 'state', id, x: m.x, y: m.y, z: m.z, yaw: m.yaw, coherence: m.coherence }, id);

        // Claim any golden seed you walk onto.
        for (const gs of goldenSeeds) {
          if (gs.claimedBy) continue;
          if (Math.hypot(gs.x - p.x, gs.z - p.z) < 6) {
            gs.claimedBy = id;
            p.seeds.add(gs.key);
            broadcast({ t: 'seedClaimed', uid: gs.uid, key: gs.key, by: id, name: p.name });
            pushChat(p.name, `${p.name} found the ${gs.name}. ${gs.grants}`, 'omen');
          }
        }
        break;
      }

      case 'chat': {
        const p = players.get(id);
        if (!p) return;
        pushChat(p.name, String(m.text).slice(0, 400), 'say');
        break;
      }

      case 'sealOpen': {
        const uid = `s${nextUid++}`;
        const p = players.get(id);
        const seal = {
          uid, key: m.key, x: m.x, y: m.y, z: m.z,
          quorum: m.quorum, remaining: m.ttl, openerId: id,
          marks: new Set([id]),
        };
        // Seed of Voice: your sigil counts twice.
        if (p?.seeds.has('voice')) seal.marks.add(`${id}#2`);
        seals.set(uid, seal);
        broadcast({ t: 'sealOpen', seal: sealWire(seal) });
        break;
      }

      case 'sealMark': {
        const seal = seals.get(m.uid);
        const p = players.get(id);
        if (!seal || !p || seal.marks.has(id)) return;
        seal.marks.add(id);
        if (p.seeds.has('voice')) seal.marks.add(`${id}#2`);
        broadcast({ t: 'sealMark', uid: seal.uid, playerId: id, marks: [...seal.marks] });
        if (seal.marks.size >= seal.quorum) {
          seals.delete(seal.uid);
          world.quorumActs++;
          world.molochPressure = Math.max(0, world.molochPressure - 0.05 * seal.quorum);
          broadcast({
            t: 'sealFire', uid: seal.uid, key: seal.key,
            x: seal.x, y: seal.y, z: seal.z,
            marks: [...seal.marks], molochPressure: world.molochPressure,
          });
        }
        break;
      }

      // ---- Hyperstition: declare a future that is not yet true.
      case 'hyperstition': {
        const p = players.get(id);
        if (!p) return;
        const kind = String(m.kind || 'green');
        const def = DECLARATIONS[kind];
        if (!def) { send(ws, { t: 'denied', why: `Unknown declaration "${kind}".` }); return; }

        // Coherence is an equal path in alongside the Seed of Naming, which
        // sits up to 1.7km away and needs flight to reach.
        if (!p.seeds.has('naming') && (p.coherence ?? 0) < def.min) {
          send(ws, {
            t: 'denied',
            why: `That declaration needs ${def.min} coherence (you have ${Math.floor(p.coherence ?? 0)}), or the Seed of Naming.`,
          });
          return;
        }

        // Only some declarations are spoken AT something.
        let target = null;
        if (def.needsMoloch) {
          let bd = Infinity;
          for (const [, mm] of molochs) {
            const d = Math.hypot(mm.x - p.x, mm.z - p.z);
            if (d < bd) { bd = d; target = mm; }
          }
          if (!target || bd > 120) {
            send(ws, { t: 'denied', why: 'That one is spoken at a Moloch, and none is within 120m.' });
            return;
          }
        }

        const uid = `h${nextUid++}`;
        // A gorged Moloch takes more of us to unmake.
        const required = def.needsMoloch && target
          ? Math.max(def.quorum, Math.min(9, def.quorum + Math.floor(target.gorge / 60)))
          : def.quorum;
        const h = {
          uid,
          kind,
          claim: String(m.claim ?? '').slice(0, 200),
          x: Math.round(target ? target.x : p.x),
          y: Math.round(target ? target.y + 22 : p.y + 14),
          z: Math.round(target ? target.z : p.z),
          invigoration: 0,
          required,
          contributors: new Set(),
          authorId: id,
          targetUid: target ? target.uid : null,
          remaining: def.ttl,
        };
        hypers.set(uid, h);
        broadcast({ t: 'hyperOpen', hyper: hyperWire(h) });
        pushChat(p.name,
          `${p.name} declares: "${h.claim}" — ${required} of us must act as if it were already true.`,
          'omen');
        break;
      }

      // ---- Align a spell with a hyperobject to invigorate it.
      case 'align': {
        const p = players.get(id);
        const h = hypers.get(m.uid);
        if (!p || !h) return;
        if (h.contributors.has(id)) {
          send(ws, { t: 'denied', why: 'You have already aligned with that Hyperobject.' });
          return;
        }
        const d = Math.hypot(h.x - p.x, h.z - p.z);
        if (d > 60) {
          send(ws, { t: 'denied', why: `Too far to align (${Math.round(d)}m, need 60m).` });
          return;
        }
        h.contributors.add(id);
        // Council raptors standing with you align too. Without this a solo
        // player could declare a Hyperstition and then watch it lapse with no
        // way on earth to invigorate it — which is exactly what happened.
        const assist = Math.max(0, Math.min(4, Number(m.assist) || 0));
        for (let i = 0; i < assist; i++) h.contributors.add(`flock:${id}:${i}`);
        h.invigoration += (p.seeds.has('voice') ? 2 : 1) + assist;
        broadcast({ t: 'hyperAlign', uid: h.uid, by: id, name: p.name,
                    invigoration: h.invigoration, required: h.required,
                    contributors: [...h.contributors] });
        pushChat(p.name, `${p.name} aligns with "${h.claim}" (${h.invigoration}/${h.required}).`, 'omen');
        break;
      }

      case 'block': {
        edits.set(`${m.x},${m.y},${m.z}`, m.id);
        broadcast({ t: 'block', x: m.x, y: m.y, z: m.z, id: m.id }, id);
        break;
      }

      case 'extract':
        world.molochPressure = Math.min(1, world.molochPressure + 0.012 * (m.n ?? 1));
        broadcast({ t: 'moloch', pressure: world.molochPressure });
        break;

      case 'plant':
        world.molochPressure = Math.max(0, world.molochPressure - 0.004 * (m.n ?? 1));
        broadcast({ t: 'moloch', pressure: world.molochPressure });
        break;

      case 'beam': {
        const p = players.get(id);
        if (!p) return;
        // A beam heartbeat. Clients resend while held; silence means released.
        for (const [, mm] of molochs) mm.beams.delete(id);
        if (m.on && m.uid) {
          const target = molochs.get(m.uid);
          if (target && Math.hypot(target.x - p.x, target.z - p.z) < 46) {
            target.beams.set(id, Date.now());
            // Council raptors the authority client sees lending streams. A solo
            // player can still take a Moloch — but only by first earning enough
            // trust that the flock will stand with them, which is the same
            // requirement wearing different clothes.
            target.assist = Math.max(0, Math.min(4, Number(m.assist) || 0));
            target.assistAt = Date.now();
          }
        }
        break;
      }

      case 'attack': {
        // Direct force does nothing, on purpose. Say so out loud.
        send(ws, { t: 'denied', why: 'Moloch does not answer to force. He is a shape a group of raptors makes when none of them can trust the others.' });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!id) return;
    const p = players.get(id);
    // Dropping out releases your stream immediately.
    for (const [, mm] of molochs) mm.beams.delete(id);
    players.delete(id);
    broadcast({ t: 'leave', id });
    if (p) console.log(`- ${p.name} (${id}) — ${players.size} online`);
  });
});

// ---------------------------------------------------------------- tick

const HZ = 10;
setInterval(() => {
  const dt = 1 / HZ;

  for (const [uid, s] of seals) {
    s.remaining -= dt;
    if (s.remaining <= 0) { seals.delete(uid); broadcast({ t: 'sealLapse', uid }); }
  }

  tickMolochs(dt);
  tickHypers(dt);

  // Moloch creeps whether anyone is playing or not. Doing nothing is not neutral.
  world.molochPressure = Math.min(1, world.molochPressure + dt * 0.0004);

  // Keep TWO walking at all times. After the first couple were taken there was
  // often nothing to fight for minutes, which reads as the game being over.
  if (molochs.size < 2 && players.size > 0) {
    world.emptyFor = (world.emptyFor ?? 0) + dt;
    if (world.emptyFor > (molochs.size === 0 ? 6 : 14)) {
      world.emptyFor = 0;
      const list = [...players.values()];
      const p = list[Math.floor(Math.random() * list.length)];
      spawnMoloch(p.x, p.z);
    }
  } else {
    world.emptyFor = 0;
  }

  // Beyond that, spawning is pressure-driven.
  if (molochs.size < 3 && players.size > 0 && Math.random() < dt * 0.12 * (0.3 + world.molochPressure)) {
    const list = [...players.values()];
    const p = list[Math.floor(Math.random() * list.length)];
    spawnMoloch(p.x, p.z);
  }

  broadcast({
    t: 'tick',
    molochs: [...molochs.values()].map(molochWire),
    hypers: [...hypers.values()].map(hyperWire),
    pressure: world.molochPressure,
    authority: authorityId(),
  });
}, 1000 / HZ);

/** Every non-internal IPv4 address this machine answers on. */
function lanAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
    }
  }
  return out;
}

const lan = lanAddresses();
console.log('');
console.log('  Philosoraptors relay is up.');
console.log(`  seed ${SEED}   ws://localhost:${PORT}`);
console.log('');
if (lan.length) {
  console.log('  SHARE THIS with anyone on your network — they just click it:');
  for (const { name, address } of lan) {
    console.log(`      http://${address}:5173      (${name})`);
  }
  console.log('');
  console.log('  They need the game server running too:  npm run dev');
  console.log('  The page connects back to this relay automatically —');
  console.log('  it uses whatever host they loaded the page from.');
} else {
  console.log('  No LAN address found — you appear to be offline.');
  console.log('  Local play still works at http://localhost:5173');
}
console.log('');
console.log(`Golden Seeds hidden at:`);
for (const g of goldenSeeds) console.log(`  ${g.name.padEnd(18)} (${g.x}, ${g.z})`);
