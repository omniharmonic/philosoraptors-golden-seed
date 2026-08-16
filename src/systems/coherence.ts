/**
 * Coherence — the single stat that matters.
 *
 * It is deliberately not health and not mana. Canon frames it as the thing that
 * lets you travel ("we use coherence to travel in space"), so it gates
 * movement: at low coherence you are a scaled thing that walks, and at high
 * coherence you fly. Feather growth is the visible readout, staged exactly as
 * the episode style-strings stage it.
 */

export interface FeatherStage {
  at: number;
  name: string;
  desc: string;
}

/** Straight from the prompts: each episode's style string advances the plumage. */
export const FEATHER_STAGES: FeatherStage[] = [
  { at: 0, name: 'Bare', desc: 'Completely bare gray-green scaled skin. No feathers anywhere yet.' },
  { at: 10, name: 'One Feather', desc: 'A single small golden feather at the centre of the chest.' },
  { at: 25, name: 'Shoulders', desc: 'New golden feathers shimmer along the shoulders.' },
  { at: 40, name: 'Collar', desc: 'A growing collar of golden feathers at chest and shoulders.' },
  { at: 58, name: 'Colour', desc: 'Feathers tinged with your own colour — copper, teal, violet.' },
  { at: 75, name: 'Plumage', desc: 'Full magnificent plumage. A knitted shawl over the shoulders.' },
  { at: 92, name: 'Radiant', desc: 'Plumage blazing every colour. You were always going to be a bird.' },
];

export interface FlightTier {
  at: number;
  name: string;
  desc: string;
}

export const FLIGHT_TIERS: FlightTier[] = [
  { at: 0, name: 'Glide', desc: 'Hold Space while falling. You always had arms.' },
  { at: 12, name: 'Lift', desc: 'Hold Space to climb. Costs Spark, which refills itself.' },
  { at: 30, name: 'Free Flight', desc: 'Sustained flight. Go and look at the Divide.' },
];

export class Coherence {
  value = 0;
  /**
   * Lowers every flight threshold. Set from the Seed of Flight (see
   * Powers.flightThresholdShift) — the seed does not grant flight outright, it
   * moves the bar down, so coherence is still what carries you.
   */
  flightBonus = 0;
  /**
   * The thing you cannot see about yourself. Grows quietly; only another
   * raptor's Preening clears it. Ep4b is the whole design note.
   */
  blindSpot = 0;

  /** Seeds taken without replanting. Drives Moloch. */
  extracted = 0;
  /** Seeds pressed back into soil. */
  planted = 0;
  /** Seals this player has marked. */
  vouches = 0;

  private floatTimer = 0;

  gain(n: number, reason: string, log?: (s: string) => void): void {
    // A large blind spot means you are misreading your own situation, so your
    // own actions return less than you think they do.
    const eff = n * (1 - this.blindSpot * 0.55);
    this.value = Math.max(0, Math.min(100, this.value + eff));
    if (log && Math.abs(eff) >= 1) {
      log(`${eff > 0 ? '+' : ''}${eff.toFixed(0)} coherence — ${reason}`);
    }
  }

  lose(n: number, reason: string, log?: (s: string) => void): void {
    this.value = Math.max(0, this.value - n);
    log?.(`-${n.toFixed(0)} coherence — ${reason}`);
  }

  addBlindSpot(n: number): void {
    this.blindSpot = Math.max(0, Math.min(1, this.blindSpot + n));
  }

  clearBlindSpot(): void {
    this.blindSpot = 0;
  }

  update(dt: number, molochPressure: number): void {
    // Drift: unattended coherence decays slowly, faster under Moloch pressure.
    this.floatTimer += dt;
    if (this.floatTimer >= 1) {
      this.floatTimer = 0;
      // Only real Moloch pressure pulls it down, and gently. Idle decay made
      // exploring feel like losing, which is the opposite of the intent.
      const decay = molochPressure * 0.12;
      this.value = Math.max(0, this.value - decay);
      // You cannot see your own back, and it gets worse if nobody looks.
      this.addBlindSpot(0.0009 + molochPressure * 0.0016);
    }
  }

  get stage(): FeatherStage {
    let s = FEATHER_STAGES[0];
    for (const f of FEATHER_STAGES) if (this.value >= f.at) s = f;
    return s;
  }

  /** Coherence as flight sees it, once the Seed of Flight is accounted for. */
  get liftValue(): number { return this.value + this.flightBonus; }

  get flight(): FlightTier {
    let t = FLIGHT_TIERS[0];
    for (const f of FLIGHT_TIERS) if (this.liftValue >= f.at) t = f;
    return t;
  }

  get canGlide(): boolean { return true; }
  get canLift(): boolean { return this.liftValue >= 12; }
  get canFly(): boolean { return this.liftValue >= 30; }

  /** 0..1 drift toward the tended palette. Drives global grading. */
  get warmth(): number {
    return Math.max(0, Math.min(1, this.value / 85));
  }

  /** Next unlock, for the HUD. */
  nextUnlock(): { at: number; name: string } | null {
    for (const f of FLIGHT_TIERS) {
      if (this.liftValue < f.at) return { at: f.at - this.flightBonus, name: f.name };
    }
    return null;
  }
}
