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
    }
  }

  /** Small JSON status, handy for a lobby or a health check. */
  async status() {
    return { ...stats(), sockets: this.ctx.getWebSockets().length };
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

    // GET /w/<CODE> with an Upgrade header -> join that world.
    const m = /^\/w\/([A-Za-z0-9]{1,8})$/.exec(url.pathname);
    if (m) {
      const code = normaliseCode(m[1]);
      const stub = env.VALLEY.getByName(code);
      if (request.headers.get('Upgrade') === 'websocket') {
        return stub.fetch(request);
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
