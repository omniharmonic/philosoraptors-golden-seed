import { drawSigil, sigilCanvas, type Sigil } from '../systems/sigil';
import { DECLARATIONS, DECL_ORDER, type DeclKind } from '../systems/declarations';
import { blockName, blockDef, BLOCKS } from '../world/blocks';
import { TILE, buildAtlas, FACE_SIDE } from '../art/atlas';
import type { Chapter } from '../systems/chapters';

/** Mirrors the hotbar shape in main.ts. */
export type HotSlotView =
  | { kind: 'claws'; name: string }
  | { kind: 'stream'; name: string }
  | { kind: 'block'; name: string; id: number };

/**
 * What each seal actually DOES, in words a player can act on. The lore names
 * are evocative but opaque — "Mirror Fire" tells you nothing about what will
 * happen when you press 1.
 */


export interface HudState {
  sigil: Sigil;
  /** 0..1 of the fast, self-refilling resource. */
  spark: number;
  /** Live line under the crosshair while the stream is on. */
  beamHint: string;
  /** The single most important thing to do right now. */
  objective: string;
  /** Supporting detail for the objective. */
  objectiveSub: string;
  /** Raptors currently following you. */
  followers: number;
  /** Which declaration H will speak. */
  declIndex: number;
  /** Live declarations awaiting alignment. */
  hypers: { kind: DeclKind; claim: string; invigoration: number; required: number; mine: boolean }[];
  /** 'WebGPU' or 'WebGL2'. */
  backend: string;
  fps: number;
  coherence: number;
  blindSpot: number;
  stageName: string;
  stageDesc: string;
  flightName: string;
  nextUnlock: { at: number; name: string } | null;
  molochPressure: number;
  molochBand: string;
  chapter: Chapter;
  chapterStatus: string;
  chapterIndex: number;
  chapterTotal: number;
  hotbar: HotSlotView[];
  hotbarIndex: number;
  counts: Record<number, number>;
  peers: { sigil: Sigil; dist: number }[];
  biome: string;
  online: boolean;
}

/** Draw one block's side texture into a small canvas, for hotbar icons. */
function blockIcon(id: number, px = 48): HTMLCanvasElement {
  const atlas = buildAtlas();
  const c = document.createElement('canvas');
  c.width = px;
  c.height = px;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  // Pull the tile out of the atlas's raw data.
  const tile = atlas.tileOf(id, FACE_SIDE);
  const src = atlas.texture.image as { data: Uint8Array; width: number };
  const tx = (tile % 16) * TILE;
  const ty = Math.floor(tile / 16) * TILE;
  const img = ctx.createImageData(TILE, TILE);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const s = ((ty + y) * src.width + (tx + x)) * 4;
      const d = (y * TILE + x) * 4;
      img.data[d] = src.data[s];
      img.data[d + 1] = src.data[s + 1];
      img.data[d + 2] = src.data[s + 2];
      img.data[d + 3] = src.data[s + 3];
    }
  }
  const tmp = document.createElement('canvas');
  tmp.width = TILE;
  tmp.height = TILE;
  tmp.getContext('2d')!.putImageData(img, 0, 0);
  ctx.drawImage(tmp, 0, 0, px, px);
  return c;
}

const iconCache = new Map<number, HTMLCanvasElement>();
const icon = (id: number) => {
  let c = iconCache.get(id);
  if (!c) { c = blockIcon(id); iconCache.set(id, c); }
  return c;
};

export class HUD {
  private root: HTMLElement;
  private logBox: HTMLElement;
  private sealBox: HTMLElement;
  private spellBox: HTMLElement;
  private hotbarBox: HTMLElement;
  private rosterBox: HTMLElement;
  private banner: HTMLElement;
  private vig: HTMLElement;

  private el: Record<string, HTMLElement> = {};
  private lastHotbarKey = '';
  private bannerTimer = 0;

