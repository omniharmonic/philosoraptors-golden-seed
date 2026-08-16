import * as THREE from 'three';
import { buildAtlas } from './art/atlas';
import { Sky } from './art/sky';
import { World } from './world/World';
import { CY } from './world/Chunk';
import {
  AIR, AMBER_SEED, ASH, CAMPFIRE, CROP_RIPE, CROP_YOUNG, DIRT,
  DOORWAY, GREEN_LANTERN, GREEN_SHOOT, LANTERN, LIGHT_WEAVE, OBELISK,
  OBELISK_GLYPH, PLANK, ROOT_LINE, SEED_PLANTED, SOIL_LIVING, SOIL_RAKED,
  STRING_LIGHT, TERRACE_STONE, WATER, blockDef, blockName, isSolid,
  isUnbreakable, PRAIRIE_GRASS, GRASS_WARM, LAVENDER, WOVEN_MAT, SCORCHED_SOIL,
} from './world/blocks';
import { BIOME_NAMES, biomeAt, PLAINS_Y, surfaceY, frontLine } from './world/worldgen';
import { LANDMARKS, nearestLandmark } from './world/landmarks';
import { Player, type InputState } from './player/Player';
import { raycastVoxel } from './player/raycast';
import { Coherence } from './systems/coherence';
import { Moloch } from './systems/moloch';
import {
  DECLARATIONS, DECL_ORDER, canDeclare, declOf, refusal, type DeclKind,
} from './systems/declarations';
import { Chapters, CHAPTERS } from './systems/chapters';
import { Flock } from './entities/Flock';
import { Net } from './net/Net';
import { HUD } from './ui/HUD';
import { Chat } from './ui/Chat';
import { Title } from './ui/Title';
import { MiniMap } from './ui/MiniMap';
import { RightPanel } from './ui/RightPanel';
import { Menu, loadOptions, type GameOptions } from './ui/Menu';
import { MolochManager } from './entities/MolochManager';
import { HyperObject } from './entities/HyperObject';
import { HyperState, canAlign, distanceOk, stillNeeded } from './systems/hyperstition';
import { Powers, nextSeedToHunt, describeAdvice } from './systems/goldenseeds';
import { Spark } from './systems/spark';
import { Motif } from './systems/motif';
import { Beam, type BeamMode } from './entities/Beam';
import { SeedField } from './entities/SeedNode';
import { RULES, TETHER_TO_HOLD, type Uid, type WireHyper } from './net/protocol';
import { SKY_COLD, SKY_WARM, FOG_COLD, FOG_WARM, hexToRgb, mixRgb, rgbToHex } from './art/palette';

// ---------------------------------------------------------------- boot

/**
 * The world seed.
 *
 * Terrain is generated identically on every client from this number, which is
 * why the relay never sends any of it. `?seed=` lets a world be created with a
 * chosen landscape; the authority adopts whatever the first arrival brings and
 * tells later arrivals the real one.
 */
const DEFAULT_SEED = 20260816;
const SEED = (() => {
  const q = new URLSearchParams(location.search).get('seed');
  const n = q ? Number(q) : NaN;
  return Number.isFinite(n) && n > 0 ? n >>> 0 : DEFAULT_SEED;
})();
const atlas = buildAtlas();

/**
 * Renderer selection.
 *
 * WebGPU where the browser has it, WebGL2 everywhere else. Nothing in the
 * render path is backend-specific any more — the sky was the only hand-written
 * GLSL and it is now plain vertex colours — so the same scene graph drives
 * both. `?webgl` forces the fallback for comparison.
 */
async function createRenderer(): Promise<{ renderer: THREE.WebGLRenderer; backend: string }> {
  const forceWebGL = new URLSearchParams(location.search).has('webgl');
  if (!forceWebGL && 'gpu' in navigator) {
    try {
      const mod = await import('three/webgpu');
      const r = new mod.WebGPURenderer({ antialias: false });
      await r.init();
      return { renderer: r as unknown as THREE.WebGLRenderer, backend: 'WebGPU' };
    } catch (e) {
      console.info('[philosoraptors] WebGPU unavailable, using WebGL2:', e);
    }
  }
  return {
    renderer: new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' }),
    backend: 'WebGL2',
  };
}

const { renderer, backend } = await createRenderer();
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x1f3241);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x1f3241, 40, 260);
const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.1, 1200);

// Entities are lit; the voxel world carries its own baked vertex light.
scene.add(new THREE.HemisphereLight(0xcfe4f5, 0x4a3a28, 1.5));
const sun = new THREE.DirectionalLight(0xffe0b0, 1.35);
sun.position.set(-60, 90, 30);
scene.add(sun);

const sky = new Sky(700);
scene.add(sky.group);

// ---------------------------------------------------------------- systems

const world = new World(SEED, atlas);
scene.add(world.group);

const coherence = new Coherence();
const moloch = new Moloch();
const chapters = new Chapters();
const powers = new Powers();
const spark = new Spark();
const motif = new Motif();
const beam = new Beam();
scene.add(beam.group);
const flock = new Flock();
scene.add(flock.group);

const hud = new HUD();

/** uid -> live visual. The state mirror is authoritative; these just draw it. */
const hyperVisuals = new Map<Uid, HyperObject>();

const hyperState = new HyperState({
  onOpen: (h) => {
    const vis = new HyperObject(h);
    vis.setSightBonus(powers.hasSight());
    scene.add(vis.root);
    hyperVisuals.set(h.uid, vis);
    hud.showBanner('A Hyperstition', 'declared, not yet true', h.claim, 6500);
    motif.play('question');
    hud.log(`Hyperobject formed. ${stillNeeded(h)} raptors must act as if it were already true.`);
  },
  onAlign: (h, _by, name) => hud.log(`${name} aligned — ${h.invigoration}/${h.required}`),
  onReal: (h) => {
    hyperVisuals.get(h.uid)?.becomeReal();
    hud.showBanner('It Became True', `${h.contributors.length} sigils`, h.claim, 8000);
    motif.play('harmony');
    spark.refill();
    coherence.gain(20, 'a hyperstition became real', (t) => hud.log(t));
  },
  onFade: (h) => {
    hyperVisuals.get(h.uid)?.dispose();
    hyperVisuals.delete(h.uid);
    hud.log(`"${h.claim}" faded. Not enough of us acted as if it were true.`);
  },
});

const molochs = new MolochManager({
  onBlockChange: (x, y, z, id) => net.setBlock(x, y, z, id),
  isAuthority: true,
});
scene.add(molochs.group);

