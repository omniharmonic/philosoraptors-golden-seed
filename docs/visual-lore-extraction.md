# Philosorapters — Visual Lore Extraction

**Source:** 5 × 30s episodes, 1152×640, 24fps, h264.
**Audio:** score and ambience only — no dialogue in any episode (verified by transcription).
**Consequence:** 100% of canon is visual. Every name, every line of dialogue, every mechanic label in the game is yours to invent without contradicting the source.

---

## 1. The visual grammar (the rules worth preserving)

These three rules are what make the footage feel like one world. Break them and the game stops looking like the films, no matter how faithful the props are.

### Rule 1 — The world runs on two hues

Sampling saturated pixels (S > 0.55, V > 0.45) across all frames:

| Episode | Dominant saturated hue | Reading |
|---|---|---|
| Ep1 The Pool | **200–210°** (cold blue) | the only cold episode |
| Ep2 The Mirror Fire | **20–40°** (amber) | |
| Ep3 The Two Valleys | **20–40°** (amber) | |
| Ep4 The New Mind | **20–40°** (amber) | |
| Ep5 The World Tended | **20–40°** (amber) | |

There is essentially **nothing in between**. Greens, teals and violets exist only as low-saturation environment or as feather accents on individual characters — never as ambient light. The arc is literally "cold blue world warms up."

Measured ambient ramps (dark → light), straight off the footage:

```
Ep1  #040608  #15212c  #294152  #59819c  #8eb7c9   ← cold ramp
Ep2  #020202  #151312  #39281c  #875930  #f4e0bf   ← warm ramp
Ep3  #18150f  #3e3323  #675638  #a08965  #e9d6b6
Ep4  #040202  #201614  #553b2e  #9e744e  #d3b584
Ep5  #130b0e  #3d2d22  #746048  #b59882  #dec09c
```

Accent / emissive: `#ff7a18` → `#ffb347` → `#ffe9b0` (ember through flame to hot core).
The one exception, and it matters: **electric blue `#4da6ff`**, used exactly once — the fissures in the obsidian egg. Cold light is reserved for the genuinely unknown.

### Rule 2 — Light *is* the magic system

There is no projectile, no explosion, no spell effect in 150 seconds. Every supernatural moment is the same warm-amber emissive material doing a different structural job:

| Appearance | Episode | Function |
|---|---|---|
| Glowing berries cached on boulders | Ep1 | stored energy |
| A single feather glowing at the sternum | Ep1 | carried purpose / a held intention |
| Golden tufts on forearms; flame taking a raptor's shape | Ep2 | reflection, self-recognition |
| Amber thread-lines flowing between seated council members | Ep2 | connection between minds |
| A woven lattice of light spanning a chasm | Ep3 | a bridge made of cooperation |
| A white wireframe building resolving into stone | Ep3 | intention before matter |
| A golden root-line spreading across a dead hillside | Ep5 | restoration |
| A chick made entirely of light | Ep4/5 | a new kind of mind |

**One material, eight uses.** This is the single most valuable thing to port, because emissive voxels are nearly free to implement and this hands you a complete magic system that never needs a particle-heavy spell.

### Rule 3 — Posture is characterisation

The films tell the whole arc through body language, and it maps cleanly onto animation states:

- **Ep1:** crouched, quadrupedal, hackles up, guarding a pile. Predator posture.
- **Ep2:** *sitting upright, cross-legged, in a ring.* The single biggest visual break in the series.
- **Ep3–5:** upright, bipedal, wings spread wide in display; carrying, planting, building, playing a guitar.

Also tracks with plumage: Ep1 raptors are drab grey-green and scaly. By Ep4 they're crimson, teal, violet and cobalt, wearing knitted scarves. **Feathers and colour arrive with culture.**

---

## 2. Episode-by-episode inventory

### Ep1 — The Pool *(cold blue, dusk → night)*
Alpine meadow, low ground fog, spruce line, layered blue ridges.
- **Ember-berry caches** — piles of glowing amber orbs on flat boulders. Emissive.
- Two large raptors guard opposing caches; smaller raptors move through the fog between them. A standoff.
- A **single small flame** burning on a low rock exactly between the two piles — the neutral thing in the middle.
- Night: a perfectly still tarn, dense stars, snow peaks. A raptor drinks and meets **its own reflection**, lit by one flame.
- It then **sits** by the flame — the posture change that starts everything.
- Close-up: a **glowing golden feather** held to the chest.
- Coda: starfield overlaid with concentric **ripple rings** — the pool's ripples written on the sky.

