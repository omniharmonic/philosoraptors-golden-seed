import * as THREE from 'three';
import { makeSigil, type Sigil } from '../systems/sigil';
import type { World } from '../world/World';
import { isSolid } from '../world/blocks';

/**
 * Flock raptors.
 *
 * They exist so that a solo player still has to *assemble* a quorum rather than
 * bypass one. An NPC will mark your seal, but only if it is physically present
 * and only if it trusts you — so the coordination problem stays a coordination
 * problem even with nobody else online. You just negotiate with the world
 * instead of with people.
 */

export type Archetype = 'exuberant' | 'thoughtful' | 'careful' | 'elder';

export const ARCHETYPES: Record<Archetype, { label: string; note: string; trust: number }> = {
  exuberant: {
    label: 'Exuberant',
    note: 'Ep3: "one exuberant raptor leaps between terraces planting seeds."',
    // Helps from the very first second. Somebody has to say yes first.
    trust: 0,
  },
  thoughtful: {
    label: 'Thoughtful',
    note: 'Ep3: "gestures grandly while six tiny clockwork songbirds orbit its head."',
    trust: 5,
  },
  careful: {
    label: 'Careful',
    note: 'Ep3: "follows behind with a slab of bark, scratching tallies, re-checking twice."',
    trust: 14,
  },
  elder: {
    label: 'Eldest',
    note: 'Ep4b: the first to roll belly-up and admit a mistake.',
    trust: 26,
  },
};

const HIDE = 0x55604f;

function box(
  w: number, h: number, d: number, colour: number,
  x = 0, y = 0, z = 0,
): THREE.Mesh {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.MeshLambertMaterial({ color: colour });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  return mesh;
}

/** A flat feather fan — used for arm plumage and the throat ruff. */
function fan(w: number, h: number, colour: number): THREE.Mesh {
  const g = new THREE.PlaneGeometry(w, h);
  const m = new THREE.MeshLambertMaterial({
    color: colour,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.96,
  });
  return new THREE.Mesh(g, m);
}

export interface RaptorParts {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  tail: THREE.Group;
  ruff: THREE.Mesh | null;
  birds: THREE.Group | null;
}

/**
 * Build the model.
 *
 * `plumage` 0..1 drives the canon progression directly: at 0 the raptor is
 * "completely BARE gray-green scaled skin — no feathers anywhere", and by 1 it
 * is in "full magnificent plumage" with a knitted shawl.
 */
