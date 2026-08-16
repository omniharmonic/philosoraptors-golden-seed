import * as THREE from 'three';
import { Chunk, CX, CY, CZ, chunkKey, idx } from './Chunk';
import { isOpaque, lightOf, AIR } from './blocks';
import { generateChunk } from './worldgen';
import { buildChunkMeshes } from './mesher';
import type { Atlas } from '../art/atlas';

/** How far chunks are kept resident, in chunks. */
// 8 keeps ~289 chunks resident instead of 361 — a 20% cut in memory, meshing
// and lighting for a view distance the fog hides anyway.
export const VIEW_RADIUS = 8;
/** Beyond this the chunk is unloaded entirely. */
const KEEP_RADIUS = VIEW_RADIUS + 3;

/** Per-frame work budgets so streaming never stalls the render loop. */
const GEN_BUDGET = 2;
const LIGHT_BUDGET = 3;
const MESH_BUDGET = 2;

export class World {
  readonly seed: number;
  readonly chunks = new Map<string, Chunk>();
  readonly group = new THREE.Group();
  private atlas: Atlas;

  /** Chunks whose light or mesh needs rebuilding, in priority order. */
  private lightQueue: Chunk[] = [];
  private meshQueue: Chunk[] = [];

  constructor(seed: number, atlas: Atlas) {
    this.seed = seed;
    this.atlas = atlas;
    this.group.name = 'world';
  }

  // ---------------------------------------------------------------- chunks

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  /** Get or create (but do not necessarily generate) a chunk. */
  private acquire(cx: number, cz: number): Chunk {
    const k = chunkKey(cx, cz);
    let c = this.chunks.get(k);
    if (!c) {
      c = new Chunk(cx, cz);
      this.chunks.set(k, c);
    }
    return c;
  }

