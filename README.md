# BSP Modeler

Generador de modelos en formato **BSP** a partir de un sistema de bloques en
grid. La geometría y el texturizado son flujos independientes; el servidor Node
compila el `.bsp` con el toolchain `qbsp/light/vis`.

Ver [`bsp_modeler`](bsp_modeler) (concepto) y [`plan.md`](plan.md) (plan de
implementación y decisiones de arquitectura).

## Requisitos

- Node ≥ 20 (verificado con v25), **pnpm** (verificado con 10.33).
- El toolchain de compilación (`qbsp.exe`, `light.exe`, `vis.exe`,
  `bspinfo.exe`). Cópialo a `./bin`, o apunta a uno existente con la variable
  de entorno `BSP_BIN_DIR` (p.ej. el de `ultimata/editor-map/bin`).

## Puesta en marcha

**Un solo comando, un solo puerto.** El servidor sirve el editor *y* la API
(texturas + compilación) en `http://localhost:7777`, con hot-reload del frontend.

```bash
pnpm install            # respeta minimumReleaseAge (ver plan.md §0)
pnpm start              # editor + API en http://localhost:7777
```

> **Texturas dinámicas:** la carpeta `textures/` es la fuente de verdad. Suelta
> un `<nombre>.png` y la textura aparece (refresca el editor); bórralo y
> desaparece. El servidor decodifica el PNG y cachea un `<nombre>.tex` (índices
> de paleta para el WAD) cuando falta o cambia. `pnpm gen-textures` solo crea el
> set de ejemplo procedural; no es obligatorio.

Para compilar BSP de verdad necesitas el toolchain. Cópialo a `./bin`, o apunta
a uno existente (PowerShell):

```powershell
$env:BSP_BIN_DIR = "D:\code\ultimata\editor-map\bin"; pnpm start
```

Producción (sirve el `dist/` ya construido, sin hot-reload):

```bash
pnpm prod               # = vite build && node server/index.js --prod
```

## Uso del editor

- **Construir (B):** elige un bloque en la paleta izquierda y haz clic en la
  grid. `Alt+clic` borra, `R` rota, `[` / `]` bajan/suben de capa (los *pips* de
  la derecha y el indicador "Capa Z = N" reflejan la altura activa), y
  `Shift+arrastrar` orbita la cámara.
- **Pintar (P):** elige una textura (paleta derecha) y haz clic en una cara para
  asignársela; `Alt+clic` la quita. La textura sigue a la cara aunque muevas o
  gires el bloque (faceId estable).
- **Compilar BSP:** botón de la barra superior. Elige perfil (`flat`/`fast`/`hq`)
  y descarga el `.bsp` resultante.

## Estructura

```
src/            frontend (navegador)
  core/         modelo de datos: model, geometry, instance
  blocks/       catálogo de módulos (cube, ramp, bevel, cornerWedge)
  gl/           renderer WebGL, meshBuilder, atlas, ghost
  components/   UI Vue (Viewport3D, ModulePalette, TexturePalette, Toolbar)
  store.js      estado reactivo
server/         servidor Node (compilación)
  index.js      API HTTP (/api/textures, /api/compile, ...)
  compile/      mapWriter, wadWriter (WAD2), compileTools, brushes, paleta
scripts/        gen-textures.mjs
textures/       texturas: <id>.png (fuente) + <id>.tex (cache autogen)
tests/          model, geometry, mapWriter
bin/            toolchain (no incluido)
```

## Tests

```bash
pnpm test
```

Cubren serialización del modelo, generación de geometría/brushes por módulo y
el `mapWriter`. El pipeline completo (`.map` → `.wad` → qbsp → `.bsp` válido) se
verificó de extremo a extremo con el toolchain de `editor-map`.
