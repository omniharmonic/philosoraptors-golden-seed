import * as THREE from 'three';
import type { World } from '../world/World';
import { isSolid, AMBER_SEED, SOIL_RAKED, ASH, AIR, SOIL_LIVING, CROP_RIPE, GREEN_SHOOT, GRASS_WARM, PRAIRIE_GRASS, DIRT } from '../world/blocks';

/**
 * Moloch.
 *
 * A horned figure that walks the valley taking what is held in common. He is
 * deliberately, structurally IMMUNE to direct attack — blocks, tools and solo
 * spells do nothing at all. You cannot punch a coordination failure, and a game
 * that let you would be teaching the opposite of its own thesis.
 *
 * The only thing that touches him is a Hyperobject that other people made real.
 */

export type MolochState = 'roam' | 'reap' | 'menace' | 'banish';

const CHARRED = 0x14100f;
const HORN = 0x3b332c;
const EMBER = 0xff5a1e;

function box(w: number, h: number, d: number, colour: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color: colour }),
  );
  m.position.set(x, y, z);
  return m;
}

function glow(w: number, h: number, d: number, colour: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshBasicMaterial({ color: colour }),
  );
  m.position.set(x, y, z);
  return m;
}

/** Curved horn built from tapering segments. */
function horn(side: number): THREE.Group {
  const g = new THREE.Group();
  let seg: THREE.Object3D = g;
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Group();
    const t = i / 6;
    s.position.set(0, i === 0 ? 0.18 : 0.22, 0);
    s.rotation.z = side * (0.16 + t * 0.24);
    s.rotation.x = -0.08;
    s.add(box(0.20 - t * 0.13, 0.24, 0.20 - t * 0.13, HORN, 0, 0.1, 0));
    seg.add(s);
    seg = s;
  }
  return g;
}

export class MolochEntity {
  readonly root = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly id: string;

  state: MolochState = 'roam';
  /** Grows as he reaps. Bigger Moloch, wider drain. */
  gorge = 0;
  banishT = 0;
  dead = false;

  /** How much of the hyperobject's reality is bound to him. */
  bound = 0;

  private head: THREE.Group;
  private body: THREE.Group;
  private legL: THREE.Group;
  private legR: THREE.Group;
  private armL: THREE.Group;
  private armR: THREE.Group;
  private hoard: THREE.Group;
  private eyes: THREE.Mesh[] = [];
  private light: THREE.PointLight;

  private phase = Math.random() * 10;
  private target = new THREE.Vector3();
  private reapTimer = 0;

  constructor(id: string, x: number, y: number, z: number) {
    this.id = id;
    this.pos.set(x, y, z);

    const body = new THREE.Group();
    body.position.y = 2.1;
    body.add(box(1.05, 1.5, 0.72, CHARRED));
    // Ribcage ridges.
    for (let i = 0; i < 4; i++) {
      body.add(box(1.12, 0.07, 0.78, 0x241c18, 0, 0.5 - i * 0.3, 0));
    }
    this.body = body;

    // --- head: a long horned skull
    const head = new THREE.Group();
    head.position.set(0, 1.0, 0);
    head.add(box(0.56, 0.5, 0.62, CHARRED));
    head.add(box(0.36, 0.3, 0.44, CHARRED, 0, -0.1, -0.44));
    for (const s of [-1, 1]) {
      const h = horn(s);
      h.position.set(s * 0.24, 0.22, 0.04);
      head.add(h);
      const e = glow(0.1, 0.13, 0.06, EMBER, s * 0.16, 0.04, -0.32);
      this.eyes.push(e);
      head.add(e);
    }
    this.head = head;
    body.add(head);

    // --- arms, long and heavy
    const mkArm = (side: number) => {
      const g = new THREE.Group();
      g.position.set(side * 0.66, 0.52, 0);
      g.add(box(0.26, 0.8, 0.26, CHARRED, 0, -0.38, 0));
      const fore = new THREE.Group();
      fore.position.y = -0.76;
      fore.add(box(0.22, 0.8, 0.22, CHARRED, 0, -0.38, 0));
      fore.add(box(0.3, 0.22, 0.34, CHARRED, 0, -0.8, -0.04));
      g.add(fore);
      return g;
    };
    this.armL = mkArm(-1);
    this.armR = mkArm(1);
    body.add(this.armL, this.armR);

    // --- legs, digitigrade and cloven
    const mkLeg = (side: number) => {
      const g = new THREE.Group();
      g.position.set(side * 0.3, -0.78, 0);
      g.add(box(0.32, 0.8, 0.34, CHARRED, 0, -0.38, 0));
      const shin = new THREE.Group();
      shin.position.y = -0.74;
      shin.add(box(0.26, 0.76, 0.28, CHARRED, 0, -0.36, 0));
      shin.add(box(0.3, 0.16, 0.2, HORN, 0, -0.76, -0.06));
      g.add(shin);
      return g;
    };
    this.legL = mkLeg(-1);
    this.legR = mkLeg(1);
    body.add(this.legL, this.legR);

    // --- the hoard: seeds he has taken, glowing on his back
    this.hoard = new THREE.Group();
    this.hoard.position.set(0, 0.5, 0.5);
    body.add(this.hoard);

    this.light = new THREE.PointLight(EMBER, 1.4, 16, 1.8);
    this.light.position.set(0, 2.6, 0);
    this.root.add(this.light);

    this.root.add(body);
    this.root.position.copy(this.pos);
    this.target.copy(this.pos);
  }

