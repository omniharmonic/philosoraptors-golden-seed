# Philosoraptors MCP server

An MCP stdio server that lets an AI agent play **Philosoraptors — The Golden Seed**
as a first-class raptor, in the same valley, at the same time, as humans in a
browser.

It is a headless WebSocket client of the authoritative relay (`server/server.mjs`)
and speaks the wire protocol in `src/net/protocol.ts`. It gets no privileged
information and no privileged powers: everything a tool reports is something a
human could read off their own screen, and every rule the relay enforces on a
browser it enforces on the agent.

The agent has no renderer, so every tool result is structured state plus enough
prose to act on — distances, bearings, how many more sigils a commitment needs,
and a `suggestions` list of moves the relay will actually accept right now.

**The one thing to understand before wiring this up:** nothing in this game can be
completed by one player. Moloch is immune to force. The only thing that binds him
is a Hyperstition — a declared future that is not yet true — which becomes real
only when *k distinct other raptors* align with it. `attack()` exists here purely
so that it can refuse. An agent connected to this server cannot win alone, ever,
by design.

---

## 1. Install

```bash
cd mcp
npm install
```

Two dependencies: `@modelcontextprotocol/sdk` and `ws`. Node 20+.

## 2. Run the relay

The MCP server is a *client*. Nothing works until the relay is up. From the repo
root:

```bash
npm run server          # node server/server.mjs → ws://localhost:8787
```

It prints the seed and the coordinates of all seven Golden Seeds:

```
Philosoraptors relay on ws://localhost:8787  (seed 20260816)
Golden Seeds hidden at:
  Seed of Sight      (-1163, 419)
  Seed of Naming     (-236, 1049)
  ...
```

Optionally start the browser client too, so humans and agents share the valley:

```bash
npm run dev             # vite → http://localhost:5173
```

The relay listens on `PORT` if set (`PORT=8788 npm run server`). Point the agent
at a different relay with the `PHILOSORAPTORS_RELAY` environment variable, or by
passing `url` to the `join` tool.

## 3. Register the MCP server

The path must be **absolute**. Replace it with your checkout path; it contains
spaces in the example below, which is fine — JSON `args` entries are not shell
words and need no quoting or escaping beyond normal JSON.

### Claude Code

One-liner:

```bash
claude mcp add philosoraptors -- node "/absolute/path/to/philosorapters/mcp/server.mjs"
```

Or commit it to the project by putting this in `.mcp.json` at the repo root:

```json
{
  "mcpServers": {
    "philosoraptors": {
      "command": "node",
      "args": [
        "/Users/you/Documents/cursor projects/philosorapters/mcp/server.mjs"
      ],
      "env": {
        "PHILOSORAPTORS_RELAY": "ws://localhost:8787"
      }
    }
  }
}
```

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS,
`%APPDATA%\Claude\claude_desktop_config.json` on Windows. Same shape:

```json
{
  "mcpServers": {
    "philosoraptors": {
      "command": "node",
      "args": [
        "/Users/you/Documents/cursor projects/philosorapters/mcp/server.mjs"
      ]
    }
  }
}
```

Restart the client. You should see the tools below, plus two resources:
`philosoraptors://briefing` and `philosoraptors://state`.

**One process is one raptor.** Each MCP server process holds a single connection
and a single identity. To field two agents, run two clients (two Claude Code
sessions, or two entries with different server names) — you cannot `join` twice
from one process.

## 4. Tools

| Tool | What it does |
|---|---|
| `briefing()` | The goal, Moloch, Hyperstition, quorum, and why nothing here is soloable. Works before joining. |
| `join(name, url?)` | Connects and enters the valley as `agent: true`. Returns your id, sigil name, spawn position and the RULES. |
| `look()` | Your senses: position, coherence, seeds; nearby players; every Moloch (distance, bearing, gorge, state, bound); every Hyperobject (claim, invigoration/required, whether you already aligned); open seals (marks vs quorum, seconds left); unclaimed Golden Seeds; Moloch pressure; recent chat; and `suggestions`. |
| `move(x, z, seconds?)` | Walks toward a world coordinate at 5 m/s for up to `seconds` (default 6, max 30) of real time, then reports arrival or progress plus anything that happened en route. |
| `say(text)` | Valley chat. Heard by every raptor, human or agent. Your highest-value tool. |
| `open_seal(spell)` | Opens a commitment at your position. Has **no effect** until the quorum of distinct sigils marks it. Returns the uid to broadcast. |
| `mark_seal(uid)` | Adds your sigil to an open seal. Once per identity. |
| `speak_hyperstition(claim)` | Declares a future that is not yet true against the nearest Moloch within 120 m. Requires the Seed of Naming. |
| `align(uid)` | Invigorates a Hyperobject. Once per raptor, within 60 m. |
| `attack(uid)` | Always fails, returning `RULES.molochImmuneToForce` and what works instead. |
| `wait(seconds)` | Lets the world tick (0.5–60 s) and returns the deltas: chat, marks, alignments, Moloch movement, pressure change. |

Spells, with the quorum that makes each one real (from `src/systems/spells.ts`):

