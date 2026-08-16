import * as THREE from 'three';
import { Chunk, CX, CY, CZ, idx } from './Chunk';
import type { World } from './World';
import { AIR, isCross, isLiquid, isOpaque, blockDef } from './blocks';
import type { Atlas } from '../art/atlas';
import { FACE_BOTTOM, FACE_SIDE, FACE_TOP } from '../art/atlas';
import { BLOCKLIGHT_TINT, SKYLIGHT_COLD, SKYLIGHT_WARM, mixRgb, type RGB } from '../art/palette';

/**
 * Face table. Corners run bottom-left, bottom-right, top-right, top-left as
 * seen from outside the face, so UVs map without rotation.
 */
interface Face {
  n: [number, number, number];
  /** Axis index of the normal: 0=x, 1=y, 2=z. */
  axis: number;
  corners: [number, number, number][];
  slot: number;
  /** Directional shading. Sky is brightest, undersides darkest. */
  shade: number;
}

const FACES: Face[] = [
  {
    n: [1, 0, 0], axis: 0, slot: FACE_SIDE, shade: 0.72,
    corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
  },
  {
    n: [-1, 0, 0], axis: 0, slot: FACE_SIDE, shade: 0.72,
    corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  },
  {
    n: [0, 1, 0], axis: 1, slot: FACE_TOP, shade: 1.0,
    corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  },
  {
    n: [0, -1, 0], axis: 1, slot: FACE_BOTTOM, shade: 0.45,
    corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  },
  {
    n: [0, 0, 1], axis: 2, slot: FACE_SIDE, shade: 0.86,
    corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  },
  {
    n: [0, 0, -1], axis: 2, slot: FACE_SIDE, shade: 0.86,
    corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
  },
];

const UV: [number, number][] = [
  [0, 1],
  [1, 1],
  [1, 0],
  [0, 0],
];

/**
 * No `normal` array. The world draws with MeshBasicMaterial and fully baked
 * vertex-colour lighting, so normals are never read — they were 12 bytes per
 * vertex of dead weight across every chunk mesh in the world.
 */
interface Buffers {
  pos: number[];
  uv: number[];
  col: number[];
  index: number[];
}

const newBuffers = (): Buffers => ({ pos: [], uv: [], col: [], index: [] });

export interface ChunkMeshes {
  opaque: THREE.Mesh | null;
  cross: THREE.Mesh | null;
  water: THREE.Mesh | null;
}

let opaqueMaterial: THREE.MeshBasicMaterial | null = null;
let crossMaterial: THREE.MeshBasicMaterial | null = null;
let waterMaterial: THREE.MeshBasicMaterial | null = null;

function materials(atlas: Atlas) {
  if (!opaqueMaterial) {
    // unlit(): chunk meshes carry no `normal` attribute, and on WebGPU a lit
    // basic material would reach for one via the scene's HemisphereLight. See
    // src/art/unlit.ts. The lighting result is discarded either way, so this
    // changes no pixels on either backend.
    opaqueMaterial = unlit(new THREE.MeshBasicMaterial({
      map: atlas.texture,
      vertexColors: true,
      alphaTest: 0.5,
      fog: true,
    }));
    crossMaterial = unlit(new THREE.MeshBasicMaterial({
      map: atlas.texture,
      vertexColors: true,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      fog: true,
    }));
    waterMaterial = unlit(new THREE.MeshBasicMaterial({
      map: atlas.texture,
      vertexColors: true,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    }));
  }
  return {
    opaque: opaqueMaterial!,
    cross: crossMaterial!,
    water: waterMaterial!,
  };
}

/**
 * Build the three meshes for a chunk.
 *
 * `warmth` is the global 0..1 drift toward the tended palette; each chunk's own
 * tend score biases it locally, so an over-harvested pocket stays visibly cold
 * inside an otherwise warm valley. That is the whole Ep3 thesis rendered as
 * vertex colour.
 */
