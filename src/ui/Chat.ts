/**
 * Chat — the coordination surface.
 *
 * This panel is not decoration. The whole game is gated behind quorum: a seal
 * needs k distinct sigils, a Hyperobject needs k distinct raptors to act as if
 * it were already true. None of that can be organised without somewhere to say
 * "I'm going, meet me at the Flatirons, mark the seal on three". Agents talk
 * here too, so the panel's job is to make WHO SPOKE unmissable — a human must
 * be able to tell at a glance whether the raptor proposing a Hyperstition is a
 * person or a model, because that changes how you read the proposal.
 *
 * Owns its own DOM root (`#chat`) and injects its own stylesheet, so it never
 * collides with HUD.ts. Colours and panel language are lifted verbatim from the
 * custom properties in index.html, which in turn come from src/art/palette.ts.
 */

import { makeSigil, sigilCanvas, type Sigil } from '../systems/sigil';
import type { WireChat } from '../net/protocol';

export interface ChatOptions {
  /**
   * Marks a speaker as an MCP/agent client. `WirePlayer.agent` exists but
   * `WireChat` carries no agent flag, so the caller — which holds the peer
   * table — has to answer this for us.
   */
  isAgent?: (from: string) => boolean;
  /**
   * Resolve a speaker to their sigil. Defaults to deriving one from the
   * display name: `WireChat.from` is a *name*, not a PlayerId, so the derived
   * glyph is not byte-identical to the one the roster draws from the id. It is
   * still deterministic and stable per speaker, which is the property chat
   * actually needs. Pass a resolver backed by the peer table for exact chips.
   */
  sigilFor?: (from: string) => Sigil;
  /** Composed message, ready to go out as `{ t: 'chat', text }`. */
  onSend?: (text: string) => void;
  /**
   * Called when the composer closes. The game grabbed the pointer before we
   * released it, and only the caller knows which canvas to re-lock.
   */
  onRequestPointerLock?: () => void;
  /** Bind Enter (open/send), Escape (cancel) and T (collapse) on window. */
  bindKeys?: boolean;
  /** Ring buffer size. Older entries are dropped from the DOM entirely. */
  max?: number;
}

/** Beyond this many lines back from the newest, everything sits at floor opacity. */
const FADE_SPAN = 14;
const FADE_FLOOR = 0.34;

const CHAT_CSS = `
#chat {
  position: fixed; right: 16px; bottom: 20px; z-index: 11;
  width: 344px; display: flex; flex-direction: column; gap: 6px;
  pointer-events: none;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
#chatLog {
  display: flex; flex-direction: column; gap: 5px;
  max-height: min(38vh, 320px); overflow-y: auto; overscroll-behavior: contain;
  padding: 9px 11px;
  background: var(--panel); border: 1px solid var(--edge); border-radius: 10px;
  backdrop-filter: blur(9px);
  scrollbar-width: thin; scrollbar-color: var(--edge) transparent;
}
#chatLog::-webkit-scrollbar { width: 6px; }
#chatLog::-webkit-scrollbar-thumb { background: var(--edge); border-radius: 3px; }
#chatLog::-webkit-scrollbar-track { background: transparent; }
#chat.empty #chatLog { display: none; }

/* Collapsed keeps the last three lines only, so the panel never eats the view
   during a fight but you can still see someone shouting a rally point. */
#chat.collapsed #chatLog { max-height: none; overflow: visible; }
#chat.collapsed .msg { display: none; }
#chat.collapsed .msg:nth-last-child(-n + 3) { display: flex; }

/* The log is click-through until the composer is open — a stray click on chat
   must never cost you pointer lock mid-flight. */
#chat.composing { pointer-events: auto; }

.msg { display: flex; gap: 7px; align-items: flex-start; line-height: 1.45; }
.msg .chip {
  width: 18px; height: 18px; flex: 0 0 18px; margin-top: 1px;
  border-radius: 4px; background: #0a0c10; border: 1px solid var(--edge);
  image-rendering: pixelated;
}
.msg .body { min-width: 0; flex: 1 1 auto; word-break: break-word; }
.msg .who { color: var(--core); font-size: 11px; letter-spacing: .03em; }
.msg .at { color: var(--dim); font-size: 9px; margin-left: 5px; font-variant-numeric: tabular-nums; }
.msg .said { color: var(--text); font-size: 11.5px; display: block; margin-top: 1px; }

/* Agents are marked on the palette's cold axis so they can never be confused
   with an omen (amber) or with a human (core). This is legibility, not lore. */
.msg .bot {
  font-size: 8.5px; letter-spacing: .16em; text-transform: uppercase;
  color: var(--cold); border: 1px solid rgba(89, 129, 156, .5);
  border-radius: 3px; padding: 0 3px; margin-left: 6px; vertical-align: 1px;
}
.msg.agent .chip { border-color: rgba(89, 129, 156, .55); box-shadow: 0 0 8px rgba(89,129,156,.35); }

/* An omen is the world talking. No author chip: nobody signed it. */
.msg.omen { border-left: 2px solid var(--ember); padding-left: 8px; }
.msg.omen .said {
  color: var(--flame); font-style: italic; font-size: 11.5px; margin-top: 0;
}
.msg.omen .src {
  display: block; color: var(--dim); font-size: 8.5px;
  letter-spacing: .16em; text-transform: uppercase; margin-bottom: 2px;
}
.msg.system .said { color: var(--dim); font-size: 10px; font-style: normal; }

#chatBar {
  display: none; align-items: center; gap: 8px;
  background: var(--panel); border: 1px solid var(--ember); border-radius: 10px;
  backdrop-filter: blur(9px); padding: 7px 10px;
  box-shadow: 0 0 18px rgba(255, 154, 46, .22);
}
#chat.composing #chatBar { display: flex; }
#chatBar .caret { color: var(--ember); font-size: 12px; }
#chatInput {
  flex: 1 1 auto; min-width: 0; background: transparent; border: 0; outline: 0;
  color: var(--core); font: inherit; font-size: 12px; caret-color: var(--ember);
}
#chatInput::placeholder { color: var(--dim); }
#chatHint { color: var(--dim); font-size: 8.5px; letter-spacing: .1em; text-transform: uppercase; }
`;

