/**
 * The in-game menu: Escape, or the `?` key.
 *
 * Everything a player needs to look up mid-game without leaving the world.
 * Previously the only reference was the entry screen, which you could not get
 * back to without reloading, and the only way out of pointer lock was Escape —
 * which dropped a full-screen wall over the game with no way to change a
 * setting.
 */

export interface GameOptions {
  /** Mouse look, 0.5x to 2.5x. */
  sensitivity: number;
  invertY: boolean;
  /** 0..1. */
  volume: number;
  muted: boolean;
  /** Chunks. Lower helps a weak machine more than anything else. */
  viewRadius: number;
  showFps: boolean;
  /** Vignette from the blind spot; some players find it uncomfortable. */
  vignette: boolean;
}

export const DEFAULT_OPTIONS: GameOptions = {
  sensitivity: 1,
  invertY: false,
  volume: 0.22,
  muted: false,
  viewRadius: 8,
  showFps: true,
  vignette: true,
};

const STORE_KEY = 'philo-options';

export function loadOptions(): GameOptions {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { ...DEFAULT_OPTIONS };
    return { ...DEFAULT_OPTIONS, ...(JSON.parse(raw) as Partial<GameOptions>) };
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

function saveOptions(o: GameOptions): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(o)); } catch { /* private mode */ }
}

/** Every binding in the game, in one place, grouped the way a player thinks. */
export const CONTROLS: { group: string; rows: [string, string][] }[] = [
  {
    group: 'Moving',
    rows: [
      ['W A S D', 'walk'],
      ['Shift', 'sprint'],
      ['Space', 'jump — hold to glide, then fly as coherence grows'],
      ['Ctrl / C', 'crouch, and reflect at the pool'],
      ['R', 'unstick yourself onto solid ground'],
    ],
  },
  {
    group: 'Your hands',
    rows: [
      ['1 – 9', 'pick a tool or block'],
      ['1', 'claws — hold left mouse to break'],
      ['2', 'the stream — hold left mouse to heal ground, tether a Moloch, or preen'],
      ['3 – 9', 'materials — right mouse to place'],
      ['Scroll / Q / E', 'cycle the hotbar'],
    ],
  },
  {
    group: 'Working together',
    rows: [
      ['V', 'call the flock — they follow you and add their streams'],
      ['J', 'cycle which declaration you will speak'],
      ['H', 'declare it'],
      ['Y or F', 'align with a declaration — your flock align too'],
      ['G', 'roll belly-up'],
    ],
  },
  {
    group: 'Interface',
    rows: [
      ['Enter', 'chat — /declare <words> speaks your own claim'],
      ['T', 'switch map / chat'],
      ['N', 'minimise the corner panel'],
      ['B', 'map zoom'],
      ['M', 'mute'],
      ['? or Esc', 'this menu'],
    ],
  },
];

const HELP = [
  {
    h: 'What you are doing',
    p: 'You are a raptor on the Front Range. Sweep the stream over grey, cracked ground and life chases the end of it — that is how coherence grows, and coherence is what lets you fly and what makes the flock trust you.',
  },
  {
    h: 'Moloch cannot be fought',
    p: 'He takes no damage from anything. Your stream does not hurt him, it holds him — and one stream is never enough. Press V to gather the flock, then hold the stream on him. Three at once and he is taken.',
  },
  {
    h: 'Declarations',
    p: 'The one commitment verb. You declare a future that is not true yet; others align with it; when enough have, it becomes true and the world changes to match. Everything that needs more than one raptor is a declaration.',
  },
  {
    h: 'Spark and coherence',
    p: 'Spark is fast and refills itself in seconds — spend it freely on the stream and on flight. Coherence is slow, comes from other raptors and from healing ground, and never needs hoarding.',
  },
];

export class Menu {
  readonly root: HTMLDivElement;
  private opts: GameOptions;
  private tab: 'controls' | 'help' | 'options' = 'controls';
  private onChange: (o: GameOptions) => void;
  private onClose: () => void;