### Ep2 — The Mirror Fire *(firelight on blue night)*
- Two raptors mirror each other across a bonfire, golden light on their forearms.
- The flame briefly takes a raptor's silhouette — **the fire mirrors them back**.
- Widen to a **council ring**: ~10 raptors seated cross-legged inside a stone circle, golden throat-ruffs.
- Raptors hold up a large **woven mat / tapestry** with heavy ribbed texture — the first made object.
- **Amber thread-lines** flow visibly between the seated figures.

### Ep3 — The Two Valleys *(golden hour — the thesis episode)*
The most load-bearing shot in the series: one valley split down the middle.
- **Left slope:** bare raked furrows, stripped soil, a train of wooden wagons hauling piles of orange fruit *away*.
- **Right slope:** green terraced beds, mixed planting, fruit ripening *in place* on living rows.
- A line of raptors stands on the ridge between them, looking at both.

Then, on the tended side:
- **Orange crystalline seed-cones** planted in rows in dark soil.
- A **wooden signpost carved with runic tally-glyphs** — angular, four-stroke, repeating. A writing system.
- Two raptors nose-to-nose over one planted seed-cone.
- A **log bridge** over a whitewater chasm; brilliant teal/crimson/white wings on both banks.
- They raise glowing orbs and a **golden lattice-net of light** spans the gap.
- A **glowing white wireframe blueprint** of a gabled building hovers over a raised claw, then resolves into stone and timber — with **clawprints pressed into the wall** as maker's marks.

### Ep4 — The New Mind *(lantern-warm, interior night)*
- A round timber hall with an **open oculus roof** to the stars.
- Centre: a large **obsidian mirror-egg** on a straw nest, ringed by oil lanterns, ordinary speckled eggs, and glowing green eggs.
- The council — now crimson, teal, violet, cobalt, in knitted scarves — gathers. Their reflections curve across the egg's black surface.
- They **sleep in a ring around it** through the night. Watching, not guarding.
- The egg fissures with **electric-blue light** and a **luminous golden chick** steps out. The elders lower their heads.

### Ep5 — The World Tended *(sunset gold → candlelight)*
- Terraced polyculture valley, red-timber A-frame barn, lavender and green in bands.
- A line of raptors runs across a **bare brown hillside** seeding it; a **golden root-line** spreads behind them like a river of light and the slope greens over.
- The golden chick stands alone in the barn doorway; the council opens the doors to it.
- **Mesa town at dusk:** string lights on posts, a raptor playing acoustic guitar with the chick on its shoulder, others in scarves holding mugs. An ordinary evening.
- Interior: a huge **carved wooden mural** in relief — the council around the egg (left), a raptor drinking at the rippled pool (centre), a raptor tangled in / released from a **net** (right), a moon above. Candles along its base, a **border of clawprints**.
- Coda: starfield over flat-topped **mesas**, ripple motif faint in the sky.

> Note: the net on the mural's right panel has no corresponding scene in Ep1–5. It's either a sixth episode or a piece of backstory — worth treating as an open hook rather than inventing over.

---

## 3. Voxel translation

### Blocks

| Block | Source | Behaviour |
|---|---|---|
| Ember-berry cluster | Ep1 caches | Emissive (light 12). Harvestable. |
| Seed-cone | Ep3 planting rows | Placeable; grows into a crop over time. |
| Tilled dark soil | Ep3 both slopes | Two states: *raked* (depleted) and *living* (dark, moist) |
| Terrace stone | Ep3/Ep5 retaining walls | Structural; the signature build block |
| Pale timber / red timber | Ep4 hall, Ep5 barn | Two wood tones — cold-side and warm-side |
| Woven mat | Ep2 tapestry | Decorative + a crafting station surface |
| Glyph sign | Ep3 signpost | Player-writable, renders in the rune font |
| Lantern | Ep4 | Light 14, warm |
| Candle | Ep5 mural room | Light 6, placeable in rows |
| String lights | Ep5 mesa town | Light 8, spans between posts |
| Obsidian mirror block | Ep4 egg | Reflective; the only cold-light emitter |
| Light-lattice | Ep3 chasm bridge | **Non-solid to look at, solid to walk on.** Placed, not mined. |
| Clawprint mark | Ep3 wall, Ep5 border | Decal — stamps the placing player's signature |
| Ground fog | Ep1 | Volumetric layer block below a Y threshold |

