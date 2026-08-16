/**
 * The eight chapters of the Alignment arc.
 *
 * Each one is gated on an act rather than a kill or a fetch, and the shape of
 * the gates is the argument: chapters 1 needs only you, chapter 2 needs one
 * other, and by chapter 8 you need seven. The difficulty curve is a
 * coordination curve.
 */

import type { DeclKind } from './declarations';

export interface Chapter {
  n: number;
  title: string;
  subtitle: string;
  /** Where the player should go. */
  site: string;
  objective: string;
  /** Declaration that must become true to pass this chapter, if any. */
  requires: DeclKind | null;
  /** Alternative completion, checked by the game loop. */
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
    objective: 'Declare "The Ground Returns" (J to select, H to speak) and have one other align with it. Press V first — the flock align with you.',
    requires: 'green',
    epigraph:
      'Their breathing falls into sync — and with each shared breath the fire steadies.',
  },
  {
    n: 3,
    title: 'The Circle',
    subtitle: 'Alignment among many',
    site: 'council',
    objective: 'Roll belly-up (G), then declare "Belly-up". Three must align.',
    requires: 'admit',
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
    objective: 'Stand over a gap and declare "The Weave That Catches". Three must align; it will catch whoever falls.',
    requires: 'catch',
    epigraph:
      'The woven net of light swings out and catches it softly — the whole flock feels the pull and holds.',
  },
  {
    n: 6,
    title: 'The New Mind',
    subtitle: 'The checks that lie',
    site: 'hall',
    objective:
      'At the hall: declare "The Honest Tally" to expose the green lantern, then declare "Preening" for what cannot see its own back.',
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
    objective: 'Reach the obelisk in the crater and declare "The Song Becomes a Door". Four must align.',
    requires: 'door',
    epigraph:
      'The falling glyphs slow and lock together into the tall outline of a doorway.',
  },
  {
    n: 8,
    title: 'The Golden Seed',
    subtitle: 'The third attractor, planted in material form',
    site: 'mesatown',
    objective: 'Declare "The Golden Seed". Seven must align. There is no solo path.',
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

  /** Called when a declaration becomes true. Returns true if it advanced the story. */
  onDeclarationReal(key: DeclKind): boolean {
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