export function buildChunkMeshes(
  world: World,
  chunk: Chunk,
  atlas: Atlas,
  warmth: number,
): ChunkMeshes {
  const solid = newBuffers();
  const cross = newBuffers();
  const water = newBuffers();

  const ox = chunk.cx * CX;
  const oz = chunk.cz * CZ;

  // Local warmth: global drift plus this chunk's own tending history.
  const localWarm = Math.max(0, Math.min(1, warmth + chunk.tend / 40));
  const skyTint: RGB = mixRgb(SKYLIGHT_COLD, SKYLIGHT_WARM, localWarm);

  const uvSize = atlas.uvSize;

  /** Light sample at a world cell, or a sky default outside loaded chunks. */
  const lightAt = (x: number, y: number, z: number): [number, number] => [
    world.getSkyLight(x, y, z),
    world.getBlockLight(x, y, z),
  ];

  const opaqueAt = (x: number, y: number, z: number) => isOpaque(world.getBlock(x, y, z));

  for (let y = 0; y < CY; y++) {
    for (let z = 0; z < CZ; z++) {
      for (let x = 0; x < CX; x++) {
        const id = chunk.blocks[idx(x, y, z)];
        if (id === AIR) continue;

        const wx = ox + x;
        const wz = oz + z;

        if (isCross(id)) {
          emitCross(cross, atlas, id, wx, y, wz, world, skyTint, uvSize);
          continue;
        }

        const liquid = isLiquid(id);
        const buf = liquid ? water : solid;

        for (const face of FACES) {
          const nx = wx + face.n[0];
          const ny = y + face.n[1];
          const nz = wz + face.n[2];
          const neighbour = world.getBlock(nx, ny, nz);

          // Cull hidden faces. Liquids only render against non-liquid.
          if (liquid) {
            if (isLiquid(neighbour) || isOpaque(neighbour)) continue;
          } else if (isOpaque(neighbour)) {
            continue;
          } else if (neighbour === id && !isOpaque(id)) {
            // Merge adjacent identical transparent blocks (leaves, glass).
            continue;
          }

          const tile = atlas.tileOf(id, face.slot);
          const u0 = (tile % 16) * uvSize;
          const v0 = Math.floor(tile / 16) * uvSize;

          const base = buf.pos.length / 3;
          const aoVals: number[] = [];

          for (let ci = 0; ci < 4; ci++) {
            const c = face.corners[ci];
            buf.pos.push(wx + c[0], y + c[1], wz + c[2]);
            buf.uv.push(u0 + UV[ci][0] * uvSize, v0 + UV[ci][1] * uvSize);

            // --- smooth lighting + ambient occlusion
            const axes = [0, 1, 2].filter((a) => a !== face.axis);
            const sgn = (a: number) => (c[a] === 1 ? 1 : -1);
            const off = (a: number, s: number): [number, number, number] => {
              const o: [number, number, number] = [0, 0, 0];
              o[a] = s;
              return o;
            };
            const b = axes[0];
            const cAx = axes[1];
            const ob = off(b, sgn(b));
            const oc = off(cAx, sgn(cAx));

            const p0: [number, number, number] = [nx, ny, nz];
            const p1: [number, number, number] = [nx + ob[0], ny + ob[1], nz + ob[2]];
            const p2: [number, number, number] = [nx + oc[0], ny + oc[1], nz + oc[2]];
            const p3: [number, number, number] = [
              nx + ob[0] + oc[0],
              ny + ob[1] + oc[1],
              nz + ob[2] + oc[2],
            ];

            const s1 = opaqueAt(...p1);
            const s2 = opaqueAt(...p2);
            const cn = opaqueAt(...p3);
            const ao = s1 && s2 ? 0 : 3 - ((s1 ? 1 : 0) + (s2 ? 1 : 0) + (cn ? 1 : 0));
            const aoF = 0.55 + (ao / 3) * 0.45;
            aoVals.push(ao);

            // Average the four light samples that touch this vertex.
            let sky = 0;
            let blk = 0;
            let n = 0;
            for (const p of [p0, p1, p2, p3]) {
              if (opaqueAt(...p)) continue;
              const [s, bl] = lightAt(...p);
              sky += s;
              blk += bl;
              n++;
            }
            if (n === 0) {
              const [s, bl] = lightAt(nx, ny, nz);
              sky = s;
              blk = bl;
              n = 1;
            }
            sky /= n * 15;
            blk /= n * 15;

            pushLitColor(buf.col, skyTint, sky, blk, face.shade * aoF);
          }

          // Flip the quad's diagonal when AO would otherwise crease it wrongly.
          if (aoVals[0] + aoVals[2] > aoVals[1] + aoVals[3]) {
            buf.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
          } else {
            buf.index.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
          }
        }
      }
    }
  }

  const mats = materials(atlas);
  return {
    opaque: toMesh(solid, mats.opaque, 'chunk'),
    cross: toMesh(cross, mats.cross, 'cross'),
    water: toMesh(water, mats.water, 'water'),
  };
}

