/**
 * Instanciado: de un BLOQUE del modelo a su geometria en MUNDO.
 *
 * Toma las brushes en espacio de celda unitaria del catalogo, les aplica
 * rotacion en Z, escala por cellSize y traslada al centro de la celda. Cada
 * cara conserva su faceId estable (blockId + nombre de cara rotado) para que el
 * texturizado siga a la cara aunque el bloque se mueva o gire.
 *
 * Salida por cara: { faceId, name, verts:[[x,y,z]...], normal:[x,y,z] }.
 * De ahi el renderer saca triangulos y el mapWriter saca el plano del .map.
 */

import { buildModule } from '../blocks/catalog.js'
import { cellCenter } from './geometry.js'
import { applyOrient, orientFaceName } from './orientations.js'
import { faceId } from './model.js'

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }

/** Normal de un poligono CCW (regla de la mano derecha sobre los 3 primeros vert). */
function faceNormal(verts) {
  return norm(cross(sub(verts[1], verts[0]), sub(verts[2], verts[0])))
}

/**
 * Instancia un bloque -> { brushes: [[face,...], ...] } en mundo.
 * Cada face: { faceId, name, verts, normal }.
 */
export function instanceBlock(block, cellSize) {
  const brushesLocal = buildModule(block.key)
  const center = cellCenter(block.cell, cellSize)
  const o = block.rot | 0 // indice de orientacion (0..23)
  const toWorld = (p) => {
    const r = applyOrient(o, p)
    return [r[0] * cellSize + center[0], r[1] * cellSize + center[1], r[2] * cellSize + center[2]]
  }
  const brushes = brushesLocal.map((faces) =>
    faces.map((face) => {
      const verts = face.poly.map(toWorld)
      const name = orientFaceName(face.name, o)
      return { faceId: faceId(block.id, name), name, verts, normal: faceNormal(verts) }
    }),
  )
  return { brushes }
}

/** Instancia todos los bloques del modelo. Devuelve [{ block, brushes }, ...]. */
export function instanceModel(model) {
  return model.blocks.map((block) => ({ block, ...instanceBlock(block, model.cellSize) }))
}

/** Todos los faceId de un bloque (todas las caras de todas sus brushes). */
export function blockFaceIds(block, cellSize) {
  const ids = []
  for (const brush of instanceBlock(block, cellSize).brushes)
    for (const face of brush) ids.push(face.faceId)
  return ids
}
