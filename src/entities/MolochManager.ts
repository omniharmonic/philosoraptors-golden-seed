import * as THREE from 'three';
import { MolochEntity } from './MolochEntity';
import type { World } from '../world/World';
import { CX, CZ } from '../world/Chunk';
import { RULES, type MolochState, type Uid, type WireMoloch } from '../net/protocol';

/**
 * MolochManager — the bridge between the server's Moloch list and the local
 * demons that walk around in front of you.
 *
 * The server is the authority on WHERE Moloch is, HOW MUCH he has eaten and HOW
 * BOUND he is; it knows none of those things about the terrain, because terrain
 * is generated from a seed on each client and never uploaded. So the split is:
 *
 *   server -> x/z, gorge, bound, state, yaw
 *   client -> ground height, gait, ember pulse, the collapse animation
 *
 * The interesting rule here is the authority rule. Moloch rakes living soil into
 * ash as he goes, and `MolochEntity` picks those columns with `Math.random()`.
 * If every client ran that, three clients would rake three DIFFERENT patches and
 * then broadcast all three — the commons would degrade at 3x and no two screens
 * would agree. So exactly one client (the server-nominated `authority`, the
 * lowest-id non-agent player) is allowed to turn Moloch's appetite into real
 * block edits, and it reports each one through `onBlockChange` so the relay can
 * hand the same edit to everyone else. Every other client renders and nothing
 * more.
 */

export interface MolochSighting {
  moloch: MolochEntity;
  /** Straight-line distance from the queried point, in metres. */
  dist: number;
}

export interface MolochManagerOpts {
  /**
   * Called once per block that Moloch actually changes, and only on the
   * authority client. Wire it to a `block` message so the edit reaches the rest
   * of the valley instead of staying in one browser.
   */
  onBlockChange?(x: number, y: number, z: number, id: number): void;
  /** From `welcome.authority`; keep it fresh from every `tick.authority`. */
  isAuthority?: boolean;
}

/**
 * The relay ticks at 10Hz (`HZ` in server.mjs), so a raw copy of the wire
 * position would step him forward 0.2m ten times a second. These rates are
 * chosen so he closes a normal tick's worth of travel inside one tick — smooth,
 * but never far enough behind to look like he is being dragged.
 */
const FOLLOW_RATE = 9;
const YAW_RATE = 6;
const GROUND_RATE = 12;
/** Past this the wire is not late, it is telling us he is somewhere else. */
const SNAP_DIST = 24;

/** Frame-rate independent exponential approach. */
const approach = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

/**
 * Moloch's own reap and grounding code calls `heightAt`, which GENERATES the
 * chunk it is asked about. He roams up to 90m from a player and `World.update`
 * unloads the far field every frame, so an ungated query would generate and
 * discard the same chunk every 2.2s. Columns the client is not actually holding
 * report no ground instead: he only rakes soil somebody is standing near.
 */
function resident(world: World, x: number, z: number): boolean {
  const c = world.getChunk(Math.floor(x / CX), Math.floor(z / CZ));
  return !!c && c.generated;
}

/** Local shadow of one server-side Moloch. */
interface Tracked {
  entity: MolochEntity;
  /** Latest authoritative position. `y` is deliberately absent — see above. */
  tx: number;
  tz: number;
  yaw: number;
  gorge: number;
  state: MolochState;
  /** Column the cached ground sample was taken in. */
  gx: number;
  gz: number;
  groundY: number;
  grounded: boolean;
  /** Position handed to the entity this frame, re-asserted after its update. */
  fx: number;
  fy: number;
  fz: number;
}

export class MolochManager {
  readonly group = new THREE.Group();

  /** Only the authority applies ground damage. Refresh from `tick.authority`. */
  isAuthority: boolean;

  private readonly onBlockChange?: (x: number, y: number, z: number, id: number) => void;
  private readonly tracked = new Map<Uid, Tracked>();
  /** Molochs the server has dropped but whose collapse is still playing. */
  private readonly retiring: MolochEntity[] = [];
  /**
   * uids whose collapse has already completed locally. See upsert(): the server
   * keeps sending a banished uid for a tick or two after we have finished with
   * it, and without this he would be rebuilt and re-killed in front of the player.
   */
  private readonly banished = new Set<Uid>();

  private view: World | null = null;
  private viewOf: World | null = null;
  private viewAuthority = false;

  constructor(opts: MolochManagerOpts = {}) {
    this.group.name = 'molochs';
    this.onBlockChange = opts.onBlockChange;
    this.isAuthority = opts.isAuthority ?? false;
  }

  get count(): number { return this.tracked.size; }

  list(): MolochEntity[] {
    const out: MolochEntity[] = [];
    for (const t of this.tracked.values()) out.push(t.entity);
    return out;
  }

  get(uid: Uid): MolochEntity | undefined {
    return this.tracked.get(uid)?.entity;
  }

