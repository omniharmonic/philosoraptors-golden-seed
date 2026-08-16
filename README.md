# Philosoraptors — The Golden Seed

**Play it: https://philosoraptors.philosoraptors-golden-seed.workers.dev**

Click *host a world* and send the link to anyone. No install, no account.

A browser voxel game on the Colorado Front Range, built in TypeScript and
three.js. You play a bare-scaled velociraptor at the foot of the Flatirons,
guarding a small heap of glowing seeds against everyone else doing the same.

There is a monster. You cannot hit it.

---

## The thesis

This is a game about a coordination failure, and the design rule is that a
coordination problem should be a **coordination problem in the code**, not a
metaphor for one.

**Moloch** is the antagonist. He is not a monster with hit points — he is the
shape a group of raptors makes when none of them can trust the others. He gorges
on whatever the commons loses. He is **immune to all direct force**: blocks,
tools and solo spells do literally nothing, and attacking him returns a written
refusal rather than a damage number. He grows whether or not anyone is playing,
because doing nothing is not neutral.

The only thing that binds him is a **Hyperobject**. One raptor holding the Seed
of Naming speaks a **Hyperstition** — a declared future that is not yet true. It
spawns inert and barely visible. Each *distinct other* raptor who aligns with it
makes it fractionally more real, and at `invigoration >= required` it becomes
true and binds the Moloch it was declared against. You cannot align twice.
Signatures are not votes you can stack.

Under that sits the **third attractor**. The world shows you two, side by side
and in one frame: a valley being stripped and hauled away, and a valley being
planted back. Extraction and tending are the same verb with opposite sign, and
extraction raises pressure for *everyone*, which makes it a real commons rather
than a personal vice. The third attractor is the one that is neither — a valley
that owns itself. Its seed needs **seven distinct sigils** on one seal, and there
is no version of that you can do alone. That is the point, and it is the reason
no mechanic in this repo may ever let one player win by themselves.

Under *that* sits **interbeing**: roots of light spread underground from every
planted seed and join beneath the whole valley, then beneath the next one. Chunk
health is per-chunk; block edits from a Root-line cross chunk borders, but the
tend score itself does not spread. Moloch pressure is one global number, not a
per-player score. When the valley burns, what survives is not the buildings.

Full source-of-truth for all of this: **[`docs/canon.md`](docs/canon.md)**.

---

## Install and run

Requires Node 20+.

```bash
npm install
npm run play         # relay + game server, reachable across your network
# or, separately:
npm run dev          # http://localhost:5173
```

That is a complete single-player game. Nothing else is required.

Runs on **WebGPU** where the browser supports it, WebGL2 otherwise — the
readout at top-left tells you which. Append `?webgl` to force the fallback.

### Playing with other people

`npm run play` binds the game server to your whole network and the relay prints
a clickable LAN link:

```
  SHARE THIS with anyone on your network — they just click it:
      http://10.0.0.42:5173      (en0)
```

Anyone who opens it joins the same valley. Their browser finds the relay
automatically, because the page connects back to whatever host it was loaded
from — there is nothing for them to configure.

### Multiplayer

```bash
npm run server       # authoritative relay on ws://localhost:8787
```

Start it in a second terminal, then reload the page. The client fails soft: with
no relay running the game is fully playable solo and the flock NPCs supply the
sigils instead. Coordination stays hard either way — you just negotiate with the
world rather than with people.

The relay prints the Golden Seed coordinates on startup. It is a development
server: no auth, no persistence, one world per process.

### Agents (MCP)

`mcp/` is a separate workspace with its own dependencies. It runs an MCP stdio
server that connects to the same relay as a normal client, so an agent joins,
senses, moves, casts, aligns and chats as a first-class raptor alongside humans.

```bash
cd mcp && npm install && node server.mjs
```

The design rule that makes this work is in `src/net/protocol.ts`: **anything an
agent must reason about lives in the protocol as structured state**, because an
agent has no renderer and cannot infer the world from pixels. The same rule is
what keeps two browser clients from disagreeing. `RULES` in that file states the
four hard constraints in prose so every client can surface them identically.

### Checks

```bash
npm run typecheck    # tsc --noEmit; strict + noUnusedLocals + noUnusedParameters
npm run build
```

---

## How you actually play

Three things, in order:

