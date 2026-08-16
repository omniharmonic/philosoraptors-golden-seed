/**
 * RightPanel — the bottom-right corner, tabbed.
 *
 * The corner used to belong to chat alone, and the event log below it could
 * never be silenced. Two surfaces now want that space — the map you read while
 * moving and the chat you read while organising — and a raptor only ever wants
 * one of them at a time. So they share one corner behind a MAP | CHAT strip,
 * with map as the default because most seconds of play are spent travelling.
 *
 * The minimise chevron is the answer to the noise complaint: it collapses the
 * whole corner down to the strip itself, giving the view back entirely while
 * leaving one visible affordance to bring it back. Chat unread is surfaced as a
 * dot on its tab so a rally call is never silently swallowed by a collapsed
 * panel.
 *
 * Owns `#rightPanel` and injects its own stylesheet; touches nothing inside the
 * targets it hosts beyond show/hide, because MiniMap and Chat own their own DOM.
 * Colours come from the custom properties in index.html, which come from
 * src/art/palette.ts.
 */

/** A surface this panel can host. Deliberately the smallest possible contract. */
export interface PanelTarget {
  /** The element to show/hide. Reparented into the panel body on construction. */
  root: HTMLElement;
  /** Fired when this target becomes the visible tab (including after restore). */
  onShow?(): void;
  /** Fired when it stops being visible — other tab chosen, or minimised. */
  onHide?(): void;
}

export interface RightPanelOptions {
  map: PanelTarget;
  chat: PanelTarget;
  /** Where to mount. Defaults to `document.body`, alongside `#hud`. */
  parent?: HTMLElement;
}

/** Which tab is selected. `min` means selected-but-collapsed. */
export type RightPanelMode = 'map' | 'chat' | 'min';

type Tab = 'map' | 'chat';

const STORE_KEY = 'philo-right-panel';

const CSS = `
#rightPanel {
  position: fixed; right: 16px; bottom: 20px; z-index: 12;
  display: flex; flex-direction: column; align-items: flex-end; gap: 6px;
  /* The game is played through a pointer-locked canvas underneath. Only the
     strip re-enables hits; everything else here is glass. */
  pointer-events: none;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}

/* The body sits ABOVE the strip in the DOM so the strip stays pinned to the
   corner and the panel grows upward — minimising then never moves the tabs. */
#rightPanel .rpBody { pointer-events: none; }
#rightPanel.rpMin .rpBody { display: none; }

/* Hosted roots position themselves for the corner they used to own alone.
   Neutralise that here (two IDs' worth of specificity beats their own \`#chat\`
   rule regardless of stylesheet order) while keeping them a containing block
   for whatever they absolutely position inside. */
#rightPanel .rpBody > * { position: relative; inset: auto; }

#rightPanel .rpStrip {
  pointer-events: auto;
  display: flex; align-items: center; gap: 3px;
  padding: 3px;
  background: var(--panel); border: 1px solid var(--edge); border-radius: 9px;
  backdrop-filter: blur(9px);
}

#rightPanel .rpTab, #rightPanel .rpChev {
  cursor: pointer; font: inherit; color: var(--dim);
  background: transparent; border: 1px solid transparent; border-radius: 6px;
}
#rightPanel .rpTab {
  position: relative;
  padding: 4px 11px;
  font-size: 9px; letter-spacing: .16em; text-transform: uppercase;
}
#rightPanel .rpChev {
  padding: 2px 8px 4px; font-size: 12px; line-height: 1;
  transition: transform .18s ease;
}
#rightPanel .rpTab:hover, #rightPanel .rpChev:hover { color: var(--core); }
#rightPanel .rpTab.on {
  color: var(--core); border-color: var(--ember);
  box-shadow: 0 0 12px rgba(255, 154, 46, .26);
}
/* Collapsed: the selected tab is remembered but nothing is on screen, so it
   must not read as lit. */
#rightPanel.rpMin .rpTab.on {
  color: var(--dim); border-color: var(--edge); box-shadow: none;
}
#rightPanel.rpMin .rpChev { transform: rotate(180deg); }

#rightPanel .rpDot {
  position: absolute; right: 2px; top: 2px;
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--ember); box-shadow: 0 0 7px var(--ember);
  opacity: 0; transition: opacity .18s ease;
}
#rightPanel.rpUnread .rpDot { opacity: 1; }
`;

interface Persisted {
  tab: Tab;
  min: boolean;
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<Persisted>;
      return {
        tab: v.tab === 'chat' ? 'chat' : 'map',
        min: v.min === true,
      };
    }
  } catch {
    // Private-mode browsers throw on storage, and a half-written value would
    // throw on parse. Either way the defaults are a perfectly good panel.
  }
  return { tab: 'map', min: false };
}

export class RightPanel {
  readonly root: HTMLDivElement;

  private readonly map: PanelTarget;
  private readonly chat: PanelTarget;

  private readonly body: HTMLDivElement;
  private readonly tabs: Record<Tab, HTMLButtonElement>;

  private tab: Tab;
  private min: boolean;
  private unread = false;