const seedField = new SeedField();
scene.add(seedField.group);


const chat = new Chat({
  bindKeys: false,
  isAgent: (from) => [...net.peers.values()].some((p) => p.sigil.name === from && p.agent),
  sigilFor: (from) => {
    for (const p of net.peers.values()) if (p.sigil.name === from) return p.sigil;
    return net.sigil;
  },
  onSend: (text) => {
    // `/declare <claim>` speaks a Hyperstition instead of chatting. Declaring a
    // future is a speech act here, so it belongs in the same box as speech.
    const m = /^\/declare\s+(.+)$/i.exec(text.trim());
    if (m) { net.declare(DECL_ORDER[declIndex], m[1]); return; }
    net.say(text);
  },
  onRequestPointerLock: () => {
    if (started) renderer.domElement.requestPointerLock();
  },
});
chat.mount();

/**
 * The bottom-right corner holds the map by default and the chat on a tab, with
 * a chevron to collapse both. Previously chat owned the corner outright and the
 * event feed could not be minimised.
 */
const minimap = new MiniMap(SEED);
minimap.mount();
const rightPanel = new RightPanel({
  map: { root: minimap.element, onShow: () => minimap.show(), onHide: () => minimap.hide() },
  chat: { root: chat.root },
});
rightPanel.showMap();

const net = new Net({
  onStatus: (t) => hud.log(t),
  onWelcome: (w) => {
    // The world already had a seed and it is not ours: our terrain is wrong and
    // nothing can fix that in place, because chunks are already generated and
    // meshed. Reload onto the correct landscape rather than let two players
    // stand in visibly different worlds.
    if (w.seed && w.seed !== SEED) {
      const u = new URL(location.href);
      u.searchParams.set('seed', String(w.seed));
      location.replace(u.toString());
      return;
    }
    moloch.pressure = w.molochPressure;
    molochs.isAuthority = w.authority;
    molochs.sync(w.molochs);
    hyperState.syncAll(w.hypers);
    seedField.sync(w.goldenSeeds, (x, z) => surfaceY(x, z, SEED));
    chat.pushAll(w.chat);
    powers.sync(net.mySeeds);
    for (const [k, id] of w.edits) {
      const [x, y, z] = k.split(',').map(Number);
      world.setBlock(x, y, z, id);
    }
  },
  onChat: (msg) => {
    chat.push(msg);
    if (msg.kind === 'say') motif.chirp();
    rightPanel.markUnread();
  },

  onMolochSpawn: (m) => {
    molochs.upsert(m);
    hud.showBanner('Moloch', 'something horned is walking', RULES.molochImmuneToForce, 7000);
  },
  onMolochBound: (uid) => {
    molochs.bind(uid, 1);
    hud.log('The Hyperobject binds him. He is being unmade.');
    motif.play('harmony');
  },
  onMolochHeld: (_uid, tether, held, beamers, capped, need) => {
    if (capped && need > 0 && Math.random() < 0.02) {
      hud.log(`The hold is capped at ${Math.round(held * 100)}% — ${need} more stream${need > 1 ? 's' : ''} needed. Time will not substitute.`);
    }
    if (tether >= TETHER_TO_HOLD && held < 0.25) {
      hud.showBanner('Held', `${tether} streams`, beamers.join(' · '), 3000);
      motif.play('traded');
    }
  },
  onMolochTaken: (uid, beamers, total, assist) => {
    molochs.bind(uid, 1);
    spark.refill();
    const others = Math.max(0, total - 1);
    const who = assist > 0 && beamers.length <= 1
      ? `${assist} of the flock stood in it with you`
      : `you held him together with ${others} other${others === 1 ? '' : 's'}`;
    coherence.gain(22, who, (t) => hud.log(t));
    hud.showBanner('Taken', `${total} stream${total === 1 ? '' : 's'} at once`,
      'Nobody did that alone. That was the whole trick.', 6000);
    motif.play('alive');
  },
  onMolochGone: (uid) => molochs.remove(uid),

  onHyperOpen: (h) => hyperState.open(h),
  onHyperAlign: (uid, by, name, inv, req, contribs) =>
    hyperState.align(uid, by, name, inv, req, contribs),
  onHyperReal: (uid, kind, claim, x, y, z, contribs) => {
    hyperState.real(uid, claim, contribs);
    applyEffect(kind, x, y, z);
    coherence.gain(declOf(kind).reward, `"${claim}" became true`, (t) => hud.log(t));
    spark.refill();
    motif.play('harmony');
    if (chapters.onDeclarationReal(kind)) advanceChapter();
  },
  onHyperFade: (uid) => hyperState.fade(uid),

  onSeedClaimed: (_uid, key, _by, name, mine) => {
    if (mine) {
      powers.claim(key);
      applyPowers();
      hud.showBanner('A Golden Seed', 'power gathered', `You carry the ${key} seed now.`, 6000);
      motif.play('alive');
      spark.refill();
    } else {
      hud.log(`${name} claimed a Golden Seed.`);
    }
  },

  onBlock: (x, y, z, id) => world.setBlock(x, y, z, id),
  onMoloch: (p) => { moloch.pressure = p; },
  onDrain: (amount) => {
    // Seed of Mirror: his drain reflects back onto him instead of onto you.
    if (powers.reflectsDrain()) return;
    coherence.lose(amount, 'Moloch takes what is held in common');
    coherence.addBlindSpot(amount * 0.01);
  },
  onDenied: (why) => hud.showBanner('No', 'the valley refuses', why, 6500),
  onTick: (m, h, pressure, authority) => {
    molochs.sync(m);
    hyperState.syncAll(h);
    moloch.pressure = pressure;
    if (authority !== null) molochs.isAuthority = authority === net.id;
  },
});
scene.add(net.group);

function applyPowers(): void {
  // The Seed of Flight lowers the bar rather than granting flight outright:
  // coherence is still what carries you.
  coherence.flightBonus = -powers.flightThresholdShift();
  for (const v of hyperVisuals.values()) v.setSightBonus(powers.hasSight());
}

// ---------------------------------------------------------------- player

// Spawn on the bench below the Third Flatiron, looking west at the range front.
// Derived from frontLine() rather than hardcoded: the front wobbles +-75 blocks
// with z, so a fixed x can land you inside the mountains or a mile out on the
// prairie depending on the seed.
const SPAWN_Z = 58;
const spawn = new THREE.Vector3(Math.round(frontLine(SPAWN_Z, SEED)) + 58, 0, SPAWN_Z);
const player = new Player(spawn.x, PLAINS_Y + 8, spawn.z);
player.yaw = Math.PI / 2; // face west, toward the range front

