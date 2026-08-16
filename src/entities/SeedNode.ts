import * as THREE from 'three';
import type { Uid, WireGoldenSeed } from '../net/protocol';
import { SEED_POWERS } from '../systems/goldenseeds';
import { EMBER, FLAME_CORE, TENDED_RAMP } from '../art/palette';

/**
 * A Golden Seed beacon.
 *
 * This is the exploration reward loop made visible. The seeds sit 240 to 1740
 * blocks out from spawn, so the beacon has to be legible from further away than
 * the terrain itself is — which is why the shaft opts out of distance fog
 * (`fog: false`) instead of just being tall. A tall thing that fogs out at 400
 * blocks is not a landmark, it is a surprise.
 *
 * It is styled as *precious* rather than as a quest marker: no floating icon,
 * no outline, no arrow. A slow warm shaft, a turning seed, a few motes. The
 * read should be "something is being kept here", not "objective 3 of 7".
 */

const SHAFT_HEIGHT = 46;
const MOTE_COUNT = 6;

/** Spent seeds go the colour of the dead ground in Ep5's opening. */
const SPENT = new THREE.Color(TENDED_RAMP[1]);

/**
 * All seven beacons share one gradient. It is module-scoped and deliberately
 * never disposed by a node, because disposing it would blank the other six.
 */
let shaftTexture: THREE.CanvasTexture | null = null;

function getShaftTexture(): THREE.CanvasTexture {
  if (shaftTexture) return shaftTexture;
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  // Row 0 of the image lands at the TOP of the cylinder (three flips Y by
  // default), so the ramp runs transparent at the sky end, bright at the soil.
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0.0, 'rgba(255,255,255,0)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.30)');
  g.addColorStop(0.88, 'rgba(255,255,255,0.85)');
  g.addColorStop(1.0, 'rgba(255,255,255,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 128);
  shaftTexture = new THREE.CanvasTexture(c);
  return shaftTexture;
}

export class SeedNode {
  readonly group = new THREE.Group();
  readonly uid: Uid;
  readonly key: WireGoldenSeed['key'];
  readonly name: string;
  readonly colour: number;

  /** World ground height the caller snapped us to, kept so sync can re-snap. */
  groundY: number;

  claimed = false;

  private shaft: THREE.Mesh;
  private shaftMat: THREE.MeshBasicMaterial;
  private halo: THREE.Mesh;
  private haloMat: THREE.MeshBasicMaterial;
  private core: THREE.Mesh;
  private coreMat: THREE.MeshBasicMaterial;
  private cage: THREE.Mesh;
  private cageMat: THREE.MeshBasicMaterial;
  private motes = new THREE.Group();
  private moteMat: THREE.MeshBasicMaterial;
  private light: THREE.PointLight;

  private live = new THREE.Color(FLAME_CORE);
  private base: THREE.Color;
  /** 0 = whole seed, 1 = spent husk. Lerped so a claim is watchable. */
  private claimT = 0;
  private t = Math.random() * Math.PI * 2;

  constructor(seed: WireGoldenSeed, groundY: number) {
    this.uid = seed.uid;
    this.key = seed.key;
    this.name = seed.name;
    this.colour = SEED_POWERS[seed.key].colour;
    this.base = new THREE.Color(this.colour);
    this.groundY = groundY;
    // heightAt reports the topmost SOLID block, so stand one above it —
    // matching Flock.populate(). Without the +1 the halo sinks into the ground.
    this.group.position.set(seed.x, groundY + 1, seed.z);

    this.shaftMat = new THREE.MeshBasicMaterial({
      color: this.colour,
      map: getShaftTexture(),
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false, // the entire point: it must survive 1500 blocks of haze
    });
    this.shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(2.4, 1.1, SHAFT_HEIGHT, 14, 1, true),
      this.shaftMat,
    );
    this.shaft.position.y = SHAFT_HEIGHT * 0.5;
    this.shaft.renderOrder = 2;
    this.group.add(this.shaft);