export class Chat {
  readonly root: HTMLDivElement;

  /** Assign or pass via options; main.ts wires this to `net.chat(text)`. */
  onSend?: (text: string) => void;

  private logBox: HTMLDivElement;
  private bar: HTMLDivElement;
  private input: HTMLInputElement;

  private composing = false;
  private collapsed = false;
  private stick = true;
  private mounted = false;

  private readonly max: number;
  private readonly isAgent: (from: string) => boolean;
  private readonly sigilFor: (from: string) => Sigil;
  private readonly onRequestPointerLock?: () => void;
  private readonly bindKeys: boolean;

  private chips = new Map<string, HTMLCanvasElement>();
  private onKeyDown = (e: KeyboardEvent) => this.handleKey(e);

  constructor(opts: ChatOptions = {}) {
    this.max = opts.max ?? 200;
    this.isAgent = opts.isAgent ?? (() => false);
    this.sigilFor = opts.sigilFor ?? ((from) => makeSigil(from));
    this.onSend = opts.onSend;
    this.onRequestPointerLock = opts.onRequestPointerLock;
    this.bindKeys = opts.bindKeys ?? true;

    this.root = document.createElement('div');
    this.root.id = 'chat';
    this.root.className = 'empty';

    this.logBox = document.createElement('div');
    this.logBox.id = 'chatLog';
    this.logBox.addEventListener('scroll', () => {
      const slack = this.logBox.scrollHeight - this.logBox.clientHeight - this.logBox.scrollTop;
      this.stick = slack < 24;
    });

    this.bar = document.createElement('div');
    this.bar.id = 'chatBar';

    const caret = document.createElement('span');
    caret.className = 'caret';
    caret.textContent = '>';

    this.input = document.createElement('input');
    this.input.id = 'chatInput';
    this.input.type = 'text';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    // The relay truncates at 400; refusing the extra characters up front is
    // kinder than silently eating the end of somebody's rally call.
    this.input.maxLength = 400;
    this.input.placeholder = 'say something the others can act on…';

    const hint = document.createElement('span');
    hint.id = 'chatHint';
    hint.textContent = 'enter · esc';

    // Swallow keystrokes at the source as well as on window, so a game input
    // handler bound to the document body can never see the player typing.
    this.input.addEventListener('keydown', (e) => e.stopPropagation());
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
    this.input.addEventListener('keypress', (e) => e.stopPropagation());
    this.input.addEventListener('blur', () => { if (this.composing) this.closeComposer(false); });

    this.bar.append(caret, this.input, hint);
    this.root.append(this.logBox, this.bar);
  }

  /** True while the composer holds focus. main.ts must gate game input on this. */
  get isComposing(): boolean {
    return this.composing;
  }

  get isCollapsed(): boolean {
    return this.collapsed;
  }

  mount(parent: HTMLElement = document.body): void {
    if (this.mounted) return;
    if (!document.getElementById('chatStyle')) {
      const style = document.createElement('style');
      style.id = 'chatStyle';
      style.textContent = CHAT_CSS;
      document.head.appendChild(style);
    }
    parent.appendChild(this.root);
    if (this.bindKeys) addEventListener('keydown', this.onKeyDown, true);
    this.mounted = true;
  }

  /** Seed the panel from `welcome.chat`. */
  pushAll(entries: WireChat[]): void {
    for (const e of entries) this.append(e);
    this.trim();
    this.refade();
    this.scrollToNewest();
  }

  push(entry: WireChat): void {
    this.append(entry);
    this.trim();
    this.refade();
    this.scrollToNewest();
  }

  /** Collapse to the last three lines, or expand back. Bound to T by default. */
  toggle(): void {
    this.setCollapsed(!this.collapsed);
  }

