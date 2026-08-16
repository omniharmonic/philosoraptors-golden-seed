/**
 * MiniMap — the live top-down map.
 *
 * The world is kilometres across and the only spatial information the HUD gave
 * you was a distance number, so this panel exists to answer "where am I, where
 * is the thing, and which way is it" in one glance.
 *
 * The important architectural choice: the map NEVER reads chunk data. It calls
 * the pure worldgen functions instead, so it can draw the Divide 1,400 blocks
 * west of you even though those chunks will never be resident. That freedom
 * costs noise evaluations, so the terrain is rasterised into an offscreen
 * image ONCE per neighbourhood and then blitted every frame:
 *
 *   - the raster covers PAD x the visible span, so ordinary walking just
 *     scrolls a cached image and costs nothing;
 *   - the rebuild is time-sliced across frames (RASTER_BUDGET_MS per frame),
 *     because one synchronous 16k-sample pass is a visible hitch at 60fps;
 *   - only the overlays — you, Molochs, peers, declarations, seeds, landmarks —
 *     are redrawn per frame, and they are a few dozen vector ops.
 *
 * Colour comes from src/art/palette.ts and the panel chrome from the custom
 * properties in index.html, so the map sits on the same measured warm axis as
 * everything else. Marker CLASS is carried by shape rather than hue on purpose:
 * the series only has two hues, and inventing a fifth marker colour would put
 * something on screen that the footage never contained.
 *
 * Owns its own DOM root (`#minimap`) and injects its own stylesheet, so it
 * never collides with HUD.ts or Chat.ts. It shares the bottom-right corner with
 * chat — the caller decides who is up via show()/hide()/toggle().
 */

import {
  BIOME_NAMES, Biome, PLAINS_Y, SEA_LEVEL, sampleColumn, terrainHeight,
} from '../world/worldgen';
import { LANDMARKS } from '../world/landmarks';
import {
  COLD_RAMP, EMBER, FLAME, FLAME_CORE, WARM_RAMP, hexToRgb, mixRgb, type RGB,
} from '../art/palette';

/** One thing worth drawing on the map. */
export interface MapMark {
  /** World position. `y` is ignored — this is a plan view. */
  x: number;
  z: number;
  /** Drawn next to the mark when there is room for it. */
  label?: string;
  /**
   * 0..1 completion, drawn as an arc around the mark. Alignment progress for a
   * declaration, binding progress for a Moloch.
   */
  progress?: number;
  /** Effect radius in blocks, drawn as a faint ring. Declarations use this. */
  radius?: number;
  /** Overrides the class tint. Declarations carry their own colour. */
  colour?: number;
}

/** Everything the map needs for one frame, in one object. */
export interface MiniMapState {
  /** Player position in world coordinates. */
  x: number;
  y: number;
  z: number;
  /** Player yaw in radians, Player.yaw convention (0 faces -Z, i.e. north). */
  yaw: number;
  /** Hostile marks. `progress` is how bound each one is. */
  molochs?: MapMark[];
  /** Other players and agents. */
  peers?: MapMark[];
  /** Declarations awaiting alignment. `progress` is aligned/quorum. */
  declarations?: MapMark[];
  /** Golden Seeds nobody has claimed yet. */
  seeds?: MapMark[];
}

/** Map spans in blocks (= metres) that cycleZoom() steps through. */
export const ZOOM_STEPS = [150, 260, 450, 800, 1500];

/** Raster resolution, samples per side. 128 keeps a rebuild near 16k samples. */
const R = 128;
/** The raster covers this multiple of the visible span, so panning is free. */
const PAD = 1.5;
/** Per-frame sampling budget. Beyond this the rebuild continues next frame. */
const RASTER_BUDGET_MS = 2.5;
/** Canvas size in CSS pixels. */
const SIZE = 260;

const EMPTY: MapMark[] = [];

