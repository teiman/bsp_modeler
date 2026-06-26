<script setup>
/**
 * Viewport 3D: canvas WebGL + barra de pips de altura + indicador de capa.
 * Replica la experiencia de modules_editor:
 *   - navegacion libre arriba/abajo por capas (pips laterales, teclas [ ]),
 *   - rejilla de referencia en la capa activa,
 *   - la camara sigue la capa, el picking cae sobre el plano de la capa,
 *   - fantasma del bloque + cursor + guia de caida.
 * En modo 'paint' resalta la cara bajo el cursor y la pinta al clic.
 */
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import { store } from '../store.js'
import { Renderer } from '../gl/renderer.js'
import { buildMesh } from '../gl/meshBuilder.js'
import { buildGhost } from '../gl/ghost.js'
import { buildAtlas, DEFAULT_TEXTURE } from '../gl/atlas.js'
import { instanceModel } from '../core/instance.js'
import { isMarker } from '../blocks/catalog.js'

const canvas = ref(null)

// Editor del texto de un ANCLA (marcador). El texto se escribe como `classname`
// de la entidad invisible que el compilador mete en el .bsp.
// El editor NO aparece solo: con el cursor sobre un ancla, pulsar "e" lo abre
// fijado a ESE bloque. Se cierra con Escape / Enter / al perder el foco.
const hoverAnchor = computed(() => {
  void store.dirty // depender del modelo para recomputar tras editar/borrar
  // Con las anclas ocultas no se interactua con ellas (no se ven, no se editan).
  if (store.mode !== 'build' || !store.showAnchors || !store.hoverCell) return null
  const b = store.model.blocks.find(
    (x) => x.cell[0] === store.hoverCell[0] && x.cell[1] === store.hoverCell[1] && x.cell[2] === store.hoverCell[2],
  )
  return b && isMarker(b.key) ? b : null
})

// Ancla en edicion: bloque fijado al pulsar "e" (independiente del hover, para
// poder mover el cursor mientras escribes). El input lo reflejamos por id.
const editAnchorId = ref(null)
const anchorInput = ref(null)
const editAnchor = computed(() => {
  void store.dirty
  if (editAnchorId.value == null) return null
  return store.model.blocks.find((x) => x.id === editAnchorId.value) || null
})
function openAnchorEditor() {
  const a = hoverAnchor.value
  if (!a) return
  editAnchorId.value = a.id
  // esperar a que el input se monte para enfocarlo y seleccionar el texto
  requestAnimationFrame(() => {
    const el = anchorInput.value
    if (el) { el.focus(); el.select() }
  })
}
function closeAnchorEditor() { editAnchorId.value = null }
function onAnchorLabel(e) {
  if (editAnchor.value) store.setBlockLabel(editAnchor.value.id, e.target.value)
}
let renderer = null
let raf = 0
let dragging = false, lastX = 0, lastY = 0, movedWhileDown = false
let hoverX = 0, hoverY = 0 // ultima posicion del cursor sobre el canvas (para atajos)
let atlasRects = { [DEFAULT_TEXTURE]: [0, 0, 1, 1] }

// Pips: rango fijo amplio que se extiende solo si trabajas mas arriba/abajo.
const PIP_TOP_BASE = 16, PIP_BOTTOM_BASE = -3
const pips = computed(() => {
  const cur = store.placeLayer
  const top = Math.max(PIP_TOP_BASE, cur), bottom = Math.min(PIP_BOTTOM_BASE, cur)
  const list = []
  for (let z = top; z >= bottom; z--) list.push(z)
  return list
})

const gridSize = computed(() => store.model.cellSize)

function gridFaces() {
  // mapa faceId -> { verts } para resaltar la cara bajo el cursor en modo pintar.
  // Omite los marcadores cuando estan ocultos: si no se ven, no se pintan.
  const m = new Map()
  for (const inst of instanceModel(store.model)) {
    if (!store.showAnchors && isMarker(inst.block.key)) continue
    for (const brush of inst.brushes)
      for (const face of brush) m.set(face.faceId, face.verts)
  }
  return m
}
let faceVerts = new Map()

function rebuildMesh() {
  if (!renderer) return
  renderer.setMesh(buildMesh(store.model, atlasRects, { showAnchors: store.showAnchors }))
  faceVerts = gridFaces()
}

function rebuildAtlas() {
  // Carga las imagenes de textura y arma el atlas para el preview.
  const imgs = store.textures.filter((t) => t.image)
  const atlas = buildAtlas(imgs, 64)
  atlasRects = atlas.rects
  renderer.setAtlas(atlas.canvas)
  rebuildMesh()
}

function pointerCell(e) {
  const rect = canvas.value.getBoundingClientRect()
  const px = e.clientX - rect.left, py = e.clientY - rect.top
  const layer = store.placeLayer
  const pt = renderer.pickGroundPoint(px, py, layer * gridSize.value)
  if (!pt) return null
  const g = gridSize.value
  return [Math.round(pt[0] / g), Math.round(pt[1] / g), layer]
}