const input: InputState = {
  forward: false, back: false, left: false, right: false,
  jump: false, sprint: false, crouch: false,
};

const counts: Record<number, number> = { [AMBER_SEED]: 4, [SEED_PLANTED]: 0 };

/**
 * The hotbar holds TOOLS as well as blocks.
 *
 * Number keys used to fire spells, which meant there was no way to change the
 * held material at all — the single most confusing thing in the game. Spells
 * moved to Z/C; 1-9 is now an ordinary Minecraft hotbar, with the two verbs
 * that matter sitting in slots 1 and 2.
 */
export type HotSlot =
  | { kind: 'claws'; name: string }
  | { kind: 'stream'; name: string }
  | { kind: 'block'; name: string; id: number };

const HOTBAR: HotSlot[] = [
  { kind: 'claws', name: 'Claws' },
  { kind: 'stream', name: 'Stream' },
  { kind: 'block', name: 'Amber Seed', id: AMBER_SEED },
  { kind: 'block', name: 'Living Soil', id: SOIL_LIVING },
  { kind: 'block', name: 'Terrace Stone', id: TERRACE_STONE },
  { kind: 'block', name: 'Plank', id: PLANK },
  { kind: 'block', name: 'Lantern', id: LANTERN },
  { kind: 'block', name: 'String Light', id: STRING_LIGHT },
  { kind: 'block', name: 'Woven Mat', id: WOVEN_MAT },
];
let hotbarIndex = 0;
const slot = () => HOTBAR[hotbarIndex];
const heldBlock = (): number | null => {
  const sl = slot();
  return sl.kind === 'block' ? sl.id : null;
};

let declIndex = 0;
/** Held mouse button / agent intent: the stream is on. */
let beaming = false;
let beamTarget: Uid | null = null;
let beamAssist = 0;
/**
 * Sticky beam target.
 *
 * The tether is paid for by several raptors at once, so dropping it because the
 * aim cone missed for a single frame is expensive and reads as the flock
 * "flashing in and out". Once locked onto a Moloch we hold him for a moment
 * even through brief misses, as long as the stream is still running.
 */
let beamLockUid: string | null = null;
let beamLockT = 0;
const BEAM_LOCK_HOLD = 0.7;
let beamHint = '';


// ---------------------------------------------------------------- spell effects


/** What the world does when a declaration becomes true. */
function applyEffect(kind: DeclKind, x: number, y: number, z: number): void {
  const base = DECLARATIONS[kind].radius;

  switch (kind) {
    case 'green': {
      const R = Math.round(base * powers.rootRadiusScale());
      let healed = 0;
      const always = powers.has('root');
      for (let dz = -R; dz <= R; dz++) {
        for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dz * dz > R * R) continue;
          for (let dy = -4; dy <= 4; dy++) {
            const b = world.getBlock(x + dx, y + dy, z + dz);
            if (b === SOIL_RAKED || b === ASH || b === DIRT) {
              const vein = !always && Math.random() < 0.22;
              world.setBlock(x + dx, y + dy, z + dz, vein ? ROOT_LINE : SOIL_LIVING);
              if (world.getBlock(x + dx, y + dy + 1, z + dz) === AIR && Math.random() < 0.35) {
                world.setBlock(x + dx, y + dy + 1, z + dz, Math.random() < 0.5 ? GREEN_SHOOT : CROP_YOUNG);
              }
              healed++;
            }
          }
        }
      }
      world.addTend(x, z, 14);
      hud.log(`The web spreads — ${healed} blocks of dead ground came back.`);
      break;
    }

    case 'catch': {
      const R = Math.round(base * powers.weaveRadiusScale());
      let laid = 0;
      for (let dz = -R; dz <= R; dz++) {
        for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dz * dz > R * R) continue;
          if (world.getBlock(x + dx, y, z + dz) !== AIR) continue;
          let isVoid = true;
          for (let dy = -1; dy >= -6; dy--) {
            if (isSolid(world.getBlock(x + dx, y + dy, z + dz))) { isVoid = false; break; }
          }
          if (!isVoid) continue;
          world.setBlock(x + dx, y, z + dz, LIGHT_WEAVE);
          laid++;
        }
      }
      hud.log(laid ? `The weave spans the gap — ${laid} threads holding.` : 'The weave found no gap to catch.');
      break;
    }

    case 'preen': {
      coherence.clearBlindSpot();
      hud.log('Preened. You can see your own back now, because someone else looked.');
      const h = flock.hatchling;
      if (h.hatched) {
        h.preen();
        hud.log(`The hatchling's feathers fill in (${Math.round(h.plumage * 100)}%).`);
      } else {
        const hall = LANDMARKS.find((l) => l.id === 'hall')!;
        if (Math.hypot(player.pos.x - hall.x, player.pos.z - hall.z) < 40) {
          h.hatch(player.pos.x, player.pos.y + 1, player.pos.z);
          hud.showBanner('The New Mind', 'it steps out of the egg',
            'I cannot see my own back — will you preen me?', 7000);
          if (chapters.chapter.custom === 'hatch') advanceChapter();
        }
      }
      break;
    }

    case 'honest': {
      chapters.onTally();
      let lies = 0;
      for (let dz = -base; dz <= base; dz++)
        for (let dy = -6; dy <= 6; dy++)
          for (let dx = -base; dx <= base; dx++)
            if (world.getBlock(x + dx, y + dy, z + dz) === GREEN_LANTERN) {
              world.setBlock(x + dx, y + dy, z + dz, LANTERN);
              lies++;
            }
      hud.log(lies
        ? `${lies} green lantern${lies > 1 ? 's' : ''} re-checked. The light said yes and the egg was hollow.`
        : 'Tallied. Nothing nearby was claiming more than it could hold.');
      break;
    }

    case 'admit':
      flock.bellyRing(player.pos, 16);
      coherence.addBlindSpot(-0.4);
      hud.log('The circle folds down together, bellies to the sky.');
      break;

    case 'door': {
      let opened = 0;
      for (let dz = -base; dz <= base; dz++)
        for (let dy = -2; dy <= 26; dy++)
          for (let dx = -base; dx <= base; dx++) {
            const b = world.getBlock(x + dx, y + dy, z + dz);
            if (b === OBELISK_GLYPH ||
                (b === OBELISK && dy > 2 && dy < 9 && Math.abs(dx) < 2 && Math.abs(dz) < 3)) {
              world.setBlock(x + dx, y + dy, z + dz, DOORWAY);
              opened++;
            }
          }
      hud.showBanner('The Song Becomes a Door', 'five voices',
        'A river of stars flowing uphill through soft darkness.', 7000);
      hud.log(`The obelisk answers. ${opened} blocks of honest blackness became a way through.`);
      break;
    }

    case 'bind': {
      // The binding itself is the server's doing. Here it just leaves a mark:
      // a fire where the flock stood when they made it true.
      if (world.getBlock(x, y, z) === AIR && isSolid(world.getBlock(x, y - 1, z))) {
        world.setBlock(x, y, z, CAMPFIRE);
      }
      hud.log('The claim lands on him. He was already unmade; the world simply caught up.');
      break;
    }

    case 'seed': {
      for (let dz = -base; dz <= base; dz++)
        for (let dx = -base; dx <= base; dx++) {
          if (dx * dx + dz * dz > base * base) continue;
          const gy = world.heightAt(x + dx, z + dz);
          if (gy < 1) continue;
          world.setBlock(x + dx, gy, z + dz, Math.random() < 0.3 ? ROOT_LINE : SOIL_LIVING);
          if (world.getBlock(x + dx, gy + 1, z + dz) === AIR) {
            const r = Math.random();
            world.setBlock(x + dx, gy + 1, z + dz,
              r < 0.35 ? CROP_RIPE : r < 0.55 ? LAVENDER : r < 0.7 ? GREEN_SHOOT : AIR);
          }
        }
      moloch.pressure = Math.max(0, moloch.pressure - 0.6);
      coherence.value = 100;
      hud.showBanner('The Golden Seed', 'the third attractor, planted',
        'We were always going to be birds.', 14000);
      break;
    }
  }
  // No markAllDirty here: every world.setBlock above already queued the chunks
  // it touched, and a global rebuild on top of that is a visible hitch.
}

