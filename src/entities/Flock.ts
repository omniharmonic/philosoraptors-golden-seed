import * as THREE from 'three';
import { Raptor, type Archetype, buildRaptor } from './Raptor';
import type { World } from '../world/World';
import { makeSigil, type Sigil } from '../systems/sigil';
import { LANDMARKS } from '../world/landmarks';
import { Beam } from './Beam';

/**
 * The light-hatchling.
 *
 * Ep4b: it steps out of the egg, looks at its own back, and asks to be preened.
 * Mechanically it is a companion that emits light and *cannot* preen itself —
 * the one thing it needs, it structurally cannot do alone.
 */
export class Hatchling {
  readonly root = new THREE.Group();
  readonly sigil: Sigil;
  readonly pos = new THREE.Vector3();
  readonly light: THREE.PointLight;
  /** 0..1 — how much real plumage it has grown, from being preened. */
  plumage = 0;
  hatched = false;
  private phase = 0;
  private body: THREE.Group;

  constructor() {
    this.sigil = makeSigil('hatchling-of-light');
    const parts = buildRaptor(48, 0.15, 'exuberant');
    this.body = parts.root;
    this.body.scale.setScalar(0.42);
    // Made of light: emissive, translucent, unlit by the scene.
    this.body.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        (o as THREE.Mesh).material = new THREE.MeshBasicMaterial({
          color: 0xffd98a,
          transparent: true,
          opacity: 0.85,
        });
      }
    });
    this.root.add(this.body);
    this.light = new THREE.PointLight(0xffb347, 2.2, 18, 1.6);
    this.light.position.y = 0.8;
    this.root.add(this.light);
    this.root.visible = false;
  }

  hatch(x: number, y: number, z: number): void {
    this.hatched = true;
    this.pos.set(x, y, z);
    this.root.visible = true;
  }

  /** Ep4b/Ep5: preening gives it real feathers. */
  preen(): void {
    this.plumage = Math.min(1, this.plumage + 0.25);
    this.body.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if (m && m.color) {
        m.opacity = 0.85 + this.plumage * 0.15;
        m.color.setHSL(0.11 - this.plumage * 0.02, 0.75, 0.62 + this.plumage * 0.08);
      }
    });
    this.light.intensity = 2.2 + this.plumage * 2.4;
  }

  update(dt: number, target: THREE.Vector3): void {
    if (!this.hatched) return;
    this.phase += dt;
    // Trails the player at a respectful distance, bobbing.
    const want = new THREE.Vector3(
      target.x - Math.sin(this.phase * 0.5) * 1.8,
      target.y + 1.1 + Math.sin(this.phase * 1.8) * 0.22,
      target.z - Math.cos(this.phase * 0.5) * 1.8,
    );
    this.pos.lerp(want, Math.min(1, dt * 2.2));
    this.root.position.copy(this.pos);
    this.root.rotation.y = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
    this.light.intensity = (2.2 + this.plumage * 2.4) * (0.9 + Math.sin(this.phase * 3) * 0.1);
  }
}

const NAMES: Archetype[] = ['exuberant', 'thoughtful', 'careful', 'elder'];

/** Manages every NPC raptor plus the hatchling. */
export class Flock {
  readonly group = new THREE.Group();
  readonly raptors: Raptor[] = [];
  readonly hatchling = new Hatchling();

  /** One stream per assisting raptor, pooled — at most a handful are ever up. */
  private beams: Beam[] = [];

  constructor() {
    this.group.name = 'flock';
    this.group.add(this.hatchling.root);
    for (let i = 0; i < 4; i++) {
      const b = new Beam();
      this.beams.push(b);
      this.group.add(b.group);
    }
  }

  /**
   * Call the flock. Everyone nearby who trusts you enough falls in behind you.
   *
   * This is the answer to the game's worst failure: at spawn, no NPC would ever
   * help, so a lone player's beam sat at 1/3 forever with no path forward. The
   * flock has to be summonable, and the friendliest archetype has to say yes
   * immediately — somebody always has to go first.
   */
  callToFollow(playerPos: THREE.Vector3, coherence: number, range = 70): { came: number; refused: number } {
    let came = 0;
    let refused = 0;
    for (const r of this.near(playerPos, range)) {
      if (coherence >= r.trustNeeded) { r.following = true; came++; }
      else refused++;
    }
    return { came, refused };
  }

  dismiss(): number {
    let n = 0;
    for (const r of this.raptors) if (r.following) { r.following = false; r.assisting = null; n++; }
    return n;
  }

  get followers(): Raptor[] {
    return this.raptors.filter((r) => r.following);
  }

  /**
   * Point every follower's stream at a world position and return how many
   * actually contributed. They must be close enough to matter.
   */
  assistAt(point: THREE.Vector3 | null, coherence: number): number {
    let n = 0;
    for (const r of this.raptors) {
      const willing = r.following && coherence >= r.trustNeeded;
      if (point && willing && r.pos.distanceTo(point) < 70 && n < this.beams.length) {
        r.assisting = point;
        n++;
      } else {
        r.assisting = null;
      }
    }
    return n;
  }

  /** Draw the assisting raptors' streams. */
  private drawAssistBeams(dt: number): void {
    const active = this.raptors.filter((r) => r.assisting);
    for (let i = 0; i < this.beams.length; i++) {
      const r = active[i];
      if (!r || !r.assisting) { this.beams[i].stop(); continue; }
      const from = new THREE.Vector3(r.pos.x, r.pos.y + 1.35, r.pos.z);
      this.beams[i].update(dt, from, r.assisting, 'tether', 0.5);
    }
  }

  /**
   * Seed the flock at the landmarks. Council sites get more raptors, because
   * that is where you go when you need signatures.
   */
  populate(world: World): void {
    let n = 0;
    for (const lm of LANDMARKS) {
      const count = lm.id === 'council' ? 7 : lm.id === 'hall' ? 5 : lm.id === 'valleys' ? 4 : 2;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        const r = lm.id === 'council' ? 9 : 6;
        const x = Math.round(lm.x + Math.cos(a) * r);
        const z = Math.round(lm.z + Math.sin(a) * r);
        const y = world.heightAt(x, z) + 1;
        const arche = NAMES[(i + lm.chapter) % NAMES.length];
        // Plumage rises with the chapter — the arc is visible in the flock.
        const plumage = Math.min(1, 0.1 + lm.chapter * 0.13);
        const rap = new Raptor(`flock-${n++}`, x, y, z, arche, plumage);
        this.raptors.push(rap);
        this.group.add(rap.parts.root);
      }
    }
  }

  /** Raptors within range of a point, nearest first. */
  near(p: THREE.Vector3, range: number): Raptor[] {
    return this.raptors
      .filter((r) => r.pos.distanceTo(p) <= range)
      .sort((a, b) => a.pos.distanceTo(p) - b.pos.distanceTo(p));
  }

  update(dt: number, world: World, playerPos: THREE.Vector3): void {
    // Only tick raptors near the player; the rest are dormant and hidden.
    for (const r of this.raptors) {
      const d = r.pos.distanceTo(playerPos);
      const active = d < 90;
      r.parts.root.visible = active;
      if (active) r.update(dt, world, playerPos);
    }
    this.hatchling.update(dt, playerPos);
    this.drawAssistBeams(dt);
  }

  /** Everyone nearby rolls belly-up. Ep6b's grief-ring. */
  bellyRing(p: THREE.Vector3, range = 14): number {
    let n = 0;
    for (const r of this.near(p, range)) {
      r.bellyUp = true;
      n++;
      setTimeout(() => { r.bellyUp = false; }, 4200);
    }
    return n;
  }
}
