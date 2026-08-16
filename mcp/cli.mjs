#!/usr/bin/env node
/**
 * A thin CLI over the MCP server, for playtesting.
 *
 * MCP is a stdio protocol meant for a model host to drive. This wrapper spawns
 * the real server.mjs and speaks JSON-RPC to it, so a playtester (human or
 * agent) can run a scripted sequence of tool calls in one process and read the
 * results — without needing an MCP client registered.
 *
 * Usage:
 *   node mcp/cli.mjs --name Alpha --script '[{"tool":"join"},{"tool":"look"}]'
 *   node mcp/cli.mjs --name Alpha --at 1755340000000 --script '[...]'
 *
 * --at is a wall-clock epoch-ms to wait for before running the script. That is
 * how several agents make their beams land at the SAME MOMENT, which is the
 * only way a tether quorum can be paid.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

function arg(flag, dflt = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const name = arg('--name', `Tester${Math.floor(Math.random() * 900 + 100)}`);
const at = Number(arg('--at', '0'));
let script;
try {
  script = JSON.parse(arg('--script', '[]'));
} catch (e) {
  console.error('Bad --script JSON:', e.message);
  process.exit(2);
}
if (!Array.isArray(script)) { console.error('--script must be a JSON array'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn('node', [join(HERE, 'server.mjs')], { stdio: ['pipe', 'pipe', 'pipe'] });
child.stderr.on('data', () => {}); // the server logs its readiness banner here

let buf = '';
const pending = new Map();
let nextId = 1;

child.stdout.on('data', (d) => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function rpc(method, params, timeoutMs = 60000) {
  const id = nextId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pending.delete(id); resolve({ error: { message: 'timeout' } }); }, timeoutMs);
    pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

const textOf = (res) => {
  const c = res?.result?.content;
  if (Array.isArray(c) && c[0]?.text) return c[0].text;
  if (res?.error) return `ERROR: ${res.error.message}`;
  return JSON.stringify(res?.result ?? res);
};

async function main() {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'philo-cli', version: '1' },
  });
  await sleep(250);

  if (at > 0) {
    const wait = at - Date.now();
    if (wait > 0) {
      console.log(`[${name}] holding ${(wait / 1000).toFixed(1)}s until the agreed moment…`);
      await sleep(wait);
    }
  }

  for (const step of script) {
    const tool = step.tool;
    const args = { ...step };
    delete args.tool;
    if (tool === 'join' && !args.name) args.name = name;

    // Pseudo-step: block until an agreed wall-clock moment. This has to be
    // available MID-script, not just at the start — agents need to join and
    // walk into range first, and only then line up. Synchronising before the
    // walk would just desynchronise them again by however long the walk took.
    if (tool === 'hold_until') {
      const target = Number(args.at ?? 0);
      const wait = target - Date.now();
      if (wait <= 0) {
        // Loudly. Silently falling through here desynchronises the whole squad
        // and the failure looks like a mechanic bug rather than a clock bug.
        console.log(`\n=== [${name}] hold_until(${target}) — !!! MOMENT ALREADY PASSED by ${(-wait / 1000).toFixed(1)}s !!! ===`);
        console.log(`[${name}] NOT WAITING. Whatever you do next will NOT be synchronised with the others.`);
        console.log(`[${name}] Pick a moment in the future: now is ${Date.now()}.`);
        continue;
      }
      console.log(`\n=== [${name}] hold_until(${target}) — waiting ${(wait / 1000).toFixed(1)}s ===`);
      await sleep(wait);
      console.log(`[${name}] released at ${Date.now()}`);
      continue;
    }

    const started = Date.now();
    const res = await rpc('tools/call', { name: tool, arguments: args });
    const ms = Date.now() - started;
    console.log(`\n=== [${name}] ${tool}(${JSON.stringify(args)}) — ${ms}ms ===`);
    console.log(textOf(res).slice(0, 3500));
  }

  child.kill();
  process.exit(0);
}

main().catch((e) => { console.error(e); child.kill(); process.exit(1); });
