# Lighting and shadows

What lights a scene in OpenWar3, and what casts shadows in it. Read this before adding
anything shadow- or light-shaped — the single most important fact is at the top.

## WC3 has no real-time shadows

No shadow maps, no shadow volumes, no per-light depth passes. Everything that looks like a
shadow in Warcraft III is one of four baked or decal mechanisms, and building a real-time
shadowing engine would move us *away* from the original rather than toward it:

| What | Where it comes from | Where we implement it |
| --- | --- | --- |
| Unit shadows | `Units\UnitUI.slk` `unitShadow` — a black-RGB/alpha blob texture, sized `shadowW`×`shadowH` and offset by `shadowX`/`shadowY` | [`render/shadowOverlay.ts`](../src/render/shadowOverlay.ts) |
| Building shadows | the same table's `buildingShadow`, one baked texture per building | the second `ShadowOverlay` pass in `mapViewer` |
| **Static map shadows** | **`war3map.shd`** — the mask the World Editor bakes for cliffs, doodads and scenery | [`render/terrainShadowOverlay.ts`](../src/render/terrainShadowOverlay.ts) |
| Time-of-day shading | `Environment\DNC\*.mdx` — a keyframed directional light per tileset | [`render/dayNight.ts`](../src/render/dayNight.ts) + the shader patch |

All three shadow layers are ground decals tessellated over the terrain's own corner grid, so
they morph across slopes and ramps instead of floating over them.

## `war3map.shd` — the static shadow layer

The file has **no header at all**, so the only way to read it is to check its length against
the map's own terrain grid. Measured on three real campaign maps:

| Map | cells | `war3map.shd` | bytes/cell |
| --- | --- | --- | --- |
| NightElfX01 | 96×128 | 196 608 | 16 |
| NightElfX02 | 128×160 | 327 680 | 16 |
| OrcX01 | 192×192 | 589 824 | 16 |

So it is **16 bytes per terrain CELL — a 4×4 sub-grid** — row-major, giving a mask of
(cells_x × 4) by (cells_y × 4). Every byte in all three maps is either **0 or 255**: a 1-bit
mask, not a gradient, so how dark a baked shadow reads is entirely our
`TerrainShadowOverlay.strength` (0.45) rather than anything the file says. Coverage runs 13%
to 34% of the map, so this is a large part of how a WC3 map reads.

The mask is stored on the same bottom-left-origin, row-major grid as `war3map.w3e`, which is
why the overlay's UVs are a plain grid fraction with no flip. If you ever see baked shadows
sitting in open ground with nothing above them, that assumption is what broke.

Unshadowed cells are dropped from the mesh — most of them are — with a one-cell dilation so
the bilinear filter still has real texels to blend toward at a shadow's edge.

## Cliffs and ramps: who shades a tile with no ground