function pointerFace(e) {
  const rect = canvas.value.getBoundingClientRect()
  return renderer.pickFace(e.clientX - rect.left, e.clientY - rect.top)
}

function onPointerMove(e) {
  const r = canvas.value.getBoundingClientRect()
  hoverX = e.clientX - r.left; hoverY = e.clientY - r.top
  if (dragging) {
    const dx = e.clientX - lastX, dy = e.clientY - lastY
    lastX = e.clientX; lastY = e.clientY
    if (Math.abs(dx) + Math.abs(dy) > 2) movedWhileDown = true
    renderer.orbit(-dx * 0.01, -dy * 0.01)
    return
  }
  if (store.mode === 'paint') {
    store.hoverFace = pointerFace(e)
    store.hoverCell = null
  } else {
    store.hoverCell = pointerCell(e)
    store.hoverFace = null
  }
}

function onPointerDown(e) {
  if (e.button === 1 || e.button === 2 || e.shiftKey) {
    dragging = true; movedWhileDown = false; lastX = e.clientX; lastY = e.clientY
    return
  }
}

function onClick(e) {
  if (movedWhileDown) { movedWhileDown = false; return }
  if (store.mode === 'paint') {
    const fid = pointerFace(e)
    if (fid) store.paintFace(fid, e.altKey ? null : store.activeTexture)
    return
  }
  if (e.altKey) {
    // Borrar: prioriza el bloque cuya cara esta bajo el cursor (picking 3D real,
    // funciona en cualquier capa). Asi se puede quitar una pieza aunque este en
    // una capa distinta de la activa. Si el rayo no toca ningun solido, cae al
    // borrado por celda en la capa activa.
    const fid = pointerFace(e)
    if (fid) { store.eraseById(fid); return }
    const cell = pointerCell(e)
    if (cell) store.erase(cell)
    return
  }
  const cell = pointerCell(e)
  if (cell) store.place(cell)
}

function onWheel(e) { e.preventDefault(); renderer.zoom(e.deltaY > 0 ? 1.1 : 0.9) }
function onPointerUp() { dragging = false }
function onContextMenu(e) { e.preventDefault() }

function onKey(e) {
  if (e.target.tagName === 'INPUT') return
  // La rotacion actua sobre el bloque bajo el cursor si lo hay; si no, sobre la
  // orientacion de colocacion (el fantasma).
  const target = store.mode === 'build' ? store.hoverCell : null
  if (e.key === 'Delete' || e.key === 'Backspace') {
    // Suprimir: borra el bloque bajo el cursor (cara con picking 3D en cualquier
    // capa; si no hay, la celda hover en la capa activa).
    e.preventDefault()
    store.eraseHover(renderer.pickFace(hoverX, hoverY))
  }
  else if (e.key === ']') store.layerUp()
  else if (e.key === '[') store.layerDown()
  else if (e.key === 'r' || e.key === 'R') store.rotate(target, 'z', e.shiftKey ? -1 : 1) // yaw
  else if (e.key === 'f' || e.key === 'F') store.rotate(target, 'x', e.shiftKey ? -1 : 1) // tumbar adelante/atras (boca abajo)
  else if (e.key === 'g' || e.key === 'G') store.rotate(target, 'y', e.shiftKey ? -1 : 1) // tumbar a los lados
  else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.shiftKey ? store.redo() : store.undo() }
  else if (e.key === 'c' || e.key === 'C') store.pickModule(renderer.pickFace(hoverX, hoverY)) // cuentagotas
  else if (e.key === 'b') store.setMode('build')
  else if (e.key === 'p') store.setMode('paint')
  else if (e.key === 'e' || e.key === 'E') { e.preventDefault(); openAnchorEditor() } // editar classname del ancla bajo el cursor
}

function loop() {
  if (renderer) {
    if (store.mode === 'build') {
      const cell = store.hoverCell
      renderer.setHighlight(cell, gridSize.value)
      renderer.setDropGuide(cell && cell[2] !== 0 ? cell : null, gridSize.value)
      renderer.setGhost(buildGhost(store.activeModule, cell, store.placeRot, gridSize.value))
      renderer.setFaceHighlight(null)
    } else {
      renderer.setHighlight(null)
      renderer.setDropGuide(null)
      renderer.setGhost(null)
      renderer.setFaceHighlight(store.hoverFace ? faceVerts.get(store.hoverFace) : null)
    }
    renderer.setFocusHeight(store.placeLayer * gridSize.value)
    renderer.setLayerGrid(store.placeLayer, gridSize.value, 8)
    renderer.render()
  }
  raf = requestAnimationFrame(loop)
}

onMounted(() => {
  renderer = new Renderer(canvas.value)
  renderer.setGrid(gridSize.value, 8)
  rebuildAtlas()
  window.addEventListener('keydown', onKey)
  raf = requestAnimationFrame(loop)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('keydown', onKey)
})

// Reconstruye la malla cuando cambia el modelo o las texturas.
watch(() => store.dirty, rebuildMesh)
watch(() => store.showAnchors, (on) => { if (!on) closeAnchorEditor(); rebuildMesh() })
watch(() => store.textures, rebuildAtlas, { deep: false })
</script>