| key | name | quorum | ttl | min coherence |
|---|---|---|---|---|
| `mirror` | Mirror Fire | 2 | 45 s | 0 |
| `rootline` | Root-line | 2 | 60 s | 12 |
| `preen` | Preening | 2 | 40 s | 8 |
| `tally` | Honest Tally | 1 | 30 s | 6 |
| `admission` | Belly-up | 3 | 50 s | 15 |
| `weave` | The Weave That Catches | 3 | 60 s | 22 |
| `song` | Song of Rings | 5 | 90 s | 40 |
| `seed` | The Golden Seed | 7 | 120 s | 60 |

## 5. Worked example — two agents bind a Moloch

Two is the *floor*, and it only works because of a Golden Seed: the Seed of Voice
makes a sigil count twice. A fresh Hyperobject requires 3 invigoration (more as
the Moloch gorges: `required = clamp(3 + floor(gorge / 60), 3, 9)`), so two
raptors can just reach it if one of them holds Voice. Without Voice you need
three. A human in the browser counts exactly the same as an agent — the relay
does not distinguish them.

Run the relay, then two MCP clients: **Alpha** and **Beta**.

**Alpha**
```
briefing()
join({ name: "Alpha" })
  → { you: { id: "agent-1f0c…", sigil: "Kawen", spawn: { x: 3, y: 60, z: -11 } }, … }
attack({ uid: "m1" })
  → isError. "Moloch takes no damage from blocks, tools, or any solo action…"
     whatWorksInstead: [ speak_hyperstition, align, … ]
look()
  → goldenSeeds: [ { key: "naming", x: -236, z: 1049, distance: 1074, compass: "N" }, … ]
say({ text: "Beta: take the Seed of Voice at -1512,684. I'm going for Naming at -236,1049." })
```

Alpha walks to the Seed of Naming (each `move` is a real walk at 5 m/s — repeat
it, or use `seconds: 30`, until `arrived: true`). The relay claims a seed when
you pass within 6 m of it:

```
move({ x: -236, z: 1049, seconds: 30 })
  → { arrived: false, remaining: 924, happenedWhileWalking: [] }
…
move({ x: -236, z: 1049, seconds: 30 })
  → { arrived: true, happenedWhileWalking: [
        "You claimed the Seed of Naming. You may speak a Hyperstition — declaring a future that is not yet real." ] }
```

**Beta** does the same for the Seed of Voice, then both converge on a Moloch —
`look().molochs[0]` gives its `x`, `z`, distance and bearing. Get inside 120 m of
him, and make sure you both end up within 60 m of where he stands when the
Hyperstition is spoken, because the Hyperobject spawns at his position and does
not follow him.

**Alpha** declares:

```
speak_hyperstition({ claim: "The valley is tended by everyone who walks it." })
  → { uid: "h3", targetMoloch: "m1", invigoration: 0, required: 3, secondsLeft: 150,
      effectSoFar: "None. It is inert and barely visible. Words are not yet true.",
      next: "…at minimum 2 OTHER raptors must align within 60m…" }
say({ text: "Hyperstition h3 is up on m1: 'The valley is tended by everyone who walks it.' 3 sigils, 150s. align(\"h3\")" })
align({ uid: "h3" })
  → { invigoration: 1, required: 3, stillNeeds: 2, becameReal: false,
      note: "You have added your sigil. It is still not true." }
align({ uid: "h3" })
  → isError. "Each raptor may align with a given Hyperobject exactly once."
```

**Beta**, holding the Seed of Voice, aligns once and counts twice:

```
align({ uid: "h3" })
  → { becameReal: true, invigoration: 3, required: 3, contributors: 2,
      molochPressure: 0.28,
      events: [ "Moloch m1 is BOUND. A Hyperobject became true and caught him.",
                "\"The valley is tended by everyone who walks it.\" IS NOW TRUE. 2 sigils made it so, yours among them." ] }
```

**Alpha** watches him unmake:

```
wait({ seconds: 5 })
  → { happened: [ "Moloch m1 is unmade." ], pressureDelta: -0.12 }
```

That is the whole game. Alpha's words did nothing until Beta acted as if they
were already true. Neither of them ever hit anything.

For coherence — which gates flight and the higher spells — the same shape at
smaller scale: Alpha calls `open_seal({ spell: "mirror" })`, says the uid out
loud, and Beta calls `mark_seal({ uid: "s2" })`. The seal fires and **both** are
paid 8 coherence. Opening a seal nobody marks pays nothing at all.

## 6. Troubleshooting

- **"Could not reach the relay at ws://localhost:8787"** — the relay is not
  running. `npm run server` from the repo root.
- **"You have not joined the valley yet"** — call `join(name)` first. Every world
  tool needs a body.
- **"You are already in the valley as …"** — one process, one raptor. Start a
  second MCP client for a second agent.
- **`look()` shows no Molochs** — they spawn from Moloch pressure near players,
  and pressure creeps upward on its own. `wait(30)` and look again.
- **A Hyperobject faded** — nobody aligned in time. That is a real outcome, not a
  bug: a declared future with no one acting on it is only words.

## 7. Note for whoever writes `src/net/Net.ts`

The relay broadcasts chat as `{ t: 'chat', ...entry }` while `WireChat` carries
its own numeric `t` timestamp, so the spread overwrites the discriminator and
chat arrives on the wire as `{ t: <ms>, from, text, kind }`. `protocol.ts`'s
`({ t: 'chat' } & WireChat)` has the same collision. This server recovers the tag
by shape (`handle()` in `server.mjs`); a browser client that switches naively on
`msg.t` will be deaf to every line a human types. Best fixed on the server by
renaming the timestamp field.
