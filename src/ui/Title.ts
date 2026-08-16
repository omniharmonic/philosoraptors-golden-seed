import { EDGE_RELAY, resolveRelay } from '../net/protocol';
import { Menu } from './Menu';

/**
 * The title screen.
 *
 * Replaces a single long scrolling document that mixed "how to play" with
 * "how to deploy this to Cloudflare". A player arriving from a link should see
 * a handful of large choices, the way any game does — not a README.
 *
 * Screens: title -> create | join | (controls/help/options, delegated to the
 * in-game Menu so there is exactly one copy of that content).
 */

type Screen = 'title' | 'create' | 'join';

interface World {
  code: string;
  name: string;
  players: number;
  molochs: number;
  banished: number;
}

const esc = (v: string): string =>
  v.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export class Title {
  private root: HTMLElement;
  private menu: Menu;
  private screen: Screen = 'title';
  private onPlay: () => void;

  constructor(menu: Menu, onPlay: () => void) {
    this.menu = menu;
    this.onPlay = onPlay;
    this.root = document.getElementById('gate')!;
    this.render();
  }

  show(): void { this.root.classList.remove('hidden'); }
  hide(): void { this.root.classList.add('hidden'); }

  private go(s: Screen): void {
    this.screen = s;
    this.render();
    if (s === 'join') void this.loadWorlds();
  }

  /** The link a given world code lives at, preserving seed and listing. */
  private worldUrl(code: string, opts: { seed?: string; name?: string; listed?: boolean } = {}): string {
    const u = new URL(location.href);
    u.search = '';
    u.searchParams.set('w', code);
    if (opts.seed) u.searchParams.set('seed', opts.seed);
    if (opts.name) u.searchParams.set('name', opts.name.slice(0, 40));
    if (opts.listed) u.searchParams.set('listed', '1');
    return u.toString();
  }

  private render(): void {
    const resolved = resolveRelay();
    const local = /^(localhost|127\.0\.0\.1|\d+\.\d+\.\d+\.\d+)$/.test(location.hostname || '');

    if (this.screen === 'title') {
      this.root.innerHTML = `
        <div class="tScreen">
          <h1 class="tTitle">The Golden Seed</h1>
          <div class="tSub">A Philosoraptors story</div>
          ${resolved.code ? `<div class="tWorldTag">in world <b>${esc(resolved.code)}</b></div>` : ''}
          <p class="tBlurb">
            You are a raptor on the Front Range, guarding a small heap of glowing
            seeds against everyone else doing the same. That arrangement has a
            name, and it is eating the valley.
          </p>
          <div class="tMenu">
            <button class="tBig" data-act="play">${resolved.code ? 'Enter this world' : 'Play'}</button>
            <button class="tBtn" data-act="create">Create a world</button>
            <button class="tBtn" data-act="join">Join a world</button>
            <button class="tBtn" data-act="help">How to play</button>
            <button class="tBtn" data-act="controls">Controls</button>
            <button class="tBtn" data-act="options">Options</button>
          </div>
          <div class="tFoot">
            ${local
              ? 'Running locally. <b>Create a world</b> to put one on the internet and invite anyone.'
              : 'Nothing to install and nothing to configure.'}
          </div>
        </div>`;
    }

    if (this.screen === 'create') {
      this.root.innerHTML = `
        <div class="tScreen">
          <button class="tBack" data-act="back">&larr; back</button>
          <h2 class="tHead">Create a world</h2>
          <div class="tForm">
            <label>World name<em>shown in the public list, if you list it</em>
              <input id="cName" maxlength="40" placeholder="The Tended Valley" />
            </label>
            <label>Seed<em>same seed, same landscape — leave blank for the default valley</em>
              <input id="cSeed" maxlength="24" placeholder="e.g. flatirons" />
            </label>
            <label class="tCheck">
              <input type="checkbox" id="cList" />
              <span>List it publicly<em>anyone can find and join it. Leave off and the link is the only way in.</em></span>
            </label>
          </div>
          <div class="tMenu">
            <button class="tBig" data-act="doCreate">Create world</button>
          </div>
          <div class="tFoot" id="cStatus">
            The world runs on Cloudflare's network near you and keeps running
            whether or not you stay. You get a link; anyone who opens it is in it.
          </div>
        </div>`;
    }

    if (this.screen === 'join') {
      this.root.innerHTML = `
        <div class="tScreen">
          <button class="tBack" data-act="back">&larr; back</button>
          <h2 class="tHead">Join a world</h2>
          <div class="tJoinRow">
            <input id="jCode" maxlength="8" placeholder="ENTER CODE" />
            <button class="tBtn" data-act="doJoin">Join</button>
          </div>
          <div class="tListHead">
            <span>Open worlds</span>
            <button class="tMini" data-act="refresh">refresh</button>
          </div>
          <div id="jList" class="tList"><div class="tFoot">Looking…</div></div>
        </div>`;
    }

    this.bind();
  }

  private bind(): void {
    for (const b of this.root.querySelectorAll<HTMLElement>('[data-act]')) {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const act = b.dataset.act;
        if (act === 'play') { this.hide(); this.onPlay(); }
        else if (act === 'create') this.go('create');
        else if (act === 'join') this.go('join');
        else if (act === 'back') this.go('title');
        else if (act === 'refresh') void this.loadWorlds();
        else if (act === 'doCreate') void this.create();
        else if (act === 'doJoin') this.joinTyped();
        else if (act === 'help') this.menu.openAt('help');
        else if (act === 'controls') this.menu.openAt('controls');
        else if (act === 'options') this.menu.openAt('options');
      });
    }
    const code = this.root.querySelector<HTMLInputElement>('#jCode');
    code?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.joinTyped(); }
    });
    this.root.querySelector<HTMLInputElement>('#cName')
      ?.addEventListener('keydown', (e) => { if (e.key === 'Enter') void this.create(); });
  }

  private joinTyped(): void {
    const el = this.root.querySelector<HTMLInputElement>('#jCode');
    const code = (el?.value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code) { if (el) el.placeholder = 'type the code first'; return; }
    location.href = this.worldUrl(code);
  }

  private async create(): Promise<void> {
    const status = this.root.querySelector('#cStatus');
    const name = (this.root.querySelector<HTMLInputElement>('#cName')?.value || '').trim();
    const seedText = (this.root.querySelector<HTMLInputElement>('#cSeed')?.value || '').trim();
    const listed = this.root.querySelector<HTMLInputElement>('#cList')?.checked ?? false;

    if (status) status.textContent = 'Asking for a world…';
    try {
      const res = await fetch(`${EDGE_RELAY || ''}/new`, { method: 'POST' });
      if (!res.ok) throw new Error(String(res.status));
      const { code } = (await res.json()) as { code: string };
      location.href = this.worldUrl(code, {
        // Keep the word the player typed — it is readable, shareable, and the
        // seed parser understands it directly.
        seed: seedText || undefined,
        name: name || undefined,
        listed,
      });
    } catch {
      if (status) {
        status.innerHTML =
          'No hosted relay is reachable from here. You can still play locally, ' +
          'and on your own network with <code>npm run play</code>. To put worlds ' +
          'on the internet, see <code>DEPLOY.md</code>.';
      }
    }
  }

  private async loadWorlds(): Promise<void> {
    const box = this.root.querySelector('#jList');
    if (!box) return;
    box.innerHTML = '<div class="tFoot">Looking…</div>';
    try {
      const res = await fetch(`${EDGE_RELAY || ''}/lobbies`);
      if (!res.ok) throw new Error(String(res.status));
      const { worlds } = (await res.json()) as { worlds: World[] };
      // An empty world still listed is joinable and worth showing, but a busy
      // one should be obviously more inviting.
      if (!worlds.length) {
        box.innerHTML =
          '<div class="tFoot">No public worlds right now. <b>Create a world</b> and ' +
          'tick <em>list it publicly</em> to put the first one up.</div>';
        return;
      }
      box.innerHTML = '';
      for (const w of worlds) {
        const row = document.createElement('button');
        row.className = 'tWorld' + (w.players > 0 ? ' busy' : '');
        row.innerHTML =
          `<span class="wName">${esc(w.name)}</span>` +
          `<span class="wCode">${esc(w.code)}</span>` +
          `<span class="wMeta">${w.players ? `${w.players} playing` : 'empty'}` +
          ` · ${w.molochs} moloch${w.molochs === 1 ? '' : 's'}` +
          (w.banished ? ` · ${w.banished} unmade` : '') + '</span>';
        row.addEventListener('click', () => { location.href = this.worldUrl(w.code); });
        box.appendChild(row);
      }
    } catch {
      box.innerHTML =
        '<div class="tFoot">No hosted relay is reachable, so there are no public ' +
        'worlds to list. Local play still works.</div>';
    }
  }
}