<template>
  <div class="viewport">
    <canvas
      ref="canvas"
      @pointermove="onPointerMove"
      @pointerdown="onPointerDown"
      @pointerup="onPointerUp"
      @click="onClick"
      @wheel="onWheel"
      @contextmenu="onContextMenu"
    ></canvas>

    <!-- Indicador de altura -->
    <div class="height-indicator">Capa Z = {{ store.placeLayer }}</div>

    <!-- Editor del texto del ANCLA (-> classname de la entidad).
         Se abre al pulsar "e" con el cursor sobre un ancla; se cierra con Esc/Enter. -->
    <div v-if="editAnchor" class="anchor-edit">
      <label>Texto del ancla (classname):</label>
      <input
        ref="anchorInput"
        type="text"
        :value="editAnchor.label || ''"
        placeholder="frontal barrage"
        @change="onAnchorLabel"
        @keyup.enter="onAnchorLabel($event); $event.target.blur()"
        @keyup.esc="closeAnchorEditor"
        @blur="onAnchorLabel($event); closeAnchorEditor()"
      />
      <span class="anchor-dir">flecha → +X local · gira con R/F/G · Esc para cerrar</span>
    </div>

    <!-- Pista flotante sobre el ancla bajo el cursor: recuerda que "e" la edita. -->
    <div v-else-if="hoverAnchor" class="anchor-hint">
      Ancla: «{{ hoverAnchor.label || '(sin texto)' }}» — pulsa <kbd>E</kbd> para editar
    </div>

    <!-- Barra de pips -->
    <div class="pips">
      <button
        v-for="z in pips"
        :key="z"
        class="pip"
        :class="{ active: z === store.placeLayer, zero: z === 0 }"
        :title="`Ir a la capa ${z}`"
        @click="store.setLayer(z)"
      >{{ z }}</button>
    </div>

    <div class="viewport-hint">
      <span v-if="store.mode === 'build'">Clic: colocar · Alt+clic / Supr: borrar · C: copiar bloque · E: editar ancla · R/F/G: girar (yaw/volcar/lado) · Shift+tecla: al revés · [ ]: capa · Shift+arrastrar: orbitar</span>
      <span v-else>Clic: pintar cara · Alt+clic: quitar textura · [ ]: capa</span>
    </div>
  </div>
</template>

<style scoped>
.viewport { position: relative; flex: 1; min-width: 0; }
canvas { display: block; width: 100%; height: 100%; cursor: crosshair; }
.height-indicator {
  position: absolute; top: 10px; left: 12px;
  background: rgba(20, 18, 26, 0.8); color: #e7d9ff;
  padding: 4px 10px; border-radius: 6px; font: 600 13px/1 system-ui; letter-spacing: 0.3px;
  pointer-events: none;
}
.anchor-edit {
  position: absolute; top: 44px; left: 12px; z-index: 20;
  display: flex; flex-direction: column; gap: 4px;
  background: rgba(20, 18, 26, 0.92); border: 1px solid #6f4bd8; border-radius: 8px;
  padding: 8px 10px; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
}
.anchor-edit label { font: 600 11px/1 system-ui; color: #c7bce0; }
.anchor-edit input {
  width: 220px; background: #232029; color: #e6e0f2; border: 1px solid #3a3647;
  border-radius: 5px; padding: 5px 9px; font: 600 13px system-ui;
}
.anchor-edit input:focus { outline: none; border-color: #9b7bff; }
.anchor-dir { font: 10px/1.2 system-ui; color: #8a7fa6; }
.anchor-hint {
  position: absolute; top: 44px; left: 12px; z-index: 20;
  background: rgba(20, 18, 26, 0.92); border: 1px solid #6f4bd8; border-radius: 8px;
  padding: 6px 10px; font: 600 12px/1.2 system-ui; color: #d8cdf2;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5); pointer-events: none;
}
.anchor-hint kbd {
  background: #3a3647; color: #fff; border-radius: 4px; padding: 1px 6px;
  font: 700 11px/1 system-ui; border: 1px solid #5a5470;
}
.pips {
  position: absolute; top: 50%; right: 10px; transform: translateY(-50%);
  display: flex; flex-direction: column; gap: 2px; max-height: 80%; overflow: hidden;
}
.pip {
  width: 30px; padding: 2px 0; font: 600 11px/1 system-ui;
  background: rgba(40, 38, 50, 0.7); color: #9d93b0; border: 1px solid transparent;
  border-radius: 4px; cursor: pointer;
}
.pip.zero { color: #c7bce0; }
.pip.active { background: #6f4bd8; color: #fff; border-color: #9b7bff; }
.pip:hover { background: rgba(80, 70, 110, 0.9); }
.viewport-hint {
  position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%);
  background: rgba(20, 18, 26, 0.75); color: #b8acce;
  padding: 4px 12px; border-radius: 6px; font: 12px/1 system-ui; pointer-events: none; white-space: nowrap;
}
</style>
