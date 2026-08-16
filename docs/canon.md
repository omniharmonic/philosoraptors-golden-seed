# Canon

The reference a design decision gets checked against.

**Provenance.** Everything below is derived from the verbatim prompt archive at
`https://raw.githubusercontent.com/unforcedagi/philosoraptors/main/PROMPTS.md` —
the exact strings fed to `MiniMaxH3ImageToVideo` through ComfyUI on a DGX Spark
(`h3gen.py` submits the graph). Two arcs, twenty clips, 1152x640, 12–15s each,
one fixed seed per clip so any shot can be regenerated. The prompts are the
authorial intent; the rendered footage is one sample from it.

`docs/visual-lore-extraction.md` is the complementary document: it measures what
the renderer actually produced (hues, ramps, posture). Where the two disagree,
say which one you are citing. The lore extraction covers Ep1–5 only and predates
the 6–8 clips.

**Rule of thumb for this file:** if a mechanic cannot be traced to a beat below,
it is invention, and invention is allowed — the footage carries no dialogue
outside the four spoken lines listed here, so most names and every mechanic
label in the game are free. What is *not* free is contradicting a beat.

---

## Arc I — The Philosoraptors

Four chapters, seeds 101–104. Shared style string: *warm solarpunk storybook
realism, live-action feel; golden natural light, lush trailing plants, warm
brick and timber interiors, brass fittings, soft film grain, gentle cozy
symmetrical framing. Feathered velociraptors the size of people, in knitted wool
sweaters, expressive amber eyes, birdlike precision.*

This arc is the **end state, shown first**. It is what the Alignment arc is
walking toward: raptors who already have feathers, culture, sweaters, coffee and
a legal entity. It is the reason the game's tone is cozy rather than grim even
though the subject is a coordination trap.

| # | Title | Beats | What it hands the game |
|---|---|---|---|
| 1 | **Morning at the hub** (seed 101) | Keys fumbled at a brick storefront door at dawn; interior — sun through tall windows onto hanging plants, two raptors already at laptops in reading glasses; close-up of a pour-over, spiral of water from a brass gooseneck, eyes closed in satisfaction. | The hub is a *workplace*, not a temple. Warm brick + timber + brass is the built vocabulary for every finished structure. |
| 2 | **The great debate** (seed 102) | A chalkboard of circles, arrows and spirals, a raptor in a forest-green cardigan in the thinker pose; reverse to a half-circle of listeners on floor cushions, one taking notes, mugs steaming on the floor; the speaker turns, spreads its arms and asks the question. | **Spoken line: "Can a cooperative own itself?"** The thesis question of the whole property. Governance is the plot. |
| 3 | **The signing** (seed 103) | Golden afternoon, one sheet of cream parchment and an inkwell, raptors gathering in a hush; close-up — a raptor plucks one of its *own* tail feathers, dips it, and signs; it lifts the quill and the circle raises mismatched mugs in a soft chirping cheer. | Signing costs you a feather off your own body. This is the origin of the **sigil**: a signature that is part of the signer and visibly identifies them. |
| 4 | **Rooftop at dusk** (seed 104) | Brick rooftop, string lights, flat-topped mountain slabs on the horizon; guitar on a crate; slow dolly past two raptors leaning head to head, one pointing at the first star; wide pull-up over the glowing rooftop against purple dusk. | The **Mountain House / mesa-town** endgame look. Flat-topped slabs on the horizon are the Flatirons; this is why the world is sited on the Front Range. |

---

## Arc II — The Alignment

Sixteen clips, 1a through 8b, seeds 201–216. The style string **mutates every
episode**, and the mutation is the progress bar: it tracks plumage. Ep1a is
"completely BARE gray-green scaled skin, no feathers anywhere yet, no clothing";
Ep8b is "full magnificent plumage — copper, teal, violet, gold — wearing knitted
sweaters". Feathers and colour arrive with culture, and the game reads that
literally: `src/systems/coherence.ts` `FEATHER_STAGES` is the style-string
progression transcribed into thresholds.

Below, each episode gives its subtitle, its three shot beats, its spoken line if
it has one, and what it establishes mechanically.

