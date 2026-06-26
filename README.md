# BSP Modeler

A generator of models in **BSP** format from a grid-based block system.
Geometry and texturing are independent workflows; a Node server compiles the
`.bsp` with the `qbsp/light/vis` toolchain.

## Requirements

- Node ≥ 20 (verified with v25), **pnpm** (verified with 10.33).
- The **ericw-tools** compilation toolchain (`qbsp`, `light`; `bspinfo` for
  verification). See [Toolchain (`bin/`)](#toolchain-bin) below.

## Toolchain (`bin/`)

Compiling a real `.bsp` needs the [**ericw-tools**](https://github.com/ericwa/ericw-tools)
binaries. They are **not bundled** (they are large and GPL-licensed) — you
provide them yourself.

1. **Download** a release for your OS from
   <https://github.com/ericwa/ericw-tools/releases> (or build from source — see
   that repo). The free [Quake](https://www.quaddicted.com/) data is not needed;
   only the tools.
2. **Place the binaries in `./bin`** (the default the server looks in). On
   Windows, copy the **whole** extracted folder, not just the `.exe` files — the
   tools need their accompanying DLLs (`embree*.dll`, `tbb*.dll`, `Qt5*.dll`,
   `freeglut.dll`, the `platforms/` folder, …). The folder must end up with at
   least:

   ```
   bin/
     qbsp.exe        light.exe        bspinfo.exe
     embree.dll      embree3.dll      tbb.dll      tbbmalloc.dll
     Qt5Core.dll     Qt5Gui.dll       Qt5Widgets.dll
     freeglut.dll    platforms/
   ```

   On Linux/macOS place the executables (`qbsp`, `light`, `bspinfo`) and their
   shared libraries in `bin/` the same way.
3. **Or** point to an existing toolchain folder without copying, via the
   `BSP_BIN_DIR` environment variable (PowerShell):

   ```powershell
   $env:BSP_BIN_DIR = "C:\path\to\ericw-tools"; pnpm start
   ```

> `bin/` is git-ignored, so the toolchain is never committed. Only `qbsp` and
> `light` are invoked during compilation (`vis` is not used — loose object
> models have no sealed PVS); `bspinfo` is handy for inspecting the output.

## Getting started

**One command, one port.** The server serves the editor *and* the API
(textures + compilation) on `http://localhost:7777`, with frontend hot-reload.

```bash
pnpm install            # respects minimumReleaseAge (see below)
pnpm start              # editor + API on http://localhost:7777
```

> **Supply-chain note:** installs respect `minimumReleaseAge` (configured in
> `pnpm-workspace.yaml`), rejecting package versions published less than 3 days
> ago to mitigate compromised-account / typosquatting attacks. The lockfile
> (`pnpm-lock.yaml`) is committed; use `pnpm install --frozen-lockfile` for
> reproducible builds.

> **Dynamic textures:** the `textures/` folder is the source of truth. Drop a
> `<name>.png` in and the texture appears (refresh the editor); delete it and it
> disappears. The server decodes the PNG and caches a `<name>.tex` (palette
> indices for the WAD) when missing or changed. `pnpm gen-textures` only creates
> the procedural example set; it is not required.

> **Fullbright textures (`textures/fb/`):** a PNG inside `textures/fb/` is
> quantized against Quake's **fullbright** palette (indices 224–255), so it
> **always glows** (map lighting does not affect it) — for lights, screens and
> beacons. Textures in the root are never fullbright (no glow added by
> accident). The id is **flat**: `textures/fb/alarm.png` is named `alarm`; if the
> same name exists in the root and in `fb/`, `fb/` wins. The fullbright ramp is
> small (mostly reds, amber/gold, light cyan and white): paint with colors in
> that range or you will get the nearest fullbright color.

> **Animated / blinking textures (Quake's `+` convention):** name the frames
> `+0<base>`, `+1<base>`, … `+9<base>` (e.g. `+0blink`, `+1blink`, …). Paint the
> face with **frame 0** (`+0blink`); the engine cycles the rest on its own at
> ~5 fps. The `.map` only references `+0`, but the WAD packs **all** present
> frames automatically. Combine with `fb/` for lights that blink at full glow.
> (The `+0`/`+a` pair is the off/on state of a switch.) Example sets included in
> `textures/fb/`: `+Nblink` (red), `+Namber` (gold), `+Ncyan` (sky blue). In the
> **editor palette only the `+0` frame** of each animation appears (the
> `+1`..`+9` are hidden; they exist only so the WAD can cycle them). **Note:**
> blinking and fullbright are only visible in the compiled `.bsp`; in the editor
> viewport the texture looks flat and static.

Remember you need the toolchain in `bin/` (or `BSP_BIN_DIR` set) to compile a
real BSP — see [Toolchain (`bin/`)](#toolchain-bin) above.

Production (serves the already-built `dist/`, no hot-reload):

```bash
pnpm prod               # = vite build && node server/index.js --prod
```

## Using the editor

- **Build (B):** pick a block in the left palette and click on the grid.
  `Alt+click` deletes, `R` rotates, `[` / `]` move down/up a layer (the *pips*
  on the right and the "Layer Z = N" indicator reflect the active height), and
  `Shift+drag` orbits the camera.
- **Paint (P):** pick a texture (right palette) and click a face to assign it;
  `Alt+click` removes it. The texture follows the face even if you move or
  rotate the block (stable faceId).
- **Compile BSP:** button in the top bar. Choose a profile and download the
  `.bsp`:
  - `flat` — geometry only, no lighting (fast, comes out fullbright).
  - `fast` — basic lighting.
  - `hq` — vis + softened lighting (`-extra4 -soft`).
  - `hqao` — hq + ambient occlusion (AO/dirt): darker corners, more volume.
  - `hqaop` — hqao + **Phong**: smooths shading between adjacent faces, so
    faceted pieces (ball, beveled cube) look rounded without adding geometry.
  > All lit profiles use a high minimum ambient (`_minlight`, floor 190) so the
  > model is never fully black. It is a loose object: there is no directional
  > sun (that would need `sky` faces); volume comes from AO.

## Structure

```
src/            frontend (browser)
  core/         data model: model, geometry, instance
  blocks/       module catalog (cube, ramp, bevel, cornerWedge)
  gl/           WebGL renderer, meshBuilder, atlas, ghost
  components/   Vue UI (Viewport3D, ModulePalette, TexturePalette, Toolbar)
  store.js      reactive state
server/         Node server (compilation)
  index.js      HTTP API (/api/textures, /api/compile, ...)
  compile/      mapWriter, wadWriter (WAD2), compileTools, brushes, palette
scripts/        gen-textures.mjs
textures/       textures: <id>.png (source) + <id>.tex (auto-generated cache)
  fb/           fullbright textures (quantized to palette 224–255)
tests/          model, geometry, mapWriter
bin/            toolchain (not included)
```

## Tests

```bash
pnpm test
```

They cover model serialization, per-module geometry/brush generation and the
`mapWriter`.