    this.haloMat = new THREE.MeshBasicMaterial({
      color: this.colour,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.halo = new THREE.Mesh(new THREE.RingGeometry(1.3, 5.2, 30), this.haloMat);
    this.halo.rotation.x = -Math.PI / 2;
    this.halo.position.y = 0.08;
    this.halo.renderOrder = 2;
    this.group.add(this.halo);

    // The seed itself: an octahedron stretched into a pip, so it reads as a
    // grain rather than as a gem. Gems are loot; this is a thing you plant.
    this.coreMat = new THREE.MeshBasicMaterial({ color: this.live.clone(), fog: false });
    this.core = new THREE.Mesh(new THREE.OctahedronGeometry(0.62, 0), this.coreMat);
    this.core.scale.set(1, 1.7, 1);
    this.core.position.y = 3.1;
    this.group.add(this.core);

    this.cageMat = new THREE.MeshBasicMaterial({
      color: this.colour,
      wireframe: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      fog: false,
    });
    this.cage = new THREE.Mesh(new THREE.OctahedronGeometry(1.15, 1), this.cageMat);
    this.cage.position.y = 3.1;
    this.group.add(this.cage);

    this.moteMat = new THREE.MeshBasicMaterial({
      color: EMBER,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const moteGeo = new THREE.BoxGeometry(0.13, 0.13, 0.13);
    for (let i = 0; i < MOTE_COUNT; i++) {
      this.motes.add(new THREE.Mesh(moteGeo, this.moteMat));
    }
    this.motes.position.y = 3.1;
    this.group.add(this.motes);

    this.light = new THREE.PointLight(this.colour, 2.2, 22, 2);
    this.light.position.y = 3.1;
    this.group.add(this.light);
  }

  /** Move the beacon to a newly known ground height (chunks stream in late). */
  setGroundY(y: number): void {
    this.groundY = y;
    this.group.position.y = y + 1; // see constructor: stand on the block, not in it
  }

  /**
   * Claimed seeds collapse into a husk instead of vanishing. A hole where a
   * beacon used to be tells a newcomer nothing; a spent husk tells them someone
   * got here first, which is information about the other players.
   */
  setClaimed(claimed: boolean, instant = false): void {
    this.claimed = claimed;
    if (instant) {
      this.claimT = claimed ? 1 : 0;
      this.applyClaim();
    }
  }

  update(dt: number): void {
    this.t += dt;

    const target = this.claimed ? 1 : 0;
    if (this.claimT !== target) {
      const step = dt * 0.9;
      this.claimT = this.claimT < target
        ? Math.min(target, this.claimT + step)
        : Math.max(target, this.claimT - step);
      this.applyClaim();
    }

    // A whole seed turns slowly and breathes; a husk does neither.
    const alive = 1 - this.claimT;
    this.core.rotation.y += dt * 0.35 * alive;
    this.cage.rotation.y -= dt * 0.22 * alive;
    this.cage.rotation.x += dt * 0.08 * alive;

    const bob = Math.sin(this.t * 0.8) * 0.32 * alive;
    const rest = 3.1 - this.claimT * 2.6;
    this.core.position.y = rest + bob;
    this.cage.position.y = rest + bob;
    this.motes.position.y = rest + bob;
    this.light.position.y = rest + bob;

    if (alive > 0.01) {
      const kids = this.motes.children;
      for (let i = 0; i < kids.length; i++) {
        const a = this.t * 0.6 + (i / kids.length) * Math.PI * 2;
        const r = 1.5 + Math.sin(this.t * 0.9 + i) * 0.35;
        kids[i].position.set(Math.cos(a) * r, Math.sin(this.t * 1.1 + i * 1.7) * 0.6, Math.sin(a) * r);
      }
      // Slow swell rather than a blink — a pulsing marker reads as UI.
      const swell = 0.42 + Math.sin(this.t * 0.55) * 0.1;
      this.shaftMat.opacity = swell * alive;
      this.haloMat.opacity = (0.18 + Math.sin(this.t * 0.55 + 1) * 0.06) * alive;
      this.light.intensity = (1.9 + Math.sin(this.t * 0.55) * 0.5) * alive;
    }
  }

  private applyClaim(): void {
    const t = this.claimT;
    const alive = 1 - t;

    this.shaft.scale.set(1, Math.max(0.0001, alive), 1);
    this.shaft.position.y = SHAFT_HEIGHT * 0.5 * Math.max(0.0001, alive);
    this.shaftMat.opacity = 0.42 * alive;

    this.core.scale.set(1 - t * 0.62, 1.7 - t * 1.25, 1 - t * 0.62);
    this.coreMat.color.lerpColors(this.live, SPENT, t);

    this.cage.scale.setScalar(1 - t * 0.72);
    this.cageMat.opacity = 0.55 * alive;

    this.moteMat.opacity = 0.9 * alive;
    this.motes.visible = alive > 0.02;

    this.light.intensity = 2.2 * alive;
    this.light.visible = alive > 0.02;

    // The ring stays, dimmed: this is the scar that marks a spent seed.
    this.haloMat.opacity = 0.18 * alive + 0.07 * t;
    this.haloMat.color.lerpColors(this.base, SPENT, t);
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.shaftMat.dispose();
    this.haloMat.dispose();
    this.coreMat.dispose();
    this.cageMat.dispose();
    this.moteMat.dispose();
    this.group.removeFromParent();
  }
}

/**
 * All seven beacons, reconciled from server truth.
 *
 * The server owns which seeds exist and who claimed them; this class owns only
 * their bodies. It never invents or removes a seed on its own.
 */
export class SeedField {
  readonly group = new THREE.Group();
  private nodes = new Map<Uid, SeedNode>();

  /**
   * @param wire     the server's `goldenSeeds` list, from `welcome` or a tick
   * @param heightAt ground height at a world column. MUST be a pure terrain
   *                 function (worldgen `surfaceY`), NOT `World.heightAt`:
   *                 Golden Seeds sit 240-1740 blocks out, far beyond the chunk
   *                 keep radius, so a chunk-generating lookup would generate
   *                 and immediately discard seven chunks every sync, forever.
   */
  sync(wire: readonly WireGoldenSeed[], heightAt: (x: number, z: number) => number): void {
    const present = new Set<Uid>();

    for (const s of wire) {
      present.add(s.uid);
      let node = this.nodes.get(s.uid);
      if (!node) {
        node = new SeedNode(s, heightAt(s.x, s.z));
        // A seed claimed before we arrived was never ours to watch collapse:
        // it starts as a husk rather than collapsing in front of a newcomer.
        node.setClaimed(s.claimedBy !== null, true);
        this.nodes.set(s.uid, node);
        this.group.add(node.group);
        continue;
      }
      const y = heightAt(s.x, s.z);
      if (Math.abs(y - node.groundY) > 0.5) node.setGroundY(y);
      node.setClaimed(s.claimedBy !== null);
    }

    for (const [uid, node] of this.nodes) {
      if (present.has(uid)) continue;
      node.dispose();
      this.nodes.delete(uid);
    }
  }

  /** Mark one seed claimed without waiting for the next full sync. */
  markClaimed(uid: Uid): void {
    this.nodes.get(uid)?.setClaimed(true);
  }

  get(uid: Uid): SeedNode | undefined {
    return this.nodes.get(uid);
  }

  update(dt: number): void {
    for (const node of this.nodes.values()) node.update(dt);
  }

  dispose(): void {
    for (const node of this.nodes.values()) node.dispose();
    this.nodes.clear();
    this.group.removeFromParent();
  }
}