export function buildRaptor(hue: number, plumage: number, archetype: Archetype): RaptorParts {
  const root = new THREE.Group();
  const feather = new THREE.Color().setHSL(hue / 360, 0.62, 0.55).getHex();
  const hide = new THREE.Color(HIDE).lerp(new THREE.Color(feather), plumage * 0.35).getHex();

  // --- torso, pitched forward like a bird
  const body = new THREE.Group();
  body.position.y = 0.95;
  body.add(box(0.52, 0.5, 0.98, hide));
  root.add(body);

  // --- neck and head
  const head = new THREE.Group();
  head.position.set(0, 0.24, -0.5);
  const neck = box(0.26, 0.3, 0.3, hide, 0, 0.06, 0.06);
  neck.rotation.x = 0.5;
  head.add(neck);
  head.add(box(0.28, 0.26, 0.4, hide, 0, 0.3, -0.16));
  head.add(box(0.16, 0.13, 0.3, hide, 0, 0.25, -0.42));
  // Amber eyes — in every style string without exception.
  for (const sx of [-0.15, 0.15]) {
    const eye = box(0.05, 0.08, 0.08, 0xffb347, sx, 0.34, -0.26);
    head.add(eye);
  }
  // The crest appears with colour.
  if (plumage > 0.5) {
    const crest = fan(0.3, 0.26, feather);
    crest.position.set(0, 0.5, -0.12);
    crest.rotation.y = Math.PI / 2;
    head.add(crest);
  }
  body.add(head);

  // --- throat ruff: the first feathers to arrive (Ep1b, at the chest)
  let ruff: THREE.Mesh | null = null;
  if (plumage > 0.05) {
    ruff = fan(0.42, 0.3 + plumage * 0.28, 0xffc94d);
    ruff.position.set(0, 0.06, -0.5);
    ruff.rotation.x = -0.5;
    body.add(ruff);
  }

  // --- tail, three tapering segments
  const tail = new THREE.Group();
  tail.position.set(0, 0.05, 0.48);
  let seg = tail;
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Group();
    s.position.z = i === 0 ? 0.1 : 0.34;
    s.add(box(0.26 - i * 0.06, 0.24 - i * 0.05, 0.4, hide, 0, 0, 0.18));
    seg.add(s);
    seg = s;
  }
  if (plumage > 0.6) {
    const plume = fan(0.5, 0.44, feather);
    plume.position.z = 0.42;
    plume.rotation.x = Math.PI / 2;
    seg.add(plume);
  }
  body.add(tail);

  // --- legs
  const mkLeg = (side: number) => {
    const g = new THREE.Group();
    g.position.set(side * 0.19, -0.2, 0.06);
    g.add(box(0.17, 0.42, 0.2, hide, 0, -0.2, 0));
    const shin = new THREE.Group();
    shin.position.y = -0.4;
    shin.add(box(0.13, 0.4, 0.16, hide, 0, -0.2, 0));
    shin.add(box(0.16, 0.1, 0.34, hide, 0, -0.4, -0.09));
    g.add(shin);
    return g;
  };
  const legL = mkLeg(-1);
  const legR = mkLeg(1);
  body.add(legL, legR);

  // --- arms, which become wings as plumage fills in
  const mkArm = (side: number) => {
    const g = new THREE.Group();
    g.position.set(side * 0.28, 0.06, -0.24);
    g.add(box(0.12, 0.3, 0.13, hide, 0, -0.14, 0));
    const fore = new THREE.Group();
    fore.position.y = -0.28;
    fore.add(box(0.1, 0.28, 0.11, hide, 0, -0.13, 0.02));
    if (plumage > 0.2) {
      const w = fan(0.24 + plumage * 0.5, 0.5 + plumage * 0.5, feather);
      w.position.set(side * (0.1 + plumage * 0.2), -0.16, 0.06);
      w.rotation.y = side * 0.5;
      fore.add(w);
    }
    g.add(fore);
    return g;
  };
  const armL = mkArm(-1);
  const armR = mkArm(1);
  body.add(armL, armR);

  // --- the thoughtful one's six tiny clockwork songbirds
  let birds: THREE.Group | null = null;
  if (archetype === 'thoughtful') {
    birds = new THREE.Group();
    birds.position.set(0, 1.85, -0.4);
    for (let i = 0; i < 6; i++) {
      const b = box(0.11, 0.09, 0.15, 0xc9a227);
      b.userData.phase = (i / 6) * Math.PI * 2;
      birds.add(b);
    }
    root.add(birds);
  }

  // --- knitted shawl at full plumage
  if (plumage > 0.75) {
    const shawl = box(0.6, 0.26, 0.7, new THREE.Color().setHSL(((hue + 180) % 360) / 360, 0.4, 0.45).getHex(), 0, 0.16, 0.02);
    body.add(shawl);
  }

  return { root, body, head, legL, legR, armL, armR, tail, ruff, birds };
}

export class Raptor {
  readonly id: string;
  readonly sigil: Sigil;
  readonly archetype: Archetype;
  readonly parts: RaptorParts;
  readonly pos = new THREE.Vector3();

  /** Home point; they wander around it and return. */
  readonly home = new THREE.Vector3();

  yaw = 0;
  private phase = Math.random() * 10;
  private target = new THREE.Vector3();
  private restTimer = 0;
  seated = false;
  bellyUp = false;

