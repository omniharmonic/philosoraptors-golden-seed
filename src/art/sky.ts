import * as THREE from 'three';

/**
 * Sky dome and starfield.
 *
 * Previously a raw GLSL ShaderMaterial, which is a hard blocker for WebGPU —
 * that backend compiles WGSL from node graphs and cannot consume hand-written
 * GLSL at all. Rewritten with plain vertex colours and a Points starfield so
 * exactly the same code runs on both backends with no branching.
 *
 * The gradient is only ~400 vertices, so recolouring it every frame costs
 * nothing measurable and keeps the day/night and warm/cold grading live.
 */
export class Sky {
  readonly group = new THREE.Group();

  private dome: THREE.Mesh;
  private colours: THREE.BufferAttribute;
  private heights: Float32Array;
  private stars: THREE.Points;
  private starMat: THREE.PointsMaterial;

  private readonly _top = new THREE.Color();
  private readonly _bottom = new THREE.Color();
  private readonly _c = new THREE.Color();

  constructor(radius = 700) {
    this.group.name = 'sky';

    const geo = new THREE.SphereGeometry(radius, 24, 16);
    const pos = geo.getAttribute('position');
    const n = pos.count;
    this.colours = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    geo.setAttribute('color', this.colours);

    // Cache each vertex's normalised height once; it never changes.
    this.heights = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const y = pos.getY(i) / radius;
      this.heights[i] = Math.pow(Math.max(0, Math.min(1, y * 0.5 + 0.5)), 0.85);
    }

    this.dome = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1;
    this.group.add(this.dome);

    // --- stars: a fixed shell of points, faded in at night
    const COUNT = 1400;
    const sg = new THREE.BufferGeometry();
    const sp = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      // Uniform on a sphere, upper hemisphere biased — you look up at stars.
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const y = Math.abs(u) * 0.9 + 0.05;
      const d = radius * 0.94;
      sp[i * 3] = Math.cos(a) * r * d;
      sp[i * 3 + 1] = y * d;
      sp[i * 3 + 2] = Math.sin(a) * r * d;
    }
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius * 1.1);
    this.starMat = new THREE.PointsMaterial({
      color: 0xdfe9ff,
      size: radius * 0.0035,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -1;
    this.group.add(this.stars);
  }

  /**
   * @param topHex     zenith colour
   * @param bottomHex  horizon colour
   * @param night      0..1, how far into night — drives star opacity
   */
  update(topHex: number, bottomHex: number, night: number): void {
    this._top.setHex(topHex);
    this._bottom.setHex(bottomHex);
    const arr = this.colours.array as Float32Array;
    for (let i = 0; i < this.heights.length; i++) {
      this._c.copy(this._bottom).lerp(this._top, this.heights[i]);
      arr[i * 3] = this._c.r;
      arr[i * 3 + 1] = this._c.g;
      arr[i * 3 + 2] = this._c.b;
    }
    this.colours.needsUpdate = true;
    this.starMat.opacity = Math.max(0, Math.min(1, night)) * 0.95;
  }

  /** Keep the dome centred on the camera. */
  follow(p: THREE.Vector3): void {
    this.group.position.copy(p);
  }

  dispose(): void {
    this.dome.geometry.dispose();
    (this.dome.material as THREE.Material).dispose();
    this.stars.geometry.dispose();
    this.starMat.dispose();
  }
}
