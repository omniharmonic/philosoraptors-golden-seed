/**
 * Free hosted worlds, at the edge.
 *
 * One Durable Object per world code. `getByName(code)` routes every player who
 * types the same code to the same object, and Cloudflare creates that object
 * near whoever asked for it first — so a world genuinely does spin up close to
 * the person who started it, and everyone else connects to that instance.
 *
 * It runs shared/authority.mjs unmodified. A world hosted here and a world you
 * host on your own laptop are the same simulation.
 *
 * WHY THIS IS FREE, roughly:
 *   - Durable Objects are on the Workers Free plan (SQLite-backed), 100k
 *     requests/day.
 *   - Incoming WebSocket messages bill at 20:1 — 100 messages count as 5
 *     requests. Outgoing messages are free, and the tick broadcast (the bulk of
 *     the traffic) is all outgoing.
 *   - WebSocket Hibernation means an idle world costs no duration at all: the
 *     object is evicted from memory while players stay connected, and wakes on
 *     the next message.
 *
 * At ~15 inbound messages per second per player, four players cost about three
 * billable requests per second, so the free allowance covers roughly nine hours
 * of continuous four-player play per day. A quiet world costs essentially zero.
 */

import { DurableObject } from 'cloudflare:workers';
import { attach, handleMessage, leave, step, stats, HZ } from '../shared/authority.mjs';

/** Idle worlds stop ticking so they can hibernate. */
const IDLE_SLEEP_MS = 60_000;

export class Valley extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.attached = false;
    this.lastActivity = Date.now();
  }

  /**
   * Wire the authority to this object's sockets.
   *
   * Done lazily rather than in the constructor because the object is
   * reconstructed every time it wakes from hibernation, and the sockets that
   * survived hibernation are only available from getWebSockets().
   */
  ensureAttached() {
    if (this.attached) return;
    this.attached = true;
    attach({
      send: (id, msg) => {
        const raw = JSON.stringify(msg);
        for (const ws of this.ctx.getWebSockets()) {
          // The player id is stored on the socket so it survives hibernation —
          // in-memory maps do not.
          if (ws.deserializeAttachment()?.id === id) {
            try { ws.send(raw); } catch { /* closing */ }
            return;
          }
        }
      },
      log: () => {},
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    // The worker passes the code through so the object can identify itself to
    // the lobby index. A DO cannot otherwise know the name it was addressed by.
    const code = url.searchParams.get('code');
    const name = url.searchParams.get('name');
    if (code) await this.ctx.storage.put('code', code);
    if (name) await this.ctx.storage.put('name', name.slice(0, 40));
    if (url.searchParams.get('listed') === '1') await this.ctx.storage.put('listed', true);

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade.', { status: 426 });
    }
    this.ensureAttached();

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // acceptWebSocket, NOT server.accept(): this is what allows the object to
    // hibernate while players stay connected, which is where the cost savings
    // come from.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: null });

    await this.armTick();
    await this.report();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    this.ensureAttached();
    this.lastActivity = Date.now();

    let msg;
    try { msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); }
    catch { return; }

    // The client chooses its own persistent id in `hello`. Pin it to the socket
    // so the authority can address this connection after a hibernation cycle.
    if (msg.t === 'hello' && typeof msg.id === 'string') {
      ws.serializeAttachment({ id: msg.id });
    }
    const id = ws.deserializeAttachment()?.id;
    if (!id) return;

    handleMessage(id, msg);
    await this.armTick();
  }

  async webSocketClose(ws) {
    this.ensureAttached();
    const id = ws.deserializeAttachment()?.id;
    if (id) leave(id);
    await this.report();
  }

  /**
   * Tell the lobby index we exist and how busy we are.
   *
   * Only listed worlds are advertised — a world created without `listed` is
   * reachable by code and invisible, which is the right default for a link you
   * send to three friends.
   */
  async report() {
    const listed = await this.ctx.storage.get('listed');
    if (!listed) return;
    const code = await this.ctx.storage.get('code');
    if (!code) return;
    const name = (await this.ctx.storage.get('name')) || 'a valley';
    const players = this.ctx.getWebSockets().length;
    try {
      await this.env.LOBBY.getByName('index').touch({
        code, name, players, ...stats(),
      });
    } catch { /* the index is a convenience; never let it break a world */ }
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }

  /**
   * The world ticks on an alarm rather than a timer, because a Durable Object
   * has no setInterval that survives hibernation. Each alarm steps the world
   * and schedules the next one, and it stops scheduling once the world is empty
   * so the object can sleep.
   */
  async armTick() {
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null) {
      await this.ctx.storage.setAlarm(Date.now() + 1000 / HZ);
    }
  }

  async alarm() {
    this.ensureAttached();
    step(1 / HZ);

    const players = this.ctx.getWebSockets().length;
    const idle = Date.now() - this.lastActivity > IDLE_SLEEP_MS;
    // Keep ticking while anyone is here. An empty or long-idle world stops,
    // which lets the object hibernate and cost nothing.
    if (players > 0 && !idle) {
      await this.ctx.storage.setAlarm(Date.now() + 1000 / HZ);
      // Refresh the lobby entry about once a minute while anyone is here.
      this.reportTick = (this.reportTick ?? 0) + 1;
      if (this.reportTick % (HZ * 60) === 0) await this.report();
    } else {
      await this.report();
    }
  }

  /** Small JSON status, handy for a lobby or a health check. */
  async status() {
    return { ...stats(), sockets: this.ctx.getWebSockets().length };
  }
}

