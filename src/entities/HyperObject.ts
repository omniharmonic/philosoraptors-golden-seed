import * as THREE from 'three';
import type { PlayerId, WireHyper } from '../net/protocol';
import { makeSigil } from '../systems/sigil';
import { invigorationRatio } from '../systems/hyperstition';
import { EGG_BLUE, EMBER, FLAME, FLAME_CORE, hexToRgb, mixRgb, rgbToHex } from '../art/palette';

/**
 * The Hyperobject — a declared future, hanging in the sky over the Moloch it
 * was declared against.
 *
 * Two rules drive every number in this file.
 *
 * 1. YOU CANNOT PERCEIVE THE WHOLE OF IT. That is what the word means. So the
 *    shell is built from partial spheres that counter-rotate: whatever face you
 *    are looking at, some of it has just turned away. It is also far too big to
 *    frame — 22 blocks of radius, hung 22 blocks up — and it never has a
 *    silhouette you can hold in one glance.
 *
 * 2. REALNESS IS OTHER PEOPLE. Opacity and light scale with
 *    invigoration/required and nothing else. A claim with nobody behind it is a
 *    ghost you can barely prove is there; a claim that reached quorum burns.
 *
 * Colour carries the same argument. Cold EGG_BLUE is the series' one reserved
 * colour, kept for the genuinely unknown (Ep4's obsidian egg), and a future
 * that has not been made true yet is exactly that. As sigils arrive it grades
 * to gold — the warm accent that does every structural job in the saga — and
 * that transition is the payoff the flock is working for.
 */

const R_OUTER = 22;
const R_MID = 18;
const R_INNER = 14;
/** Server hangs the object this far above its Moloch; the tether reaches back down. */
const TETHER_DROP = 22;
/** Never zero: you can always *just* tell that something is up there. */
const GHOST_MIN = 0.045;
/** Seed of Sight: perception, not reality. It reveals; it does not invigorate. */
const SIGHT_FLOOR = 0.85;
const MAX_MARKS = 16;
const BURST_SECS = 2.6;