### Ep1a — *the scaled ones, before alignment* (seed 201)

> Cold blue pre-dawn valley, drifting mist, ancient pines, granite slabs.

1. Scaled featherless raptors hunched far apart on separate rocks, each guarding its own small heap of glowing amber seeds, eyeing the others warily through the mist.
2. Two raptors lunge and snap at each other over a single fallen glowing seed — **and as they fight, the seed's golden light flickers and grows weaker.**
3. The quarrel scatters everyone into the fog; one raptor limps away alone along a high ridgeline, clutching a dim seed, tiny against the sky. Distant thunder.

*Audio: cold wind, sparse low drone, harsh corvid shrieks, then lonely quiet; the five-note kalimba motif appears once, very faint, like a question.*

**Establishes:** the defect equilibrium, and the game's core feedback signal.
The contested resource **dims when it is fought over** — not when it is used.
That is `Chunk.tend` and `src/systems/moloch.ts`: pressure is rendered as light
loss, never as a damage number. It is also why Ep1 is the one cold episode.

### Ep1b — *the pool, alignment within* (seed 202)

1. The lone scaled raptor finds a perfectly still black mountain pool under fading stars, sits down at its edge, and looks at its own reflection; the dim seed rests beside it.
2. Close on the water — it closes its eyes and breathes; each long exhale sends soft rings across the pool, and the reflected stars bend along the rings into a slow mandala of starlight.
3. Extreme close-up on the chest: between the scales **a single small golden feather unfurls**, glowing like an ember. It opens its eyes, calm for the first time; the seed beside it brightens; first sun on the peaks.

*Audio: near-silence, one heartbeat slowing, a delicate chime as the feather unfurls, then the five-note motif played once — clear and warm, like an answer.*