/**
 * The lobby index.
 *
 * One tiny Durable Object holding a row per listed world. Worlds push to it on
 * join, leave and about once a minute; nothing polls, so a quiet lobby costs
 * nothing. Entries expire on read rather than on a timer, which means an index
 * nobody is looking at does no work at all.
 */
export class Lobby extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS worlds (
          code TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          players INTEGER NOT NULL,
          molochs INTEGER NOT NULL DEFAULT 0,
          banished INTEGER NOT NULL DEFAULT 0,
          seen INTEGER NOT NULL
        )
      `);
    });
  }

  async touch(w) {
    this.ctx.storage.sql.exec(
      `INSERT INTO worlds (code, name, players, molochs, banished, seen)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET
         name = excluded.name, players = excluded.players,
         molochs = excluded.molochs, banished = excluded.banished,
         seen = excluded.seen`,
      String(w.code).slice(0, 8), String(w.name).slice(0, 40),
      w.players | 0, w.molochs | 0, w.banished | 0, Date.now(),
    );
  }

  /** Listed worlds seen recently, busiest first. */
  async list() {
    // Five minutes: long enough that a world does not vanish between two
    // players arriving, short enough that dead worlds fall off by themselves.
    const cutoff = Date.now() - 5 * 60_000;
    this.ctx.storage.sql.exec('DELETE FROM worlds WHERE seen < ?', cutoff - 60 * 60_000);
    return this.ctx.storage.sql
      .exec('SELECT code, name, players, molochs, banished, seen FROM worlds WHERE seen >= ? ORDER BY players DESC, seen DESC LIMIT 40', cutoff)
      .toArray();
  }
}

/** Room codes: short, unambiguous, easy to read aloud. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function normaliseCode(raw) {
  const up = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  // O/0 and I/1 are the classic misreads when someone reads a code out loud.
  const fixed = up.replace(/O/g, '0').replace(/I/g, '1').replace(/0/g, '0');
  return fixed.slice(0, 8);
}

function randomCode() {
  const n = new Uint8Array(6);
  crypto.getRandomValues(n);
  return [...n].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    // POST /new -> mint a world code. No auth: a code IS the invitation, and
    // guessing a random 6-character code is not a threat model worth the
    // friction of accounts.
    if (url.pathname === '/new') {
      return Response.json({ code: randomCode() }, { headers: cors });
    }

    // GET /lobbies -> public worlds anyone can drop into.
    if (url.pathname === '/lobbies') {
      const worlds = await env.LOBBY.getByName('index').list();
      return Response.json({ worlds }, { headers: cors });
    }

    // GET /w/<CODE> with an Upgrade header -> join that world.
    const m = /^\/w\/([A-Za-z0-9]{1,8})$/.exec(url.pathname);
    if (m) {
      const code = normaliseCode(m[1]);
      const stub = env.VALLEY.getByName(code);
      if (request.headers.get('Upgrade') === 'websocket') {
        // Pass the code through: a Durable Object cannot otherwise learn the
        // name it was addressed by, and it needs that to list itself.
        const fwd = new URL(request.url);
        fwd.searchParams.set('code', code);
        return stub.fetch(new Request(fwd, request));
      }
      return Response.json({ code, ...(await stub.status()) }, { headers: cors });
    }

    return new Response(
      'Philosoraptors relay.\n\n' +
      'POST /new        mint a world code\n' +
      'GET  /w/<CODE>   status, or upgrade to a WebSocket to play\n',
      { headers: { 'content-type': 'text/plain', ...cors } },
    );
  },
};