  constructor(opts: RightPanelOptions) {
    this.map = opts.map;
    this.chat = opts.chat;

    const saved = load();
    this.tab = saved.tab;
    this.min = saved.min;

    if (!document.getElementById('rightPanelStyle')) {
      const style = document.createElement('style');
      style.id = 'rightPanelStyle';
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    this.root = document.createElement('div');
    this.root.id = 'rightPanel';

    this.body = document.createElement('div');
    this.body.className = 'rpBody';
    // appendChild moves the roots, so it is safe whether or not the collaborator
    // already mounted itself to the body on its own.
    this.body.append(this.map.root, this.chat.root);

    const strip = document.createElement('div');
    strip.className = 'rpStrip';

    this.tabs = {
      map: this.makeTab('map', 'Map'),
      chat: this.makeTab('chat', 'Chat'),
    };

    const dot = document.createElement('span');
    dot.className = 'rpDot';
    this.tabs.chat.appendChild(dot);

    const chev = document.createElement('button');
    chev.type = 'button';
    chev.className = 'rpChev';
    chev.title = 'Collapse this corner';
    chev.textContent = '⌄';
    this.arm(chev, () => (this.min ? this.restore() : this.minimise()));

    strip.append(this.tabs.map, this.tabs.chat, chev);
    this.root.append(this.body, strip);
    (opts.parent ?? document.body).appendChild(this.root);

    // No onShow/onHide on the first paint: the targets have not been told
    // anything yet, so this is state assertion, not a transition.
    this.paint();
    this.map.root.style.display = !this.min && this.tab === 'map' ? '' : 'none';
    this.chat.root.style.display = !this.min && this.tab === 'chat' ? '' : 'none';
  }

  /** 'map' | 'chat' when open, 'min' when collapsed to the tab strip. */
  get mode(): RightPanelMode {
    return this.min ? 'min' : this.tab;
  }

  /** Which tab is selected, even while collapsed. */
  get selected(): 'map' | 'chat' {
    return this.tab;
  }

  /** True while a message has arrived that the player has not seen. */
  get hasUnread(): boolean {
    return this.unread;
  }

  showMap(): void {
    this.select('map');
  }

  showChat(): void {
    this.select('chat');
  }

  /** Flip between the two tabs. Restores first if collapsed. */
  toggle(): void {
    this.select(this.tab === 'map' ? 'chat' : 'map');
  }

  /** Collapse to the tab strip and hand the corner back to the view. */
  minimise(): void {
    if (this.min) return;
    this.min = true;
    this.hide(this.tab);
    this.paint();
    this.save();
  }

  /** Re-open on whichever tab was last selected. */
  restore(): void {
    if (!this.min) return;
    this.min = false;
    this.show(this.tab);
    this.paint();
    this.save();
  }

  /**
   * The player pressed Enter to talk. This must land on chat no matter what the
   * panel was doing — a collapsed panel silently eating a composed message is
   * exactly the bug this method exists to prevent.
   */
  focusChat(): void {
    this.select('chat');
  }

  /** A message arrived. Lights the dot only if chat is not actually on screen. */
  markUnread(): void {
    if (this.mode === 'chat') return;
    this.unread = true;
    this.paint();
  }

  destroy(): void {
    this.root.remove();
  }

  // ------------------------------------------------------------------ internals

  private select(next: Tab): void {
    const wasVisible = !this.min;
    const changed = next !== this.tab;
    if (!changed && wasVisible) {
      // Already looking at it; still clear the dot, since asking for chat is
      // the same act as reading it.
      if (next === 'chat' && this.unread) { this.unread = false; this.paint(); }
      return;
    }

    if (wasVisible && changed) this.hide(this.tab);
    this.tab = next;
    this.min = false;
    this.show(next);
    if (next === 'chat') this.unread = false;
    this.paint();
    this.save();
  }

  private show(t: Tab): void {
    const target = t === 'map' ? this.map : this.chat;
    target.root.style.display = '';
    target.onShow?.();
  }

  private hide(t: Tab): void {
    const target = t === 'map' ? this.map : this.chat;
    target.root.style.display = 'none';
    target.onHide?.();
  }

  private makeTab(t: Tab, label: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rpTab';
    b.dataset.tab = t;
    b.textContent = label;
    this.arm(b, () => this.select(t));
    return b;
  }

  /**
   * Wire a strip control. Clicks here happen only when the pointer is already
   * unlocked, but the mousedown must still be swallowed so it never reaches the
   * canvas's own lock/fire handlers, and focus must be dropped afterwards or a
   * later Space (jump) would re-fire the button instead.
   */
  private arm(b: HTMLButtonElement, run: () => void): void {
    b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      b.blur();
      run();
    });
  }

  private paint(): void {
    this.root.classList.toggle('rpMin', this.min);
    this.root.classList.toggle('rpUnread', this.unread);
    this.tabs.map.classList.toggle('on', this.tab === 'map');
    this.tabs.chat.classList.toggle('on', this.tab === 'chat');
    const chev = this.root.querySelector<HTMLButtonElement>('.rpChev');
    if (chev) chev.title = this.min ? 'Re-open this corner' : 'Collapse this corner';
  }

  private save(): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ tab: this.tab, min: this.min }));
    } catch {
      // Storage refused; the panel still works, it just forgets on reload.
    }
  }
}