  constructor() {
    this.root = document.getElementById('hud')!;
    this.vig = document.getElementById('vig')!;
    this.root.innerHTML = `
      <div id="cross"></div>

      <div id="status" class="panel">
        <div id="me">
          <canvas id="meSigil" width="34" height="34"></canvas>
          <div>
            <div id="meName">—</div>
            <div id="meStage">—</div>
          </div>
        </div>
        <div class="row"><span class="k">Spark</span><span class="v" id="spkV">100</span></div>
        <div class="bar"><i id="spkFill" style="width:100%"></i></div>
        <div class="row" style="margin-top:9px"><span class="k">Coherence</span><span class="v" id="cohV">0</span></div>
        <div class="bar"><i id="cohFill" style="width:0%"></i></div>
        <div class="sub" id="cohNext"></div>
        <div class="row" style="margin-top:9px"><span class="k">Moloch</span><span class="v" id="molV">quiet</span></div>
        <div class="bar"><i id="molFill" style="width:0%"></i></div>
        <div class="row" style="margin-top:9px"><span class="k">Blind spot</span><span class="v" id="blindV">0%</span></div>
        <div class="bar"><i id="blindFill" style="width:0%"></i></div>
        <div class="sub" id="biome"></div>
        <div class="sub" id="perf"></div>
      </div>

      <div id="roster" class="panel">
        <div class="row"><span class="k">The flock nearby</span><span class="v" id="netV">solo</span></div>
        <div id="peerList"></div>
      </div>

      <div id="chapter" class="panel">
        <div class="row"><span class="k" id="chN">Chapter</span></div>
        <div id="chTitle">—</div>
        <div id="chSub">—</div>
        <div id="chObj">—</div>
        <div id="chEpi">—</div>
      </div>

      <div id="seals"></div>
      <div id="spells"></div>
      <div id="hotbar"></div>
      <div id="log"></div>

      <div id="beamHint"></div>

      <div id="objective">
        <div id="objMain">—</div>
        <div id="objSub"></div>
      </div>

      <div id="banner">
        <div id="bTitle"></div>
        <div id="bSub"></div>
        <div id="bBody"></div>
      </div>
    `;

    for (const id of [
      'spkV', 'spkFill', 'beamHint', 'objMain', 'objSub',
      'meName', 'meStage', 'cohV', 'cohFill', 'cohNext', 'molV', 'molFill',
      'blindV', 'blindFill', 'biome', 'perf', 'chN', 'chTitle', 'chSub', 'chObj',
      'chEpi', 'netV', 'peerList', 'bTitle', 'bSub', 'bBody',
    ]) {
      this.el[id] = document.getElementById(id)!;
    }
    this.logBox = document.getElementById('log')!;
    this.sealBox = document.getElementById('seals')!;
    this.spellBox = document.getElementById('spells')!;
    this.hotbarBox = document.getElementById('hotbar')!;
    this.rosterBox = document.getElementById('roster')!;
    this.banner = document.getElementById('banner')!;

    this.buildSpellbook();
  }

  /**
   * The declaration selector. One row, one highlighted entry — J cycles it and
   * H speaks it. This replaced an eight-tile spellbook that most players never
   * pressed because the number keys it claimed were needed for the hotbar.
   */
  private buildSpellbook(): void {
    this.spellBox.innerHTML = DECL_ORDER.map((k) => {
      const d = DECLARATIONS[k];
      return `<div class="spell" data-k="${k}" title="${d.lore}\n\n${d.claim}">
        ${d.name}<u>${d.plain}</u><i>${d.quorum} align</i>
      </div>`;
    }).join('');
  }

  log(text: string): void {
    const d = document.createElement('div');
    d.className = 'line';
    d.textContent = text;
    this.logBox.prepend(d);
    while (this.logBox.children.length > 7) this.logBox.lastChild?.remove();
    setTimeout(() => d.remove(), 9000);
  }