/**
 * Biome tints, traced to the surface block each biome actually lays down in
 * worldgen's surfaceBlock() (see the `tex.base` values in world/blocks.ts), so
 * the map reads as the same ground you are standing on.
 */
const BIOME_TINT: Record<Biome, number> = {
  [Biome.Prairie]: 0x9d9a52,   // prairie grass
  [Biome.Mesa]: 0xa08d5f,      // prairie grass over a dry cap
  [Biome.Foothill]: 0x5f7a34,  // meadow turf under ponderosa
  [Biome.Flatiron]: 0x8a6338,  // meadow turf shot through with arkose
  [Biome.Subalpine]: 0x46583f, // spruce over granite
  [Biome.Divide]: 0x6b6f6a,    // granite
  [Biome.GrayValley]: 0x9a8a70,// raked soil
  [Biome.AshWaste]: 0x8d8a85,  // ash
};

const SNOW_TINT = 0xdfe8ee;
/** Matches surfaceBlock(): snow only above this line. */
const SNOW_LINE = PLAINS_Y + 96;

const TINT: RGB[] = [
  hexToRgb(BIOME_TINT[Biome.Prairie]),
  hexToRgb(BIOME_TINT[Biome.Mesa]),
  hexToRgb(BIOME_TINT[Biome.Foothill]),
  hexToRgb(BIOME_TINT[Biome.Flatiron]),
  hexToRgb(BIOME_TINT[Biome.Subalpine]),
  hexToRgb(BIOME_TINT[Biome.Divide]),
  hexToRgb(BIOME_TINT[Biome.GrayValley]),
  hexToRgb(BIOME_TINT[Biome.AshWaste]),
];
const SNOW_RGB = hexToRgb(SNOW_TINT);
const WATER_RGB = hexToRgb(COLD_RAMP[2]);
const SHADE_LOW = hexToRgb(WARM_RAMP[1]);
const SHADE_HIGH = hexToRgb(WARM_RAMP[4]);

/** Marker inks. `#dim`/`#core` are the same values as the CSS custom properties. */
const INK_DIM = css(WARM_RAMP[3]);
const INK_CORE = css(FLAME_CORE);
const INK_PEER = css(EMBER);
const INK_DECL = css(FLAME);
const INK_SEED = css(FLAME_CORE);
/**
 * The one cold-warm exception on the map. Moloch already owns this red in the
 * HUD's pressure bar (#molFill in index.html), and a demon rendered in the same
 * amber as a Golden Seed would be actively misleading.
 */
const INK_MOLOCH = '#b03a3a';

const MAP_BG = '#0a0c10';
const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

