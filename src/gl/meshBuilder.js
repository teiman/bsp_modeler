/**
 * Construye la malla de render a partir del modelo instanciado.
 *
 * Las UV se DERIVAN del texturizado por cara estilo BSP (core/faceUV.js): ejes
 * world-aligned + escala + offset + rotacion, la MISMA formula que el mapWriter
 * escribe en el .map. Por eso el preview coincide con lo que compila el BSP: no
 * hay proyeccion estilo-MDL ni distorsiones.
 *
 * El atlas del editor empaqueta las texturas en tiles; mapeamos la UV (en
 * baldosas) al rect del tile correspondiente. Anclamos al minimo de la cara
 * para que la baldosa sea continua a lo largo del quad (sin saltos de fract).
 */

import { instanceModel } from '../core/instance.js'
import { faceAxes, pointUV } from '../core/faceUV.js'
import { DEFAULT_TEXTURE } from './atlas.js'

/**
 * @param model        modelo (usa model.faceTextures: { tex, scale, offset, rot })
 * @param atlasRects   { [texturaId|DEFAULT]: [u0,v0,u1,v1] } de buildAtlas
 */
export function buildMesh(model, atlasRects) {
  const positions = []
  const uvs = []
  const normals = []
  const triFaceId = []
  const rects = atlasRects || { [DEFAULT_TEXTURE]: [0, 0, 1, 1] }

  for (const inst of instanceModel(model)) {
    for (const brush of inst.brushes) {
      for (const face of brush) {
        const ft = model.faceTextures[face.faceId]
        const texId = (ft && ft.tex) || DEFAULT_TEXTURE
        const rect = rects[texId] || rects[DEFAULT_TEXTURE] || [0, 0, 1, 1]
        // Inset de medio texel: con NEAREST, muestrear justo el borde del tile
        // dejaria ver el tile vecino del atlas como una linea fina.
        const inset = (rect[2] - rect[0]) / 64 / 2
        const u0 = rect[0] + inset, v0 = rect[1] + inset, u1 = rect[2] - inset, v1 = rect[3] - inset

        const axes = faceAxes(face.normal, ft || {})
        const v = face.verts
        // UV (en baldosas) de cada vertice por la formula BSP.
        const tile = v.map((p) => pointUV(p, axes, ft || {}))
        // Ancla al MINIMO real de la cara (no su floor): la baldosa empieza en 0
        // justo en la esquina de la cara. Para el caso 1:1 (cara de 64u, escala
        // 1) el span es exactamente 1.0 y llena el tile sin recortes ni saltos.
        // El atlas del editor no puede repetir, asi que mostramos una baldosa.
        let baseU = Infinity, baseV = Infinity
        for (const t of tile) { baseU = Math.min(baseU, t[0]); baseV = Math.min(baseV, t[1]) }

        for (let i = 1; i < v.length - 1; i++) {
          for (const idx of [0, i, i + 1]) {
            const p = v[idx]
            positions.push(p[0], p[1], p[2])
            const fu = tile[idx][0] - baseU
            const fv = tile[idx][1] - baseV
            uvs.push(u0 + fu * (u1 - u0), v0 + fv * (v1 - v0))
            normals.push(face.normal[0], face.normal[1], face.normal[2])
          }
          triFaceId.push(face.faceId)
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    normals: new Float32Array(normals),
    triFaceId,
    triCount: triFaceId.length,
  }
}