/** Combine the two light channels into a vertex colour. */
function pushLitColor(
  out: number[],
  skyTint: RGB,
  sky: number,
  blk: number,
  shade: number,
): void {
  // Gamma-ish curves: sky falls off softly, ember light stays punchy.
  const s = Math.pow(Math.max(0, Math.min(1, sky)), 1.45) * shade;
  const b = Math.pow(Math.max(0, Math.min(1, blk)), 1.15);
  const amb = 0.05;
  out.push(
    Math.min(1.6, amb + skyTint[0] * s + BLOCKLIGHT_TINT[0] * b * 1.35),
    Math.min(1.6, amb + skyTint[1] * s + BLOCKLIGHT_TINT[1] * b * 1.15),
    Math.min(1.6, amb + skyTint[2] * s + BLOCKLIGHT_TINT[2] * b * 0.85),
  );
}

/** Plants render as two crossed quads so they read from every angle. */
function emitCross(
  buf: Buffers,
  atlas: Atlas,
  id: number,
  wx: number,
  y: number,
  wz: number,
  world: World,
  skyTint: RGB,
  uvSize: number,
): void {
  const tile = atlas.tileOf(id, FACE_SIDE);
  const u0 = (tile % 16) * uvSize;
  const v0 = Math.floor(tile / 16) * uvSize;

  const sky = world.getSkyLight(wx, y, wz) / 15;
  const blk = Math.max(
    world.getBlockLight(wx, y, wz),
    blockDef(id)?.light ?? 0,
  ) / 15;

  const quads: [number, number, number, number][] = [
    // x0, z0, x1, z1 across the cell diagonal
    [0.146, 0.146, 0.854, 0.854],
    [0.854, 0.146, 0.146, 0.854],
  ];

  for (const [x0, z0, x1, z1] of quads) {
    const base = buf.pos.length / 3;
    const pts: [number, number, number][] = [
      [wx + x0, y, wz + z0],
      [wx + x1, y, wz + z1],
      [wx + x1, y + 1, wz + z1],
      [wx + x0, y + 1, wz + z0],
    ];
    for (let i = 0; i < 4; i++) {
      buf.pos.push(pts[i][0], pts[i][1], pts[i][2]);
      buf.uv.push(u0 + UV[i][0] * uvSize, v0 + UV[i][1] * uvSize);
      // Slight vertical gradient: darker at the root, brighter at the tip.
      const tip = i >= 2 ? 1.0 : 0.82;
      pushLitColor(buf.col, skyTint, sky * tip, blk, 0.95);
    }
    buf.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function toMesh(b: Buffers, mat: THREE.Material, name: string): THREE.Mesh | null {
  if (b.index.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  g.setIndex(b.index);
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat);
  m.name = name;
  m.frustumCulled = true;
  return m;
}

/** Exposed for the HUD's "what am I standing in" readout. */
export const chunkBounds = { CX, CY, CZ };