/**
 * The single most useful sentence at this instant.
 *
 * A playtester pressed H, got nothing, and could not tell what a Beacon, a
 * Sigil or a Mirror Fire were for. The fix is not more tooltips — it is one
 * line, always on screen, that names the next physical action.
 */
function currentObjective(): { main: string; sub: string } {
  const near = molochs.nearest(player.pos);
  const following = flock.followers.length;

  if (near && near.dist < 90) {
    const wire = net.molochs.find((mm) => mm.uid === near.moloch.id);
    const tether = Math.max(0, wire?.tether ?? 0);
    const bearing = compassTo(near.moloch.pos);

    if (beaming && beamTarget) {
      if (tether >= TETHER_TO_HOLD) {
        return { main: 'HOLDING HIM — do not let go', sub: `${tether} streams. Keep the button down.` };
      }
      return {
        main: `${Math.max(1, tether)} of ${TETHER_TO_HOLD} streams — not enough`,
        sub: following
          ? 'Your flock is streaming too. Get them closer, or find more raptors.'
          : 'Holding longer will NOT work. Press V to call the flock.',
      };
    }
    return {
      main: `A Moloch, ${Math.round(near.dist)}m ${bearing}`,
      sub: following
        ? `Hold LEFT MOUSE on him. ${following} of the flock are with you.`
        : 'Press V to call the flock, then hold LEFT MOUSE on him.',
    };
  }

  if (following) {
    return {
      main: `${following} of the flock are following you`,
      sub: 'Find a Moloch and hold LEFT MOUSE on him. V dismisses them.',
    };
  }

  if (coherence.value < 8) {
    return {
      main: 'Hold LEFT MOUSE and sweep the stream over bare ground',
      sub: 'Grey, cracked soil comes back to life. That is how coherence grows.',
    };
  }

  return { main: chapters.chapter.title, sub: chapters.status() };
}

/** Compass word for a world point relative to the player. */
function compassTo(p: THREE.Vector3): string {
  const a = (Math.atan2(p.x - player.pos.x, p.z - player.pos.z) * 180) / Math.PI;
  const deg = (a + 360) % 360;
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
}

function advanceChapter(): void {
  const done = CHAPTERS[Math.max(0, chapters.current - 1)];
  hud.showBanner(done.title, done.subtitle, done.epigraph, 6000);
  coherence.gain(6, `chapter complete: ${done.title}`, (t) => hud.log(t));
}

// ---------------------------------------------------------------- interaction

const targetHit = () => raycastVoxel(world, player.eye, player.forwardVector(), 7.5);

function breakBlock(): void {
  const hit = targetHit();
  if (!hit) return;
  if (isUnbreakable(hit.id)) { hud.log(`${blockName(hit.id)} does not yield.`); return; }

  const def = blockDef(hit.id);
  world.setBlock(hit.x, hit.y, hit.z, AIR);
  net.setBlock(hit.x, hit.y, hit.z, AIR);

  const drop = def?.drop ?? hit.id;
  counts[drop] = (counts[drop] ?? 0) + 1;

  if (def?.tendDelta) {
    world.addTend(hit.x, hit.z, def.tendDelta);
    if (def.tendDelta < 0) {
      moloch.onExtract(1);
      coherence.extracted++;
      coherence.addBlindSpot(0.02);
      net.reportExtract(1);
      hud.log('You take the seed. Its light flickers and grows weaker.');
    }
  }
}

function placeBlock(): void {
  const hit = targetHit();
  if (!hit) return;
  const id = heldBlock();
  if (id === null) { hud.log('Select a block (3-9) to place.'); return; }
  const have = counts[id];
  if (have !== undefined && have <= 0) { hud.log(`No ${blockName(id)} left.`); return; }

  const px = hit.x + hit.nx;
  const py = hit.y + hit.ny;
  const pz = hit.z + hit.nz;
  if (py < 0 || py >= CY) return;
  const at = world.getBlock(px, py, pz);
  if (at !== AIR && at !== WATER) return;

  const fx = Math.floor(player.pos.x);
  const fz = Math.floor(player.pos.z);
  const fy = Math.floor(player.pos.y);
  if (isSolid(id) && px === fx && pz === fz && (py === fy || py === fy + 1)) return;

  world.setBlock(px, py, pz, id);
  net.setBlock(px, py, pz, id);
  if (have !== undefined) counts[id] = have - 1;

  const def = blockDef(id);
  if (def?.warmth) world.addTend(px, pz, def.warmth);

  if (id === SEED_PLANTED || (id === AMBER_SEED && isPlantable(px, py - 1, pz))) {
    if (id === AMBER_SEED) world.setBlock(px, py, pz, SEED_PLANTED);
    moloch.onPlant(1);
    coherence.planted++;
    coherence.gain(1.5, 'a seed pressed back into the soil');
    net.reportPlant(1);
    if (chapters.onPlant()) advanceChapter();
  }
}