const COLD = hexToRgb(EGG_BLUE);
const WARM = hexToRgb(FLAME);
const CORE = hexToRgb(FLAME_CORE);

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function glowMat(colour: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: colour,
    transparent: true,
    opacity,
    // Additive so overlapping bands accumulate into brightness instead of
    // stacking into mud, and depthWrite off so the shell never occludes itself.
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** A wireframe band of the shell. `phi` < 2PI is the point: it is never closed. */
function shellBand(radius: number, phi: number, mat: THREE.LineBasicMaterial): THREE.LineSegments {
  const src = new THREE.SphereGeometry(radius, 20, 12, 0, phi, 0.25, Math.PI - 0.5);
  const wire = new THREE.WireframeGeometry(src);
  src.dispose();
  return new THREE.LineSegments(wire, mat);
}

export class HyperObject {
  readonly root = new THREE.Group();
  readonly uid: string;
  readonly claim: string;

  /** 0..1, mirrored from the server each frame. */
  ratio = 0;

  private readonly frame = new THREE.Group();
  private readonly rings: THREE.Group[] = [];
  private readonly ringMats: THREE.MeshBasicMaterial[] = [];
  private readonly bandA: THREE.LineSegments;
  private readonly bandB: THREE.LineSegments;
  private readonly shellMat: THREE.LineBasicMaterial;
  private readonly coreMat: THREE.MeshBasicMaterial;
  private readonly tetherMat: THREE.MeshBasicMaterial;
  private readonly light: THREE.PointLight;

  private readonly contribRing = new THREE.Group();
  private readonly markGeo: THREE.OctahedronGeometry;
  private readonly markMats: THREE.MeshBasicMaterial[] = [];
  private readonly markBase: THREE.Color[] = [];
  private markIds: PlayerId[] = [];

  private readonly tint = new THREE.Color();
  private readonly hot = new THREE.Color();
  private t = 0;
  private sight = false;
  private realT = -1;

  constructor(hyper: WireHyper) {
    this.uid = hyper.uid;
    this.claim = hyper.claim;
    this.root.position.set(hyper.x, hyper.y, hyper.z);
    // Bigger claims are bigger objects: `required` is the size of the future.
    this.root.scale.setScalar(0.85 + Math.min(9, hyper.required) * 0.03);
    this.root.add(this.frame);

    // --- three nested rings on three axes. Their periods are deliberately
    // incommensurate so the structure never repeats a pose you recognise.
    const ringSpec: [number, number, THREE.Euler][] = [
      [R_OUTER, 0.28, new THREE.Euler(Math.PI / 2, 0, 0)],
      [R_MID, 0.34, new THREE.Euler(0.42, 0, Math.PI / 2)],
      [R_INNER, 0.44, new THREE.Euler(1.15, 0.6, 0)],
    ];
    for (const [radius, tube, rot] of ringSpec) {
      const pivot = new THREE.Group();
      const mat = glowMat(EGG_BLUE, GHOST_MIN);
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, 96), mat);
      mesh.rotation.copy(rot);
      pivot.add(mesh);
      this.frame.add(pivot);
      this.rings.push(pivot);
      this.ringMats.push(mat);
    }

    // --- lattice shell, in two open bands that turn against each other.
    this.shellMat = new THREE.LineBasicMaterial({
      color: EGG_BLUE, transparent: true, opacity: GHOST_MIN, depthWrite: false,
    });
    this.bandA = shellBand(R_MID, Math.PI * 1.35, this.shellMat);
    this.bandB = shellBand(R_MID * 0.72, Math.PI * 1.1, this.shellMat);
    this.bandB.rotation.set(0.9, 1.6, 0.3);
    this.frame.add(this.bandA, this.bandB);

    // --- the core. Effectively invisible until the claim is nearly true, which
    // is the honest reading: there is no "there" there yet.
    this.coreMat = glowMat(EGG_BLUE, 0);
    this.frame.add(new THREE.Mesh(new THREE.IcosahedronGeometry(3.4, 1), this.coreMat));

    // --- tether down to the Moloch this was declared against, so that anyone
    // who sees the sky object knows immediately what it is aimed at.
    this.tetherMat = glowMat(EMBER, 0);
    const tether = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.05, TETHER_DROP, 6, 1, true),
      this.tetherMat,
    );
    tether.position.y = -TETHER_DROP / 2;
    this.root.add(tether);

    this.contribRing.rotation.x = 0.22;
    this.root.add(this.contribRing);
    this.markGeo = new THREE.OctahedronGeometry(0.85, 0);

    // Dark until real. A Hyperobject that nobody has aligned with lights nothing.
    this.light = new THREE.PointLight(FLAME, 0, 140, 2);
    this.root.add(this.light);
  }

  /** Seed of Sight: its holder perceives the object clearly at any invigoration. */
  setSightBonus(on: boolean): void {
    this.sight = on;
  }

  /** True once the burst has run its course and the owner may dispose it. */
  get finished(): boolean {
    return this.realT >= BURST_SECS;
  }

  get isReal(): boolean {
    return this.realT >= 0;
  }

  /**
   * The claim came true. It flares, expands, and then stops being an object at
   * all — which is correct: once a hyperstition is real it is not a thing in
   * the sky any more, it is a fact about the world.
   */
  becomeReal(): void {
    if (this.realT >= 0) return;
    this.realT = 0;
  }

  update(
    dt: number,
    invigoration: number,
    required: number,
    contributors: readonly PlayerId[],
  ): void {
    this.t += dt;
    this.ratio = invigorationRatio(invigoration, required);

    // Burst envelope. `flare` rises fast, `decay` dissolves the whole thing.
    let flare = 0;
    let decay = 0;
    if (this.realT >= 0) {
      this.realT = Math.min(BURST_SECS, this.realT + dt);
      const k = this.realT / BURST_SECS;
      flare = clamp01(k / 0.3);
      decay = clamp01((k - 0.45) / 0.55);
    }

    // realness = how true it is. reveal = how much of it you can perceive.
    // Keeping these apart is what lets the Seed of Sight show you a ghost
    // without making the ghost any more real than it was.
    const realness = this.realT >= 0 ? 1 : this.ratio;
    const reveal = Math.max(GHOST_MIN, realness, this.sight ? SIGHT_FLOOR : 0) * (1 - decay);

    this.tint.setHex(rgbToHex(mixRgb(COLD, WARM, realness)));
    const hot = this.hot.setHex(rgbToHex(mixRgb(WARM, CORE, flare)));

    // Breathing: slow and wide when unreal, tight and urgent as quorum nears.
    const breath = 0.72 + Math.sin(this.t * (0.5 + realness * 1.6)) * 0.28;

    for (let i = 0; i < this.rings.length; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      const speed = (0.035 + i * 0.019 + realness * 0.06 + flare * 0.5) * dir;
      this.rings[i].rotation.y += dt * speed;
      this.rings[i].rotation.z += dt * speed * 0.43;
      const m = this.ringMats[i];
      m.color.copy(this.realT >= 0 ? hot : this.tint);
      m.opacity = (GHOST_MIN + reveal * 0.66) * (0.7 + breath * 0.3);
    }

    this.frame.rotation.y += dt * (0.05 + flare * 0.6);
    // The two open bands turn against the frame and against each other, so no
    // two consecutive frames show you the same slice of the shell.
    this.bandA.rotation.y -= dt * 0.11;
    this.bandB.rotation.y += dt * 0.17;
    this.frame.scale.setScalar(1 + flare * 0.25 + decay * 0.7);

    this.shellMat.color.copy(this.tint);
    this.shellMat.opacity = GHOST_MIN + reveal * 0.5;

    this.coreMat.color.copy(hot);
    // Squared, so the core is genuinely absent for the first half of the climb.
    this.coreMat.opacity = reveal * realness * realness * 0.9 + flare * 0.6 * (1 - decay);

    this.tetherMat.color.copy(this.tint);
    this.tetherMat.opacity = reveal * 0.3;

    this.syncMarks(contributors);
    this.contribRing.rotation.y += dt * 0.22;
    for (let i = 0; i < this.markMats.length; i++) {
      const m = this.markMats[i];
      // A signature keeps its own colour and warms toward the claim as the
      // claim comes true — the mark is the person, not the object.
      m.color.copy(this.markBase[i]).lerp(this.tint, realness * 0.6);
      // Marks stay legible even when the object does not: other people's
      // commitments are the part of a hyperobject you *can* perceive.
      m.opacity = (0.3 + reveal * 0.7) * (1 - decay);
    }
    for (let i = 0; i < this.contribRing.children.length; i++) {
      const c = this.contribRing.children[i];
      c.position.y = Math.sin(this.t * 0.9 + i * 1.7) * 1.6;
      c.rotation.y += dt * 1.3;
      c.rotation.x += dt * 0.8;
    }

    // Only a real Hyperobject casts light on the valley below.
    this.light.color.copy(hot);
    this.light.intensity = (realness >= 1 ? 3 + flare * 16 : 0) * (1 - decay);
    this.light.distance = 140 + flare * 120;
  }

  private syncMarks(ids: readonly PlayerId[]): void {
    if (ids.length === this.markIds.length && ids.every((v, i) => v === this.markIds[i])) return;
    this.markIds = [...ids];

    for (const m of this.markMats) m.dispose();
    this.markMats.length = 0;
    this.markBase.length = 0;
    while (this.contribRing.children.length) this.contribRing.children[0].removeFromParent();

    const n = Math.min(ids.length, MAX_MARKS);
    for (let i = 0; i < n; i++) {
      // Same hue the raptor's sigil draws with, so a mark is readable as *whose*.
      const sig = makeSigil(ids[i]);
      const mat = glowMat(0xffffff, 1);
      mat.color.setHSL(sig.hue / 360, 0.78, 0.62);
      this.markBase.push(mat.color.clone());
      this.markMats.push(mat);

      const mesh = new THREE.Mesh(this.markGeo, mat);
      const a = (i / n) * Math.PI * 2;
      mesh.position.set(Math.cos(a) * (R_OUTER + 3.5), 0, Math.sin(a) * (R_OUTER + 3.5));
      this.contribRing.add(mesh);
    }
  }

  dispose(): void {
    this.light.dispose();
    this.markGeo.dispose();
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
        o.geometry.dispose();
        const mat = o.material;
        if (Array.isArray(mat)) for (const m of mat) m.dispose();
        else mat.dispose();
      }
    });
    this.root.removeFromParent();
  }
}