  /** Set true once it has marked the player's current seal. */
  lastSealMarked: string | null = null;

  /** Called to follow the player. They walk with you until dismissed. */
  following = false;
  /** World point this raptor is currently streaming at, if any. */
  assisting: THREE.Vector3 | null = null;

  constructor(id: string, x: number, y: number, z: number, archetype: Archetype, plumage: number) {
    this.id = id;
    this.sigil = makeSigil(id);
    this.archetype = archetype;
    this.parts = buildRaptor(this.sigil.hue, plumage, archetype);
    this.pos.set(x, y, z);
    this.home.set(x, y, z);
    this.target.copy(this.pos);
    this.parts.root.position.copy(this.pos);
  }

  get trustNeeded(): number {
    return ARCHETYPES[this.archetype].trust;
  }

  /** Will this raptor mark a seal opened by a player with `coherence`? */
  willVouch(coherence: number, distance: number): boolean {
    return distance < 14 && coherence >= this.trustNeeded;
  }

  update(dt: number, world: World, playerPos: THREE.Vector3): void {
    this.phase += dt;

    if (this.bellyUp) {
      this.parts.body.rotation.z = THREE.MathUtils.lerp(this.parts.body.rotation.z, Math.PI * 0.48, 0.1);
      this.parts.body.position.y = THREE.MathUtils.lerp(this.parts.body.position.y, 0.42, 0.1);
      this.animateIdle(dt);
      this.parts.root.position.copy(this.pos);
      return;
    }
    this.parts.body.rotation.z = THREE.MathUtils.lerp(this.parts.body.rotation.z, 0, 0.12);

    const distToPlayer = this.pos.distanceTo(playerPos);

    // Streaming at something: stand, face it, hold position.
    if (this.assisting) {
      this.seated = false;
      this.parts.body.position.y = THREE.MathUtils.lerp(this.parts.body.position.y, 0.95, 0.1);
      this.faceToward(this.assisting, dt);
      // Arms forward, as if throwing the stream.
      this.parts.armL.rotation.x = THREE.MathUtils.lerp(this.parts.armL.rotation.x, -1.3, 0.2);
      this.parts.armR.rotation.x = THREE.MathUtils.lerp(this.parts.armR.rotation.x, -1.3, 0.2);
      // Close the last of the gap so the stream has a plausible length.
      if (this.pos.distanceTo(this.assisting) > 16) {
        const d = new THREE.Vector3().subVectors(this.assisting, this.pos).setY(0).normalize();
        this.pos.addScaledVector(d, 4.2 * dt);
        this.stickToGround(world);
      }
      this.parts.root.position.copy(this.pos);
      this.parts.root.rotation.y = this.yaw;
      return;
    }

    // Following: keep up with the player.
    if (this.following && distToPlayer > 4) {
      this.seated = false;
      const d = new THREE.Vector3().subVectors(playerPos, this.pos).setY(0).normalize();
      this.pos.addScaledVector(d, (distToPlayer > 18 ? 5.2 : 3.4) * dt);
      this.stickToGround(world);
      this.faceToward(playerPos, dt);
      this.animateWalk(dt, 2.6);
      this.parts.root.position.copy(this.pos);
      this.parts.root.rotation.y = this.yaw;
      return;
    }

    // Sit when the player is close and calm — Ep2's circle posture.
    this.seated = distToPlayer < 7 && this.restTimer <= 0;

    if (this.seated) {
      this.parts.body.position.y = THREE.MathUtils.lerp(this.parts.body.position.y, 0.55, 0.08);
      this.faceToward(playerPos, dt);
      this.animateIdle(dt);
    } else {
      this.parts.body.position.y = THREE.MathUtils.lerp(this.parts.body.position.y, 0.95, 0.08);
      this.wander(dt, world);
    }

    // Clockwork songbirds orbit regardless.
    if (this.parts.birds) {
      this.parts.birds.rotation.y = this.phase * 0.8;
      for (const b of this.parts.birds.children) {
        const ph = (b.userData.phase as number) + this.phase * 0.8;
        b.position.set(Math.cos(ph) * 0.6, Math.sin(ph * 2.1) * 0.12, Math.sin(ph) * 0.6);
        b.rotation.y = -ph;
      }
    }

    this.parts.root.position.copy(this.pos);
    this.parts.root.rotation.y = this.yaw;
  }

