# Plan de implementación — BSP Modeler

> Generador de modelos en formato BSP a partir de un sistema de bloques en
> grid. La geometría y el texturizado son flujos independientes. La parte
> servidor compila el BSP. Ver [`bsp_modeler`](bsp_modeler) para el concepto.

## 0. Decisiones de arquitectura

Basado en los dos proyectos de referencia que ya tenemos en `d:\code`:

| Proyecto | Stack | Qué reusamos |
| --- | --- | --- |
| [`modules_editor`](D:\code\modules_editor) | Vite + **Vue 3**, navegador, render WebGL (`gl/`, `blocks/`, `core/`, `store.js`) | Editor de bloques en grid, viewport WebGL, store reactivo |
| [`ultimata/editor-map`](D:\code\ultimata\editor-map) | **Electron** (main/renderer) + React, compila **BSP2 para FTEQW** | Pipeline de compilación: `mapWriter` → `wadWriter` → `qbsp/light/vis` (`bin/`) |

**Arquitectura elegida — servidor Node + frontend en navegador:**

- **Frontend** (navegador): editor de bloques + texturizado, sirve la UI con
  Vite + Vue, como `modules_editor`.
- **Servidor Node** (local): expone una API (HTTP/WebSocket) que recibe el
  modelo, escribe el `.map` y el WAD, e invoca el toolchain. Sólo el servidor
  toca disco y procesos hijo — el navegador nunca ejecuta binarios.
- El toolchain (`qbsp.exe`, `light.exe`, `vis.exe`, `bspinfo.exe`) ya existe en
  [`editor-map/bin/`](D:\code\ultimata\editor-map\bin) y se copia a `bin/`.

> Se descarta Electron: con servidor Node mantenemos la simplicidad de
> `modules_editor` (navegador) y aislamos la compilación (disco + procesos)
> en el backend.

### Gestor de paquetes y seguridad de la cadena de suministro

> Verificado en este entorno: **pnpm 10.33.0**, **Node v25.2.1**.

- **pnpm** como gestor (no npm).
- **No instalar paquetes con menos de 3 días de antigüedad** — mitiga ataques
  de cuenta comprometida / typosquatting recién publicado (las releases
  maliciosas suelen retirarse del registro en menos de una hora). El ajuste se
  llama `minimumReleaseAge`, se mide **en minutos**, aplica a **todas** las
  dependencias (incluidas las transitivas), y desde pnpm 10.16 vive en
  **`pnpm-workspace.yaml`** (no en `.npmrc`):
  ```yaml
  # pnpm-workspace.yaml
  # Rechaza versiones publicadas hace menos de 3 días (3 × 24 × 60 = 4320 min)
  minimumReleaseAge: 4320
  # Opcional: excepciones de confianza que pueden instalarse al instante
  # minimumReleaseAgeExclude:
  #   - vue
  #   - vite
  ```
  > Nota: en pnpm 11 el default ya es 1440 min (1 día); aquí lo subimos a
  > 4320 (3 días). `minimumReleaseAgeExclude` permite eximir paquetes
  > concretos o patrones (`@org/*`) si alguna release de confianza nos bloquea.
- Lockfile (`pnpm-lock.yaml`) **commiteado**; instalar siempre con
  `pnpm install --frozen-lockfile` en CI/builds reproducibles.
- Revisar dependencias nuevas antes de añadirlas; preferir copiar código
  propio de `d:\code` (ver §7) frente a añadir dependencias externas.

## 1. Andamiaje del proyecto

- [ ] `pnpm init`, `package.json` con scripts `dev` / `build` / `test` /
      `server` (copiar de `modules_editor/package.json`).
- [ ] `pnpm-workspace.yaml` con `minimumReleaseAge: 4320` (ver §0).
- [ ] Vite + Vue 3 + Vitest (frontend); servidor Node (HTTP/WebSocket).
- [ ] Estructura de carpetas:
  ```
  src/
    core/        # modelo de datos: grid, bloques, faces, model (compartido)
    blocks/      # definiciones de módulos (cubo, rampa, bevel, ...)
    gl/          # render WebGL del viewport (frontend)
    components/  # UI Vue (viewport, paleta de bloques, paleta de texturas)
    store.js     # estado reactivo (frontend)
  server/
    index.js     # API HTTP/WebSocket; sirve la UI y orquesta la compilación
    compile/     # generación de .map + WAD + invocación del toolchain
  bin/           # qbsp/light/vis (copiado de editor-map/bin)
  textures/      # texturas en disco, pregeneradas (editables)
  ref/           # codebases externas de referencia (no propias)
  tests/
  ```

## 2. Modelo de datos (`core/`)

- [ ] **Grid 3D** de celdas con coordenadas enteras.
- [ ] **Bloque** = posición en grid + tipo de módulo + orientación/rotación.
- [ ] **Módulo** = forma paramétrica que sabe generar sus brushes/faces.
- [ ] **Face** = identificador estable por (bloque, cara) para poder asociarle
      una textura de forma persistente.
- [ ] **Modelo** = colección de bloques + mapa `faceId → texturaId`.
- [ ] Serialización a JSON (guardar/cargar proyectos).

## 3. Catálogo de módulos (`blocks/`)

Empezar por **todas las formas que sabemos hacer en un BSP**:

- [ ] Cubo (1×1×1 y multi-celda).
- [ ] Rampa.
- [ ] Bevel / chaflán.
- [ ] (extensible: cuñas, arcos, etc.)

Cada módulo expone:
- [ ] Geometría para el render WebGL (mesh + faces con `faceId`).
- [ ] Geometría para BSP (brushes en formato `.map`, vía `boxBrush`/similar
      reusado de [`editor-map/src/shared/tileBrushes.js`](D:\code\ultimata\editor-map\src\shared\tileBrushes.js)).