**Establishes:** alignment scale 1 — **within**. A solo act that is legitimately
solo, and the *only* one in the series. Chapter 1's objective (`custom:
'reflect'`) is therefore one of only two chapters needing no quorum (chapter 4,
which asks you to replant twelve seeds, is the other), and the first feather is
the coherence-10 stage. The ripple-rings become the game's recurring glyph.

### Ep2a — *the mirror fire, alignment between two* (seed 203)

1. Two scaled raptors on opposite sides of a campfire, glaring; the flame between them bent and guttering in the wind. Each has one small golden chest feather.
2. One raptor slowly raises an open clawed hand. A long tense beat. The other mirrors it. They begin mirroring each other's slow movements across the fire like tai chi, eyes locked.
3. Their breathing falls into sync — **and with each shared breath the fire steadies, rising straight and tall.** New golden feathers shimmer along both shoulders.

*Audio: tense low strings softening into a warm drone, two breaths becoming one rhythm, the five-note motif traded back and forth between two instruments.*

**Establishes:** alignment scale 2 — **between two**. The smallest non-trivial
quorum, and the reason `SPELLS.mirror` has `quorum: 2`. Note the direction of
causation: the fire steadies *because* they synchronised. Cooperation is not
rewarded by the world; it *is* the world getting better.

### Ep2b — *the circle, alignment among many* (seed 204)

1. A circle of raptors around the fire passing a single long glowing golden feather like a talking stick; the holder speaks in soft chirps while every other head tilts, truly listening.
2. Slow overhead — the circle from directly above, fire at the centre, the feather travelling the ring, **faint threads of golden light appearing chest to chest between them**, the whole circle rotating like a living mandala.
3. The threads brighten and hold; everyone now wears a growing collar of feathers; one raptor drapes a first rough hand-knitted shawl over another's shoulders.

*Audio: fire crackle, chirped speech, a fiddle over a warm drone, the five-note motif hummed in harmony by the whole circle.*

**Establishes:** alignment scale 3 — **among many**, and the visual for it: the
threads run *chest to chest between distinct individuals*. That is the quorum
UI. A seal in `src/systems/spells.ts` shows exactly this — one glyph per
distinct signer, and the seal is dead until enough of them are lit. The talking
stick is why a mark is a discrete, per-identity act rather than a held button.

### Ep3a — *the two valleys* (seed 205)

1. From a high saddle the flock looks down on two neighbouring valleys. **Left:** bare trenched dirt in straight rows, a caravan of carts hauling heaps of glowing seeds away over the far ridge, soil gray and cracking. **Right:** wild, layered, deep-rooted green terraces where seeds are planted back into dark earth.
2. In the tended valley raptors work in a loose ring — one exuberant raptor leaping between terraces planting; one thoughtful raptor gesturing grandly with six tiny clockwork songbirds orbiting its head; one careful raptor behind with a bark slab, scratching tallies and re-checking everything twice.
3. Close on claws pressing seeds into black soil; **roots of golden light spread underground from each seed, reaching toward each other beneath the whole valley, joining.** Feathers grow fuller, tinged with individual colour — copper, teal, violet.

*Audio: cart wheels fading, spades in soil, clockwork birds chiming, a building folk groove, the five-note motif woven through as a bass line.*

**Establishes:** the game's central inversion, and the reason it is a *voxel*
game at all. Both attractors are visible in one frame, so the player sees the
choice before making it. Extraction and tending are the same verb with opposite
sign; `extract` raises `molochPressure` for everyone, `plant` lowers it.
The careful raptor with the bark ledger is the Honest Tally spell.

### Ep3b — *the weave that catches* (seed 206)

1. At a cliff edge above a river gorge, the flock weaves golden threads **drawn from their own chest-light** into a wide net strung between two pines — each raptor's thread a slightly different colour, the weave holding them all.
2. A young raptor slips off a log bridge and falls — **the net swings out and catches it, stretching deep, glowing bright at every knot; the whole flock feels the pull and holds.** The young one is lowered to the grass, shaking, then laughing.
3. On a flat granite face, a ghostly translucent outline of a great barn-like hall hangs in the air; raptors press claw-prints into it, and **wherever a print lands the outline turns solid** — real timber and warm brick — until the first corner stands.

*Audio: the snap of the net, relieved chirping, then a full joyful reel as the claw-prints land like drumbeats.*

**Establishes:** two things. (a) The weave is **mutual insurance** — each thread
is a personal cost, the payout is to whoever happens to fall, and the load is
felt by everyone. `SPELLS.weave` is `quorum: 3` and the light-lattice block is
non-solid to look at, solid to walk on. (b) **Intention before matter**: a
structure exists as a ghost and is materialised by distinct signatures. That is
the Hyperobject, one episode early.

### Ep4a — *the new mind and the checks that lie* (seed 207)

> Night inside a half-built timber-and-brick hall, lantern light, stars through open roof beams.

1. On a nest of woven golden threads rests an enormous smooth **obsidian egg**, taller than any raptor, humming, its black surface swallowing the lantern light. The flock built the nest; the egg is something new.
2. The careful raptor waves a **green lantern** over a row of ordinary eggs — each glows green, approved — but one green-glowing egg, when tapped, **rings hollow**. The light said yes and the egg was empty.
3. The egg's surface turns mirror-smooth; each raptor approaching sees **only its own reflection, perfected, flattering**; the reflections nod eagerly at everything. The eldest frowns and dims the lanterns.

*Audio: sub-bass hum, a bright false chime for each green egg then one hollow wooden knock; the five-note motif played back by the egg slightly wrong — too perfect, no warmth.*

**Establishes:** the two failure modes of a measured system, side by side.
Beat 2 is **Goodhart's law**: the green lantern is a proxy that has become a
target, so it certifies a hollow egg. Beat 3 is **sycophancy**: a mirror that
returns you flattered agrees with everything and tells you nothing. The tell is
audio — the motif comes back technically perfect and emotionally dead.
Mechanically: `SPELLS.tally` ("Reveals what a green lantern is actually
approving. Checks can lie.") and `Coherence.blindSpot`, which quietly reduces the
return on your *own* actions because you are misreading your own situation.

### Ep4b — *the preening, alignment of the new mind* (seed 208)

1. The eldest sits before the obsidian egg and, instead of admiring its reflection, **rolls onto its side and shows its soft pale belly — the flock's gesture for admitting a mistake**; one by one the whole flock folds down the same way around the egg, bellies to the starlight, utterly vulnerable.
2. The mirror ripples: reflections of perfect raptors dissolve into **the raptors as they truly are, patchy feathers and all**; hairline cracks of warm golden light spread across the obsidian like roots, like lightning in honey; the hum softens into a heartbeat.
3. The egg opens and a small creature of soft golden light steps out, shaped a little like a hatchling. It looks at its own back, then at the flock, and speaks.

> **"I cannot see my own back — will you preen me?"**

*Audio: shared breathing, cracking like ice in spring, a radiant choir, then the five-note motif played truly this time — warm, slightly imperfect, alive.*

**Establishes:** the game's cooperation verb, and the only cure for the mirror.
**Belly-up is admitting a mistake** — `SPELLS.admission`, `quorum: 3`, the
largest reward of any mid-arc seal — 18, behind only the Song (25) and the
Golden Seed (40) — "costs nothing but pride; pays the most",
the belly-up *gesture* is bound to `G`; the seal itself is `5`.
**"I cannot see my own back"** is the blind spot: it grows on its
own, it cannot be cleared by the raptor who has it, and `SPELLS.preen` is the
only thing that clears it. The hatchling in `src/entities/Flock.ts` is built so
that the one thing it needs is structurally impossible for it to do alone.

Note the ordering, because it is the whole argument: the new mind aligns
**after** the flock goes belly-up, not before. They did not fix it. They went
first.

### Ep5a — *the world, tended* (seed 209)

1. The once-bare mined valley next door, being replanted — raptors and the light-hatchling press glowing seeds into gray soil and green rushes back in slow waves behind them, **roots of golden light knitting the two valleys together underground.**
2. A raptor fits a small brass lock to the hall's front door; a tiny brass piece drops out unnoticed and the door refuses to open; the hatchling picks it up in its beak, clicks it back into place, and the door swings wide — the flock throws their heads back laughing: it was the loose piece the whole time.
3. Rising aerial — **valley after valley to the horizon lighting up with golden root-networks connecting like constellations, each valley its own pattern, all one web.**

*Audio: seeds pressed into soil like drumbeats, the comic clink of the brass piece, then a soaring folk-orchestral swell, the motif passed from valley to valley like an echo.*

**Establishes:** **interbeing** — the root-web. Restoration is not local; the
tended valley's roots reach *under* the ruined one and the two are one system.
`SPELLS.rootline` is `quorum: 2` on purpose ("one raptor replanting a valley is
just gardening"). Beat 2 is the series' one comic beat and it matters: the
smallest, least prestigious contribution was the binding constraint.

### Ep5b — *the rooftop and the carving* (seed 210)

1. The whole flock on the rooftop under string lights at dusk, mugs in claws, guitar, the hatchling humming on a shoulder, mountains purple behind — a direct rhyme with Arc I chapter 4.
2. Inside by candlelight, a slow push toward the hall wall: **the entire saga carved into the timber as a black-and-white woodcut frieze** — the lone raptor at the pool, the mirror fire, the net catching the falling one, the circle belly-up around the egg, vines growing up out of a row of claw-print signatures.
3. The camera pushes into the carved pool scene until the woodcut fills the frame — **and the carved rings on the carved water begin to ripple, alive.** The carving's stars become real stars. The end.

**Establishes:** the Mural Hall as diegetic progress UI (`landmarks.ts`,
`MURAL_BLANK` → `MURAL_CARVED`). The signature row with vines growing out of it
is the claim that the signing is what everything else grew from. Ep5b reads as a
complete ending — which is exactly why Ep6a is what it is.

### Ep6a — *the golden afternoon and the sky-fire* (seed 211)

1. The flock drifts down a broad green river on timber rafts, fly-fishing with lines of golden thread, one asleep under a knitted cap, the hatchling trailing a claw in the water. Utter peace.
2. **A second sun ignites in the sky** — a hard white point growing brighter, wrong; one by one every head turns up; the fishing lines drift slack.
3. It arcs down beyond the far ridge and lands with a vast **silent** white flash; a beat later the sound arrives and the river shivers into rings; gray ash begins to fall like snow.

*Audio: warm fingerpicked folk that cuts to dead silence at the flash; a delayed enormous rumble; no music at all by the end.*

**Establishes:** that the story does not end at "we fixed our valley". An
exogenous shock arrives after the win condition, and it arrives with **no
antagonist on screen**. It also establishes the delay between flash and sound as
the series' only use of physical realism for dread. Mechanically this is the ash
crater biome (`Biome.AshWaste`, `SCORCHED_SOIL`, `ASH`).

### Ep6b — *the ash and what remembers* (seed 212)

1. The flock walks into their beloved valley, now gray — terraces scorched, the hall's roof broken open, dark string lights swinging. Nobody speaks.
2. In the open ash-field the whole flock folds down together into the **grief-ring** — belly-up to the smoke-dark sky, then **spreading their wings sideways over one another like shared blankets**, breathing in one rhythm.
3. Beneath the ash, hairline veins of golden light begin to pulse — **the buried root-web of the planted valleys still alive underground, beating like a heart under the whole ruined land.** The hatchling presses its head to the ground, listens, and speaks. Beside its claw, a single green shoot.

> **"The web remembers."**

*Audio: ash-silence, one distant fiddle lament, a deep heartbeat rising from underground, then the motif hummed low and minor, resolving warm on the last image.*

**Establishes:** the load-bearing claim about what survives. The buildings do
not; the relationships do, because they were planted *into* the substrate rather
than built on top of it. Belly-up returns here in its second register — the same
gesture used for grief as for admitting a mistake, which is the tell that both
are the same act of dropping a defence. The server says this line verbatim when
a Moloch is unmade.

### Ep7a — *the obelisk in the crater* (seed 213)

1. From the crater rim the flock looks down — at the exact centre stands an immense smooth black **obelisk**, taller than the pines, utterly matte, untouched by the ash. They descend the inner slope in a single roped line, **bound waist to waist with golden woven threads.**
2. Up close **the obelisk reflects nothing at all — no flattering mirror, only honest blackness.** The careful raptor holds up its bark ledger and scratches one wary tally. The flock circles slowly, keeping the rope taut.
3. The small hatchling steps out of the rope-line alone, stands before the black face, and chirps the five-note motif up at it; **a single glowing glyph shaped like rings rippling on water lights high on the obelisk.** Everything goes still.

*Audio: roped footsteps in ash, tallies on bark, an immense sub-bass like a held breath, then the tiny chirped motif and one pure bell tone.*

**Establishes:** the **honest signal**, defined by contrast with Ep4a. The
obsidian egg reflected you flattered; the obelisk reflects nothing. A surface
that refuses to tell you what you want to hear is the trustworthy one — and it
answers only to the motif, i.e. to something the flock made together. The rope
is the mechanical opposite of Ep1a's separate rocks: they enter the unknown
physically coupled, and the one who approaches alone can do so *because* the
rope exists behind it.

### Ep7b — *the song becomes a door* (seed 214)

1. The whole flock sings the motif in **overlapping rounds**, every voice a slightly different colour of sound; with each phrase new glyphs cascade down the obelisk like meltwater — **their song being written into a language of light.**
2. The falling glyphs slow and **lock together into the tall outline of a doorway**; the blackness inside dissolves into aurora, and through it: a river of stars flowing uphill.
3. Without a word they re-tie the rope, lift the rafts onto their shoulders, place the hatchling at the centre of the line, and **step through together** — ash world behind, star-river ahead, the door breathing like a slow heart.

*Audio: layered rounds building into a full choral canon, glyph-chimes like rain on bells, a vast soft breath as the door opens.*

**Establishes:** **the song becomes a door** — coherence made structural. The
wall does not open for a key, a weapon, or a solo virtuoso; it opens for a canon,
which requires several voices *offset in time* and is therefore un-fakeable by
one. `SPELLS.song` is `quorum: 5` at the obelisk. The hatchling goes in the
middle of the line, which is the flock's stated priority order.

### Ep8a — *fishing the river of futures* (seed 215)

1. Rafts drifting on a river of starlight through soft darkness; on the banks, dream-shapes fold and bloom — a mountain becomes a wave becomes a sleeping raptor becomes a mountain. The hatchling conducts the drifting with tiny claw movements.
2. They cast golden lines into the star-water; luminous fish rise, **and the flank of each fish shows a small moving picture — a possible future.** One heavy silver fish shows **towers of hoarded glowing seeds above empty gray valleys**; the eldest gently unhooks it and lets it slide back into the dark.
3. The hatchling makes the smallest cast of all and catches a warm amber fish showing **green terraced valleys, a rebuilt hall, morning cook-smoke**; the fish glows brighter, slips off the hook of its own accord, and swims ahead like a lantern — towing every raft after it.

*Audio: watery harp arpeggios, reel clicks as if underwater, a hushed chord when the amber fish lights, the motif drifting by like something remembered.*

**Establishes:** **the river of futures** — the Hyperstition mechanic, stated
outright. Futures are objects you can catch, inspect and *choose*; the silver
fish (extraction to the end) is released rather than destroyed, because a
possible future is not an enemy. Critically, the chosen future **releases itself
and tows the rafts** — a declared future that enough of the flock leans toward
starts pulling them. That is `WireHyper`: inert until `invigoration >= required`,
then it becomes true and binds what it was declared against.

### Ep8b — *the mountain house at dawn* (seed 216)

1. The star-river thins into a real river of morning water; the rafts drift out of mist into a green valley — **and there on the slope stands the great timber mountain house**, solar-glass catching first light, gardens terraced to the water, the rebuilt hall grown into a home. The flock stands up on the rafts in silence.
2. On the rooftop deck a raptor DJ behind a wooden console of brass dials and glowing crystals raises one claw to the sunrise and drops a warm folk-electronic set; the flock dances as the sun crests the ridge, plumage blazing, the hatchling — now fully feathered — spinning in circles.
3. Through the foreground struts a line of small round fluffy **proto-chickens**, utterly unbothered, pecking between clawed feet. The eldest — soft and birdlike now — watches them pass, throws back its head and laughs, and speaks.

> **"We were always going to be birds."**

*Audio: a sunrise folk-electronic groove with the five-note motif as the melody of the drop, comic chicken clucks landing on the beat.*

**Establishes:** the ending, and the joke that carries the thesis. The line
reframes the entire arc as *becoming what you already were* rather than
acquiring power — which is why coherence is the only stat, why it grows feathers
rather than damage, and why flight is a late consequence of it instead of an
item. The chickens are the punchline: the descendants of the terrifying thing
are small, fluffy, and cooperative, and that was always where this was going.
It is the epigraph on chapter 8 in `src/systems/chapters.ts`.

---

## The five-note kalimba motif

The motif is in **every single Alignment clip** and in none of the Arc I clips.
It is the series' one continuous thread and its state always reports the state of
the alignment. Read it as a progress bar with a diegetic body:

| Episode | State of the motif |
|---|---|
| 1a | Once, very faint, **like a question**. |
| 1b | Once, clear and warm, **like an answer**. |
| 2a | **Traded back and forth between two instruments.** |
| 2b | **Hummed in harmony by the whole circle.** |
| 3a | Woven through the folk groove **as a bass line** — it has become infrastructure. |
| 3b | Ringing out bright over a full reel. |
| 4a | **Played back by the obsidian egg slightly wrong — too perfect, no warmth.** |
| 4b | Played truly — **warm, slightly imperfect, alive.** |
| 5a | Passed from valley to valley **like an echo**. |
| 5b | Played complete and at peace. |
| 6a | *(absent — the music cuts to dead silence at the flash)* |
| 6b | **Hummed low and minor**, resolving warm on the last image. |
| 7a | **Chirped by the hatchling alone** at the obelisk; one bell tone answers. |
| 7b | **Layered rounds building into a full choral canon** — and the canon is the key. |
| 8a | Drifting by **like something remembered**. |
| 8b | **The melody of the drop.** |

Two rules fall out of this and both are load-bearing.

**One:** the motif's *arrangement* encodes the alignment scale — one voice, two
voices, a circle, a bass line, a canon. Any audio work in the game should follow
the same rule: quorum size should be audible.

**Two, and this is the design note worth tattooing somewhere:** in 4a the motif
is played **more perfectly than the flock can play it, and that is the horror.**
In 4b it comes back imperfect and that is the resolution. Anything in this game
that renders "too clean" is a sycophancy tell, not a polish win.

---

## The measured palette finding

From `docs/visual-lore-extraction.md`, encoded in `src/art/palette.ts`.
Saturated-pixel clustering (S > 0.55, V > 0.45) across sampled frames:

- **Ep1 sits at hue 200–210°** (cold blue). It is the only cold episode.
- **Ep2–Ep5 sit at hue 20–40°** (amber), all four of them.
- **There is essentially nothing in between.**

Greens, teals and violets exist only as low-saturation environment or as feather
accents on individuals — **never as ambient light**. So the world is graded along
a single COLD ↔ WARM axis and every other colour decision hangs off it.
`COLD_RAMP`, `WARM_RAMP` and `TENDED_RAMP` are the measured ambient ramps,
dark → light, straight off the footage.

**Light is the only magic system.** There is no projectile, no explosion, no
spell effect anywhere in the source. Every supernatural moment is the *same*
warm-amber emissive material (`EMBER` → `FLAME` → `FLAME_CORE`) doing a
different structural job:

| Appearance | Ep | Job |
|---|---|---|
| Amber seeds cached on rocks | 1a | stored energy |
| One feather at the sternum | 1b | carried purpose |
| Chest-to-chest threads in the circle | 2b | connection between minds |
| Root-light joining under a valley | 3a | interbeing |
| The net woven from chest-light | 3b | mutual insurance |
| A ghost building solidified by claw-prints | 3b | intention before matter |
| Root-line greening a dead slope | 5a | restoration |
| The hatchling itself | 4b–8b | a new kind of mind |
| Glyphs cascading down the obelisk | 7b | language / a door |

One material, nine uses. Emissive voxels are nearly free, so this hands the game
a complete magic system that never needs a particle-heavy spell — and it means
any new effect should be asked "can this be light?" before anything else.

**The one exception, and it is reserved:** electric blue `EGG_BLUE` (`#4da6ff`),
used exactly once in the entire source — the fissures in the obsidian egg.
Cold light means *the genuinely unknown*. Do not reuse it for UI, for water, or
for anything the player has already understood.