  showBanner(title: string, sub: string, body: string, ms = 5200): void {
    this.el.bTitle.textContent = title;
    this.el.bSub.textContent = sub;
    this.el.bBody.textContent = body;
    this.banner.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('show'), ms);
  }

  update(s: HudState): void {
    // --- identity
    this.el.meName.textContent = s.sigil.name;
    this.el.meStage.textContent = `${s.stageName} · ${s.flightName}`;
    const sc = this.root.querySelector<HTMLCanvasElement>('#meSigil')!;
    const sctx = sc.getContext('2d')!;
    sctx.clearRect(0, 0, 34, 34);
    drawSigil(sctx, s.sigil, 2, 2, 30);

    // --- bars
    this.el.spkV.textContent = String(Math.round(s.spark * 100));
    (this.el.spkFill as HTMLElement).style.width = `${s.spark * 100}%`;
    this.el.beamHint.textContent = s.beamHint;
    this.el.beamHint.style.opacity = s.beamHint ? '1' : '0';
    this.el.objMain.textContent = s.objective;
    this.el.objSub.textContent = s.objectiveSub;

    this.el.cohV.textContent = String(Math.floor(s.coherence));
    (this.el.cohFill as HTMLElement).style.width = `${s.coherence}%`;
    this.el.cohNext.textContent = s.nextUnlock
      ? `${s.stageDesc}  ·  next: ${s.nextUnlock.name} at ${s.nextUnlock.at}`
      : s.stageDesc;

    this.el.molV.textContent = s.molochBand;
    (this.el.molFill as HTMLElement).style.width = `${s.molochPressure * 100}%`;

    this.el.blindV.textContent = `${Math.round(s.blindSpot * 100)}%`;
    (this.el.blindFill as HTMLElement).style.width = `${s.blindSpot * 100}%`;
    this.el.biome.textContent = s.biome;
    this.el.perf.textContent = `${s.backend} · ${Math.round(s.fps)} fps`;

    // The thing you cannot see about yourself closes in at the edges.
    // Softer curve: the vignette should read as a nagging edge, not as fog.
    this.vig.style.boxShadow =
      `inset 0 0 ${120 + s.blindSpot * 150}px ${14 + s.blindSpot * 46}px rgba(8,12,24,${s.blindSpot * 0.55})`;

    // --- chapter
    this.el.chN.textContent = `Chapter ${s.chapterIndex + 1} / ${s.chapterTotal}`;
    this.el.chTitle.textContent = s.chapter.title;
    this.el.chSub.textContent = s.chapter.subtitle;
    this.el.chObj.textContent = s.chapterStatus;
    this.el.chEpi.textContent = s.chapter.epigraph;

    // --- declaration selector
    const nodes = Array.from(this.spellBox.children) as HTMLElement[];
    nodes.forEach((node, i) => {
      const def = DECLARATIONS[node.dataset.k as DeclKind];
      const locked = s.coherence < def.minCoherence;
      const selected = i === s.declIndex;
      node.classList.toggle('locked', locked && !selected);
      node.classList.toggle('on', selected);
      node.querySelector('i')!.textContent =
        locked ? `needs ${def.minCoherence}` : `${def.quorum} align`;
    });

    this.renderHypers(s.hypers);
    this.renderHotbar(s);
    this.renderPeers(s);
  }

  /** Live declarations and how far from true they are. */
  private renderHypers(hypers: HudState['hypers']): void {
    if (!hypers.length) { this.sealBox.innerHTML = ''; return; }
    this.sealBox.innerHTML = '';
    for (const h of hypers.slice(0, 3)) {
      const d = DECLARATIONS[h.kind];
      const box = document.createElement('div');
      box.className = 'panel seal';
      const pct = Math.round((h.invigoration / Math.max(1, h.required)) * 100);
      box.innerHTML = `
        <div class="sealHead">
          <span>${d.name}</span>
          <span class="ttl">${h.invigoration}/${h.required}</span>
        </div>
        <div class="bar" style="margin-top:6px"><i style="width:${pct}%;background:linear-gradient(90deg,#4da6ff,var(--core))"></i></div>
        <div class="sub">${h.mine ? 'You have aligned with this.' : 'Press F to align.'}</div>
      `;
      this.sealBox.appendChild(box);
    }
  }

  private renderHotbar(s: HudState): void {
    const key = s.hotbar.map((h) => h.kind + (h.kind === 'block' ? h.id : '')).join(',') +
      '|' + s.hotbarIndex + '|' +
      s.hotbar.map((h) => (h.kind === 'block' ? s.counts[h.id] ?? 0 : 0)).join(',');
    if (key === this.lastHotbarKey) return;
    this.lastHotbarKey = key;

    this.hotbarBox.innerHTML = '';
    s.hotbar.forEach((slot, i) => {
      const d = document.createElement('div');
      d.className = 'slotB' + (i === s.hotbarIndex ? ' on' : '');

      if (slot.kind === 'block') {
        d.title = `${blockName(slot.id)}${blockDef(slot.id)?.lore ? '\n' + blockDef(slot.id)!.lore : ''}`;
        d.appendChild(icon(slot.id));
        const c = document.createElement('em');
        const count = s.counts[slot.id] ?? 0;
        c.textContent = count > 0 ? String(count) : '∞';
        d.appendChild(c);
      } else {
        // Tools get a glyph rather than a block texture, so the two verbs read
        // as verbs and not as another kind of brick.
        d.title = slot.kind === 'claws'
          ? 'Claws — hold left mouse to break blocks'
          : 'Stream — hold left mouse to heal ground, tether a Moloch, or preen';
        const g = document.createElement('div');
        g.className = 'toolGlyph ' + slot.kind;
        g.textContent = slot.kind === 'claws' ? '⫽' : '≈';
        d.appendChild(g);
        const lbl = document.createElement('em');
        lbl.textContent = slot.kind === 'claws' ? 'break' : 'beam';
        lbl.style.fontSize = '8px';
        d.appendChild(lbl);
      }

      const n = document.createElement('span');
      n.textContent = String(i + 1);
      d.appendChild(n);
      this.hotbarBox.appendChild(d);
    });
  }

  private renderPeers(s: HudState): void {
    this.el.netV.textContent =
      (s.online ? `${s.peers.length + 1} online` : 'solo') +
      (s.followers ? ` · ${s.followers} following` : '');
    const list = this.el.peerList;
    list.innerHTML = '';
    for (const p of s.peers.slice(0, 8)) {
      const row = document.createElement('div');
      row.className = 'peer';
      const c = sigilCanvas(p.sigil, 40);
      row.appendChild(c);
      const n = document.createElement('span');
      n.textContent = p.sigil.name;
      row.appendChild(n);
      const d = document.createElement('span');
      d.className = 'd';
      d.textContent = `${Math.round(p.dist)}m`;
      row.appendChild(d);
      list.appendChild(row);
    }
    this.rosterBox.style.display = s.peers.length ? 'block' : 'none';
  }
}

/** Convenience for the start gate. */
export const allPlaceable = BLOCKS.filter((b) => b && !b.worldOnly && b.id !== 0).map((b) => b.id);
