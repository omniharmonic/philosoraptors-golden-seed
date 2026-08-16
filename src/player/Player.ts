import * as THREE from 'three';
import type { World } from '../world/World';
import { isSolid, isLiquid } from '../world/blocks';
import { CY } from '../world/Chunk';
import type { Coherence } from '../systems/coherence';
import type { Spark } from '../systems/spark';

const WIDTH = 0.62;
const HEIGHT = 1.85;
const EYE = 1.62;

const GRAVITY = 26;
const WALK = 5.0;
const SPRINT = 8.2;
/**
 * Jump apex is v^2 / 2g. At the old 8.6 against g=26 that was 1.42 blocks —
 * enough for a single step and nothing else, so any two-block lip in the
 * terrain was a wall you could get wedged against. 10.7 clears 2.2 blocks.
 */
const JUMP = 10.7;
/** Ledges up to this high are walked over automatically. */
const STEP_HEIGHT = 1.05;
const TERMINAL = 46;

/** Flight constants, unlocked by coherence tier. */
const GLIDE_FALL = 3.4;
const GLIDE_PUSH = 3.0;
const LIFT_SPEED = 6.0;
const FLY_SPEED = 13.5;

export interface InputState {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
}

export class Player {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;

  onGround = false;
  inLiquid = false;
  gliding = false;
  flying = false;

  /** Ep4b: rolling belly-up. Blocks movement, but it is a move. */
  bellyUp = false;
  bellyTimer = 0;

  constructor(x: number, y: number, z: number) {
    this.pos.set(x, y, z);
  }

  get eye(): THREE.Vector3 {
    return new THREE.Vector3(this.pos.x, this.pos.y + EYE, this.pos.z);
  }