  setCollapsed(v: boolean): void {
    this.collapsed = v;
    this.root.classList.toggle('collapsed', v);
    if (!v) this.scrollToNewest();
  }

  openComposer(): void {
    if (this.composing) return;
    this.composing = true;
    this.root.classList.add('composing');
    // Expanding on open is the point: you are about to organise something, and
    // three lines of scrollback is not enough context to organise from.
    if (this.collapsed) this.setCollapsed(false);
    document.exitPointerLock();
    this.input.value = '';
    this.input.focus();
    this.scrollToNewest();
  }

  /** `send = false` cancels (Escape / focus loss) without emitting. */
  closeComposer(send: boolean): void {
    if (!this.composing) return;
    const text = this.input.value.trim();
    this.composing = false;
    this.root.classList.remove('composing');
    this.input.value = '';
    this.input.blur();
    if (send && text) this.onSend?.(text);
    // Chrome refuses a pointer-lock request made immediately after an exit, so
    // asking right now reliably fails and the caller sees "lock lost" a second
    // time. Give the browser a beat before asking for it back.
    setTimeout(() => this.onRequestPointerLock?.(), 250);
  }

  /**
   * Key routing. Returns true if the event was consumed — useful if the caller
   * binds keys itself (`bindKeys: false`) and forwards them here.
   */
  handleKey(e: KeyboardEvent): boolean {
    if (this.composing) {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        e.stopPropagation();
        this.closeComposer(true);
        return true;
      }
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.closeComposer(false);
        return true;
      }
      // Everything else belongs to the text field, never to the game.
      e.stopPropagation();
      return true;
    }

    // Don't steal Enter from some other field (the gate's button, a dev overlay).
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return false;
    if (e.ctrlKey || e.metaKey || e.altKey) return false;

    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      e.stopPropagation();
      this.openComposer();
      return true;
    }
    if (e.code === 'KeyT') {
      e.preventDefault();
      e.stopPropagation();
      this.toggle();
      return true;
    }
    return false;
  }

  destroy(): void {
    if (!this.mounted) return;
    removeEventListener('keydown', this.onKeyDown, true);
    this.root.remove();
    this.mounted = false;
  }

  // ------------------------------------------------------------------ internals

  private append(entry: WireChat): void {
    const row = document.createElement('div');
    row.className = `msg ${entry.kind}`;

    const body = document.createElement('div');
    body.className = 'body';

    if (entry.kind === 'say') {
      const agent = this.isAgent(entry.from);
      if (agent) row.classList.add('agent');

      row.appendChild(this.chip(entry.from));

      const head = document.createElement('div');
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = entry.from;
      head.appendChild(who);

      if (agent) {
        const tag = document.createElement('span');
        tag.className = 'bot';
        tag.textContent = 'agent';
        head.appendChild(tag);
      }

      const at = document.createElement('span');
      at.className = 'at';
      at.textContent = clock(entry.at);
      head.appendChild(at);

      const said = document.createElement('span');
      said.className = 'said';
      said.textContent = entry.text;

      body.append(head, said);
    } else if (entry.kind === 'omen') {
      // The valley and the web speak unsigned. Showing the source but no sigil
      // is the whole distinction: an omen is a fact about the world, not a
      // commitment anyone can be held to.
      if (entry.from) {
        const src = document.createElement('span');
        src.className = 'src';
        src.textContent = entry.from;
        body.appendChild(src);
      }
      const said = document.createElement('span');
      said.className = 'said';
      said.textContent = entry.text;
      body.appendChild(said);
    } else {
      const said = document.createElement('span');
      said.className = 'said';
      said.textContent = entry.text;
      body.appendChild(said);
    }

    row.appendChild(body);
    this.logBox.appendChild(row);
    this.root.classList.remove('empty');
  }

  private chip(from: string): HTMLCanvasElement {
    let cached = this.chips.get(from);
    if (!cached) {
      // Draw at 2x the CSS box so the glyph stays crisp on retina.
      cached = sigilCanvas(this.sigilFor(from), 36);
      this.chips.set(from, cached);
    }
    const c = cached.cloneNode(true) as HTMLCanvasElement;
    c.getContext('2d')!.drawImage(cached, 0, 0);
    c.className = 'chip';
    return c;
  }

  private trim(): void {
    while (this.logBox.childElementCount > this.max) {
      this.logBox.firstElementChild!.remove();
    }
  }

  /** Older lines recede rather than vanish — history stays readable if you look. */
  private refade(): void {
    const kids = this.logBox.children;
    const n = kids.length;
    for (let i = 0; i < n; i++) {
      const back = n - 1 - i;
      const a = back >= FADE_SPAN ? FADE_FLOOR : 1 - (1 - FADE_FLOOR) * (back / FADE_SPAN);
      (kids[i] as HTMLElement).style.opacity = a.toFixed(3);
    }
  }

  private scrollToNewest(): void {
    if (!this.stick) return;
    this.logBox.scrollTop = this.logBox.scrollHeight;
  }
}

function clock(t: number): string {
  const d = new Date(t);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}
