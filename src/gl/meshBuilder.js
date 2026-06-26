/**
 * Construye la malla de render a partir del modelo instanciado.
 *
 * Las UV se DERIVAN del texturizado por cara estilo BSP (core/faceUV.js): ejes
 * + escala + offset + rotacion, la MISMA formula que el mapWriter escribe en el
 * .map. Por eso el preview coincide con lo que compila el BSP: no hay proyeccion
 * estilo-MDL ni distorsiones.
 *
 * El atlas del editor empaqueta las texturas en tiles. Emitimos por vertice la
 * UV en BALDOSAS (cruda, anclada al minimo de la cara) y el rect del tile; el
 * SHADER envuelve con fract() dentro del tile, asi una cara mayor de 1 baldosa
 * (p.ej. un ala diagonal) REPITE la textura en vez de salirse al tile vecino.
 */

import { instanceModel } from '../core/instance.js'
import { faceAxes, pointUV } from '../core/faceUV.js'
import { isMarker } from '../blocks/catalog.js'
import { DEFAULT_TEXTURE } from './atlas.js'

/**
 * @param model        modelo (usa model.faceTextures: { tex, scale, offset, rot })
 * @param atlasRects   { [texturaId|DEFAULT]: [u0,v0,u1,v1] } de buildAtlas
 * @param opts         { showAnchors } — si es false, omite los marcadores (anclas)
 *                     de la malla para quitar ruido visual. No afecta a la compilacion.
 */
export function buildMesh(model, atlasRects, opts = {}) {
  const showAnchors = opts.showAnchors !== false
  const positions = []
  const uvs = []          // UV en BALDOSAS (puede salirse de [0,1]); el shader la envuelve
  const tileRects = []    // rect del tile en el atlas [u0,v0,u1,v1] por vertice
  const normals = []
  const triFaceId = []
  const rects = atlasRects || { [DEFAULT_TEXTURE]: [0, 0, 1, 1] }

  for (const inst of instanceModel(model)) {
    if (!showAnchors && isMarker(inst.block.key)) continue // ocultar anclas (ruido visual)
    for (const brush of inst.brushes) {
      for (const face of brush) {
        const ft = model.faceTextures[face.faceId]
        const texId = (ft && ft.tex) || DEFAULT_TEXTURE
        const rect = rects[texId] || rects[DEFAULT_TEXTURE] || [0, 0, 1, 1]
        // Inset de medio texel: con NEAREST, muestrear justo el borde del tile
        // dejaria ver el tile vecino del atlas como una linea fina. El shader
        // envuelve dentro de [u0,v0]..[u1,v1].
        const inset = (rect[2] - rect[0]) / 64 / 2
        const r0 = rect[0] + inset, s0 = rect[1] + inset, r1 = rect[2] - inset, s1 = rect[3] - inset

        const axes = faceAxes(face.normal, ft || {})
        const v = face.verts
        // UV (en baldosas) de cada vertice por la formula BSP.
        const tile = v.map((p) => pointUV(p, axes, ft || {}))
        // Ancla al MINIMO real de la cara: la baldosa empieza en 0 justo en la
        // esquina de la cara. El caso 1:1 (cara de 64u, escala 1) da span 1.0.
        // Para caras mayores (alas diagonales) el span pasa de 1 y el shader
        // REPITE la textura (fract), como hace el BSP real — sin clampear ni
        // mezclar con tiles vecinos del atlas.
        let baseU = Infinity, baseV = Infinity
        for (const t of tile) { baseU = Math.min(baseU, t[0]); baseV = Math.min(baseV, t[1]) }

        for (let i = 1; i < v.length - 1; i++) {
          for (const idx of [0, i, i + 1]) {
            const p = v[idx]
            positions.push(p[0], p[1], p[2])
            uvs.push(tile[idx][0] - baseU, tile[idx][1] - baseV) // baldosa cruda
            tileRects.push(r0, s0, r1, s1)
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
    tileRects: new Float32Array(tileRects),
    normals: new Float32Array(normals),
    triFaceId,
    triCount: triFaceId.length,
  }
}