  forwardVector(): THREE.Vector3 {
    return new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    ).normalize();
  }

  update(dt: number, input: InputState, world: World, coh: Coherence, spark: Spark): void {
    if (this.bellyUp) {
      this.bellyTimer -= dt;
      if (this.bellyTimer <= 0) this.bellyUp = false;
      // Still fall while belly-up, but no steering. Vulnerability is real.
      this.vel.x *= 0.82;
      this.vel.z *= 0.82;
      this.vel.y -= GRAVITY * dt;
      this.integrate(dt, world);
      return;
    }

    // --- horizontal intent in world space
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let ix = 0;
    let iz = 0;
    if (input.forward) { ix -= sin; iz -= cos; }
    if (input.back) { ix += sin; iz += cos; }
    if (input.left) { ix -= cos; iz += sin; }
    if (input.right) { ix += cos; iz -= sin; }
    const len = Math.hypot(ix, iz);
    if (len > 0) { ix /= len; iz /= len; }

    this.inLiquid = isLiquid(
      world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.9), Math.floor(this.pos.z)),
    );

    // --- flight tiers
    const wantsUp = input.jump;
    this.flying = false;
    this.gliding = false;

    // Flight is paid in Spark, which refills on its own in a few seconds, so
    // it is a toy rather than a budget. Coherence only decides which tier you
    // are allowed to use, never how long you may stay up.
    if (coh.canFly && wantsUp && !this.onGround && spark.fly(dt)) {
      this.flying = true;
      const f = this.forwardVector();
      const speed = input.sprint ? FLY_SPEED * 1.5 : FLY_SPEED;
      this.vel.x = (ix * 0.55 + f.x * 0.75) * speed;
      this.vel.z = (iz * 0.55 + f.z * 0.75) * speed;
      this.vel.y = THREE.MathUtils.lerp(this.vel.y, LIFT_SPEED * 1.2, 0.16);
    } else if (coh.canLift && wantsUp && !this.onGround && spark.fly(dt)) {
      this.flying = true;
      const speed = input.sprint ? SPRINT : WALK;
      this.vel.x = ix * speed;
      this.vel.z = iz * speed;
      this.vel.y = THREE.MathUtils.lerp(this.vel.y, LIFT_SPEED, 0.14);
    } else if (coh.canGlide && wantsUp && !this.onGround && this.vel.y < 0) {
      // Glide: arms spread, slow descent, forward push.
      this.gliding = true;
      const f = this.forwardVector();
      this.vel.y = Math.max(this.vel.y, -GLIDE_FALL);
      this.vel.x += f.x * GLIDE_PUSH * dt * 4;
      this.vel.z += f.z * GLIDE_PUSH * dt * 4;
      const cap = SPRINT * 1.5;
      const hs = Math.hypot(this.vel.x, this.vel.z);
      if (hs > cap) { this.vel.x = (this.vel.x / hs) * cap; this.vel.z = (this.vel.z / hs) * cap; }
    } else {
      // --- grounded / falling
      const speed = input.sprint && !input.crouch ? SPRINT : input.crouch ? WALK * 0.4 : WALK;
      const control = this.onGround ? 1 : 0.22;
      this.vel.x = THREE.MathUtils.lerp(this.vel.x, ix * speed, control);
      this.vel.z = THREE.MathUtils.lerp(this.vel.z, iz * speed, control);

      if (this.inLiquid) {
        this.vel.y = Math.max(this.vel.y - GRAVITY * 0.28 * dt, -3.2);
        if (input.jump) this.vel.y = 4.2;
      } else {
        if (input.jump && this.onGround) this.vel.y = JUMP;
        this.vel.y -= GRAVITY * dt;
      }
    }

    if (this.vel.y < -TERMINAL) this.vel.y = -TERMINAL;
    this.integrate(dt, world);
  }

  /** Ep4b/Ep6b: the grief-ring gesture. */
  rollBellyUp(): void {
    this.bellyUp = true;
    this.bellyTimer = 3.2;
  }

  /**
   * Swept AABB resolution, one axis at a time. Resolving axes separately is
   * what lets you slide along a wall instead of sticking to it.
   */
  private integrate(dt: number, world: World): void {
    const step = (axis: 'x' | 'y' | 'z', amount: number) => {
      if (amount === 0) return;
      this.pos[axis] += amount;
      const hw = WIDTH / 2;
      const minX = Math.floor(this.pos.x - hw);
      const maxX = Math.floor(this.pos.x + hw);
      const minY = Math.floor(this.pos.y);
      const maxY = Math.floor(this.pos.y + HEIGHT);
      const minZ = Math.floor(this.pos.z - hw);
      const maxZ = Math.floor(this.pos.z + hw);

      for (let y = minY; y <= maxY; y++) {
        if (y < 0 || y >= CY) continue;
        for (let z = minZ; z <= maxZ; z++) {
          for (let x = minX; x <= maxX; x++) {
            if (!isSolid(world.getBlock(x, y, z))) continue;
            // Overlap — push back out along the axis we just moved.
            if (axis === 'x') {
              this.pos.x = amount > 0 ? x - hw - 1e-4 : x + 1 + hw + 1e-4;
              this.vel.x = 0;
            } else if (axis === 'z') {
              this.pos.z = amount > 0 ? z - hw - 1e-4 : z + 1 + hw + 1e-4;
              this.vel.z = 0;
            } else {
              if (amount > 0) {
                this.pos.y = y - HEIGHT - 1e-4;
              } else {
                this.pos.y = y + 1 + 1e-4;
                this.onGround = true;
              }
              this.vel.y = 0;
            }
            return;
          }
        }
      }
    };

    this.onGround = false;
    step('y', this.vel.y * dt);

    // Horizontal movement, with an automatic step up over low ledges. Without
    // this you catch on every single-block rise in the terrain and have to jump
    // constantly, which reads as the world being sticky rather than as a
    // challenge.
    const tryAxis = (axis: 'x' | 'z', amount: number) => {
      if (amount === 0) return;
      const beforePos = this.pos[axis];
      const beforeVel = this.vel[axis];
      step(axis, amount);
      const blocked = this.vel[axis] === 0 && beforeVel !== 0;
      if (!blocked || !this.onGround) return;
      // Blocked at foot height: see if lifting by a step clears it.
      const restoreY = this.pos.y;
      this.pos[axis] = beforePos;
      this.pos.y += STEP_HEIGHT;
      this.vel[axis] = beforeVel;
      step(axis, amount);
      if (this.vel[axis] === 0) {
        // Still blocked even raised — it is a real wall. Put us back.
        this.pos.y = restoreY;
        this.pos[axis] = beforePos;
        this.vel[axis] = 0;
      }
    };
    tryAxis('x', this.vel.x * dt);
    tryAxis('z', this.vel.z * dt);

    // Safety: never let the player fall out of the world.
    if (this.pos.y < -8) {
      this.pos.y = 90;
      this.vel.set(0, 0, 0);
    }
  }

  /** Drop the player onto the surface at their column. */
  settle(world: World): void {
    const h = world.heightAt(Math.floor(this.pos.x), Math.floor(this.pos.z));
    this.pos.y = Math.max(h + 1.2, 2);
    this.vel.set(0, 0, 0);
  }
}
