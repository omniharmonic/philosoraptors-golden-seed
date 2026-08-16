/**
 * Self-hosted relay.
 *
 * A thin Node wrapper around shared/authority.mjs, which holds the entire game
 * simulation and knows nothing about transports. The same authority runs
 * unchanged inside a Cloudflare Durable Object (see edge/worker.js), so a world
 * you host on your laptop and a world hosted at the edge behave identically.
 *
 * Run:  npm run server      (or npm run play, which also serves the game)
 */

import { WebSocketServer } from 'ws';
import { networkInterfaces } from 'node:os';
import { attach, handleMessage, leave, step, stats, HZ } from '../shared/authority.mjs';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const wss = new WebSocketServer({ port: PORT });

/** connId -> socket. The authority only ever hands us an id. */
const sockets = new Map();
let nextConn = 1;

attach({
  send(id, msg) {
    const ws = sockets.get(id);
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  },
  log: (...a) => console.log(...a),
});

wss.on('connection', (ws) => {
  // The authority addresses connections by id, so the socket never leaks in.
  const connId = `c${nextConn++}`;
  sockets.set(connId, ws);

  ws.on('message', (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }
    // The client picks its own persistent id in `hello`; from then on the
    // authority uses that, so re-key the socket to match.
    if (msg.t === 'hello' && typeof msg.id === 'string') {
      sockets.delete(connId);
      sockets.set(msg.id, ws);
      ws.__id = msg.id;
    }
    handleMessage(ws.__id ?? connId, msg);
  });

  ws.on('close', () => {
    const id = ws.__id ?? connId;
    leave(id);
    sockets.delete(id);
  });

  ws.on('error', () => { /* a dropped client is normal; close handles it */ });
});

setInterval(() => step(1 / HZ), 1000 / HZ);

// ---------------------------------------------------------------- banner

/** Every non-internal IPv4 address this machine answers on. */
function lanAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
    }
  }
  return out;
}

const lan = lanAddresses();
console.log('');
console.log('  Philosoraptors relay is up.');
console.log(`  seed ${stats().seed}   ws://localhost:${PORT}`);
console.log('');
if (lan.length) {
  console.log('  SHARE THIS with anyone on your network — they just click it:');
  for (const { name, address } of lan) {
    console.log(`      http://${address}:5173      (${name})`);
  }
  console.log('');
  console.log('  They need the game server running too:  npm run dev');
} else {
  console.log('  No LAN address found — you appear to be offline.');
  console.log('  Local play still works at http://localhost:5173');
}
console.log('');
console.log('  To host a world on the public internet for free, see DEPLOY.md');
console.log('');