  /**
   * Reconcile the whole authoritative list. Safe to call every `tick`: it
   * spawns what is new, retires what is gone and re-asserts the rest.
   */
  sync(wire: WireMoloch[]): void {
    const live = new Set<Uid>();
    for (const w of wire) {
      live.add(w.uid);
      this.upsert(w);
    }
    for (const uid of [...this.tracked.keys()]) {
      if (!live.has(uid)) this.remove(uid);
    }
  }

  /** One Moloch from `molochSpawn` or from a `tick`. */
  upsert(w: WireMoloch): MolochEntity | null {
    // Tombstone guard. Our local collapse finishes ~0.2s BEFORE the server's
    // (the server only starts its banishT on the tick after bound=1), so the
    // uid is still present in one or two more `tick` payloads after we have
    // disposed the entity. Without this, upsert would build a brand-new
    // full-size demon and immediately re-banish it — a second collapse of a
    // Moloch the player already watched die. Cleared by molochGone().
    if (this.banished.has(w.uid)) return null;
    let t = this.tracked.get(w.uid);
    if (!t) {
      const entity = new MolochEntity(w.uid, w.x, w.y, w.z);
      this.group.add(entity.root);
      t = {
        entity,
        tx: w.x, tz: w.z, yaw: w.yaw,
        gorge: w.gorge, state: w.state,
        gx: NaN, gz: NaN, groundY: w.y, grounded: false,
        fx: w.x, fy: w.y, fz: w.z,
      };
      this.tracked.set(w.uid, t);
    }

    t.tx = w.x;
    t.tz = w.z;
    t.yaw = w.yaw;
    t.gorge = w.gorge;

    const e = t.entity;
    // Gorge drives his size and drain radius, so it must be server truth: the
    // local reap loop counts seeds that another client may already have taken.
    e.gorge = w.gorge;

    // Binding only ever goes up, and `bind()` is what arms the collapse — so
    // apply the delta through it rather than assigning the field.
    if (w.bound > e.bound) e.bind(w.bound - e.bound);
    else e.bound = w.bound;

    if (w.state === 'banish') e.bind(1);
    else if (e.state !== 'banish') { t.state = w.state; e.state = w.state; }

    return e;
  }

  /** From `molochBound`. The server has already checked the quorum. */
  bind(uid: Uid, amount = 1): void {
    this.tracked.get(uid)?.entity.bind(amount);
  }

  /** From `molochGone`, or from a uid dropping out of the tick list. */
  remove(uid: Uid): void {
    const t = this.tracked.get(uid);
    // The authority has confirmed he is gone, so the tombstone has done its job.
    this.banished.delete(uid);
    if (!t) return;
    this.tracked.delete(uid);
    // The server deletes him the instant his 3.2s banish timer ends. Disposing
    // on that message would cut the one moment that shows a Hyperobject
    // working, so a collapse in progress is allowed to finish locally.
    if (t.entity.state === 'banish' && !t.entity.dead) this.retiring.push(t.entity);
    else t.entity.dispose();
  }

  update(dt: number, world: World, playerPos: THREE.Vector3): void {
    const view = this.worldView(world);

    for (const [uid, t] of this.tracked) {
      const e = t.entity;
      // Captured before `update`, which recomputes `state` from local distance.
      const banishing = e.state === 'banish';

      if (!banishing) this.follow(t, dt, world);
      e.update(dt, view, playerPos, noReap);
      if (!banishing) this.reassert(t, dt);

      if (e.dead) {
        e.dispose();
        this.tracked.delete(uid);
        this.banished.add(uid);
      }
    }

    for (let i = this.retiring.length - 1; i >= 0; i--) {
      const e = this.retiring[i];
      e.update(dt, view, playerPos, noReap);
      if (e.dead) {
        e.dispose();
        this.retiring.splice(i, 1);
      }
    }
  }

  /**
   * Nearest Moloch that still matters. A banishing one is skipped: he is
   * already unmade, and pointing the HUD at him would read as a live threat.
   */
  nearest(pos: THREE.Vector3): MolochSighting | null {
    let moloch: MolochEntity | null = null;
    let dist = Infinity;
    for (const t of this.tracked.values()) {
      if (t.entity.state === 'banish') continue;
      const d = t.entity.pos.distanceTo(pos);
      if (d < dist) { dist = d; moloch = t.entity; }
    }
    return moloch ? { moloch, dist } : null;
  }

  /**
   * Everyone close enough to be a problem, nearest first. Not filtered to the
   * `menace` state on purpose — a Moloch in `reap` thirty metres away is eating
   * the ground you are standing on, which is exactly what a warning is for.
   */
  menacing(pos: THREE.Vector3, range = 40): MolochSighting[] {
    const out: MolochSighting[] = [];
    for (const t of this.tracked.values()) {
      if (t.entity.state === 'banish') continue;
      const dist = t.entity.pos.distanceTo(pos);
      if (dist <= range) out.push({ moloch: t.entity, dist });
    }
    out.sort((a, b) => a.dist - b.dist);
    return out;
  }