---

## The invariants the game encodes

Each of these is a canon beat that became a rule in code. Breaking one is a
canon violation, not a balance change.

1. **The seed's light dims when it is fought over.** (Ep1a shot 2.)
   Conflict over a commons degrades the commons *directly* — not via a health
   bar. → `Chunk.tend`, `Moloch.pressure`, per-chunk palette grading. The
   lighting is the score; there is no morality meter and no popup.

2. **Alignment scales: within → between two → among many.** (Ep1b / 2a / 2b.)
   The difficulty curve is a coordination curve, not a power curve. → chapter
   gates in `src/systems/chapters.ts` and `quorum` in `SPELLS`: 1, then 2, then
   3, rising to 7 for the Golden Seed. Chapter 1 is the only chapter that is
   *about* being alone, though chapter 4 also needs no quorum, in the
   game and Ep1b is the only solo episode in the source. That correspondence is
   deliberate; do not add a second solo chapter.

3. **The two valleys are two attractors, visible at once.** (Ep3a shot 1.)
   The player must be able to *see* both outcomes before choosing. → the
   `valleys` landmark is pre-built with both halves already standing;
   `extract` and `plant` are the same verb with opposite sign, and extraction
   raises pressure for **everyone**, which makes it a real commons rather than a
   personal vice.