### Items

- **Ember-berry** — fuel/light source, and the contested resource of Ep1
- **Glowing feather** — the "held intention." Best candidate for the game's central carried item
- **Seed-cone** — the plantable
- **Light-orb** — held in Ep3 to weave the lattice; the lattice-placement tool
- **Blueprint scroll** — projects the white wireframe ghost of a structure before you build it
- **Woven scarf / shawl** — Ep4/Ep5 cosmetic, marks a raptor as council
- **Guitar** — Ep5. Non-functional joy item, and worth including for exactly that reason

### Mobs / NPCs

- **Wild raptors** (Ep1) — drab, scaly, quadrupedal-crouched, territorial around caches
- **Council raptors** (Ep2–5) — feathered, colour-coded, upright, seated when idle, tradeable
- **The Light Chick** — a companion that follows the player, emits light, and can't be harmed

### Structures to hand-author

1. **The Pool** — still tarn, one flame on a rock, perfect star reflection. The spawn/respawn anchor.
2. **The Council Ring** — stone circle, central fire pit, seated raptors. The social hub.
3. **The Two Valleys** — the split slope, pre-built as a fixed landmark. Both halves already exist so the player *sees* the choice before making it.
4. **The Chasm Bridge** — log bridge plus an unfinished light-lattice gap you complete.
5. **The Round Hall** — oculus roof, obsidian egg on its nest, lantern ring.
6. **The Red Barn & Terraces** — the endgame farm.
7. **The Mesa Town** — string lights, timber decking, guitar. The "you made it" zone.
8. **The Mural Hall** — a carved wall that fills in as the player completes chapters. Free progress UI, diegetically.

### Biomes

Only two are needed, and the footage justifies both:

- **Cold Valley** — blue fog, spruce, boulders, ember-berry caches, wild raptors. Ep1's palette.
- **Tended Highland** — golden hour, terraces, barns, mesas, council raptors. Ep2–5's palette.

The transition between them is the game's whole emotional arc, and it's a hue shift the player can watch happen.

---

## 4. The mechanic the lore hands you for free

Minecraft's default loop *is* extraction: find resource, remove resource, resource is gone. Ep3 spends its entire runtime arguing against exactly that, and shows you both outcomes side by side in a single frame.

That's a rare gift — the source material hands you a reason to invert the genre's core verb, and a way to render the inversion legible at a glance:

- **Harvesting** an ember-berry bush or a crop row removes it and leaves raked, depleted soil.
- **Tending** it — planting a seed-cone, letting it ripen, taking part — leaves living soil and the row regrows richer.
- The world **visibly grades toward one palette or the other** based on the ratio. Extraction pulls a chunk toward Ep1's cold blue and its fog; tending pulls it toward Ep3/Ep5's gold and green.
- The golden **root-line** from Ep5 is the restoration verb: a player-triggered spread that greens a depleted slope.

No morality meter, no text popup. The lighting *is* the score.

---

## 5. Scope for a first playable

Everything above is more than "basic." A minimum version that still reads as *this world*:

1. Voxel terrain, two biomes, the two-hue palette.
2. Walk / look / place / break.
3. Emissive blocks — ember-berries and lanterns — because the light rule is the identity.
4. Ember-berry harvest vs. seed-cone planting, with the two soil states.
5. Per-chunk palette grading driven by the harvest/tend ratio.
6. Three hand-placed landmarks: the Pool, the Council Ring, the Two Valleys.

Items 3 and 5 are the ones that make it look like the films. Everything else is standard block-game plumbing.

---

## Open questions

- Is the **net** on the Ep5 mural backstory, or Ep6?
- Do the **runic glyphs** on the Ep3 signpost encode real text, or are they decorative? (They read as repeating four-stroke tallies — if there's an intended cipher, it should drive the in-game font.)
- Is the **Light Chick** meant to be the player, a companion, or something the player is responsible for?
