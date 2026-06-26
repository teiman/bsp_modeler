/**
 * Emisor de brushes Valve 220 a partir de las CARAS instanciadas del modelo.
 *
 * Cada cara llega como poligono CCW visto DESDE FUERA del solido (la convencion
 * del editor / OpenGL). qbsp define el plano de una cara con 3 puntos en orden
 * HORARIO visto desde fuera (la normal apunta hacia fuera, el solido queda
 * detras). Por eso tomamos 3 vertices del poligono en orden INVERSO.
 *
 * Sintaxis de cara Valve 220:
 *   ( p1 ) ( p2 ) ( p3 ) tex [ ux uy uz uOff ] [ vx vy vz vOff ] rot uScale vScale
 *
 * Adaptado de editor-map/src/shared/tileBrushes.js (boxBrush), generalizado a
 * caras arbitrarias.
 */

import { faceAxes } from '../../src/core/faceUV.js'
import { wadName } from './textures.js'

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }

const n0 = (x) => (Object.is(x, -0) ? 0 : x)
const round = (x) => Math.round(x * 10000) / 10000
const fmt = (p) => `${n0(round(p[0]))} ${n0(round(p[1]))} ${n0(round(p[2]))}`
const num = (x) => n0(round(x))

/**
 * Una cara del .map. `ft` = { tex, scale:[su,sv], offset:[ou,ov], rot } — los
 * MISMOS parametros que el preview (core/faceUV.js). Emitimos los ejes ya
 * rotados (faceAxes) con rotacion 0 en el .map, asi qbsp produce exactamente lo
 * que se ve en el editor.
 *
 * Valve 220:
 *   ( p1 ) ( p2 ) ( p3 ) tex [ ux uy uz uOff ] [ vx vy vz vOff ] rot uScale vScale
 */
export function faceLine(verts, normal, ft) {
  const p1 = verts[0], p2 = verts[2], p3 = verts[1] // CCW -> CW (3 primeros invertidos)
  // Nombre canonico (<=15 chars) — debe coincidir con el del WAD.
  const tex = wadName((ft && ft.tex) || 'default')
  const axes = faceAxes(normal, ft || {})
  const uScale = ft && ft.scale ? ft.scale[0] : 1
  const vScale = ft && ft.scale ? ft.scale[1] : 1
  // Quake calcula texel = dot(p, axis)/scale + offset, anclado al ORIGEN del
  // mundo. El preview, en cambio, ancla la textura a la ESQUINA (minimo) de la
  // cara. Para que coincidan (WYSIWYG), horneamos ese anclaje en el offset:
  // restamos el minimo de dot(p,axis)/scale sobre la cara. Asi el texel 0 cae
  // en la esquina de la cara, igual que en el editor — sin el desfase de medio
  // tile que aparecia al estar las caras centradas en el origen de celda.
  const dot = (p, a) => p[0] * a[0] + p[1] * a[1] + p[2] * a[2]
  let minU = Infinity, minV = Infinity
  for (const p of verts) {
    minU = Math.min(minU, dot(p, axes.u) / uScale)
    minV = Math.min(minV, dot(p, axes.v) / vScale)
  }
  const uOff = (ft && ft.offset ? ft.offset[0] : 0) - minU
  const vOff = (ft && ft.offset ? ft.offset[1] : 0) - minV
  return (
    `( ${fmt(p1)} ) ( ${fmt(p2)} ) ( ${fmt(p3)} ) ${tex} ` +
    `[ ${num(axes.u[0])} ${num(axes.u[1])} ${num(axes.u[2])} ${num(uOff)} ] ` +
    `[ ${num(axes.v[0])} ${num(axes.v[1])} ${num(axes.v[2])} ${num(vOff)} ] ` +
    `0 ${num(uScale)} ${num(vScale)}`
  )
}

/**
 * Brush a partir de una lista de caras instanciadas [{ faceId, verts, normal }]
 * y texOf(faceId) -> { tex, scale, offset, rot } (o un string = solo el nombre).
 */
export function brushFromFaces(faces, texOf) {
  const lines = faces.map((f) => {
    const normal = f.normal || norm(cross(sub(f.verts[1], f.verts[0]), sub(f.verts[2], f.verts[0])))
    let ft = texOf(f.faceId)
    if (typeof ft === 'string') ft = { tex: ft }
    return faceLine(f.verts, normal, ft)
  })
  return '{\n' + lines.join('\n') + '\n}'
}