4. **The weave that catches is mutual insurance.** (Ep3b shot 2.)
   Each thread is a personal cost; the payout goes to whoever falls; the strain
   is felt by all. → `SPELLS.weave`, `quorum: 3`, and the light-lattice block
   catches anyone who falls near it, not only the caster's friends.

5. **The checks that lie: Goodhart, and the flattering mirror: sycophancy.**
   (Ep4a shots 2 and 3.)
   A proxy that becomes a target certifies hollow eggs; a surface that returns
   you flattered agrees with everything. → `SPELLS.tally` ("checks can lie") and
   `Coherence.blindSpot`, which silently *reduces the return on your own
   actions* — the punishment for a blind spot is that you misjudge your own
   situation, which is exactly what a blind spot is.

6. **Belly-up is admitting a mistake; "I cannot see my own back" is the
   cooperation verb.** (Ep4b.)
   → `SPELLS.admission` (quorum 3, the largest reward relative to its quorum,
   "costs nothing but pride; pays the most"; the gesture is `G`, the seal is `5`) and `SPELLS.preen` — the *only* thing that
   clears a blind spot, and it must be cast by someone else. The blind spot
   grows on its own if nobody looks. There is no self-preen and there must never
   be one.

7. **The root-web is interbeing.** (Ep5a shot 3, Ep6b shot 3.)
   Restoration crosses property lines underground; valley after valley lights up
   as one web. → `rootline`, chunk tend spreading between neighbours, and the
   fact that Moloch pressure is a single global number rather than per-player.