  private stickToGround(world: World): void {
    const gx = Math.floor(this.pos.x);
    const gz = Math.floor(this.pos.z);
    let gy = Math.floor(this.pos.y) + 3;
    while (gy > 0 && !isSolid(world.getBlock(gx, gy - 1, gz))) gy--;
    this.pos.y = THREE.MathUtils.lerp(this.pos.y, gy, 0.3);
  }

  private faceToward(p: THREE.Vector3, dt: number): void {
    const want = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
    let d = want - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, dt * 4);
  }

  private wander(dt: number, world: World): void {
    this.restTimer -= dt;
    if (this.pos.distanceTo(this.target) < 1.0 || this.restTimer > 0) {
      if (this.restTimer <= -2) {
        const a = Math.random() * Math.PI * 2;
        const r = 3 + Math.random() * 9;
        this.target.set(
          this.home.x + Math.cos(a) * r,
          this.pos.y,
          this.home.z + Math.sin(a) * r,
        );
        this.restTimer = 1 + Math.random() * 3;
      }
      this.animateIdle(dt);
      return;
    }

    const dir = new THREE.Vector3().subVectors(this.target, this.pos).setY(0);
    const dist = dir.length();
    if (dist < 0.001) return;
    dir.divideScalar(dist);

    const speed = this.archetype === 'exuberant' ? 3.0 : 1.9;
    this.pos.addScaledVector(dir, speed * dt);
    this.faceToward(this.target, dt);

    // Stick to the surface.
    const gx = Math.floor(this.pos.x);
    const gz = Math.floor(this.pos.z);
    let gy = Math.floor(this.pos.y) + 2;
    while (gy > 0 && !isSolid(world.getBlock(gx, gy - 1, gz))) gy--;
    this.pos.y = THREE.MathUtils.lerp(this.pos.y, gy, 0.25);

    this.animateWalk(dt, speed);
  }

  private animateWalk(_dt: number, speed: number): void {
    const s = Math.sin(this.phase * speed * 3.2);
    const c = Math.cos(this.phase * speed * 3.2);
    this.parts.legL.rotation.x = s * 0.7;
    this.parts.legR.rotation.x = -s * 0.7;
    this.parts.armL.rotation.x = -s * 0.25;
    this.parts.armR.rotation.x = s * 0.25;
    this.parts.body.rotation.x = 0.22 + c * 0.03;
    this.parts.body.position.y = 0.95 + Math.abs(s) * 0.05;
    this.parts.tail.rotation.y = s * 0.18;
    this.parts.head.rotation.x = -0.18 + c * 0.05;
  }

  private animateIdle(_dt: number): void {
    const s = Math.sin(this.phase * 1.4);
    this.parts.legL.rotation.x = THREE.MathUtils.lerp(this.parts.legL.rotation.x, 0, 0.1);
    this.parts.legR.rotation.x = THREE.MathUtils.lerp(this.parts.legR.rotation.x, 0, 0.1);
    this.parts.body.rotation.x = THREE.MathUtils.lerp(this.parts.body.rotation.x, 0.1, 0.08);
    // Birdlike head tilt — "every other head tilts, truly listening".
    this.parts.head.rotation.z = Math.sin(this.phase * 0.7) * 0.28;
    this.parts.head.rotation.x = -0.1 + s * 0.06;
    this.parts.armL.rotation.x = s * 0.05;
    this.parts.armR.rotation.x = -s * 0.05;
  }
}
