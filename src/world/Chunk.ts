import * as THREE from 'three';

export const CX = 16;
export const CY = 128;
export const CZ = 16;
export const CHUNK_VOL = CX * CY * CZ;

export const idx = (x: number, y: number, z: number) => (y * CZ + z) * CX + x;
export const chunkKey = (cx: number, cz: number) => `${cx},${cz}`;

export class Chunk {
  readonly cx: number;
  readonly cz: number;
  readonly blocks: Uint8Array;
  /** Daylight channel, 0-15. */
  readonly skyLight: Uint8Array;
  /** Warm emissive channel, 0-15. The magic system. */
  readonly blockLight: Uint8Array;

  /** Highest non-air y per column, for fast skylight seeding. */
  readonly heightMap: Int16Array;

  mesh: THREE.Mesh | null = null;
  crossMesh: THREE.Mesh | null = null;
  waterMesh: THREE.Mesh | null = null;

  /** Set when blocks change; mesher picks it up. */
  dirty = true;
  /** Set when light must be recomputed before meshing. */
  lightDirty = true;
  /**
   * Queue membership, tracked as flags rather than by scanning the queues.
   * `Array.includes` is O(n) and these are touched dozens of times per frame
   * while the stream is sweeping ground, which made queueing itself O(n^2).
   */
  inLightQueue = false;
  inMeshQueue = false;
  /** Populated by worldgen. */
  generated = false;
  /**
   * Set when the chunk has been unloaded. The mesh/light queues can still hold
   * a reference to it, and rebuilding a dead chunk would attach orphaned meshes
   * to the scene that nothing will ever dispose — a steady leak that ends in a
   * crash on a long session.
   */
  unloaded = false;

  /**
   * Net tending score for this chunk. Canon Ep1: fighting over a seed makes its
   * light dim. Extraction pushes negative, planting pushes positive; the
   * renderer grades this chunk's palette from the result.
   */
  tend = 0;

  constructor(cx: number, cz: number) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = new Uint8Array(CHUNK_VOL);
    this.skyLight = new Uint8Array(CHUNK_VOL);
    this.blockLight = new Uint8Array(CHUNK_VOL);
    this.heightMap = new Int16Array(CX * CZ).fill(-1);
  }

  get(x: number, y: number, z: number): number {
    if (x < 0 || x >= CX || y < 0 || y >= CY || z < 0 || z >= CZ) return 0;
    return this.blocks[idx(x, y, z)];
  }

  set(x: number, y: number, z: number, id: number): void {
    if (x < 0 || x >= CX || y < 0 || y >= CY || z < 0 || z >= CZ) return;
    this.blocks[idx(x, y, z)] = id;
    const h = this.heightMap[z * CX + x];
    if (id !== 0 && y > h) this.heightMap[z * CX + x] = y;
    else if (id === 0 && y === h) {
      let ny = y - 1;
      while (ny >= 0 && this.blocks[idx(x, ny, z)] === 0) ny--;
      this.heightMap[z * CX + x] = ny;
    }
  }

  /** Fast unchecked write used by worldgen; caller maintains the height map. */
  setRaw(x: number, y: number, z: number, id: number): void {
    this.blocks[idx(x, y, z)] = id;
  }

  rebuildHeightMap(): void {
    for (let z = 0; z < CZ; z++) {
      for (let x = 0; x < CX; x++) {
        let y = CY - 1;
        while (y >= 0 && this.blocks[idx(x, y, z)] === 0) y--;
        this.heightMap[z * CX + x] = y;
      }
    }
  }

  dispose(): void {
    for (const m of [this.mesh, this.crossMesh, this.waterMesh]) {
      if (!m) continue;
      m.geometry.dispose();
      m.removeFromParent();
    }
    this.mesh = null;
    this.crossMesh = null;
    this.waterMesh = null;
  }
}
