import * as THREE from 'three';
import { EMBER, FLAME, FLAME_CORE, EGG_BLUE } from '../art/palette';

/**
 * The stream.
 *
 * A crackling ribbon of light thrown from the raptor's claws to whatever it is
 * pointed at. It is the game's main verb and it is deliberately a HOLD, not a
 * click: the fun is in sweeping it across a dead hillside and watching green
 * chase the end of it, and in the moment three raptors' streams land on the
 * same Moloch at once.
 *
 * It never deals damage to anything. Against ground it restores; against a
 * Moloch it tethers. Ghostbusters, not Doom — you hold the thing still and
 * someone else brings the trap.
 *
 * PERFORMANCE NOTE: this used to rebuild two TubeGeometry objects every frame,
 * which at five simultaneous streams meant ~600 geometry allocations per second
 * and constant GC pressure. The topology of a tube never changes — only where
 * its vertices sit — so the buffers are now allocated ONCE and rewritten in
 * place. Same look, no churn.
 */

/** Rings along the length. */
const SEGMENTS = 24;
/** Vertices per ring. Low: it is a glowing noodle, not a pipe. */
const RADIAL = 6;

export type BeamMode = 'idle' | 'ground' | 'tether' | 'preen';

const MODE_COLOUR: Record<BeamMode, number> = {
  idle: EMBER,
  ground: 0x8fe04a,   // green: life going back in
  tether: EGG_BLUE,   // cold: the one colour reserved for the unknown
  preen: FLAME_CORE,  // warm white: care
};

/** Build a fixed-topology tube: (SEGMENTS+1) rings of RADIAL verts. */
function makeTubeGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const verts = (SEGMENTS + 1) * RADIAL;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
  // MeshBasicMaterial ignores normals, but WebGPU's node pipeline still asks for
  // the attribute and warns once per material if it is missing. A constant
  // buffer satisfies it at zero per-frame cost.
  const nrm = new Float32Array(verts * 3);
  for (let i = 0; i < verts; i++) nrm[i * 3 + 1] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));

  const index: number[] = [];
  for (let s = 0; s < SEGMENTS; s++) {
    for (let r = 0; r < RADIAL; r++) {
      const a = s * RADIAL + r;
      const b = s * RADIAL + ((r + 1) % RADIAL);
      const c = (s + 1) * RADIAL + ((r + 1) % RADIAL);
      const d = (s + 1) * RADIAL + r;
      index.push(a, b, c, a, c, d);
    }
  }
  g.setIndex(index);
  // The stream moves constantly; a fixed sphere avoids per-frame recomputation
  // and it is always on screen when it exists anyway.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  return g;
}

export class Beam {
  readonly group = new THREE.Group();

  private tube: THREE.Mesh;
  private core: THREE.Mesh;
  private tubePos: THREE.BufferAttribute;
  private corePos: THREE.BufferAttribute;
  private tubeMat: THREE.MeshBasicMaterial;
  private coreMat: THREE.MeshBasicMaterial;
  private light: THREE.PointLight;
  private sparks: THREE.Points;
  private sparkPos: THREE.BufferAttribute;

  /** Scratch vectors, reused so the hot path allocates nothing. */
  private readonly _dir = new THREE.Vector3();
  private readonly _side = new THREE.Vector3();
  private readonly _up = new THREE.Vector3();
  private readonly _p = new THREE.Vector3();
  private readonly _spine: THREE.Vector3[] = [];

  private t = 0;
  private strength = 0;

  active = false;
  mode: BeamMode = 'idle';