A cliff or ramp tile has **no ground** — the viewer draws a `Cliffs\`/`CliffTrans\` model in
its place and leaves the tile's four texture slots at zero. Three things went wrong at those
tiles, and together they were the "seams where slopes meet the ground" and the "sharp black
lines on cliffs" (Lost Temple shows all three at once):

1. **Two layers drew a plane through the rock.** The fog-of-war veil and the `war3map.shd`
   layer are meshes on the ground's corner grid; on a cliff tile that grid is a plane slanting
   from the low corners to the high ones. The cliff shader ALREADY dims itself by the fog mask,
   so wherever that plane landed on a ramp or a cliff top it was dimmed twice — a ramp in
   explored fog drew at a quarter of the grass beside it, a hard-edged dark rectangle with the
   ramp's outline — and wherever it cut a curved cliff face it painted a jagged black wedge.
   Now both layers skip those cells (`FogOverlay.skipCells`, `TerrainShadowOverlay.skipCells`,
   driven by `MapViewerScene.syncGroundless` off the viewer's own `cornerTextures`), and the
   cliff shader samples the shadow mask itself (`cliffs.frag` `u_shdTexture`), as it already
   samples the fog. Neither layer is LIFTED any more either: a lifted edge rides up the screen
   and left the last three pixels of every plateau tile above a cliff unfogged once the quad
   hanging below it was gone. The polygon offset alone wins (no speckle in unexplored fog at
   any zoom).
2. **The ground lit itself by the cliff layers.** `ground.vert` took its normal from the FINAL
   corner height (ground + cliff layer + a ramp's half layer), so every tile beside a cliff or
   ramp was lit as a 27° hill. Under Lordaeron's low south-west sun (terrain light direction
   −0.68, −0.41, 0.62) that is about half brightness — a band along every cliff edge and an
   outline round every ramp, near-black at night. HiveWE and Warsmash both light from the RAW
   ground height and position from the final one; the height map now carries both (luminance =
   raw, alpha = final).
3. **A cliff model's normals are smoothed.** Where the mesh meets the grass its vertex leans
   toward its own slope or wall (a ramp's flat border sits ~25° off vertical), so the two sides
   of the seam were lit differently. A cliff vertex on a cell edge at a ground level (x or y on
   the 128 grid, z on a half layer) now takes the ground's own normal there — Warsmash's idea,
   studied not lifted. The `nz > 0.6` guard comes from a census of all 253 stock cliff/ramp
   models: every vertex where a natural cliff or a ramp meets the ground is at nz ≥ 0.6 and
   every wall vertex on those lines under 0.3, while City cliffs split vertices on purpose
   (walls at 0, bevels at 0.45) and keep their creases.

A trap when testing any of this: `MapViewerScene.ensureFog` rebuilds the veil whenever
`fog` is null, so setting `mapScene().fog = null` from the page does NOT turn the fog off.

## The engine's light model: a lamp is a WASH, not a disc

Everything here was measured off the **1.27 `Game.dll`** (the install this project plays),
not assumed:

* **A light MULTIPLIES the surface — it is never added to it.** D3D9's fixed-function output
  is `texel × clamp(Σ (Diffuse_i × attenuation_i × N·L_i) + Σ Ambient_i, 0, 1)`: the light
  SUM is clamped per channel and only then modulates the texel. A lamp *raises the light on*
  the ground it stands on; it cannot paint orange onto black.
* **A point light's attenuation is `1 / (1 + linear·d + quadratic·d²)`,** and the
  coefficients are **global**: `GxLightingSetFalloff(0.0, 0.00050000002)` is called exactly
  once, at device init (`Game.dll.c:268329`), and never changed afterwards.
  `CGxDeviceD3d::IStateSyncLights` (`Game.dll.c:472600`) uploads `Range = 10000`,
  `Falloff = 1`, `Attenuation0 = 1`, `Attenuation1 = m_lightLinearFalloff` and
  `Attenuation2 = m_lightQuadraticFalloff` — so the linear term is **zero** and the
  attenuation is purely quadratic.
* **The MDX `LITE` chunk's `AttenuationStart`/`AttenuationEnd` never reach the light.** The
  engine's `struct CLight` (`Game.dll.h:133364`) carries no range field at all: `m_light`,
  `m_ambColor`, `m_dirColor`, `m_ambIntensity`, `m_dirIntensity`, `m_dir` and nothing else.
  The header has `MDLTOK_ATTENUATION` tokens, the values are read, and they are dropped.
* **The engine's intensity is in the MDX's own scale.** `Diffuse = dirColor ×
  (dirIntensity / 255)`, so a `LITE` chunk's `Color` (0…1) and `Intensity` (0…255) multiply
  out to exactly the product our shaders use.

The consequence is that a lamp at intensity 10 throws a **wide, soft pool**: at 144 units the
attenuation is still 0.088, so the light is a warm wash reaching far past the model that
carries it. Our shaders used to do the opposite on both counts — a per-light
`min(colour × window × N·L, 1)` pool ADDED to the texel, inside a hard linear window taken
from the LITE chunk — which is why our lantern pool was a saturated yellow-green disc while
the real client's is a wide soft brown.

The day/night rig and the model lights are **ONE sum**. `sd.frag` used to make them
alternatives (`if (u_omniEnabled) … else if (u_dncEnabled) …`), so a model standing near a
lamp lost the map's own dim sun entirely and went black; the engine adds them. The falloff
is written down in one place, [`src/render/omniFalloff.ts`](../src/render/omniFalloff.ts).

**An `Unshaded` layer takes no light at all.** The layer flag `0x1` removes the layer from
that sum — the ambient AND the directional term are skipped for it and it is drawn at its own
colour, which is the whole point of the flag on a team-colour glow or an effect quad.
`sd.frag` used to multiply an unshaded layer by the scene's ambient when it was also fogged
(the `0x20` bit clear), which is wrong twice over: DSIII's night rig is `light.mdx`, whose
`AmbIntensity` is 0, so **every one of its glow quads was multiplied to black** — the login
lantern lost its entire warm halo — and a halo's colour comes from its texture and the
doodad's own tint, never from a light.

Measured on the DSIII login against the real client's capture (same relative patches at the
lamp, RGB). The "before" column is not a measurement of a grey area — the ambient there is
exactly `(0,0,0)`, so the multiply drove every one of those quads to nothing and the halo was
gone:

| patch | real | after |
| --- | --- | --- |
| left of the lamp (air) | 92/49/32 | 75/40/24 |
| below the lamp (ground) | 77/37/12 | 66/30/9 |
| the post beside it | 121/65/14 | 97/45/10 |

The remaining ~20 % is the capture's own exposure on a locally lit patch, not a missing
term: ground clear of the lamp matches cell for cell (real 12/11/5, ours 13/11/4).

## Glue-screen lighting (issue #105)

The main menu and the campaign backdrops are 3D scenes, and **every glue model carries its own
lights** in its MDX `LITE` chunk:

| Model | screen | lights | type | attenuation | intensity |
| --- | --- | --- | --- | --- | --- |
| `NightElf_Exp` | Sentinels | 4 (`Omni01`–`Omni04`) | omni | 80 → 200 | 6 / 250 / 15 / 7 |
| `Alliance_Exp` | Alliance | 4 + `FDirect01` | omni + **1 directional** | 80 → 200 | 400 / 1000 / 1000 / 800, directional 0.1 |
| `Undead3D_Exp` | Scourge | 4 (`Omni01`,`03`,`04`,`05`) | omni | 80 → 200 | 120 / 111 / 222 / 40 |
| `Orc_Exp` | Bonus | 4 | omni | 80 → 200 | 80 / 75 / 80 / 35 |
| `MainMenu3D_Exp` | main menu | 5 | omni | 80 → 200 | 170 … 280 |

**`Type` is not always 0**, and Alliance_Exp is the model that proves it: `FDirect01` is
`Type 1`, a DIRECTIONAL light — a direction and no attenuation, where every other light in the
glue set is a point. `updateOmniLights` had no filter and uploaded it as an omni at its pivot,
which put it 6102 units from that model's own camera target against a 200-unit reach: it lit
nothing, and it spent a shader slot claiming to. Non-omni lights are skipped now. It is skipped
rather than approximated because the MDX gives no direction to approximate FROM — identity
rotation, no parent, `Intensity 0.1` — and picking a base axis for it would be inventing what
the reference shows rather than reading it.

**Alliance_Exp is lit almost entirely by the base ambient, and that is the data's doing.** Its
four omnis sit 1361 / 5804 / 7109 / 4206 units from the camera target with the same 80→200 reach
every glue light has, so barely any of that set is inside a light. Measured by rendering one
frozen frame with `scene.omniLights` on and then null, mean |Δ| over the scene: Sentinels 17.1,
Scourge 14.5, Bonus 10.7 — **Alliance 2.8**. That is why its baked `lightAmbient` is 0.83 where
the others sit near 0.5, and it is the right answer rather than a workaround: with no practical
lights near the subject, ambient is what the engine has left to light Kael with.

We ignored all of them until issue #105, and with no light on the scene the SD shader fell
through to mdx-m3-viewer's stock `clamp(N·L + 0.7)` — a 0.7…1.0 wash with no falloff anywhere.
That is exactly the flat, over-bright look the campaign screen had.

**The main menu is on the same path**, not a special case: `updateOmniLights` reads whatever is
in the 3D scene (`backdropModel ?? bgModel`), so MainMenu3D_Exp's five lights are sampled and
uploaded exactly as a backdrop's are. Verified by toggling `scene.omniLights` on a frozen frame:
the tower, the chains, the ice spikes, the bergs and the ocean all change. What it does NOT have
is any shadow art — the model names 49 textures and not one of them is a shadow — so there is
nothing further to hook up there; a glue scene's shadows are painted into its textures.

If a glue scene looks *sharper* than a screenshot of the real client, that is very likely the
screenshot rather than the renderer — see **"Calibrate a screenshot reference on something you
render identically"** in [`REFERENCES.md`](REFERENCES.md), which measures it and also rules out the
mip chain, a missing shading layer and the install's `*_mip1.blp` files as causes.

### A glue scene's shadows are painted, and one of them is painted 178 times

There is no shadow *pass* to hook up on these screens — a glue model's shadows are in its art.
Read out of each model's `TEXS` chunk, four of the five name no shadow texture at all
(NightElf_Exp 88, Alliance_Exp 26, Orc_Exp 23, MainMenu3D_Exp 49 — none shadow-named), and the
fifth is the exception worth knowing about:

**`Undead3D_Exp` ships 216 of its 248 textures as baked shadow FRAMES** —
`UI\Glues\SinglePlayer\Undead3D_Exp\shadowMap0000…0354.blp` (178, even numbers) and
`Textures\shadowMapHair0000…0074.blp` (38). They are Arthas's own self-shadowing, baked per
animation frame and played back as a flipbook: two material layers (22 and 29) carry a **`KMTF`
texture-id track**, animated in both `Birth` and `Stand`, blended over the model at alpha 0.35
and 0.5 — the second one `Unshaded` and `Unfogged`, since a shadow cast by his hair onto his
face is not something the scene's own lights or haze should touch.

**This already works, and it works because mdx-m3-viewer samples KMTF per instance per frame**
(`modelinstance.js`, `layer.variants['textureId'][sequence]` → `instance.layerTextures[i]`,
which is what the batch binds). Nothing in OpenWar3 had to be added for it. Verified on the
running screen: all 248 textures resolve in the install and all 248 load, and forcing the two
cached layer textures to something else on a frozen frame changes 68k pixels across Arthas —
his face and hair flatten out and the modelling on his armour goes. If you are ever testing
this, note the trap that made it look dead the first time: **the render path reads the CACHED
`instance.layerTextures`, not `getTextureId`**, so monkeypatching the getter on a stopped scene
proves nothing — nothing calls it until an update runs.

The screen-edge sprite layers (`scenePanel` / `sceneLeft`) deliberately get no lights. They are
flat UI chrome drawn through an orthographic camera, and lighting the metal border with the
seascape's lamps is not what any of this is for.

**An 80→200 unit reach reads as far too small** for a scene whose bounds run to ±3000 — until
you read the model's own camera, which sits **340 units** from its target. These are dioramas:
a small lit set near the eye with a big painted backdrop far behind it, and the lights are
sized for the set. What covers the far scenery is the campaign's own `BackgroundFog*`.

Two things about the implementation are worth knowing before touching it:

* **Colours come out BGR.** The same quirk `dayNight.ts` documents for the day/night lights —
  neither the parser nor Warsmash swizzles them, and reading them straight gives a scene a
  mirror-image tint.
* **The base ambient is NOT from the file**, and is labelled as such wherever it appears. Every
  one of these lights carries `AmbIntensity 0`, which past 200 units would leave the scene
  pitch black, and the reference plainly is not. The engine supplies a base we cannot read out
  of the model, so it lives in `BackdropTuning.lightAmbient` with its own `?menudebug` slider
  rather than being smuggled in as a constant that looks like data.

The uniforms (`u_omni*`, `u_dnc*`, `u_distFog*`, `u_boundary*`) are all added by
`patches/mdx-m3-viewer@5.12.0.patch`. Two traps live there, and both cost real time:

**After editing that patch, restart the dev server and delete `node_modules/.vite`** — Vite
pre-bundles the dependency, so a running server keeps serving the pre-patch copy and your
shader change will appear to do nothing at all.

**The shader source is a JS TEMPLATE LITERAL.** A backtick in a comment you add inside it ends
the string, and whatever follows lands in JS — a backslash there is an esbuild syntax error and
a dev server that starts and then serves nothing. So no backticks around `UI\MiscData.txt` or
around a constant's name, however much the rest of the codebase writes them that way; and
double any backslash you do keep, since the literal eats one. The failure looks like
`✘ [ERROR] Syntax error "\"` pointing at a COMMENT, which reads as impossible until you notice
what the file really is (issue #117).
