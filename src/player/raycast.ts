import * as THREE from 'three';
import type { World } from '../world/World';
import { AIR, isLiquid } from '../world/blocks';

export interface Hit {
  /** Block hit. */
  x: number;
  y: number;
  z: number;
  /** Face normal — where a placed block would go. */
  nx: number;
  ny: number;
  nz: number;
  id: number;
  distance: number;
}

/**
 * Amanatides & Woo voxel traversal. Steps cell to cell along the ray rather
 * than sampling at fixed intervals, so it never tunnels through a thin wall.
 */
export function raycastVoxel(
  world: World,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist: number,
  hitLiquid = false,
): Hit | null {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const stepX = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
  const stepY = dir.y > 0 ? 1 : dir.y < 0 ? -1 : 0;
  const stepZ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;

  const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;

  const boundary = (p: number, step: number) =>
    step > 0 ? Math.floor(p) + 1 - p : p - Math.floor(p);

  let tMaxX = stepX !== 0 ? boundary(origin.x, stepX) * tDeltaX : Infinity;
  let tMaxY = stepY !== 0 ? boundary(origin.y, stepY) * tDeltaY : Infinity;
  let tMaxZ = stepZ !== 0 ? boundary(origin.z, stepZ) * tDeltaZ : Infinity;

  let nx = 0, ny = 0, nz = 0;
  let t = 0;

  for (let i = 0; i < 512 && t <= maxDist; i++) {
    const id = world.getBlock(x, y, z);
    if (id !== AIR && (hitLiquid || !isLiquid(id))) {
      return { x, y, z, nx, ny, nz, id, distance: t };
    }

    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX;
      nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY;
      nx = 0; ny = -stepY; nz = 0;
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ;
      nx = 0; ny = 0; nz = -stepZ;
    }
  }
  return null;
}