function isPlantable(x: number, y: number, z: number): boolean {
  const b = world.getBlock(x, y, z);
  return b === SOIL_LIVING || b === SOIL_RAKED || b === DIRT || b === ASH ||
         b === GRASS_WARM || b === PRAIRIE_GRASS || b === ROOT_LINE;
}



/**
 * Declare a future that is not true yet.
 *
 * This is now the ONLY commitment verb. Seals used to be a parallel system with
 * the same shape (open one, others mark it, it fires at quorum) occupying eight
 * number keys; they are gone, and everything they did is a declaration kind.
 */
function declareNow(): void {
  const d = declOf(DECL_ORDER[declIndex]);
  if (!canDeclare(d, coherence.value, powers.list())) {
    const advice = nextSeedToHunt(powers);
    hud.showBanner('Not yet', `needs ${d.minCoherence} coherence`,
      refusal(d, coherence.value) + (advice ? ' ' + describeAdvice(advice) : ''), 6500);
    return;
  }
  if (d.needsMoloch) {
    const m = molochs.nearest(player.pos);
    if (!m || m.dist > 120) {
      hud.showBanner('Nothing to declare it at', 'no Moloch within 120m',
        `"${d.name}" is spoken at a Moloch. The line at the top of the screen will point you at one.`, 5000);
      return;
    }
  }
  net.declare(d.kind, d.claim);
  hud.log(`You declare it: "${d.claim}"`);
}

/** Cycle which declaration H will speak. */
function cycleDeclaration(dir = 1): void {
  declIndex = (declIndex + dir + DECL_ORDER.length) % DECL_ORDER.length;
  const d = declOf(DECL_ORDER[declIndex]);
  const ok = canDeclare(d, coherence.value, powers.list());
  hud.log(
    `${d.name} — ${d.plain} · ${d.quorum} must align` +
    (ok ? ' · press H' : ` · needs ${d.minCoherence} coherence`),
  );
}

function alignNearest(): void {
  const candidates = hyperState.alignableBy(net.id, player.pos);
  const target: WireHyper | undefined = candidates[0];
  if (!target) {
    const any = hyperState.nearest(player.pos);
    if (!any) hud.log('No Hyperobject exists yet. Someone must declare one first.');
    else if (!canAlign(any, net.id)) hud.log(RULES.alignOncePerRaptor);
    else if (!distanceOk(any, player.pos)) hud.log('Too far to align. Get within 60m.');
    return;
  }
  // Everyone following you who trusts you aligns as well.
  const here = new THREE.Vector3(target.x, target.y, target.z);
  const withYou = flock.followers.filter(
    (r) => coherence.value >= r.trustNeeded && r.pos.distanceTo(player.pos) < 40,
  ).length;
  net.align(target.uid, withYou);
  coherence.gain(4, 'you acted as if it were already true');
  hud.showBanner(
    'Aligned',
    withYou ? `you + ${withYou} of the flock` : 'you alone, so far',
    withYou
      ? 'They act as though it were already true, because you do.'
      : 'Call the flock with V and align again — a claim needs more than one believer.',
    4500,
  );
  // Point their streams at it so the alignment is visible.
  flock.assistAt(here, coherence.value);
  setTimeout(() => flock.assistAt(null, coherence.value), 2200);
}

function checkReflection(): void {
  if (chapters.reflected || chapters.chapter.custom !== 'reflect' || !input.crouch) return;
  let water = 0;
  const px = Math.floor(player.pos.x), py = Math.floor(player.pos.y), pz = Math.floor(player.pos.z);
  for (let dz = -3; dz <= 3; dz++)
    for (let dx = -3; dx <= 3; dx++)
      for (let dy = -3; dy <= 1; dy++)
        if (world.getBlock(px + dx, py + dy, pz + dz) === WATER) water++;
  if (water < 8) return;
  coherence.gain(12, 'a single golden feather unfurls at the chest', (t) => hud.log(t));
  motif.play('answer');
  if (chapters.onReflect()) advanceChapter();
}

/**
 * The stream.
 *
 * Aim decides what it does, and none of the outcomes are damage:
 *   at a Moloch  -> tether him (the arcade form of quorum)
 *   at the ground-> put life back into it, following the cursor
 *   at a raptor  -> preen them, which is the one thing nobody can do alone
 */