## 4. Editor de geometría (UI + `gl/`)

> **Objetivo: que se sienta como `modules_editor`.** Navegación libre en altura
> por capas con la barra de *pips*, grid de referencia en la capa actual e
> indicador de altura. Reusar los mecanismos ya probados allí (referencias de
> archivo abajo) en vez de reinventarlos.

- [ ] Viewport WebGL con cámara orbital (reusar `gl/renderer.js` de
      `modules_editor`).
- [ ] **Capa Z activa** (`placeLayer`) en el store, con `layerUp()` /
      `layerDown()` / `setLayer(z)` y atajos de teclado `[` y `]`
      (ver [`modules_editor/src/store.js:305-307`](D:\code\modules_editor\src\store.js#L305-L307)).
- [ ] **Barra de pips** lateral: rango fijo y amplio de capas que se extiende
      sólo si colocas/seleccionas más arriba/abajo; clic en un pip salta a esa
      capa; el pip activo resaltado. Reusar el patrón de
      [`ModelViewer3D.vue:32-44`](D:\code\modules_editor\src\components\ModelViewer3D.vue#L32-L44)
      (`PIP_TOP_BASE` / `PIP_BOTTOM_BASE`, `pips` computed).
- [ ] **Grid de referencia en la capa actual**: rejilla gris translúcida
      dibujada a la altura `placeLayer * gridSize`
      (`renderer.setLayerGrid(...)`, oculta en la capa 0).
- [ ] **Indicador de altura**: texto tipo "Capa Z = N" (ver
      [`ToolPanel.vue:102-105`](D:\code\modules_editor\src\components\ToolPanel.vue#L102-L105)).
- [ ] **La cámara sigue la capa activa** (`renderer.setFocusHeight(layer *
      gridSize)`) para que trabajar en niveles altos sea cómodo.
- [ ] **Picking sobre el plano de la capa activa** (no sobre el suelo): el
      bloque aparece bajo el cursor aunque trabajes en alto
      (`pickGroundPoint(px, py, layer*gridSize)`, ver
      [`ModelViewer3D.vue:105-118`](D:\code\modules_editor\src\components\ModelViewer3D.vue#L105-L118)).
- [ ] Paleta de bloques: seleccionar módulo y colocar/borrar en la grid.
- [ ] Cursor/highlight de la celda activa, fantasma semitransparente del bloque
      a colocar y guía de caída vertical cuando el bloque está elevado
      (`setHighlight` / `setGhost` / `setDropGuide`).
- [ ] Snapping a celda, gizmos/atajos de rotación.
- [ ] (Opcional, si se quiere paridad completa) planos de espejo X/Y como en
      `modules_editor`.
- [ ] Undo/redo sobre el store.

## 5. Texturizado (flujo independiente)

> Forma y textura están **desligadas**: este flujo opera sobre el modelo ya
> construido, asignando texturas por face.

- [ ] **Texturas en disco** en `textures/`, editables; se **pregeneran** al
      iniciar si faltan.
- [ ] Cargador de texturas + paleta de texturas predefinidas en la UI.
- [ ] Modo "pintar face": clic en una cara del viewport → asigna la textura
      seleccionada a ese `faceId`.
- [ ] Persistencia del mapa `faceId → texturaId` en el modelo.

## 6. Compilación a BSP (`server/compile/` — lado servidor Node)

El navegador **no** ejecuta binarios: envía el modelo al servidor por la API y
recibe el `.bsp` + logs. Replicar el pipeline probado de `editor-map`:

- [ ] **API del servidor**: endpoint `POST /compile` (o mensaje WebSocket) que
      recibe el modelo JSON; devuelve el `.bsp` y emite logs por streaming.
- [ ] **`mapWriter`**: del modelo → fichero `.map` (Valve 220). Reusar la
      lógica de [`editor-map/src/main/mapWriter.js`](D:\code\ultimata\editor-map\src\main\mapWriter.js)
      y `tileBrushes.js`.
- [ ] **`wadWriter` / `texturesWadBuilder`**: empaqueta las texturas de
      `textures/` en un WAD que qbsp pueda resolver.
- [ ] **`compileTools`**: invoca `qbsp → vis → light` desde `bin/`,
      streaming de logs línea a línea, parar al primer exit code ≠ 0.
      Reusar flags de [`editor-map/src/main/compileTools.js`](D:\code\ultimata\editor-map\src\main\compileTools.js)
      (`-bsp2 -worldextent 32768 -leaktest`, perfiles `flat`/`hq`).
- [ ] Salida: `.bsp` + panel de log en la UI (logs llegan vía la API).

## 7. Librerías

- **Código propio:** copiar de los proyectos referenciados y otros de
  `d:\code` (son nuestros). Preferido frente a añadir dependencias externas.
- **Código externo (referencia):** clonar/descargar a `ref/` para consultar,
  no como dependencia instalada.
- **Dependencias instaladas:** vía **pnpm**, respetando la antigüedad mínima de
  3 días (`minimumReleaseAge`, ver §0). Lockfile commiteado.

## 8. Tests (`tests/`)

- [ ] Unit: generación de brushes por módulo (geometría correcta).
- [ ] Unit: serialización/deserialización del modelo.
- [ ] Unit: `mapWriter` produce `.map` válido para un modelo mínimo.
- [ ] Integración: compilar un cubo simple a `.bsp` y validar con `bspinfo`.

## 9. Hitos

1. **MVP geometría** — colocar cubos en grid + render (secciones 1–4).
2. **MVP compilación** — exportar `.map` y compilar a `.bsp` un modelo
   simple (sección 6).
3. **Texturizado** — paleta + pintar faces + WAD (sección 5).
4. **Catálogo completo** — rampas, bevels y demás (sección 3).