  /** Generate a chunk immediately if it has not been generated yet. */
  ensureGenerated(cx: number, cz: number): Chunk {
    const c = this.acquire(cx, cz);
    if (!c.generated) {
      generateChunk(c, this.seed);
      c.rebuildHeightMap();
      c.generated = true;
      c.dirty = true;
      c.lightDirty = true;
      // Must be queued, not just flagged: remesh() refuses any chunk that is
      // still lightDirty, so a chunk generated through this path (the
      // synchronous spawn block) would otherwise never light and never mesh —
      // a black hole in the middle of a lit world.
      c.inLightQueue = true;
      this.lightQueue.push(c);
      // Its neighbours' seams change too.
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        this.touch(cx + dx, cz + dz);
      }
    }
    return c;
  }

  // ---------------------------------------------------------------- access

  getBlock(x: number, y: number, z: number): number {
    if (y < 0 || y >= CY) return AIR;
    const cx = Math.floor(x / CX);
    const cz = Math.floor(z / CZ);
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c || !c.generated) return AIR;
    return c.blocks[idx(x - cx * CX, y, z - cz * CZ)];
  }

  /** Block lookup that forces generation — used by worldgen-adjacent code. */
  getBlockForced(x: number, y: number, z: number): number {
    if (y < 0 || y >= CY) return AIR;
    const cx = Math.floor(x / CX);
    const cz = Math.floor(z / CZ);
    const c = this.ensureGenerated(cx, cz);
    return c.blocks[idx(x - cx * CX, y, z - cz * CZ)];
  }

  getSkyLight(x: number, y: number, z: number): number {
    if (y < 0) return 0;
    if (y >= CY) return 15;
    const cx = Math.floor(x / CX);
    const cz = Math.floor(z / CZ);
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c) return 15;
    return c.skyLight[idx(x - cx * CX, y, z - cz * CZ)];
  }

  getBlockLight(x: number, y: number, z: number): number {
    if (y < 0 || y >= CY) return 0;
    const cx = Math.floor(x / CX);
    const cz = Math.floor(z / CZ);
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c) return 0;
    return c.blockLight[idx(x - cx * CX, y, z - cz * CZ)];
  }

  /**
   * Place or clear a block and schedule the affected chunks for relight/remesh.
   * Returns false if the write was out of bounds.
   */
  setBlock(x: number, y: number, z: number, id: number): boolean {
    if (y < 0 || y >= CY) return false;
    const cx = Math.floor(x / CX);
    const cz = Math.floor(z / CZ);
    const c = this.ensureGenerated(cx, cz);
    const lx = x - cx * CX;
    const lz = z - cz * CZ;
    const old = c.blocks[idx(lx, y, lz)];
    if (old === id) return true;
    c.set(lx, y, lz, id);

    /*
     * Only relight when the swap can actually change light. Swapping raked soil
     * for living soil is opaque->opaque, emission 0->0: the lighting solution is
     * bit-identical, and re-running a ~138k-operation BFS for it was the single
     * biggest cost while the stream was sweeping ground. Face culling and vertex
     * tints still need a remesh, which is cheap.
     */
    const lightChanged = isOpaque(old) !== isOpaque(id) || lightOf(old) !== lightOf(id);
    const edit = lightChanged ? (a: number, b: number) => this.touch(a, b)
                              : (a: number, b: number) => this.touchMesh(a, b);
    edit(cx, cz);
    if (lx === 0) edit(cx - 1, cz);
    if (lx === CX - 1) edit(cx + 1, cz);
    if (lz === 0) edit(cx, cz - 1);
    if (lz === CZ - 1) edit(cx, cz + 1);
    return true;
  }

  /**
   * Queue a remesh WITHOUT a relight. Tend score only tints vertex colours, so
   * re-running the light BFS for it would be pure waste.
   */
  queueMesh(c: Chunk): void {
    if (!c.generated) return;
    c.dirty = true;
    if (!c.inMeshQueue) { c.inMeshQueue = true; this.meshQueue.push(c); }
  }

  private queueLight(c: Chunk): void {
    if (!c.generated) return;
    c.lightDirty = true;
    c.dirty = true;
    if (!c.inLightQueue) { c.inLightQueue = true; this.lightQueue.push(c); }
  }

  /** Mark a chunk (if resident) for relight and remesh. */
  touch(cx: number, cz: number): void {
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c || !c.generated) return;
    this.queueLight(c);
  }

  /** Remesh only — no relight. */
  private touchMesh(cx: number, cz: number): void {
    const c = this.chunks.get(chunkKey(cx, cz));
    if (c) this.queueMesh(c);
  }

  /** Adjust a chunk's tend score. Drives palette grading. */
  addTend(x: number, z: number, delta: number): void {
    const cx = Math.floor(x / CX);
    const cz = Math.floor(z / CZ);
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c) return;
    c.tend = Math.max(-40, Math.min(40, c.tend + delta));
    this.queueMesh(c);
  }

  tendAt(x: number, z: number): number {
    const c = this.chunks.get(chunkKey(Math.floor(x / CX), Math.floor(z / CZ)));
    return c ? c.tend : 0;
  }

  // -------------------------------------------------------------- lighting

  /**
   * Solve both light channels for one chunk.
   *
   * Sky light floods straight down at full strength through anything
   * non-opaque, then spreads sideways losing one level per step. Block light
   * is a plain BFS from every emitter. Border cells are seeded from resident
   * neighbours, and neighbours are re-queued afterwards so light bleeds across
   * chunk seams over a frame or two rather than stopping at the edge.
   */
  private computeLight(c: Chunk): void {
    const sky = c.skyLight;
    const blk = c.blockLight;
    sky.fill(0);
    blk.fill(0);

    const ox = c.cx * CX;
    const oz = c.cz * CZ;

    // Queues hold packed local indices; level lives in the array itself.
    const skyQ: number[] = [];
    const blkQ: number[] = [];

    /*
     * --- seed sky from open columns
     *
     * Every open cell gets full sky light, but only the LOWEST open cell in each
     * column is queued for BFS. Cells higher up are surrounded by other full-lit
     * sky and have nothing to contribute; queueing them meant ~23,000 entries per
     * chunk (256 columns x ~90 cells of empty air) instead of 256. Light still
     * reaches overhangs and cliff faces, because it spreads sideways from the
     * lowest cell of each neighbouring column.
     */
    for (let z = 0; z < CZ; z++) {
      for (let x = 0; x < CX; x++) {
        let lowest = -1;
        for (let y = CY - 1; y >= 0; y--) {
          const i = idx(x, y, z);
          if (isOpaque(c.blocks[i])) break;
          sky[i] = 15;
          lowest = i;
        }
        if (lowest >= 0) skyQ.push(lowest);
      }
    }

    // --- seed both channels from resident neighbours' border columns
    const seedFrom = (nx: number, nz: number, ax: number, az: number) => {
      const n = this.chunks.get(chunkKey(nx, nz));
      if (!n || !n.generated) return;
      for (let y = 0; y < CY; y++) {
        for (let t = 0; t < (ax !== 0 ? CZ : CX); t++) {
          const lx = ax !== 0 ? (ax > 0 ? 0 : CX - 1) : t;
          const lz = az !== 0 ? (az > 0 ? 0 : CZ - 1) : t;
          const nxl = ax !== 0 ? (ax > 0 ? CX - 1 : 0) : t;
          const nzl = az !== 0 ? (az > 0 ? CZ - 1 : 0) : t;
          const ni = idx(nxl, y, nzl);
          const li = idx(lx, y, lz);
          if (isOpaque(c.blocks[li])) continue;
          const ns = n.skyLight[ni] - 1;
          if (ns > sky[li]) {
            sky[li] = ns;
            skyQ.push(li);
          }
          const nb = n.blockLight[ni] - 1;
          if (nb > blk[li]) {
            blk[li] = nb;
            blkQ.push(li);
          }
        }
      }
    };
    seedFrom(c.cx - 1, c.cz, 1, 0);
    seedFrom(c.cx + 1, c.cz, -1, 0);
    seedFrom(c.cx, c.cz - 1, 0, 1);
    seedFrom(c.cx, c.cz + 1, 0, -1);

    // --- seed block light from emitters
    for (let i = 0; i < c.blocks.length; i++) {
      const l = lightOf(c.blocks[i]);
      if (l > 0 && l > blk[i]) {
        blk[i] = l;
        blkQ.push(i);
      }
    }

    // --- BFS
    const spread = (arr: Uint8Array, queue: number[], skyMode: boolean) => {
      let head = 0;
      while (head < queue.length) {
        const i = queue[head++];
        const level = arr[i];
        if (level <= 0) continue;

        const y = Math.floor(i / (CX * CZ));
        const rem = i - y * CX * CZ;
        const z = Math.floor(rem / CX);
        const x = rem - z * CX;

        for (let d = 0; d < 6; d++) {
          const dx = d === 0 ? -1 : d === 1 ? 1 : 0;
          const dy = d === 2 ? -1 : d === 3 ? 1 : 0;
          const dz = d === 4 ? -1 : d === 5 ? 1 : 0;
          const nx = x + dx;
          const ny = y + dy;
          const nz = z + dz;
          if (ny < 0 || ny >= CY) continue;
          if (nx < 0 || nx >= CX || nz < 0 || nz >= CZ) continue;
          const ni = idx(nx, ny, nz);
          if (isOpaque(c.blocks[ni])) continue;
          // Sky light falls straight down without attenuating.
          const next = skyMode && dy === -1 && level === 15 ? 15 : level - 1;
          if (next > arr[ni]) {
            arr[ni] = next;
            queue.push(ni);
          }
        }
      }
    };

    spread(sky, skyQ, true);
    spread(blk, blkQ, false);

    c.lightDirty = false;
    this.queueMesh(c);

    // Let the seams settle.
    for (const [dx, dz] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const) {
      const n = this.chunks.get(chunkKey(c.cx + dx, c.cz + dz));
      if (n) this.queueMesh(n);
    }

    void ox;
    void oz;
  }

  // -------------------------------------------------------------- streaming

  /** Called every frame with the player position. */
  update(px: number, pz: number, warmth: number): void {
    const pcx = Math.floor(px / CX);
    const pcz = Math.floor(pz / CZ);

    // 1. Generate nearby chunks, nearest first.
    let gen = 0;
    outer: for (let r = 0; r <= VIEW_RADIUS; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const c = this.acquire(pcx + dx, pcz + dz);
          if (!c.generated) {
            generateChunk(c, this.seed);
            c.rebuildHeightMap();
            c.generated = true;
            c.dirty = true;
            c.lightDirty = true;
            if (!c.inLightQueue) { c.inLightQueue = true; this.lightQueue.push(c); }
            // A new neighbour changes our seams.
            this.touch(c.cx - 1, c.cz);
            this.touch(c.cx + 1, c.cz);
            this.touch(c.cx, c.cz - 1);
            this.touch(c.cx, c.cz + 1);
            if (++gen >= GEN_BUDGET) break outer;
          }
        }
      }
    }

    // 2. Relight.
    this.lightQueue.sort(
      (a, b) => dist2(a, pcx, pcz) - dist2(b, pcx, pcz),
    );
    let lit = 0;
    while (this.lightQueue.length && lit < LIGHT_BUDGET) {
      const c = this.lightQueue.shift()!;
      c.inLightQueue = false;
      if (!c.generated || c.unloaded) continue;
      this.computeLight(c);
      lit++;
    }

    // 3. Remesh.
    this.meshQueue.sort((a, b) => dist2(a, pcx, pcz) - dist2(b, pcx, pcz));
    let meshed = 0;
    while (this.meshQueue.length && meshed < MESH_BUDGET) {
      const c = this.meshQueue.shift()!;
      c.inMeshQueue = false;
      if (!c.generated || c.unloaded || c.lightDirty) continue;
      this.remesh(c, warmth);
      meshed++;
    }

    // 4. Unload the far field.
    let unloaded = 0;
    for (const [k, c] of this.chunks) {
      if (Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz)) > KEEP_RADIUS) {
        c.unloaded = true;
        c.dispose();
        this.chunks.delete(k);
        unloaded++;
      }
    }
    // Drop dead chunks from the work queues. Without this a chunk that was
    // unloaded while queued gets rebuilt afterwards and its meshes are added to
    // the scene with nothing holding a reference to dispose them.
    if (unloaded) {
      this.lightQueue = this.lightQueue.filter((c) => !c.unloaded);
      this.meshQueue = this.meshQueue.filter((c) => !c.unloaded);
    }
  }

  private remesh(c: Chunk, warmth: number): void {
    const built = buildChunkMeshes(this, c, this.atlas, warmth);
    c.dispose();
    if (built.opaque) {
      this.group.add(built.opaque);
      c.mesh = built.opaque;
    }
    if (built.cross) {
      this.group.add(built.cross);
      c.crossMesh = built.cross;
    }
    if (built.water) {
      this.group.add(built.water);
      c.waterMesh = built.water;
    }
    c.dirty = false;
  }

  /**
   * Force every resident chunk to remesh.
   *
   * EXPENSIVE — this is a full rebuild of every loaded chunk (~360 of them,
   * each a 16x128x16 scan). It was being called on a 1.5s timer by Moloch,
   * which produced a guaranteed hitch forever. Call it only when something
   * genuinely global changes, and prefer queueMesh() for local edits.
   */
  markAllDirty(): void {
    for (const c of this.chunks.values()) {
      if (!c.generated) continue;
      c.dirty = true;
      this.queueMesh(c);
    }
  }

  /** True once the chunk under the player and its ring are meshed. */
  readyAt(px: number, pz: number): boolean {
    const pcx = Math.floor(px / CX);
    const pcz = Math.floor(pz / CZ);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.getChunk(pcx + dx, pcz + dz);
        if (!c || !c.generated || c.lightDirty) return false;
      }
    }
    return true;
  }

  /** Highest solid block at a column, or -1. */
  heightAt(x: number, z: number): number {
    const cx = Math.floor(x / CX);
    const cz = Math.floor(z / CZ);
    const c = this.ensureGenerated(cx, cz);
    return c.heightMap[(z - cz * CZ) * CX + (x - cx * CX)];
  }
}

function dist2(c: Chunk, pcx: number, pcz: number): number {
  const dx = c.cx - pcx;
  const dz = c.cz - pcz;
  return dx * dx + dz * dz;
}