function updateBeam(dt: number): void {
  // The stream only flows when the Stream tool is selected. Holding claws and
  // getting a beam anyway was one of the things that made the verbs unreadable.
  if (!beaming || slot().kind !== 'stream' || !spark.available) {
    if (beam.active) { beam.stop(); motif.beamOff(); }
    flock.assistAt(null, coherence.value);
    beamLockUid = null;
    beamLockT = 0;
    if (beaming && !spark.available) beamHint = 'Spark spent — it refills in a moment.';
    if (net.connected) net.beam(dt, null, false);
    beamTarget = null;
    return;
  }
  if (!spark.beam(dt)) return;
  if (!beam.active) motif.beamOn();

  const eye = player.eye;
  const dir = player.forwardVector();
  const REACH = 42;

  // 1. A Moloch takes priority: he is the thing you most want to point at.
  //
  // The cone is ANGULAR, not a fixed radius. A fixed 3.4-block perpendicular
  // tolerance is ~5 degrees at 40m, which is a sniper shot; this stays a
  // constant, forgiving angle at every range, plus his actual body width.
  const CONE = 0.20;                    // tan of the half-angle, ~11 degrees
  const pickMoloch = (slack: number) => {
    let best: { uid: string; point: THREE.Vector3; dist: number } | null = null;
    for (const e of molochs.list()) {
      const point = new THREE.Vector3(e.pos.x, e.pos.y + 2.2, e.pos.z);
      const to = point.clone().sub(eye);
      const along = to.dot(dir);
      if (along < 0 || along > REACH) continue;
      const perp = to.addScaledVector(dir, -along).length();
      const body = 1.6 + e.gorge * 0.02;
      if (perp > body + along * CONE * slack) continue;
      if (!best || along < best.dist) best = { uid: e.id, point, dist: along };
    }
    return best;
  };

  let hitMoloch = pickMoloch(1);

  // Stickiness: if we lost the aim but were on him a moment ago, stay on him.
  if (hitMoloch) {
    beamLockUid = hitMoloch.uid;
    beamLockT = BEAM_LOCK_HOLD;
  } else if (beamLockUid && beamLockT > 0) {
    beamLockT -= dt;
    // A wider recapture cone while the lock is warm, so small drift is free.
    const relaxed = pickMoloch(2.2);
    const held = molochs.get(beamLockUid);
    if (relaxed && relaxed.uid === beamLockUid) hitMoloch = relaxed;
    else if (held && held.pos.distanceTo(eye) < REACH) {
      hitMoloch = {
        uid: beamLockUid,
        point: new THREE.Vector3(held.pos.x, held.pos.y + 2.2, held.pos.z),
        dist: held.pos.distanceTo(eye),
      };
    } else {
      beamLockUid = null;
    }
  } else {
    beamLockUid = null;
  }

  // 2. Otherwise a flock raptor, to preen them.
  let hitRaptor: THREE.Vector3 | null = null;
  if (!hitMoloch) {
    for (const r of flock.near(player.pos, REACH)) {
      const to = new THREE.Vector3(r.pos.x, r.pos.y + 1.1, r.pos.z).sub(eye);
      const along = to.dot(dir);
      if (along < 0 || along > REACH) continue;
      if (to.clone().addScaledVector(dir, -along).length() > 2.2) continue;
      hitRaptor = new THREE.Vector3(r.pos.x, r.pos.y + 1.1, r.pos.z);
      break;
    }
  }

  const claw = eye.clone().addScaledVector(dir, 0.9).add(new THREE.Vector3(0, -0.35, 0));
  let mode: BeamMode = 'ground';
  let end: THREE.Vector3;
  let power = 0.35;

  if (hitMoloch) {
    mode = 'tether';
    end = hitMoloch.point;
    beamTarget = hitMoloch.uid;
    // Followers throw their own streams at whatever you are streaming at. This
    // is how a solo player finishes: not by holding longer, but by having
    // gathered a flock that will stand in it with them.
    const here = new THREE.Vector3(hitMoloch.point.x, hitMoloch.point.y, hitMoloch.point.z);
    beamAssist = flock.assistAt(here, coherence.value);

    const wire = net.molochs.find((mm) => mm.uid === hitMoloch!.uid);
    const tether = Math.max(1 + beamAssist, wire?.tether ?? 1);
    power = Math.min(1, tether / TETHER_TO_HOLD);
    beamHint = tether >= TETHER_TO_HOLD
      ? 'HELD — do not let go'
      : beamAssist > 0
        ? `${tether}/${TETHER_TO_HOLD} streams (you + ${beamAssist} flock). Not enough yet.`
        : `${tether}/${TETHER_TO_HOLD} streams. Holding longer will not help — you need others.`;
    // Solo tethering still pays a little coherence: showing up counts.
    coherence.gain(dt * 0.6, '');
  } else if (hitRaptor) {
    mode = 'preen';
    end = hitRaptor;
    beamTarget = null;
    beamAssist = 0;
    flock.assistAt(null, coherence.value);
    power = 0.5;
    coherence.clearBlindSpot();
    beamHint = 'Preening. Somebody has to see your back for you.';
    if (Math.random() < 0.03) motif.chirp();
  } else {
    beamTarget = null;
    beamAssist = 0;
    flock.assistAt(null, coherence.value);
    const hit = raycastVoxel(world, eye, dir, REACH, true);
    end = hit
      ? new THREE.Vector3(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5)
      : eye.clone().addScaledVector(dir, REACH);
    if (hit) greenAt(hit.x, hit.y, hit.z, dt);
    beamHint = '';
  }

  beam.update(dt, claw, end, mode, power);
  if (net.connected) net.beam(dt, beamTarget, true, beamAssist);
}

/** Life goes back into whatever the stream lands on. */
let greenBudget = 0;
function greenAt(x: number, y: number, z: number, dt: number): void {
  greenBudget += dt;
  if (greenBudget < 0.14) return;
  greenBudget = 0;

  const R = Math.round(2 * powers.rootRadiusScale());
  let changed = 0;
  for (let dz = -R; dz <= R; dz++) {
    for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dz * dz > R * R) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const b = world.getBlock(x + dx, y + dy, z + dz);
        if (b !== SOIL_RAKED && b !== ASH && b !== DIRT && b !== SCORCHED_SOIL) continue;
        const above = world.getBlock(x + dx, y + dy + 1, z + dz);
        if (above !== AIR) continue;
        world.setBlock(x + dx, y + dy, z + dz, Math.random() < 0.22 ? ROOT_LINE : SOIL_LIVING);
        if (Math.random() < 0.5) {
          world.setBlock(x + dx, y + dy + 1, z + dz, Math.random() < 0.5 ? GREEN_SHOOT : CROP_YOUNG);
        }
        net.setBlock(x + dx, y + dy, z + dz, world.getBlock(x + dx, y + dy, z + dz));
        changed++;
      }
    }
  }
  if (changed) {
    world.addTend(x, z, 1);
    moloch.onPlant(1);
    coherence.gain(0.35, '');
    if (Math.random() < 0.16) motif.blip(520 + Math.random() * 380, 0.13, 0.07);
  }
}

// ---------------------------------------------------------------- input

/**
 * Player options. Applied immediately rather than on a restart, because
 * "change it, see if that helped" is the only way anyone tunes a view distance.
 */
let options: GameOptions = loadOptions();

function applyOptions(o: GameOptions): void {
  options = o;
  motif.setVolume(o.muted ? 0 : o.volume);
  world.setViewRadius(o.viewRadius);
  const perf = document.getElementById('perf');
  if (perf) perf.style.display = o.showFps ? '' : 'none';
  const vig = document.getElementById('vig');
  if (vig) vig.style.display = o.vignette ? '' : 'none';
}

const menu = new Menu(applyOptions, () => {
  // Closing the menu hands the pointer back, after the browser's cooldown.
  // Before the game starts there is nothing to hand it back to.
  if (started) setTimeout(() => renderer.domElement.requestPointerLock(), 120);
});

const gate = document.getElementById('gate')!;
const resumeHint = document.getElementById('resume')!;
let started = false;

function enterWorld(): void {
  gate.classList.add('hidden');
  renderer.domElement.requestPointerLock();
  if (!started) {
    started = true;
    net.connect();
    hud.showBanner('The Scaled Ones', 'before alignment',
      'Hunched far apart on separate rocks, each guarding its own small heap.', 6000);
    motif.start();
    motif.play('question');
  }
}

const title = new Title(menu, enterWorld);
void title;

