/**
 * Construye la geometria del FANTASMA (bloque que se colocaria) para el
 * renderer: triangulos intercalados pos(3)+normal(3) en mundo. Reusa el
 * instanciado real, asi que el fantasma coincide exactamente con la pieza.
 */

import { instanceBlock } from '../core/instance.js'

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }

/** verts intercalados [x,y,z, nx,ny,nz, ...] o [] si no hay celda. */
export function buildGhost(key, cell, rot, cellSize) {
  if (!cell) return []
  const inst = instanceBlock({ id: '__ghost__', key, cell, rot }, cellSize)
  const out = []
  for (const brush of inst.brushes) {
    for (const face of brush) {
      const v = face.verts
      const n = norm(cross(sub(v[1], v[0]), sub(v[2], v[0])))
      for (let i = 1; i < v.length - 1; i++) {
        for (const p of [v[0], v[i], v[i + 1]]) out.push(p[0], p[1], p[2], n[0], n[1], n[2])
      }
    }
  }
  return out
}
