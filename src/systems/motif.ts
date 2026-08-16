/**
 * The five-note kalimba motif.
 *
 * Canon: it threads all sixteen episodes, and it *changes* — "very faint, like a
 * question" in Ep1a, "clear and warm, like an answer" in Ep1b, traded between
 * two instruments in Ep2a, hummed in harmony by the whole circle in Ep2b,
 * played back "slightly wrong — too perfect, no warmth" by the obsidian egg in
 * Ep4a, and finally "warm, slightly imperfect, alive" in Ep4b.
 *
 * So it is not background music, it is a readout: the same five notes tell you
 * what just happened and how the world feels about it. Synthesised rather than
 * sampled so there are no audio assets to ship and no licensing to think about.
 */

const NOTES = [0, 2, 5, 7, 11]; // a pentatonic-ish shape, the "five notes"

export type MotifMood =
  | 'question'   // Ep1a: faint, unresolved, ends hanging
  | 'answer'     // Ep1b: clear and warm
  | 'traded'     // Ep2a: two voices alternating
  | 'harmony'    // Ep2b: the whole circle
  | 'wrong'      // Ep4a: too perfect, detuned bright, no warmth
  | 'alive';     // Ep4b: warm, slightly imperfect

export class Motif {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  /** Must be called from a user gesture — browsers block audio otherwise. */
  start(): void {
    if (this.ctx) return;
    try {
      const Ctor = window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.level;
      this.master.connect(this.ctx.destination);
    } catch {
      // No audio is a perfectly playable game. Never throw for a nice-to-have.
      this.ctx = null;
    }
  }

  /** Live volume, 0..1. */
  setVolume(v: number): void {
    this.level = Math.max(0, Math.min(1, v));
    this.muted = this.level <= 0.001;
    if (this.master) this.master.gain.value = this.level;
  }

  private level = 0.22;

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : this.level;
    return this.muted;
  }

  /**
   * A single plucked tine. Kalimba is a fast attack, a long woody decay and a
   * strong odd harmonic, which two detuned sines plus a short noise tick get
   * close enough to at this scale.
   */
  private pluck(freq: number, at: number, gain = 1, detune = 0): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + at;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.9 * gain, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    env.connect(this.master);

    for (const [mult, level, dt] of [[1, 1, 0], [2.01, 0.28, 0.004], [3.02, 0.11, 0.008]] as const) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * mult;
      o.detune.value = detune;
      const g = this.ctx.createGain();
      g.gain.value = level;
      o.connect(g).connect(env);
      o.start(t + dt);
      o.stop(t + 1.6);
    }
  }

  /** Play the motif in a given mood. */
  play(mood: MotifMood = 'answer', root = 293.66): void {
    this.start();
    if (!this.ctx || this.muted) return;

    const step = (n: number) => root * Math.pow(2, n / 12);
    const gap = mood === 'question' ? 0.20 : mood === 'harmony' ? 0.13 : 0.16;

    NOTES.forEach((n, i) => {
      const at = i * gap;
      switch (mood) {
        case 'question':
          // Faint, and the last note lifts instead of landing.
          this.pluck(step(i === 4 ? n + 2 : n), at, 0.28);
          break;
        case 'answer':
          this.pluck(step(n), at, 0.75);
          break;
        case 'traded':
          // Alternating voices, one an octave up — two instruments passing it.
          this.pluck(step(n + (i % 2 ? 12 : 0)), at, 0.7, i % 2 ? 6 : -6);
          break;
        case 'harmony':
          this.pluck(step(n), at, 0.6);
          this.pluck(step(n + 7), at + 0.012, 0.4, 4);
          this.pluck(step(n + 12), at + 0.02, 0.25, -4);
          break;
        case 'wrong':
          // Quantised dead flat and detuned sharp: too perfect, no warmth.
          this.pluck(step(n), i * 0.15, 0.7, 34);
          break;
        case 'alive':
          // Human timing and touch: it breathes.
          this.pluck(step(n), at + (Math.random() - 0.5) * 0.035,
                     0.62 + Math.random() * 0.3, (Math.random() - 0.5) * 9);
          break;
      }
    });
  }

  /** Small non-motif sounds. Whimsy is mostly made of these. */
  blip(freq = 880, gain = 0.4, dur = 0.09): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 1.6, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** A raptor chirp — birdlike, two quick rising blips. */
  chirp(): void {
    const f = 700 + Math.random() * 500;
    this.blip(f, 0.22, 0.06);
    setTimeout(() => this.blip(f * 1.5, 0.16, 0.05), 55);
  }

  /** Continuous beam hum, started and stopped by the caller. */
  private beamOsc: { osc: OscillatorNode; gain: GainNode } | null = null;

  beamOn(): void {
    this.start();
    if (!this.ctx || !this.master || this.beamOsc || this.muted) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = 62;
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 17;
    lfoGain.gain.value = 14;
    lfo.connect(lfoGain).connect(o.frequency);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    g.gain.setValueAtTime(0, this.ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.13, this.ctx.currentTime + 0.08);
    o.connect(filter).connect(g).connect(this.master);
    o.start(); lfo.start();
    this.beamOsc = { osc: o, gain: g };
  }

  beamOff(): void {
    if (!this.ctx || !this.beamOsc) return;
    const { osc, gain } = this.beamOsc;
    const t = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.stop(t + 0.15);
    this.beamOsc = null;
  }
}