/**
 * "Pointer lock lost" is NOT the same event as "player paused", and treating
 * them as one is what made chat unusable: opening the composer releases the
 * lock, the re-lock afterwards is refused by the browser's cooldown, and the
 * pause gate slammed over the composer.
 *
 * So the gate only appears when the player is actually idle — lock lost, not
 * composing, and still gone after a grace period long enough for a legitimate
 * release-and-retake.
 */
let unlockGrace = 0;
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === renderer.domElement) {
    gate.classList.add('hidden');
    resumeHint.classList.remove('show');
    return;
  }
  if (!started) return;
  unlockGrace = performance.now();
  setTimeout(() => {
    if (document.pointerLockElement === renderer.domElement) return;
    if (chat.isComposing || menu.isOpen) return;
    // Still unlocked and not typing: offer a click-to-resume rather than the
    // full gate, which is heavy and hides the world.
    resumeHint.classList.add('show');
  }, 700);
});

/**
 * Clicking the WORLD retakes the pointer once the browser will allow it.
 *
 * Capture phase, so it must exclude the HUD itself: a capture listener on
 * window runs before the event reaches a button, so stopPropagation() on a tab
 * strip cannot defeat it, and clicking MAP/CHAT would silently grab pointer
 * lock and hide the cursor.
 */
addEventListener('mousedown', (e) => {
  if (!started || chat.isComposing) return;
  const t = e.target as HTMLElement | null;
  if (t && t.closest('#rightPanel, #chat, #minimap, #hud, #gate, #menu')) return;
  if (document.pointerLockElement !== renderer.domElement &&
      performance.now() - unlockGrace > 300) {
    renderer.domElement.requestPointerLock();
    resumeHint.classList.remove('show');
  }
}, true);

addEventListener('keydown', (e) => {
  if (!started || chat.isComposing) return;
  // Escape and ? both open the in-game menu. The full entry screen is no longer
  // the only place to read the controls, which meant reloading to check a key.
  if (e.code === 'Escape' || e.key === '?') {
    e.preventDefault();
    menu.toggle();
    resumeHint.classList.remove('show');
  }
});

addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  const s = 0.0022 * options.sensitivity;
  player.yaw -= e.movementX * s;
  player.pitch -= (options.invertY ? -e.movementY : e.movementY) * s;
  player.pitch = Math.max(-1.53, Math.min(1.53, player.pitch));
});

/** Left button held: with Claws it mines repeatedly, with Stream it beams. */
let mining = false;
let mineTimer = 0;

addEventListener('mousedown', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  if (e.button === 0) {
    motif.start();
    if (slot().kind === 'stream') beaming = true;
    else { mining = true; mineTimer = 0; breakBlock(); }
  }
  if (e.button === 2) placeBlock();
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) { beaming = false; mining = false; }
});
addEventListener('contextmenu', (e) => e.preventDefault());

function selectSlot(i: number): void {
  hotbarIndex = ((i % HOTBAR.length) + HOTBAR.length) % HOTBAR.length;
  const sl = slot();
  beaming = false;
  mining = false;
  hud.log(
    sl.kind === 'claws' ? 'Claws — hold left mouse to break blocks.'
    : sl.kind === 'stream' ? 'Stream — hold left mouse to heal ground, tether a Moloch, or preen a raptor.'
    : `${sl.name} — right mouse to place.`,
  );
  motif.blip(660, 0.12, 0.05);
}

addEventListener('wheel', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  selectSlot(hotbarIndex + (e.deltaY > 0 ? 1 : -1));
});

addEventListener('keydown', (e) => {
  // Chat gets first refusal: while composing, the game must not see keys at all.
  if (chat.handleKey(e)) return;
  if (chat.isComposing) return;

  switch (e.code) {
    case 'KeyW': input.forward = true; break;
    case 'KeyS': input.back = true; break;
    case 'KeyA': input.left = true; break;
    case 'KeyD': input.right = true; break;
    case 'Space': input.jump = true; e.preventDefault(); break;
    case 'ShiftLeft': case 'ShiftRight': input.sprint = true; break;
    case 'ControlLeft': case 'KeyC': input.crouch = true; break;
    case 'KeyQ': selectSlot(hotbarIndex - 1); break;
    case 'KeyE': selectSlot(hotbarIndex + 1); break;
    case 'KeyF': alignNearest(); break;
    case 'KeyG':
      player.rollBellyUp();
      flock.bellyRing(player.pos, 12);
      coherence.gain(2, 'you showed the soft belly');
      break;
    case 'KeyH': declareNow(); break;
    case 'KeyJ': cycleDeclaration(1); break;
    case 'KeyY': alignNearest(); break;
    case 'KeyT': rightPanel.toggle(); break;
    case 'KeyN': rightPanel.minimise(); break;
    case 'KeyB': minimap.cycleZoom(); break;
    case 'Enter': rightPanel.focusChat(); chat.openComposer(); break;
    case 'KeyV': {
      if (flock.followers.length) {
        const n = flock.dismiss();
        hud.log(`${n} of the flock go back to their work.`);
      } else {
        const { came, refused } = flock.callToFollow(player.pos, coherence.value);
        if (came) {
          hud.showBanner('The flock comes', `${came} with you`,
            'They will throw their own streams at whatever you stream at. Point at a Moloch.', 4200);
          motif.play('traded');
        } else if (refused) {
          hud.showBanner('They hang back', `${refused} nearby, none will come`,
            'They do not trust you yet. Green some dead ground with your stream first — coherence is what they are reading.', 5200);
        } else {
          hud.log('No flock within earshot. They gather at the Council Ring and the landmarks.');
        }
      }
      break;
    }
    case 'KeyM': hud.log(motif.toggleMute() ? 'Sound off.' : 'Sound on.'); break;
    case 'KeyR': player.settle(world); break;
    default: {
      const n = /^Digit([1-9])$/.exec(e.code);
      if (n) selectSlot(Number(n[1]) - 1);
    }
  }
});

addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': input.forward = false; break;
    case 'KeyS': input.back = false; break;
    case 'KeyA': input.left = false; break;
    case 'KeyD': input.right = false; break;
    case 'Space': input.jump = false; break;
    case 'ShiftLeft': case 'ShiftRight': input.sprint = false; break;
    case 'ControlLeft': case 'KeyC': input.crouch = false; break;
  }
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- world prep

for (let dz = -2; dz <= 2; dz++)
  for (let dx = -2; dx <= 2; dx++)
    world.ensureGenerated(Math.floor(spawn.x / 16) + dx, Math.floor(spawn.z / 16) + dz);
player.settle(world);
flock.populate(world);
// Solo play still shows the seeds; the server list arrives later and re-syncs.
seedField.sync(
  net.goldenSeeds.length ? net.goldenSeeds : [],
  (x, z) => surfaceY(x, z, SEED),
);