  constructor(onChange: (o: GameOptions) => void, onClose: () => void) {
    this.opts = loadOptions();
    this.onChange = onChange;
    this.onClose = onClose;

    this.root = document.createElement('div');
    this.root.id = 'menu';
    this.root.innerHTML = `
      <div class="menuBox">
        <div class="menuHead">
          <div class="menuTitle">The Golden Seed</div>
          <div class="menuTabs">
            <button data-tab="controls">Controls</button>
            <button data-tab="help">How to play</button>
            <button data-tab="options">Options</button>
          </div>
          <button class="menuClose" title="Close (Esc)">resume</button>
        </div>
        <div class="menuBody"></div>
      </div>
    `;
    this.injectStyle();
    document.body.appendChild(this.root);

    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.menuTabs button')) {
      b.addEventListener('click', () => { this.tab = b.dataset.tab as typeof this.tab; this.render(); });
    }
    this.root.querySelector('.menuClose')!.addEventListener('click', () => this.close());
    // Clicking the backdrop closes, but clicking the panel must not.
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) this.close();
      e.stopPropagation();
    });
    this.render();
  }

  get options(): GameOptions { return this.opts; }
  get isOpen(): boolean { return this.root.classList.contains('show'); }

  open(): void { this.root.classList.add('show'); this.render(); }
  close(): void { this.root.classList.remove('show'); this.onClose(); }
  toggle(): void { this.isOpen ? this.close() : this.open(); }

  private set<K extends keyof GameOptions>(k: K, v: GameOptions[K]): void {
    this.opts = { ...this.opts, [k]: v };
    saveOptions(this.opts);
    this.onChange(this.opts);
    if (this.tab === 'options') this.render();
  }

  private render(): void {
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.menuTabs button')) {
      b.classList.toggle('on', b.dataset.tab === this.tab);
    }
    const body = this.root.querySelector('.menuBody')!;
    body.innerHTML = '';

    if (this.tab === 'controls') {
      for (const g of CONTROLS) {
        const sec = document.createElement('div');
        sec.className = 'menuSect';
        sec.innerHTML = `<h4>${g.group}</h4>` + g.rows
          .map(([k, v]) => `<div class="kv"><b>${k}</b><span>${v}</span></div>`)
          .join('');
        body.appendChild(sec);
      }
      return;
    }

    if (this.tab === 'help') {
      for (const s of HELP) {
        const sec = document.createElement('div');
        sec.className = 'menuSect';
        sec.innerHTML = `<h4>${s.h}</h4><p>${s.p}</p>`;
        body.appendChild(sec);
      }
      return;
    }

    const o = this.opts;
    const sec = document.createElement('div');
    sec.className = 'menuSect';
    body.appendChild(sec);

    const slider = (label: string, note: string, min: number, max: number, step: number,
                    value: number, fmt: (v: number) => string, set: (v: number) => void) => {
      const row = document.createElement('div');
      row.className = 'opt';
      row.innerHTML = `<label>${label}<em>${note}</em></label>
        <input type="range" min="${min}" max="${max}" step="${step}" value="${value}" />
        <output>${fmt(value)}</output>`;
      const input = row.querySelector('input')!;
      const out = row.querySelector('output')!;
      input.addEventListener('input', () => { out.textContent = fmt(Number(input.value)); });
      input.addEventListener('change', () => set(Number(input.value)));
      sec.appendChild(row);
    };

    const toggle = (label: string, note: string, value: boolean, set: (v: boolean) => void) => {
      const row = document.createElement('div');
      row.className = 'opt';
      row.innerHTML = `<label>${label}<em>${note}</em></label>
        <button class="tog ${value ? 'on' : ''}">${value ? 'on' : 'off'}</button><output></output>`;
      row.querySelector('button')!.addEventListener('click', () => set(!value));
      sec.appendChild(row);
    };

    slider('Mouse sensitivity', 'how far the view turns', 0.4, 2.5, 0.05, o.sensitivity,
      (v) => `${v.toFixed(2)}x`, (v) => this.set('sensitivity', v));
    toggle('Invert vertical look', 'pull down to look up', o.invertY,
      (v) => this.set('invertY', v));
    slider('Volume', 'the kalimba and the stream', 0, 1, 0.02, o.volume,
      (v) => `${Math.round(v * 100)}%`, (v) => this.set('volume', v));
    toggle('Sound', 'everything, at once', !o.muted, (v) => this.set('muted', !v));
    slider('View distance', 'lower this first if the game struggles', 4, 12, 1, o.viewRadius,
      (v) => `${v} chunks (${v * 16}m)`, (v) => this.set('viewRadius', v));
    toggle('Edge vignette', 'darkens as your blind spot grows', o.vignette,
      (v) => this.set('vignette', v));
    toggle('Show frame rate', 'in the panel top-left', o.showFps,
      (v) => this.set('showFps', v));
  }

  private injectStyle(): void {
    if (document.getElementById('menuStyle')) return;
    const st = document.createElement('style');
    st.id = 'menuStyle';
    st.textContent = `
#menu { position: fixed; inset: 0; z-index: 60; display: none;
        background: rgba(6,8,12,.82); backdrop-filter: blur(6px);
        overflow-y: auto; padding: 40px 20px; }
#menu.show { display: block; }
#menu .menuBox { max-width: 720px; margin: 0 auto; background: var(--panel, rgba(16,12,10,.9));
                 border: 1px solid var(--edge, rgba(255,200,130,.22)); border-radius: 14px;
                 pointer-events: auto; }
#menu .menuHead { display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
                  padding: 16px 20px; border-bottom: 1px solid var(--edge, rgba(255,200,130,.22)); }
#menu .menuTitle { font-size: 15px; color: var(--core, #ffe9b0); letter-spacing: .06em; }
#menu .menuTabs { display: flex; gap: 6px; margin-left: auto; }
#menu .menuTabs button, #menu .menuClose {
  pointer-events: auto; cursor: pointer; font: inherit; font-size: 11px;
  background: transparent; border: 1px solid var(--edge, rgba(255,200,130,.22));
  color: var(--dim, #a08965); border-radius: 7px; padding: 6px 12px; }
#menu .menuTabs button.on { color: var(--core, #ffe9b0); border-color: var(--ember, #ff9a2e); }
#menu .menuClose { color: var(--core, #ffe9b0); border-color: var(--ember, #ff9a2e); }
#menu .menuBody { padding: 8px 20px 22px; }
#menu .menuSect { margin-top: 18px; }
#menu .menuSect h4 { font-size: 10px; letter-spacing: .22em; text-transform: uppercase;
                     color: var(--ember, #ff9a2e); margin: 0 0 10px; font-weight: 400; }
#menu .menuSect p { font-size: 13px; line-height: 1.65; color: var(--text, #e9d6b6); margin: 0; }
#menu .kv { display: flex; gap: 16px; font-size: 12.5px; padding: 5px 0;
            border-bottom: 1px dashed rgba(255,200,130,.12); }
#menu .kv b { flex: 0 0 150px; color: var(--core, #ffe9b0); font-weight: 500; }
#menu .kv span { color: var(--text, #e9d6b6); }
#menu .opt { display: flex; align-items: center; gap: 14px; padding: 9px 0;
             border-bottom: 1px dashed rgba(255,200,130,.12); }
#menu .opt label { flex: 1 1 auto; font-size: 12.5px; color: var(--core, #ffe9b0);
                   display: flex; flex-direction: column; }
#menu .opt label em { font-style: normal; font-size: 10.5px; color: var(--dim, #a08965); margin-top: 2px; }
#menu .opt input[type=range] { flex: 0 0 190px; accent-color: var(--ember, #ff9a2e); pointer-events: auto; }
#menu .opt output { flex: 0 0 110px; text-align: right; font-size: 11.5px;
                    color: var(--dim, #a08965); font-variant-numeric: tabular-nums; }
#menu .tog { pointer-events: auto; cursor: pointer; font: inherit; font-size: 11px;
             background: transparent; border: 1px solid var(--edge, rgba(255,200,130,.22));
             color: var(--dim, #a08965); border-radius: 7px; padding: 5px 16px; flex: 0 0 190px; }
#menu .tog.on { color: var(--core, #ffe9b0); border-color: var(--ember, #ff9a2e); }
`;
    document.head.appendChild(st);
  }
}
