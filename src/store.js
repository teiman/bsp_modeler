/**
 * Estado reactivo central del BSP Modeler.
 *
 * Mantiene el modelo (bloques + texturas por face), el modulo activo del
 * catalogo, la capa Z de colocacion, la celda/cara bajo el cursor, el modo
 * (construir | pintar) y la textura activa. El undo guarda snapshots
 * serializados del modelo.
 */

import { reactive } from 'vue'
import {
  createModel, placeBlock, removeBlock, rotateBlock, blockAtCell,
  setFaceTexture, serialize, deserialize,
} from './core/model.js'
import { MODULE_LIST } from './blocks/catalog.js'
import { rotateOrientation, ORIENT_IDENTITY } from './core/orientations.js'
import { blockFaceIds } from './core/instance.js'

const UNDO_LIMIT = 100
const AUTOSAVE_KEY = 'bsp_modeler:autosave'
const VIEW_KEY = 'bsp_modeler:view'

function loadAutosave() {
  try {
    const raw = typeof localStorage !== 'undefined' && localStorage.getItem(AUTOSAVE_KEY)
    return raw ? deserialize(JSON.parse(raw)) : null
  } catch { return null }
}

/** Estado de vista (capa, modulo, modo, textura) persistido para sobrevivir al refresco. */
function loadView() {
  try {
    const raw = typeof localStorage !== 'undefined' && localStorage.getItem(VIEW_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}
const _view = loadView()

export const store = reactive({
  model: loadAutosave() || createModel(),
  modules: MODULE_LIST,
  activeModule: _view.activeModule || 'cube',
  placeRot: _view.placeRot || ORIENT_IDENTITY, // orientacion (0..23) con la que se coloca
  placeLayer: _view.placeLayer || 0, // capa Z actual (celdas) — navegacion por pips
  hoverCell: null,        // celda bajo el cursor (modo construir)
  hoverFace: null,        // faceId bajo el cursor (modo pintar)
  mode: _view.mode || 'build', // 'build' | 'paint'
  paintWhole: _view.paintWhole || false, // pintar toda la pieza, no solo la cara
  textures: [],           // [{ id, image }] cargadas desde /api/textures
  activeTexture: _view.activeTexture || null, // texturaId activa para pintar
  dirty: 0,               // se incrementa en cada cambio (para watchers)
  fileName: _view.fileName || 'modelo', // nombre del modelo actual
  catalogOpen: false,     // overlay del catalogo visible

  _undo: [],
  _redo: [],

  // --- mutaciones ---
  _snapshot() {
    this._undo.push(JSON.stringify(serialize(this.model)))
    if (this._undo.length > UNDO_LIMIT) this._undo.shift()
    this._redo.length = 0
  },
  _touch() {
    this.dirty++
    try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serialize(this.model))) } catch {}
  },
  /** Persiste el estado de vista (capa, modulo, modo, textura) para el refresco. */
  _saveView() {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({
        placeLayer: this.placeLayer, activeModule: this.activeModule,
        mode: this.mode, activeTexture: this.activeTexture, placeRot: this.placeRot,
        paintWhole: this.paintWhole, fileName: this.fileName,
      }))
    } catch {}
  },

  setModule(key) { this.activeModule = key; this._saveView() },
  setMode(m) { this.mode = m; this.hoverCell = null; this.hoverFace = null; this._saveView() },
  setActiveTexture(id) { this.activeTexture = id; this._saveView() },
  setPaintWhole(v) { this.paintWhole = !!v; this._saveView() },

  place(cell) {
    this._snapshot()
    placeBlock(this.model, this.activeModule, cell, this.placeRot)
    this._touch()
  },
  erase(cell) {
    if (!blockAtCell(this.model, cell)) return
    this._snapshot()
    removeBlock(this.model, cell)
    this._touch()
  },
  setPlaceRot(o) { this.placeRot = o; this._saveView() },
  /**
   * Rota 90° sobre un eje. axis: 'z' (yaw), 'x' (tumbar adelante/atras —
   * sirve para poner una rampa boca abajo), 'y' (tumbar a los lados).
   * Si hay bloque en la celda lo rota a el; si no, rota la orientacion de
   * colocacion (el fantasma).
   */
  rotate(cell, axis = 'z', dir = 1) {
    if (!blockAtCell(this.model, cell)) {
      this.setPlaceRot(rotateOrientation(this.placeRot, axis, dir))
      return
    }
    this._snapshot()
    rotateBlock(this.model, cell, axis, dir)
    this._touch()
  },
  paintFace(faceId, texturaId) {
    if (!faceId) return
    this._snapshot()
    if (this.paintWhole) {
      // Pinta TODA la pieza: del faceId "<blockId>:<cara>" saco el bloque y
      // aplico la textura a todas sus caras.
      const blockId = faceId.slice(0, faceId.indexOf(':'))
      const block = this.model.blocks.find((b) => b.id === blockId)
      if (block) {
        for (const fid of blockFaceIds(block, this.model.cellSize)) {
          setFaceTexture(this.model, fid, texturaId)
        }
      }
    } else {
      setFaceTexture(this.model, faceId, texturaId)
    }
    this._touch()
  },

  // --- capa Z (pips) ---
  setLayer(z) { this.placeLayer = z; this._saveView() },
  layerUp() { this.placeLayer++; this._saveView() },
  layerDown() { this.placeLayer--; this._saveView() },

  // --- undo / redo ---
  undo() {
    if (!this._undo.length) return
    this._redo.push(JSON.stringify(serialize(this.model)))
    this.model = deserialize(JSON.parse(this._undo.pop()))
    this._touch()
  },
  redo() {
    if (!this._redo.length) return
    this._undo.push(JSON.stringify(serialize(this.model)))
    this.model = deserialize(JSON.parse(this._redo.pop()))
    this._touch()
  },

  // --- proyecto ---
  setFileName(name) { this.fileName = (name || 'modelo').trim() || 'modelo'; this._saveView() },
  newModel() { this._snapshot(); this.model = createModel(); this.setFileName('modelo'); this._touch() },
  loadProject(data, name) {
    this._snapshot()
    this.model = deserialize(data)
    if (name) this.setFileName(name)
    this._touch()
  },
  exportProject() { return serialize(this.model) },
  isEmpty() { return this.model.blocks.length === 0 },
  setTextures(list) {
    this.textures = list
    if (!this.activeTexture && list.length) this.activeTexture = list[0].id
  },

  // --- catalogo ---
  openCatalog() { this.catalogOpen = true },
  closeCatalog() { this.catalogOpen = false },
})