function css(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

const MINIMAP_CSS = `
#minimap {
  position: fixed; right: 16px; bottom: 20px; z-index: 11;
  width: 284px; pointer-events: none;
  display: flex; flex-direction: column; gap: 6px;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  background: var(--panel, rgba(16, 12, 10, 0.72));
  border: 1px solid var(--edge, rgba(255, 200, 130, 0.22));
  border-radius: 10px;
  backdrop-filter: blur(9px);
  padding: 9px 11px 8px;
}
#minimap.hidden { display: none; }
#minimap .mmRow {
  display: flex; justify-content: space-between; align-items: baseline; gap: 8px;
}
#mmTitle {
  color: var(--dim, #a08965); letter-spacing: .08em;
  text-transform: uppercase; font-size: 9.5px;
}
#mmBiome {
  color: var(--core, #ffe9b0); font-size: 10.5px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
#mmCanvas {
  display: block; width: ${SIZE}px; height: ${SIZE}px;
  border-radius: 6px; background: ${MAP_BG};
  border: 1px solid var(--edge, rgba(255, 200, 130, 0.22));
}
#mmPos {
  color: var(--core, #ffe9b0); font-size: 10px;
  font-variant-numeric: tabular-nums; letter-spacing: .02em;
}
#mmSpan { color: var(--dim, #a08965); font-size: 9.5px; font-variant-numeric: tabular-nums; }
`;

/** A finished terrain raster and the window of world it covers. */
interface Raster {
  /** Centre in world coordinates. */
  cx: number;
  cz: number;
  /** Visible span this raster was built for. */
  span: number;
  /** Blocks per raster sample. */
  bps: number;
}

/** A raster part-way through being sampled. */
interface Pending extends Raster {
  heights: Float32Array;
  biomes: Uint8Array;
  /** Next row of samples to take. */
  row: number;
}

export class MiniMap {
  private readonly el: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly biomeEl: HTMLElement;
  private readonly posEl: HTMLElement;
  private readonly spanEl: HTMLElement;

  /** Offscreen R x R terrain raster, blitted and scaled into the panel. */
  private readonly tex: HTMLCanvasElement;
  private readonly texCtx: CanvasRenderingContext2D;
  private readonly img: ImageData;

  private ready: Raster | null = null;
  private pending: Pending | null = null;

  private spanM = ZOOM_STEPS[2];
  private dpr = 0;
  private shown = true;
  private mounted = false;
  private lastPos = '';
  private lastBiome = '';
  private lastSpan = '';

  constructor(private readonly seed: number) {
    this.el = document.createElement('div');
    this.el.id = 'minimap';
    this.el.innerHTML = `
      <div class="mmRow"><span id="mmTitle">Map</span><span id="mmBiome">—</span></div>
      <canvas id="mmCanvas"></canvas>
      <div class="mmRow"><span id="mmPos">—</span><span id="mmSpan">—</span></div>
    `;

    this.canvas = this.el.querySelector<HTMLCanvasElement>('#mmCanvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.biomeEl = this.el.querySelector<HTMLElement>('#mmBiome')!;
    this.posEl = this.el.querySelector<HTMLElement>('#mmPos')!;
    this.spanEl = this.el.querySelector<HTMLElement>('#mmSpan')!;

    this.tex = document.createElement('canvas');
    this.tex.width = R;
    this.tex.height = R;
    // The raster is read back as a whole image every rebuild, so tell the
    // browser not to keep it on the GPU.
    this.texCtx = this.tex.getContext('2d', { willReadFrequently: true })!;
    this.img = this.texCtx.createImageData(R, R);

    this.syncBacking();
  }

  /** The panel root, for callers that want to reparent or measure it. */
  get element(): HTMLDivElement {
    return this.el;
  }

  get visible(): boolean {
    return this.shown;
  }

  /** Current map width in blocks (= metres). */
  get span(): number {
    return this.spanM;
  }

  mount(parent: HTMLElement = document.body): void {
    if (this.mounted) return;
    if (!document.getElementById('minimapStyle')) {
      const style = document.createElement('style');
      style.id = 'minimapStyle';
      style.textContent = MINIMAP_CSS;
      document.head.appendChild(style);
    }
    parent.appendChild(this.el);
    this.mounted = true;
  }

  show(): void {
    this.setVisible(true);
  }

  hide(): void {
    this.setVisible(false);
  }

  toggle(): void {
    this.setVisible(!this.shown);
  }

  setVisible(v: boolean): void {
    this.shown = v;
    this.el.classList.toggle('hidden', !v);
  }

  /**
   * Set the map width in metres. Continuous rather than an index, so a caller
   * can bind it to a wheel as easily as to a key; it is clamped to the ends of
   * ZOOM_STEPS.
   */
  setZoom(metresAcross: number): void {
    const next = clamp(metresAcross, ZOOM_STEPS[0], ZOOM_STEPS[ZOOM_STEPS.length - 1]);
    if (next === this.spanM) return;
    this.spanM = next;
    // The cached raster was sampled for the old span; at a different scale its
    // resolution is wrong in one direction or the other, so start over.
    this.pending = null;
  }

  /** Step to the next preset span, wrapping back to the tightest. */
  cycleZoom(): void {
    const next = ZOOM_STEPS.find((s) => s > this.spanM * 1.01) ?? ZOOM_STEPS[0];
    this.setZoom(next);
  }

  /** Call once per frame with the player pose and every marker list. */
  update(s: MiniMapState): void {
    if (!this.shown) return;
    this.syncBacking();
    this.stepRaster(s.x, s.z);
    this.draw(s);
    this.updateReadouts(s);
  }

  // ------------------------------------------------------------- the raster

  /** How far the player may drift from the raster centre before a rebuild. */
  private drift(span: number): number {
    // Half the padding, minus a margin so the rebuild finishes before the
    // cached edge actually enters the view.
    return (span * (PAD - 1)) / 2 * 0.65;
  }

  private stepRaster(px: number, pz: number): void {
    const span = this.spanM;

    if (this.pending && (this.pending.span !== span
      || Math.abs(px - this.pending.cx) > this.drift(span) * 2
      || Math.abs(pz - this.pending.cz) > this.drift(span) * 2)) {
      this.pending = null; // teleported or zoomed mid-build; the work is stale
    }

    if (!this.pending) {
      const stale = !this.ready
        || this.ready.span !== span
        || Math.abs(px - this.ready.cx) > this.drift(span)
        || Math.abs(pz - this.ready.cz) > this.drift(span);
      if (stale) {
        this.pending = {
          cx: px, cz: pz, span,
          bps: (span * PAD) / R,
          heights: new Float32Array(R * R),
          biomes: new Uint8Array(R * R),
          row: 0,
        };
      }
    }

    const p = this.pending;
    if (!p) return;

    const minX = p.cx - (p.span * PAD) / 2;
    const minZ = p.cz - (p.span * PAD) / 2;
    const t0 = performance.now();

    // Always advance at least one row, so a slow frame can never stall the
    // rebuild forever.
    do {
      const wz = minZ + (p.row + 0.5) * p.bps;
      const base = p.row * R;
      for (let i = 0; i < R; i++) {
        const wx = minX + (i + 0.5) * p.bps;
        const c = sampleColumn(wx, wz, this.seed);
        p.heights[base + i] = c.height;
        p.biomes[base + i] = c.biome;
      }
      p.row++;
    } while (p.row < R && performance.now() - t0 < RASTER_BUDGET_MS);

    if (p.row >= R) {
      this.paintRaster(p);
      this.ready = { cx: p.cx, cz: p.cz, span: p.span, bps: p.bps };
      this.pending = null;
    }
  }

  /**
   * Second pass: heights and biomes into pixels. Separated from sampling
   * because it touches no noise functions and so costs almost nothing — it runs
   * whole in the frame that finishes the raster.
   */
  private paintRaster(p: Pending): void {
    const d = this.img.data;
    const h = p.heights;
    const lowY = PLAINS_Y - 8;
    const highY = PLAINS_Y + 92;
    /**
     * Relief exaggeration. Zoomed out, one sample spans many blocks and the
     * finite difference measures an average slope that is far gentler than the
     * ground actually is, so the mountains flatten into a smear. Scaling the
     * shading with the sample step gives the Divide back its texture without
     * over-cooking the plains at close zoom, where the slope is already real.
     */
    const relief = clamp(Math.sqrt(p.bps / 2), 1, 3.2);

    for (let z = 0; z < R; z++) {
      const row = z * R;
      const up = (z > 0 ? z - 1 : 0) * R;
      const down = (z < R - 1 ? z + 1 : R - 1) * R;
      for (let x = 0; x < R; x++) {
        const i = row + x;
        const y = h[i];
        const o = i * 4;

        if (y <= SEA_LEVEL) {
          d[o] = WATER_RGB[0] * 255;
          d[o + 1] = WATER_RGB[1] * 255;
          d[o + 2] = WATER_RGB[2] * 255;
          d[o + 3] = 255;
          continue;
        }

        const base = y > SNOW_LINE ? SNOW_RGB : TINT[p.biomes[i]];
        const t = clamp((y - lowY) / (highY - lowY), 0, 1);
        let c = mixRgb(base, SHADE_LOW, (1 - t) * 0.34);
        c = mixRgb(c, SHADE_HIGH, t * 0.26);

        // Relief. The light is low in the east because that is where the sun
        // is in the footage — it is what makes the Flatirons' east faces the
        // brightest thing on the map and the range front a hard bright edge,
        // exactly the way the real escarpment reads at dawn.
        const l = x > 0 ? x - 1 : 0;
        const r = x < R - 1 ? x + 1 : R - 1;
        const gx = (h[row + r] - h[row + l]) / (2 * p.bps);
        const gz = (h[down + x] - h[up + x]) / (2 * p.bps);
        const shade = clamp(1 + (gz * 0.36 - gx) * relief, 0.4, 1.85);

        d[o] = clamp(c[0] * shade, 0, 1) * 255;
        d[o + 1] = clamp(c[1] * shade, 0, 1) * 255;
        d[o + 2] = clamp(c[2] * shade, 0, 1) * 255;
        d[o + 3] = 255;
      }
    }

    this.texCtx.putImageData(this.img, 0, 0);
  }

  // ------------------------------------------------------------- the drawing

  private syncBacking(): void {
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    if (dpr === this.dpr) return;
    this.dpr = dpr;
    this.canvas.width = Math.round(SIZE * dpr);
    this.canvas.height = Math.round(SIZE * dpr);
  }

  private draw(s: MiniMapState): void {
    const g = this.ctx;
    const scale = SIZE / this.spanM; // CSS px per block

    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, SIZE, SIZE);
    g.fillStyle = MAP_BG;
    g.fillRect(0, 0, SIZE, SIZE);

    // --- terrain
    const b = this.ready;
    if (b) {
      const rMinX = b.cx - (b.span * PAD) / 2;
      const rMinZ = b.cz - (b.span * PAD) / 2;
      const sx = (s.x - this.spanM / 2 - rMinX) / b.bps;
      const sy = (s.z - this.spanM / 2 - rMinZ) / b.bps;
      const sw = this.spanM / b.bps;
      // Partly-outside source rectangles are clipped proportionally by the
      // spec, so an edge case at the raster border still lands in the right
      // place — it just leaves the background showing.
      g.imageSmoothingEnabled = true;
      g.drawImage(this.tex, sx, sy, sw, sw, 0, 0, SIZE, SIZE);
    }

    g.font = `9px ${FONT}`;
    g.textAlign = 'left';
    g.textBaseline = 'middle';

    // --- landmarks first: they are scenery for everything else.
    for (const lm of LANDMARKS) {
      const x = SIZE / 2 + (lm.x - s.x) * scale;
      const y = SIZE / 2 + (lm.z - s.z) * scale;
      if (x < -20 || x > SIZE + 20 || y < -12 || y > SIZE + 12) continue;
      g.strokeStyle = INK_DIM;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, y - 4);
      g.lineTo(x + 4, y);
      g.lineTo(x, y + 4);
      g.lineTo(x - 4, y);
      g.closePath();
      g.stroke();
      this.label(lm.name, x + 6, y, INK_DIM);
    }

    // --- declarations: hollow ring, effect radius, alignment arc.
    for (const m of s.declarations ?? EMPTY) {
      const x = SIZE / 2 + (m.x - s.x) * scale;
      const y = SIZE / 2 + (m.z - s.z) * scale;
      if (!this.onMap(x, y)) continue;
      const ink = m.colour === undefined ? INK_DECL : css(m.colour);
      if (m.radius) {
        g.strokeStyle = ink;
        g.globalAlpha = 0.25;
        g.beginPath();
        g.arc(x, y, Math.max(2, m.radius * scale), 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }
      g.strokeStyle = ink;
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(x, y, 4.5, 0, Math.PI * 2);
      g.stroke();
      if (m.progress !== undefined) {
        g.lineWidth = 2.4;
        g.beginPath();
        g.arc(x, y, 4.5, -Math.PI / 2, -Math.PI / 2 + clamp(m.progress, 0, 1) * Math.PI * 2);
        g.stroke();
      }
      if (m.label) this.label(m.label, x + 7, y, ink);
    }

    // --- unclaimed seeds: a four-point star with a glow. The only thing on the
    // map drawn with a shadow, because it is the only thing that is a prize.
    for (const m of s.seeds ?? EMPTY) {
      const x = SIZE / 2 + (m.x - s.x) * scale;
      const y = SIZE / 2 + (m.z - s.z) * scale;
      const ink = m.colour === undefined ? INK_SEED : css(m.colour);
      if (!this.onMap(x, y)) { this.rimMark(x, y, ink); continue; }
      g.fillStyle = ink;
      g.shadowColor = ink;
      g.shadowBlur = 8;
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 === 0 ? 5.5 : 2;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath();
      g.fill();
      g.shadowBlur = 0;
      if (m.label) this.label(m.label, x + 7, y, ink);
    }

    // --- peers and agents: a filled dot with a ring, so it stays visible over
    // both snow and ash.
    const nameThem = this.spanM <= 300 && (s.peers ?? EMPTY).length <= 8;
    for (const m of s.peers ?? EMPTY) {
      const x = SIZE / 2 + (m.x - s.x) * scale;
      const y = SIZE / 2 + (m.z - s.z) * scale;
      if (!this.onMap(x, y)) continue;
      const ink = m.colour === undefined ? INK_PEER : css(m.colour);
      g.fillStyle = ink;
      g.beginPath();
      g.arc(x, y, 3, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = MAP_BG;
      g.lineWidth = 1;
      g.stroke();
      if (m.label && nameThem) this.label(m.label, x + 6, y, ink);
    }

    // --- Molochs last of the markers: nothing may hide one.
    for (const m of s.molochs ?? EMPTY) {
      const x = SIZE / 2 + (m.x - s.x) * scale;
      const y = SIZE / 2 + (m.z - s.z) * scale;
      const ink = m.colour === undefined ? INK_MOLOCH : css(m.colour);
      if (!this.onMap(x, y)) { this.rimMark(x, y, ink); continue; }
      g.fillStyle = ink;
      g.strokeStyle = MAP_BG;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, y - 5.5);
      g.lineTo(x + 5.5, y);
      g.lineTo(x, y + 5.5);
      g.lineTo(x - 5.5, y);
      g.closePath();
      g.fill();
      g.stroke();
      if (m.progress !== undefined) {
        // How bound he already is — the only number that matters about him.
        g.strokeStyle = INK_CORE;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x, y, 8, -Math.PI / 2, -Math.PI / 2 + clamp(m.progress, 0, 1) * Math.PI * 2);
        g.stroke();
      }
      if (m.label) this.label(m.label, x + 8, y, ink);
    }

    this.drawPlayer(s.yaw);
    this.drawCompass();
    this.drawScale(scale);

    if (this.pending) {
      // Honest feedback that the ground under the overlays is still catching
      // up, rather than silently showing a stale or empty map.
      g.fillStyle = INK_DIM;
      g.globalAlpha = 0.5;
      g.fillRect(8, 8, 40 * (this.pending.row / R), 2);
      g.globalAlpha = 1;
    }
  }

  private onMap(x: number, y: number): boolean {
    return x >= 0 && x <= SIZE && y >= 0 && y <= SIZE;
  }

  private label(text: string, x: number, y: number, ink: string): void {
    const g = this.ctx;
    g.fillStyle = 'rgba(6,8,12,0.85)';
    g.fillText(text, x + 1, y + 1);
    g.fillStyle = ink;
    g.fillText(text, x, y);
  }

  /** A chevron pinned to the rim for an off-map Moloch or seed. */
  private rimMark(x: number, y: number, ink: string): void {
    const g = this.ctx;
    const dx = x - SIZE / 2;
    const dy = y - SIZE / 2;
    const len = Math.hypot(dx, dy) || 1;
    const rx = SIZE / 2 + (dx / len) * (SIZE / 2 - 7);
    const ry = SIZE / 2 + (dy / len) * (SIZE / 2 - 7);
    const a = Math.atan2(dy, dx);
    g.save();
    g.translate(rx, ry);
    g.rotate(a);
    g.fillStyle = ink;
    g.globalAlpha = 0.85;
    g.beginPath();
    g.moveTo(5, 0);
    g.lineTo(-3, 3.5);
    g.lineTo(-3, -3.5);
    g.closePath();
    g.fill();
    g.globalAlpha = 1;
    g.restore();
  }

  /**
   * You, always dead centre. Player.yaw is 0 facing -Z and the map is
   * north-up with -Z at the top, so rotating the glyph by -yaw points it the
   * way you are actually looking.
   */
  private drawPlayer(yaw: number): void {
    const g = this.ctx;
    g.save();
    g.translate(SIZE / 2, SIZE / 2);
    g.rotate(-yaw);

    // Field of view wedge — cheap orientation cue you can read peripherally.
    g.fillStyle = 'rgba(255,233,176,0.13)';
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, 26, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62);
    g.closePath();
    g.fill();

    g.fillStyle = INK_CORE;
    g.strokeStyle = MAP_BG;
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(0, -7.5);
    g.lineTo(5, 6);
    g.lineTo(0, 3);
    g.lineTo(-5, 6);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }

  /** North is always up; the rose says so without the player having to test it. */
  private drawCompass(): void {
    const g = this.ctx;
    const cx = SIZE - 20;
    const cy = 20;
    g.strokeStyle = INK_DIM;
    g.lineWidth = 1;
    g.globalAlpha = 0.75;
    g.beginPath();
    g.arc(cx, cy, 11, 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = INK_CORE;
    g.beginPath();
    g.moveTo(cx, cy - 8);
    g.lineTo(cx + 3.2, cy + 1);
    g.lineTo(cx - 3.2, cy + 1);
    g.closePath();
    g.fill();
    g.font = `8px ${FONT}`;
    g.textAlign = 'center';
    g.fillStyle = INK_DIM;
    g.fillText('N', cx, cy + 6);
    g.textAlign = 'left';
    g.font = `9px ${FONT}`;
  }

  /** A bar of a round number of metres, so distances can be eyeballed. */
  private drawScale(scale: number): void {
    const g = this.ctx;
    const nice = [10, 25, 50, 100, 200, 500, 1000];
    let metres = nice[0];
    for (const n of nice) if (n <= this.spanM / 3) metres = n;
    const w = metres * scale;
    const x0 = 10;
    const y0 = SIZE - 12;

    g.strokeStyle = INK_CORE;
    g.lineWidth = 1;
    g.globalAlpha = 0.9;
    g.beginPath();
    g.moveTo(x0, y0 - 3);
    g.lineTo(x0, y0);
    g.lineTo(x0 + w, y0);
    g.lineTo(x0 + w, y0 - 3);
    g.stroke();
    g.globalAlpha = 1;
    this.label(`${metres} m`, x0, y0 - 9, INK_CORE);
  }

  private updateReadouts(s: MiniMapState): void {
    const ground = Math.floor(terrainHeight(s.x, s.z, this.seed));
    const pos = `${Math.round(s.x)}, ${Math.round(s.z)}  y ${Math.round(s.y)}` +
      (Math.abs(Math.round(s.y) - ground) > 2 ? ` (gnd ${ground})` : '');
    if (pos !== this.lastPos) { this.posEl.textContent = pos; this.lastPos = pos; }

    const biome = BIOME_NAMES[sampleColumn(s.x, s.z, this.seed).biome];
    if (biome !== this.lastBiome) { this.biomeEl.textContent = biome; this.lastBiome = biome; }

    const span = `${this.spanM} m across`;
    if (span !== this.lastSpan) { this.spanEl.textContent = span; this.lastSpan = span; }
  }
}