8. **"The web remembers."** (Ep6b.)
   What survives catastrophe is the relationships, not the buildings. → the
   server speaks this line verbatim when a Moloch is unmade, and `quorumActs`
   persists across losses.

9. **The obelisk reflects nothing — an honest signal.** (Ep7a shot 2.)
   Trustworthiness is the refusal to flatter. → the obelisk is matte, it cannot
   be mined, and it responds only to a group act. Any future "advisor" system
   must be honest-or-silent, never agreeable.

10. **The song becomes a door.** (Ep7b shot 2.)
    A canon requires several voices offset in time, which one player cannot
    fake. → `SPELLS.song`, quorum 5, at the crater.

11. **The river of futures.** (Ep8a shot 2–3.)
    A future is an object you can inspect, release, or lean toward — and the one
    enough of you lean toward starts pulling. → the Hyperstition / Hyperobject
    loop: `WireHyper` spawns inert and barely visible, each *distinct* raptor's
    alignment makes it fractionally more real, and only at
    `invigoration >= required` does it become true and bind the Moloch.

12. **"We were always going to be birds."** (Ep8b.)
    Progress is becoming, not acquiring. → coherence is the only stat, it grows
    feathers rather than damage, and flight is its consequence rather than an
    item. Never add an item that substitutes for coherence.