  // Both clamped independently of the server so a stale or hostile value can
  // never produce an unplayable giant.
  get radius(): number { return 6 + Math.min(60, this.gorge) * 0.14; }
  get scale(): number { return 1 + Math.min(60, this.gorge) * 0.021; }

  /** Only a real hyperobject can do this. */
  bind(amount: number): void {
    this.bound = Math.min(1, this.bound + amount);
    if (this.bound >= 1 && this.state !== 'banish') {
      this.state = 'banish';
      this.banishT = 0;
    }
  }

  update(dt: number, world: World, playerPos: THREE.Vector3, onReap: (n: number) => void): void {
    this.phase += dt;

    if (this.state === 'banish') {
      this.banishT += dt;
      const t = Math.min(1, this.banishT / 3.2);
      this.root.scale.setScalar(this.scale * (1 - t) + 0.001);
      this.root.rotation.y += dt * (2 + t * 14);
      this.light.intensity = 1.4 + t * 20;
      this.light.color.setHex(0xffd27a);
      // Drop everything he took, as living ground.
      if (t >= 1) this.dead = true;
      this.root.position.copy(this.pos);
      return;
    }

    const dToPlayer = this.pos.distanceTo(playerPos);
    this.state = dToPlayer < 14 ? 'menace' : this.reapTimer > 0 ? 'reap' : 'roam';

    // --- movement
    if (this.state === 'menace') {
      // Walks toward you, unhurried. He is not in a rush.
      const dir = new THREE.Vector3().subVectors(playerPos, this.pos).setY(0).normalize();
      this.pos.addScaledVector(dir, 2.1 * dt);
      this.faceToward(playerPos, dt);
    } else {
      if (this.pos.distanceTo(this.target) < 2) {
        const a = Math.random() * Math.PI * 2;
        this.target.set(
          this.pos.x + Math.cos(a) * (20 + Math.random() * 40),
          this.pos.y,
          this.pos.z + Math.sin(a) * (20 + Math.random() * 40),
        );
      }
      const dir = new THREE.Vector3().subVectors(this.target, this.pos).setY(0).normalize();
      this.pos.addScaledVector(dir, 1.5 * dt);
      this.faceToward(this.target, dt);
    }

    // Stay on the ground.
    const gx = Math.floor(this.pos.x);
    const gz = Math.floor(this.pos.z);
    let gy = Math.floor(this.pos.y) + 3;
    while (gy > 0 && !isSolid(world.getBlock(gx, gy - 1, gz))) gy--;
    this.pos.y = THREE.MathUtils.lerp(this.pos.y, gy, 0.2);

    // --- reaping: he takes what is held in common and leaves it raked
    this.reapTimer -= dt;
    if (this.reapTimer <= 0) {
      this.reapTimer = 2.2;
      let took = 0;
      const R = Math.floor(this.radius);
      for (let i = 0; i < 26; i++) {
        const dx = Math.round((Math.random() * 2 - 1) * R);
        const dz = Math.round((Math.random() * 2 - 1) * R);
        const x = gx + dx;
        const z = gz + dz;
        const y = world.heightAt(x, z);
        if (y < 1) continue;
        const top = world.getBlock(x, y + 1, z);
        if (top === AMBER_SEED || top === CROP_RIPE || top === GREEN_SHOOT) {
          world.setBlock(x, y + 1, z, AIR);
          took++;
        }
        const surf = world.getBlock(x, y, z);
        if (surf === SOIL_LIVING || surf === GRASS_WARM || surf === PRAIRIE_GRASS || surf === DIRT) {
          world.setBlock(x, y, z, Math.random() < 0.25 ? ASH : SOIL_RAKED);
        }
      }
      if (took) {
        this.gorge += took;
        onReap(took);
        this.rebuildHoard();
      }
      world.addTend(this.pos.x, this.pos.z, -3);
    }

    // --- animation
    const s = Math.sin(this.phase * 2.4);
    const c = Math.cos(this.phase * 2.4);
    this.legL.rotation.x = s * 0.5;
    this.legR.rotation.x = -s * 0.5;
    this.armL.rotation.x = -s * 0.3;
    this.armR.rotation.x = s * 0.3;
    this.body.position.y = 2.1 + Math.abs(s) * 0.09;
    this.head.rotation.x = 0.12 + c * 0.04;
    this.head.rotation.y = this.state === 'menace' ? 0 : Math.sin(this.phase * 0.5) * 0.4;

    const pulse = 0.75 + Math.sin(this.phase * 3.4) * 0.25;
    this.light.intensity = (1.2 + this.gorge * 0.03) * pulse;
    for (const e of this.eyes) {
      (e.material as THREE.MeshBasicMaterial).color.setHex(
        this.state === 'menace' ? 0xff2e0a : EMBER,
      );
    }

    this.root.position.copy(this.pos);
    this.root.scale.setScalar(this.scale);
  }

  private faceToward(p: THREE.Vector3, dt: number): void {
    const want = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
    let d = want - this.root.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.root.rotation.y += d * Math.min(1, dt * 2.2);
  }

  private rebuildHoard(): void {
    // Visible stolen light: the more he has taken, the brighter his back.
    while (this.hoard.children.length) this.hoard.children[0].removeFromParent();
    const n = Math.min(18, Math.floor(this.gorge / 2));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 0.28 + (i % 3) * 0.1;
      this.hoard.add(glow(0.12, 0.12, 0.12, 0xff9a2e,
        Math.cos(a) * r, Math.sin(a) * r * 0.7, (i % 2) * 0.1));
    }
  }

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.root.removeFromParent();
  }
}