// ---------------------------------------------------------------- loop

let last = performance.now();
// Start mid-morning rather than at dusk: dayN = (sin(clock*0.018)+1)/2, so
// clock 0 would open the game at half light with the range front in shadow.
let clock = Math.PI / 2 / 0.018;
let hudTimer = 0;
// Smoothed frame rate, so the readout is stable enough to judge.
let fps = 60;

function frame(now: number): void {
  // Dev handle: lets the world be queried directly instead of inferred from
// screenshots. Vite strips this branch from the production bundle.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__philo = {
    world, player, coherence, spark, powers, molochs, hyperState, net, motif, flock, SEED,
    // Drive the stream without pointer lock, so it can be exercised headlessly.
    setBeaming: (on: boolean) => { beaming = on; },
    get beaming() { return beaming; },
    get beamHint() { return beamHint; },
  };
}

applyOptions(options);

requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  clock += dt;
  if (dt > 0) fps += (1 / dt - fps) * 0.06;

  const locked = document.pointerLockElement === renderer.domElement;
  if (locked) { player.update(dt, input, world, coherence, spark); checkReflection(); }

  coherence.update(dt, moloch.pressure);
  moloch.update(dt, world, player.pos.x, player.pos.z);
  flock.update(dt, world, player.pos);
  molochs.update(dt, world, player.pos);
  hyperState.update(dt);
  seedField.update(dt);
  net.update(dt, player.pos.x, player.pos.y, player.pos.z, player.yaw, coherence.value);
  world.update(player.pos.x, player.pos.z, coherence.warmth);

  // Hyperobject visuals track the authoritative mirror.
  for (const h of hyperState.active) {
    const vis = hyperVisuals.get(h.uid);
    if (vis) vis.update(dt, h.invigoration, h.required, h.contributors);
  }
  for (const [uid, vis] of hyperVisuals) {
    if (hyperState.get(uid)) continue;
    vis.update(dt, 0, 1, []);
    if (vis.finished) { vis.dispose(); hyperVisuals.delete(uid); }
  }

  // ---------------------------------------------------------------- the beam
  spark.update(dt);
  updateBeam(dt);

  // Claws mine repeatedly while held, like any block game.
  if (mining && locked) {
    mineTimer -= dt;
    if (mineTimer <= 0) { breakBlock(); mineTimer = 0.22; }
  }

  // --- camera
  const eye = player.eye;
  camera.position.copy(eye);
  camera.rotation.set(0, 0, 0);
  camera.rotateY(player.yaw);
  camera.rotateX(player.pitch);
  if (player.bellyUp) camera.rotateZ(Math.sin(clock * 2) * 0.06 + 1.1);
  sky.follow(eye);

  // --- palette grading
  const localTend = world.tendAt(player.pos.x, player.pos.z);
  const warm = Math.max(0, Math.min(1, coherence.warmth * 0.6 + (localTend + 40) / 80 * 0.4));
  const dayN = (Math.sin(clock * 0.018) + 1) / 2;
  const night = Math.pow(1 - dayN, 1.6);

  const skyTop = mixRgb(hexToRgb(SKY_COLD), hexToRgb(SKY_WARM), warm);
  const fogC = mixRgb(hexToRgb(FOG_COLD), hexToRgb(FOG_WARM), warm);
  const dim = (c: [number, number, number]) =>
    rgbToHex(c.map((v) => v * (0.28 + dayN * 0.72)) as [number, number, number]);
  sky.update(dim(skyTop), dim(fogC), night);

  const fog = scene.fog as THREE.Fog;
  fog.color.setHex(dim(fogC));
  fog.near = 50 - moloch.pressure * 30;
  // Floor the far plane: Moloch is meant to thicken the air, not delete the
  // Flatirons. Below ~170 the range front stops being visible from the bench.
  fog.far = Math.max(170, 300 - moloch.pressure * 130);
  renderer.setClearColor(fog.color);

  sun.intensity = 0.35 + dayN * 1.1;


  // --- HUD at 12 Hz
  hudTimer += dt;
  if (hudTimer > 1 / 12) {
    hudTimer = 0;
    const lm = nearestLandmark(player.pos.x, player.pos.z);
    const near = molochs.nearest(player.pos);
    const threat = near && near.dist < 60
      ? ` · MOLOCH ${Math.round(near.dist)}m`
      : '';
    // The map samples pure terrain functions, so it draws country that is not
    // resident — which is the point, since the world is kilometres across.
    minimap.update({
      x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw,
      molochs: molochs.list().map((m) => ({ x: m.pos.x, z: m.pos.z, label: 'Moloch' })),
      peers: [...net.peers.values()].map((p) => ({ x: p.pos.x, z: p.pos.z, label: p.sigil.name })),
      declarations: hyperState.active.map((h) => ({
        x: h.x, z: h.z, label: DECLARATIONS[h.kind].name,
        progress: h.invigoration / Math.max(1, h.required),
      })),
      seeds: net.goldenSeeds.filter((g) => !g.claimedBy).map((g) => ({ x: g.x, z: g.z, label: g.name })),
    });

    const obj = currentObjective();
    hud.update({
      sigil: net.sigil,
      spark: spark.ratio,
      beamHint,
      objective: obj.main,
      objectiveSub: obj.sub,
      followers: flock.followers.length,
      declIndex,
      hypers: hyperState.active.map((h) => ({
        kind: h.kind,
        claim: h.claim,
        invigoration: h.invigoration,
        required: h.required,
        mine: h.contributors.includes(net.id),
      })),
      backend,
      fps,
      coherence: coherence.value,
      blindSpot: coherence.blindSpot,
      stageName: coherence.stage.name,
      stageDesc: coherence.stage.desc,
      flightName: coherence.flight.name,
      nextUnlock: coherence.nextUnlock(),
      molochPressure: moloch.pressure,
      molochBand: moloch.band,
      chapter: chapters.chapter,
      chapterStatus: chapters.status(),
      chapterIndex: chapters.current,
      chapterTotal: CHAPTERS.length,
      hotbar: HOTBAR,
      hotbarIndex,
      counts,
      peers: net.peerList(player.pos),
      biome: `${BIOME_NAMES[biomeAt(Math.floor(player.pos.x), Math.floor(player.pos.z), SEED)]} · ${lm.lm.name} ${Math.round(lm.dist)}m${threat}`,
      online: net.connected,
    });
  }

  renderer.render(scene, camera);
}

requestAnimationFrame(frame);