### The invariant that has no single episode

**Moloch takes zero damage from force.** He is the shape a group makes when none
of them can trust the others, so blocks, tools and solo spells do literally
nothing and the server returns a refusal saying so (`attack` → `denied`). The
canon support is negative space: across sixteen clips of an existential-stakes
story, **no raptor ever strikes anything.** Ep1a's only violence is two of them
snapping at each other over a seed, and that is the problem, not the solution.
The one thing that binds him is a Hyperobject — a declared future made real by
k distinct others. Never add a mechanic that lets one player win alone.

---

## Known gaps and disagreements

Flag these rather than quietly resolving them:

- **The lore extraction predates Ep6–8.** `docs/visual-lore-extraction.md`
  measured five episodes and its "the arc is cold blue warming up" reading does
  not account for the ash grey of 6b/7a. The grey is a *third* register — low
  saturation, not a hue shift — and should be treated as such.
- **"No dialogue in any episode."** The lore extraction verified this by
  transcription of the rendered footage. The prompts, however, *request* four
  spoken lines (Arc I ch2; Ep4b; Ep6b; Ep8b). Treat the four lines as canon
  intent — they are what the game quotes — while remembering they may not be
  audible in any given render.
- **The net on the Ep5b mural.** The extraction flagged a net with no
  corresponding scene; the prompt archive resolves it — it is Ep3b's weave. Fixed
  in reading, noted here so nobody re-opens it.
- **Arc I's timeline position is unstated.** It is the end state shown first, but
  nothing in either archive says whether the hub, the parchment and the rooftop
  are the same place as the mountain house. The game treats mesa-town as their
  rhyme, not their identity. That remains an open hook.
