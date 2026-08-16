# Coordinated Build Plan

Parallel-safe by construction: **every work package owns a disjoint set of files**
and codes against one shared contract, `src/net/protocol.ts`. No package edits a
file another package owns. Integration (`src/main.ts`) is serialized to the end,
because it is the only file that touches everything.

## Contract

`src/net/protocol.ts` defines every wire type and is already written. Three
implementations must agree with it:

| Implementation | Role |
|---|---|
| `server/server.mjs` | authority — owns players, chat, seals, Molochs, Hyperobjects, Golden Seeds, pressure |
| `src/net/Net.ts` | browser client — renders server truth, sends intents |
| `mcp/server.mjs` | agent client — same intents, JSON instead of pixels |

Rule that shapes everything: **anything an agent must reason about is structured
server state**, because an agent has no renderer.

## Status

**Done (built serially, typechecks clean):**

- Build config, `index.html`, procedural texture atlas, measured palette
- Block registry (56 blocks), chunked streaming world, two-channel baked lighting,
  AO mesher
- Boulder / Front Range worldgen: oriented plains→foothills→Divide, explicit
  Flatiron slab geometry, Boulder Creek, ponderosa/cottonwood/scrub oak
- Eight landmark sites, player physics with coherence-gated flight, voxel raycast
- Sigils, seals & quorum, coherence, Moloch pressure, 8-chapter arc
- Raptor + Flock NPCs, `MolochEntity` demon model
- Authoritative relay server

**Remaining — the parallel packages:**

| WP | Owns (exclusive) | Delivers |
|---|---|---|
| **A** | `src/net/Net.ts` | Rewrite client against new protocol: molochs, hypers, chat, seeds, drain, denied, tick |
| **B** | `src/entities/HyperObject.ts`, `src/systems/hyperstition.ts` | Hyperobject visual + invigoration state; only fully visible once real |
| **C** | `src/entities/MolochManager.ts` | Reconcile server Moloch list → `MolochEntity` instances |
| **D** | `src/systems/goldenseeds.ts`, `src/entities/SeedNode.ts` | Power registry, gating helpers, world beacon visual |
| **E** | `src/ui/Chat.ts` | Chat panel + composer; standalone DOM, does not touch `HUD.ts` |
| **F** | `mcp/server.mjs`, `mcp/package.json`, `mcp/README.md` | MCP stdio server: agents join, sense, move, cast, align, chat |
| **G** | `docs/canon.md`, `README.md` | Canon reference from the prompt archive; run instructions |

**Serialized after the swarm (owner: main session):**

- `src/main.ts` integration
- `src/ui/HUD.ts` additions (seed powers, moloch/hyper readouts)
- Full typecheck + build + runtime smoke test

## Why these boundaries

- **A** is the only package that may touch `Net.ts`; B/C/D consume it via callbacks
  passed in from `main.ts`, so they never import each other.
- **B** and **C** both concern the Moloch fight but touch different files —
  the Hyperobject does not reach into the Moloch, it reports invigoration and the
  *server* binds the Moloch. That keeps the authority boundary honest.
- **E** owns its own DOM root (`#chat`) so it cannot collide with `HUD.ts`.
- **F** depends only on the protocol file and the relay's behaviour, not on any
  browser code, so it is fully independent.

## Invariants no package may break

1. Moloch takes **zero** damage from force. Direct attack returns a refusal.
2. A raptor may align with a Hyperobject **exactly once**.
3. The Golden Seed seal needs **7 distinct sigils**. No solo path exists.
4. Extraction raises pressure for **everyone**; it is a real commons.
5. All colours come from `src/art/palette.ts` (measured off the footage).
