import { SPARK_MAX, SPARK_REGEN, SPARK_BEAM_COST, SPARK_FLY_COST } from '../net/protocol';

/**
 * Spark — the fast, self-refilling resource.
 *
 * Deliberately separate from Coherence. Coherence is the slow social stat: it
 * is earned from other raptors, it decays if you hoard, and it gates what you
 * are allowed to attempt. Spark is the opposite in every way — it refills on
 * its own in about five seconds and is meant to be spent constantly.
 *
 * That split is the fix for the game feeling like a survival sim: when the
 * moment-to-moment resource is scarce you play defensively and count every
 * action, and when it refills fast you play with it. Flight and the beam both
 * cost Spark, never Coherence, so flying around firing a stream at the ground
 * is free in the only currency that would have punished you for it.
 */
export class Spark {
  value = SPARK_MAX;
  /** Seconds since the last spend; regen holds off briefly so it reads as a beat. */
  private idle = 0;
  /** Rises while spending, for the HUD's crackle and the beam's thickness. */
  strain = 0;

  get ratio(): number { return this.value / SPARK_MAX; }
  get empty(): boolean { return this.value <= 0.5; }

  /**
   * Hysteresis for held actions. Without it a beam held past empty strobes:
   * it cuts out, regen immediately refills a sliver, the beam resumes, drains
   * it, and the whole thing flickers several times a second. Once you bottom
   * out you must recover a real amount before the stream will restart.
   */
  private locked = false;
  get available(): boolean {
    if (this.value <= 0.5) this.locked = true;
    else if (this.locked && this.ratio > 0.28) this.locked = false;
    return !this.locked;
  }

  /** Try to spend `perSecond` for `dt`. Returns false if there is not enough. */
  spend(perSecond: number, dt: number): boolean {
    const cost = perSecond * dt;
    if (this.value < cost) { this.value = 0; return false; }
    this.value -= cost;
    this.idle = 0;
    this.strain = Math.min(1, this.strain + dt * 3);
    return true;
  }

  beam(dt: number): boolean { return this.spend(SPARK_BEAM_COST, dt); }
  fly(dt: number): boolean { return this.spend(SPARK_FLY_COST, dt); }

  /** A one-off cost, e.g. opening a seal. */
  spendBurst(amount: number): boolean {
    if (this.value < amount) return false;
    this.value -= amount;
    this.idle = 0;
    this.strain = Math.min(1, this.strain + 0.35);
    return true;
  }

  update(dt: number): void {
    this.idle += dt;
    this.strain = Math.max(0, this.strain - dt * 1.6);
    // Short hold-off, then a fast refill. ~5s from empty to full.
    if (this.idle > 0.45) {
      this.value = Math.min(SPARK_MAX, this.value + SPARK_REGEN * dt);
    }
  }

  /** Refill instantly — the reward for a quorum act or a Golden Seed. */
  refill(): void {
    this.value = SPARK_MAX;
    this.idle = 0;
  }
}