1. **Press `2` for the stream, hold left mouse.** A ribbon of light throws from
   your claws. Sweep it over grey, cracked ground and life chases the end of it.
   That is how coherence is earned, and it is the whole early game.
2. **Press `V` to call the flock.** Raptors who trust you fall in behind and
   follow you. The more coherence you have, the more of them come.
3. **Find a Moloch and hold the stream on him.** It does not hurt him — nothing
   does. It *tethers* him, and one stream is never enough. Your flock throw
   their streams too. Three at once and he is taken.

A line at the top of the screen always names the next physical action. If you
are lost, read it and do that.

### The other way: hyperstition

A hyperstition is a fiction that makes itself true by being acted upon. Press
`H` near a Moloch (needs 25 coherence, or the Seed of Naming) to declare a
future that is not real yet. A hyperobject appears above him, huge and barely
visible. Press `Y` to align with it — and everyone following you aligns too.
When enough have, the claim becomes true and it binds the Moloch outright.

Streams hold one Moloch by brute co-presence. Hyperstition takes longer to set
up but needs nobody in the same place at the same second — only agreement.

## Two resources

| | |
|---|---|
| **Spark** | Fast. Refills itself in about five seconds. Pays for the stream and for flight. Spend it constantly. |
| **Coherence** | Slow. Earned from other raptors and from healing ground. Grows your feathers, decides which flight tier you may use, and how much of the flock will follow you. |

## Controls

`1`–`9` picks what is in your hands. Slot 1 is **claws** (hold left mouse to
break blocks), slot 2 is the **stream**, and 3–9 are materials you place with
right mouse.

| Key | Action |
|---|---|
| `W` `A` `S` `D` | move |
| `Space` | jump · glide · fly (tier depends on coherence, paid in Spark) |
| `Shift` | sprint |
| `Ctrl` / `C` | crouch · reflect at the pool |
| `1`–`9` | pick tool or block |
| Scroll · `Q` / `E` | cycle hotbar |
| Mouse left | use held tool — claws break, stream beams |
| Mouse right | place the held block |
| `V` | call / dismiss the flock |
| `H` | declare a hyperstition |
| `J` | cycle which claim you will declare |
| `Y` | align with a hyperobject |
| `Z` | cycle which seal is ready |
| `C` | open the selected seal |
| `F` | mark the nearest open seal with your sigil |
| `G` | roll belly-up |
| `R` | settle (unstick yourself onto solid ground) |
| `T` | collapse chat |
| `Enter` | chat (`/declare <words>` speaks a hyperstition) |
| `M` | mute |
| `Esc` | release cursor |

Ledges up to one block are stepped over automatically, and a jump clears 2.2
blocks, so ordinary terrain should never trap you.

## The chapters

Eight chapters, in `src/systems/chapters.ts`. Each is gated on an act rather than
a kill or a fetch, and the **shape of the gates is the argument**: chapter 1
needs only you, chapter 2 needs one other raptor, chapter 8 needs seven. The
difficulty curve is a coordination curve.

| # | Chapter | Site | Gate |
|---|---|---|---|
| 1 | The Pool — *alignment within* | `pool` | crouch at the water's edge and look at your reflection (one of only two chapters with no quorum; chapter 4 is the other) |
| 2 | The Mirror Fire — *alignment between two* | `council` | a Mirror Fire seal, 2 sigils |
| 3 | The Circle — *alignment among many* | `council` | roll belly-up, then a Belly-up seal, 3 sigils |
| 4 | The Two Valleys — *the choice, side by side* | `valleys` | plant twelve seeds back into the gray soil |
| 5 | The Weave That Catches — *aligned incentives* | `valleys` | a Weave seal over a gap, 3 sigils; it catches whoever falls |
| 6 | The New Mind — *the checks that lie* | `hall` | cast an Honest Tally to expose the green lantern, then Preen what cannot see its own back |
| 7 | The Song of Rings — *coherence becomes a door* | `crater` | five voices sing the motif at the obelisk |
| 8 | The Golden Seed — *the third attractor, planted* | `mesatown` | seven sigils on one seal |

Eight landmarks are hand-authored into worldgen at fixed coordinates and stamped
into whatever chunks they intersect: the Still Pool, the Council Ring, the Two
Valleys, the Half-built Hall, the Red Barn & Terraces, the Mural Hall, the
Obelisk (out in the ash crater, ~1.8km away), and the Mountain House.