  /**
   * Why swinging at him did nothing.
   *
   * The refusal text comes from `RULES` so the HUD, the chat log and the MCP
   * agent all give the identical answer — an agent that got a different excuse
   * than a human would start theorising about hit points, and there are none.
   */
  whyAttackFails(pos?: THREE.Vector3): string {
    const parts: string[] = [RULES.molochImmuneToForce];
    const near = pos ? this.nearest(pos) : null;
    if (near) {
      const taken = Math.floor(near.moloch.gorge);
      const bound = Math.round(near.moloch.bound * 100);
      parts.push(`This one has eaten ${taken} of the commons and is ${bound}% bound.`);
    }
    parts.push(RULES.quorumIsTheGame);
    parts.push(
      'Speak a Hyperstition against him, then get other raptors to align with it. ' +
      'A future enough of you declare together is the only thing he cannot eat.',
    );
    return parts.join(' ');
  }

  dispose(): void {
    for (const t of this.tracked.values()) t.entity.dispose();
    for (const e of this.retiring) e.dispose();
    this.tracked.clear();
    this.retiring.length = 0;
    this.view = null;
    this.viewOf = null;
    this.group.removeFromParent();
  }

  // ------------------------------------------------------------- internals

  /** Interpolate toward the wire position and settle him onto local ground. */
  private follow(t: Tracked, dt: number, world: World): void {
    const p = t.entity.pos;

    const gap = Math.hypot(t.tx - p.x, t.tz - p.z);
    const k = gap > SNAP_DIST ? 1 : approach(FOLLOW_RATE, dt);
    p.x += (t.tx - p.x) * k;
    p.z += (t.tz - p.z) * k;

    // Ground sampling is per-column, not per-frame: he is always walking, so a
    // resample on column change costs a handful of lookups a second.
    const gx = Math.floor(p.x);
    const gz = Math.floor(p.z);
    if (!t.grounded || gx !== t.gx || gz !== t.gz) {
      t.gx = gx;
      t.gz = gz;
      const h = resident(world, gx, gz) ? world.heightAt(gx, gz) : -1;
      if (h >= 0) {
        t.groundY = h + 1;
        // First real sample: put his feet down rather than easing him through
        // the hillside from the server's placeholder altitude.
        if (!t.grounded) { p.y = t.groundY; t.grounded = true; }
      }
    }
    if (t.grounded) p.y += (t.groundY - p.y) * approach(GROUND_RATE, dt);

    t.fx = p.x;
    t.fy = p.y;
    t.fz = p.z;
  }

  /**
   * `MolochEntity.update` steers and grounds itself — that logic is what makes
   * him move like something alive when there is no relay at all. With a relay
   * it is fiction, so the server's answer is written back over the top while
   * the gait, the ember pulse and the hoard stay exactly as the entity left
   * them.
   */
  private reassert(t: Tracked, dt: number): void {
    const e = t.entity;

    e.state = t.state;
    e.gorge = t.gorge;

    e.pos.set(t.fx, t.fy, t.fz);
    e.root.position.copy(e.pos);
    e.root.scale.setScalar(e.scale);

    let d = t.yaw - e.root.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    e.root.rotation.y += d * Math.min(1, approach(YAW_RATE, dt));
  }

  /**
   * The world Moloch is handed.
   *
   * Prototype delegation rather than a wrapper class: `World`'s readers reach
   * for private fields, and inheriting the live instance keeps every one of
   * them resolvable while we shadow just the two methods that matter — the one
   * that writes terrain, and the one that would generate terrain nobody is
   * looking at.
   */
  private worldView(world: World): World {
    if (this.view && this.viewOf === world && this.viewAuthority === this.isAuthority) {
      return this.view;
    }
    const emit = this.onBlockChange;
    const authority = this.isAuthority;
    const view: World = Object.create(world);

    view.setBlock = authority
      ? (x: number, y: number, z: number, id: number): boolean => {
          // Skip no-ops so a Moloch standing on already-raked soil does not
          // flood the relay with edits that change nothing.
          if (world.getBlock(x, y, z) === id) return true;
          const ok = world.setBlock(x, y, z, id);
          if (ok) emit?.(x, y, z, id);
          return ok;
        }
      : (): boolean => false;

    view.heightAt = (x: number, z: number): number =>
      resident(world, x, z) ? world.heightAt(x, z) : -1;

    this.view = view;
    this.viewOf = world;
    this.viewAuthority = authority;
    return view;
  }
}

/**
 * Moloch's local reap tally is thrown away: the server integrates `gorge`
 * itself and ships it back, and there is no wire message for "he took n".
 */
const noReap = (): void => {};
