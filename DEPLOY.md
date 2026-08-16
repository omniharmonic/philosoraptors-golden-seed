# Putting this online, for about nothing

Three ways to play, in increasing order of reach. You do not need all of them.

| | Who can play | Cost | Setup |
|---|---|---|---|
| **Local** | you | free | `npm run play` |
| **LAN** | anyone on your wifi | free | `npm run play`, share the printed link |
| **Hosted worlds** | anyone with the link | free tier, realistically £0 | 2 commands, below |

The same simulation runs in all three. `shared/authority.mjs` is the entire
game and knows nothing about transports; `server/server.mjs` wraps it in a Node
WebSocket server, and `edge/worker.js` wraps it in a Cloudflare Durable Object.

---

## It is already live

**https://philosoraptors.philosoraptors-golden-seed.workers.dev**

Open it, click **host a world**, and send the link you land on to anyone.

## Deploying your own

You need a free Cloudflare account. No card.

```bash
npm install
npx wrangler login          # opens a browser once
npm run edge:deploy         # builds the game and ships everything
```

That is the whole thing. The game and the relay are ONE worker: static files
are served directly, and anything that is not a file (`/new`, `/w/<CODE>`)
falls through to the relay. So the WebSocket is same-origin as the page —
nothing to configure, no CORS, and no second URL to get wrong.

You do not need to edit `EDGE_RELAY`; it defaults to the origin the page was
served from, so a fork deployed to your own account works untouched.

---

## What actually happens when someone hosts a world

1. The browser asks your worker for a code (`POST /new`) — six characters.
2. The link carries the code: `?w=K7QM2F`.
3. Everyone opening that link connects to `wss://…/w/K7QM2F`.
4. The worker routes that code to a **Durable Object** via `getByName(code)`.
   Same code, same object, every time.
5. Cloudflare creates that object **near whoever asked for it first**, and
   everyone else connects to that instance.

So a world does spin up at the edge, close to its host, and other players join
it there. There is no lobby server, no matchmaking, and no database — the code
*is* the address.

## Why it is free

Durable Objects run on the Workers **Free** plan (SQLite-backed), which includes
100,000 requests/day. The billing details that matter for a game:

- **Incoming** WebSocket messages bill at **20:1** — 100 messages count as 5
  requests.
- **Outgoing** messages are **free**. The 10Hz world tick, which is the bulk of
  all traffic, costs nothing.
- **Hibernation**: an idle world is evicted from memory while players stay
  connected, and accrues no duration charge until the next message.

The client sends one recurring message — its own position — at 8Hz, and only
when it has actually moved (standing still drops to 1Hz). Four players moving
constantly is roughly 3 billable requests/second, so the free allowance covers
on the order of **nine hours of continuous four-player play per day**. A world
with people standing around talking costs a small fraction of that.

If you outgrow it, Workers Paid is $5/month and the limits stop being
interesting.

## Hosting the page itself

Anything that serves static files works — the game is a folder of files after
`npm run build`.

- **Cloudflare Pages**: `npx wrangler pages deploy dist` — free, unmetered
  bandwidth, and it sits next to your worker.
- **GitHub Pages**: free, and the repo is already there. Serve `dist/` from a
  branch or an action.
- **Anything else**: Netlify, Vercel, a static bucket. There is no server side
  to the game itself.

## Self-hosting instead

If you would rather run the relay yourself — a VPS, a Raspberry Pi, a spare
laptop — nothing about that changed:

```bash
npm run server                        # relay on :8787
PORT=9000 npm run server              # or somewhere else
```

Then point players at it explicitly:

```
https://your-game-page/?relay=wss://your-host:8787
```

That path never touches Cloudflare, has no request limits, and is a good fit if
you want a world that runs for weeks.

## Agents

The MCP server takes the same relay:

```bash
PHILO_RELAY=wss://philosoraptors.<you>.workers.dev/w/K7QM2F node mcp/server.mjs
```

so an agent can join a hosted world from anywhere, exactly like a person.

## What I deliberately did not build

**WebRTC peer-to-peer.** It is genuinely free for game traffic — players talk
directly, and the server only introduces them. I chose against it as the default
because roughly 10–20% of players sit behind NATs that need a TURN relay to
connect at all, TURN is the one piece that is not free, and when it fails it
fails as "some of my friends just cannot join", which is the worst possible bug
to hand a non-technical host. The Durable Object path costs approximately
nothing and always works.

If you later want P2P, the shape is already right: `shared/authority.mjs` runs
anywhere, so a host-in-the-browser mode is a transport swap rather than a
rewrite.
