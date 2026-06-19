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

const canvas = ref(null)
let renderer = null
let raf = 0
let dragging = false, lastX = 0, lastY = 0, movedWhileDown = false
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
  const m = new Map()
  for (const inst of instanceModel(store.model))
    for (const brush of inst.brushes)
      for (const face of brush) m.set(face.faceId, face.verts)
  return m
}
let faceVerts = new Map()

function rebuildMesh() {
  if (!renderer) return
  renderer.setMesh(buildMesh(store.model, atlasRects))
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
  const cell = pointerCell(e)
  if (!cell) return
  if (e.altKey) store.erase(cell)
  else store.place(cell)
}

function onWheel(e) { e.preventDefault(); renderer.zoom(e.deltaY > 0 ? 1.1 : 0.9) }
function onPointerUp() { dragging = false }
function onContextMenu(e) { e.preventDefault() }

function onKey(e) {
  if (e.target.tagName === 'INPUT') return
  // La rotacion actua sobre el bloque bajo el cursor si lo hay; si no, sobre la
  // orientacion de colocacion (el fantasma).
  const target = store.mode === 'build' ? store.hoverCell : null
  if (e.key === ']') store.layerUp()
  else if (e.key === '[') store.layerDown()
  else if (e.key === 'r' || e.key === 'R') store.rotate(target, 'z', e.shiftKey ? -1 : 1) // yaw
  else if (e.key === 'f' || e.key === 'F') store.rotate(target, 'x', e.shiftKey ? -1 : 1) // tumbar adelante/atras (boca abajo)
  else if (e.key === 'g' || e.key === 'G') store.rotate(target, 'y', e.shiftKey ? -1 : 1) // tumbar a los lados
  else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.shiftKey ? store.redo() : store.undo() }
  else if (e.key === 'b') store.setMode('build')
  else if (e.key === 'p') store.setMode('paint')
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
      <span v-if="store.mode === 'build'">Clic: colocar · Alt+clic: borrar · R/F/G: girar (yaw/volcar/lado) · Shift+tecla: al revés · [ ]: capa · Shift+arrastrar: orbitar</span>
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
