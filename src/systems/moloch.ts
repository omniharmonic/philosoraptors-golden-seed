/**
 * Moloch — the antagonist that is not a monster.
 *
 * There is nothing here to kill. Moloch is a pressure field that rises whenever
 * value is taken out of the commons faster than it is put back, and it is
 * expressed the way Ep1 expresses it: the light gets weaker. Chunks lose tend
 * score, the palette slides cold, seeds stop regrowing.
 *
 * Crucially it cannot be reduced by a solo player at high pressure — individual
 * virtue is not the counter to a multipolar trap. Only fired seals (quorum
 * acts) cut it meaningfully. That asymmetry is the entire lesson, encoded.
 */

import type { World } from '../world/World';
import { CX, CZ } from '../world/Chunk';

export class Moloch {
  /** 0 = the tended valley, 1 = the gray one. */
  pressure = 0.18;

  /** Seeds hauled out of the world without replanting, all players. */
  extraction = 0;
  /** Quorum acts completed. */
  quorumActs = 0;

  private tick = 0;

  /** Called when any player takes a seed without planting one. */
  onExtract(n = 1): void {
    this.extraction += n;
    this.pressure = Math.min(1, this.pressure + 0.012 * n);
  }

  /** Called when a seed is pressed back into soil. */
  onPlant(n = 1): void {
    this.pressure = Math.max(0, this.pressure - 0.004 * n);
  }

  /**
   * A quorum act. Deliberately far stronger than any solo action — this is the
   * only lever that actually moves the field once pressure is high.
   */
  onQuorum(quorumSize: number): void {
    this.quorumActs++;
    this.pressure = Math.max(0, this.pressure - 0.05 * quorumSize);
  }

  update(dt: number, world: World, px: number, pz: number): void {
    // Baseline creep. Doing nothing is not neutral.
    this.pressure = Math.min(1, this.pressure + dt * 0.0016);

    this.tick += dt;
    if (this.tick < 1.5) return;
    this.tick = 0;

    // Spread the gray outward from wherever pressure is high, one ring of
    // chunks at a time, biased toward chunks already low on tend.
    if (this.pressure < 0.35) return;
    const pcx = Math.floor(px / CX);
    const pcz = Math.floor(pz / CZ);
    const reach = 4;
    const bite = (this.pressure - 0.35) * 0.9;

    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const c = world.getChunk(pcx + dx, pcz + dz);
        if (!c || !c.generated) continue;
        if (c.tend <= -30) continue;
        // Already-degraded ground degrades faster. Traps compound.
        const vuln = c.tend < 0 ? 1.6 : 1.0;
        const before = c.tend;
        c.tend -= bite * vuln;
        if (c.tend < -40) c.tend = -40;
        // Only queue a rebuild when the tint actually moved enough to see.
        if (Math.abs(before - c.tend) > 0.35) world.queueMesh(c);
      }
    }
  }

  /** Label for the HUD. */
  get band(): string {
    if (this.pressure < 0.2) return 'quiet';
    if (this.pressure < 0.4) return 'stirring';
    if (this.pressure < 0.6) return 'grinding';
    if (this.pressure < 0.8) return 'devouring';
    return 'ascendant';
  }
}