**Coherence** is the only stat. It is deliberately not health and not mana: it
gates *movement*, so at low coherence you are a scaled thing that walks and at
high coherence you fly. It also grows your feathers, in the exact stages the
episode style-strings use. It decays if unattended, faster under Moloch pressure.

Alongside it runs the **blind spot** — the thing you cannot see about yourself.
It grows quietly, it makes your own actions return less than you think they do,
and *you cannot clear it*. Only another raptor's Preening clears it. That is the
whole design note, and it is quoted from Ep4b: *"I cannot see my own back — will
you preen me?"*

---

## Architecture

```
index.html          start card, HUD styles, pointer-lock gate
src/main.ts         integration: the only file that touches everything
src/net/protocol.ts THE WIRE CONTRACT — three implementations agree with it
server/server.mjs   authoritative relay (Node + ws)
mcp/server.mjs      agent client — same intents, JSON instead of pixels
docs/canon.md       what the design is checked against
```

**Streaming voxel chunks.** 16 × 128 × 16, `Uint8Array` per chunk, 56 blocks in
the registry. Chunks stream in rings out to `VIEW_RADIUS = 9` and unload three
rings further out. Generation, lighting and meshing each run under a per-frame
budget so streaming never stalls the render loop. Terrain is deterministic from
the world seed, which is why the server does not need to know the terrain at all
— it only replays block *edits*.

Worldgen is oriented rather than isotropic, because the defining fact about
Boulder's landscape is a discontinuity, not a gradient: plains → mesas → front →
foothills → subalpine → divide, running along `-X`. The Flatirons are explicit
geometry — arkose slabs on a plane `x = x0 - (y-y0)/tan(dip)` with a tapering
triangular footprint — because noise makes lumps, not leaning triangles.

**Two-channel baked lighting.** Every chunk carries a `skyLight` and a
`blockLight` channel, 0–15, flood-filled on edit and baked into vertex colours by
the mesher along with per-vertex ambient occlusion (quad diagonals flip where AO
would crease wrongly). Block light is tinted amber; sky light carries the biome,
lerped along one COLD ↔ WARM axis. This is the whole art direction: the source
material has no projectiles and no explosions, so **light is the only magic
system** — one emissive amber material doing nine structural jobs. Per-chunk
grading is driven by `Chunk.tend`, so extraction visibly pulls ground toward
Ep1's cold blue and tending pulls it toward gold. The lighting *is* the score;
there is no morality meter.

The texture atlas is drawn procedurally at runtime from each block's `TexSpec`,
so there are no image assets to ship and every colour provably comes from
`src/art/palette.ts` — measured off the source footage by saturated-pixel
clustering — rather than from memory.

**Authoritative relay.** The server owns everything two clients could disagree
about: players, chat, seals, Molochs, Hyperobjects, Golden Seeds, and the Moloch
pressure commons. Clients own terrain (deterministic) and block edits. It ticks
at 10 Hz and broadcasts Moloch and Hyperobject state every tick. The browser is a
renderer of server truth plus an input device; the MCP server is a second,
equally legitimate client. One nomination the server does make: the lowest-id
*browser* client is named `authority` and simulates Moloch ground damage, because
that needs terrain the server does not have.

**Sigil quorum.** A sigil is a deterministic 7×7 mirrored glyph derived from a
player id, so the same raptor always draws the same mark and you learn to
recognise it. It is not cryptography and does not pretend to be — the property
the game needs is that a commitment can record *which distinct parties marked
it*, and a visible glyph does that better than an opaque token because you can
read a seal at a glance and see who is already on it.

A spell is not something you cast. It is a **commitment you open**, which does
nothing at all until enough distinct parties have marked it with their own sigil
before it lapses. `SPELLS` in `src/systems/spells.ts` carries each one's quorum,
TTL, coherence floor and reward. Marking a seal is idempotent per identity.

### Invariants no change may break

1. Moloch takes **zero** damage from force. Direct attack returns a refusal.
2. A raptor may align with a Hyperobject **exactly once**.
3. The Golden Seed seal needs **7 distinct sigils**. No solo path exists.
4. Extraction raises pressure for **everyone**. It is a real commons.
5. All colours come from `src/art/palette.ts`.

`docs/BUILD-PLAN.md` holds file ownership; `docs/visual-lore-extraction.md` holds
the raw measurements behind the palette.
