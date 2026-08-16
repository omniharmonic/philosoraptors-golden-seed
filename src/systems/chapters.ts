/**
 * The eight chapters of the Alignment arc.
 *
 * Each one is gated on an act rather than a kill or a fetch, and the shape of
 * the gates is the argument: chapters 1 needs only you, chapter 2 needs one
 * other, and by chapter 8 you need seven. The difficulty curve is a
 * coordination curve.
 */

import type { SpellKey } from './spells';

export interface Chapter {
  n: number;
  title: string;
  subtitle: string;
  /** Where the player should go. */
  site: string;
  objective: string;
  /** Fired when this seal type completes, if any. */
  requires: SpellKey | null;
  /** Alternative non-seal completion, checked by the game loop. */
  custom?: 'reflect' | 'plant' | 'hatch' | 'restore';
  epigraph: string;
}

export const CHAPTERS: Chapter[] = [
  {
    n: 1,
    title: 'The Pool',
    subtitle: 'Alignment within',
    site: 'pool',
    objective: 'Find the still pool. Crouch at its edge and look at your reflection.',
    requires: null,
    custom: 'reflect',
    epigraph:
      'Between the scales a single small golden feather unfurls, glowing softly like an ember.',
  },
  {
    n: 2,
    title: 'The Mirror Fire',
    subtitle: 'Alignment between two',
    site: 'council',
    objective: 'Open a Mirror Fire seal at the council ring and have one other mark it.',
    requires: 'mirror',
    epigraph:
      'Their breathing falls into sync — and with each shared breath the fire steadies.',
  },
  {
    n: 3,
    title: 'The Circle',
    subtitle: 'Alignment among many',
    site: 'council',
    objective: 'Roll belly-up and open a Belly-up seal. Three sigils are needed.',
    requires: 'admission',
    epigraph:
      'Faint threads of golden light appear chest to chest between them, the whole circle turning like a living mandala.',
  },
  {
    n: 4,
    title: 'The Two Valleys',
    subtitle: 'The choice, side by side',
    site: 'valleys',
    objective: 'Stand between the slopes. Plant twelve seeds back into the gray soil.',
    requires: null,
    custom: 'plant',
    epigraph:
      'Roots of golden light spread visibly underground from each seed, reaching toward each other beneath the whole valley, joining.',
  },
  {
    n: 5,
    title: 'The Weave That Catches',
    subtitle: 'Aligned incentives',
    site: 'valleys',
    objective: 'Open a Weave seal over a gap. Three sigils. It will catch whoever falls.',
    requires: 'weave',
    epigraph:
      'The woven net of light swings out and catches it softly — the whole flock feels the pull and holds.',
  },
  {
    n: 6,
    title: 'The New Mind',
    subtitle: 'The checks that lie',
    site: 'hall',
    objective:
      'At the hall: cast an Honest Tally to expose the green lantern, then Preen what cannot see its own back.',
    requires: 'preen',
    custom: 'hatch',
    epigraph:
      'I cannot see my own back — will you preen me?',
  },
  {
    n: 7,
    title: 'The Song of Rings',
    subtitle: 'Coherence becomes a door',
    site: 'crater',
    objective: 'Reach the obelisk in the crater. Five voices must sing the motif together.',
    requires: 'song',
    epigraph:
      'The falling glyphs slow and lock together into the tall outline of a doorway.',
  },
  {
    n: 8,
    title: 'The Golden Seed',
    subtitle: 'The third attractor, planted in material form',
    site: 'mesatown',
    objective: 'Seven sigils on one seal. There is no solo path. Plant the seed.',
    requires: 'seed',
    epigraph:
      'We were always going to be birds.',
  },
];

export class Chapters {
  current = 0;
  /** Progress counters for custom objectives. */
  seedsPlanted = 0;
  reflected = false;
  tallyCast = false;
  completed: boolean[] = CHAPTERS.map(() => false);

  get chapter(): Chapter {
    return CHAPTERS[Math.min(this.current, CHAPTERS.length - 1)];
  }

  get finished(): boolean {
    return this.completed.every(Boolean);
  }

  /** Called when a seal fires. Returns true if it advanced the story. */
  onSealFired(key: SpellKey): boolean {
    const ch = this.chapter;
    if (ch.requires === key && !this.completed[this.current]) {
      // Chapter 6 additionally requires the tally to have been cast first.
      if (ch.n === 6 && !this.tallyCast) return false;
      return this.complete();
    }
    return false;
  }

  onReflect(): boolean {
    if (this.chapter.custom === 'reflect' && !this.reflected) {
      this.reflected = true;
      return this.complete();
    }
    return false;
  }

  onPlant(): boolean {
    this.seedsPlanted++;
    if (this.chapter.custom === 'plant' && this.seedsPlanted >= 12) {
      return this.complete();
    }
    return false;
  }

  onTally(): void {
    this.tallyCast = true;
  }

  private complete(): boolean {
    this.completed[this.current] = true;
    if (this.current < CHAPTERS.length - 1) this.current++;
    return true;
  }

  /** Short status line for the HUD. */
  status(): string {
    if (this.finished) return 'The seed is planted. The web remembers.';
    const ch = this.chapter;
    if (ch.custom === 'plant') {
      return `${ch.objective} (${this.seedsPlanted}/12)`;
    }
    return ch.objective;
  }
}