  constructor() {
    this.group.name = 'beam';
    this.group.visible = false;
    for (let i = 0; i <= SEGMENTS; i++) this._spine.push(new THREE.Vector3());

    this.tubeMat = new THREE.MeshBasicMaterial({
      color: EMBER, transparent: true, opacity: 0.42,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.coreMat = new THREE.MeshBasicMaterial({
      color: FLAME_CORE, transparent: true, opacity: 0.95,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });

    const tg = makeTubeGeometry();
    const cg = makeTubeGeometry();
    this.tube = new THREE.Mesh(tg, this.tubeMat);
    this.core = new THREE.Mesh(cg, this.coreMat);
    this.tubePos = tg.getAttribute('position') as THREE.BufferAttribute;
    this.corePos = cg.getAttribute('position') as THREE.BufferAttribute;
    this.tube.frustumCulled = false;
    this.core.frustumCulled = false;
    this.group.add(this.tube, this.core);

    this.light = new THREE.PointLight(FLAME, 0, 14, 2);
    this.group.add(this.light);

    const N = 40;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    sg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.sparkPos = sg.getAttribute('position') as THREE.BufferAttribute;
    this.sparks = new THREE.Points(
      sg,
      new THREE.PointsMaterial({
        color: FLAME_CORE, size: 0.22, transparent: true, opacity: 0.9,
        depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
      }),
    );
    this.sparks.frustumCulled = false;
    this.group.add(this.sparks);
  }

  stop(): void {
    this.active = false;
    this.group.visible = false;
    this.light.intensity = 0;
    this.strength = 0;
  }

  /**
   * Redraw the stream between two points.
   *
   * `power` 0..1 widens it and speeds the crackle — that is how the extra
   * raptors on a shared tether are made visible without any UI.
   */
  update(dt: number, from: THREE.Vector3, to: THREE.Vector3, mode: BeamMode, power = 0.35): void {
    this.active = true;
    this.mode = mode;
    this.group.visible = true;
    this.t += dt;
    this.strength += (power - this.strength) * Math.min(1, dt * 8);

    this._dir.subVectors(to, from);
    const len = this._dir.length() || 1;
    this._dir.divideScalar(len);
    // Two axes perpendicular to the stream, for the whip.
    this._side.set(-this._dir.z, 0, this._dir.x);
    if (this._side.lengthSq() < 1e-6) this._side.set(1, 0, 0);
    this._side.normalize();
    this._up.crossVectors(this._dir, this._side).normalize();

    // --- spine
    const amp = 0.16 + this.strength * 0.42;
    for (let i = 0; i <= SEGMENTS; i++) {
      const k = i / SEGMENTS;
      // Taper the wobble at both ends so it stays anchored to claw and target.
      const env = Math.sin(k * Math.PI);
      const w1 = Math.sin(k * 15 - this.t * 22) * amp * env;
      const w2 = Math.cos(k * 11 - this.t * 17) * amp * env;
      this._spine[i].copy(from)
        .addScaledVector(this._dir, len * k)
        .addScaledVector(this._side, w1)
        .addScaledVector(this._up, w2);
    }

    const radius = 0.13 + this.strength * 0.2;
    this.writeTube(this.tubePos, radius);
    this.writeTube(this.corePos, radius * 0.32);

    const colour = MODE_COLOUR[mode];
    this.tubeMat.color.setHex(colour);
    this.tubeMat.opacity = 0.3 + this.strength * 0.45;
    this.coreMat.opacity = 0.75 + Math.sin(this.t * 40) * 0.2;

    this.light.position.copy(to);
    this.light.color.setHex(colour);
    this.light.intensity = 2.5 + this.strength * 7;
    this.light.distance = 10 + this.strength * 16;

    // Sparks scatter along the stream, denser with power.
    const n = this.sparkPos.count;
    const arr = this.sparkPos.array as Float32Array;
    const j = 0.25 + this.strength * 0.5;
    for (let i = 0; i < n; i++) {
      const k = (i / n + this.t * 0.6) % 1;
      const seg = Math.min(SEGMENTS, Math.floor(k * SEGMENTS));
      const p = this._spine[seg];
      arr[i * 3] = p.x + (Math.random() - 0.5) * j;
      arr[i * 3 + 1] = p.y + (Math.random() - 0.5) * j;
      arr[i * 3 + 2] = p.z + (Math.random() - 0.5) * j;
    }
    this.sparkPos.needsUpdate = true;
    (this.sparks.material as THREE.PointsMaterial).color.setHex(colour);
  }

  /** Rewrite a tube's vertex positions around the current spine. */
  private writeTube(attr: THREE.BufferAttribute, radius: number): void {
    const arr = attr.array as Float32Array;
    let o = 0;
    for (let s = 0; s <= SEGMENTS; s++) {
      const c = this._spine[s];
      for (let r = 0; r < RADIAL; r++) {
        const a = (r / RADIAL) * Math.PI * 2;
        const ca = Math.cos(a) * radius;
        const sa = Math.sin(a) * radius;
        this._p.copy(c).addScaledVector(this._side, ca).addScaledVector(this._up, sa);
        arr[o++] = this._p.x;
        arr[o++] = this._p.y;
        arr[o++] = this._p.z;
      }
    }
    attr.needsUpdate = true;
  }

  dispose(): void {
    this.tube.geometry.dispose();
    this.core.geometry.dispose();
    this.sparks.geometry.dispose();
    this.tubeMat.dispose();
    this.coreMat.dispose();
    (this.sparks.material as THREE.Material).dispose();
    this.group.removeFromParent();
  }
}
