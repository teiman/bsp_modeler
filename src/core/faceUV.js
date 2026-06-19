/**
 * Texturizado por cara estilo BSP (Valve 220), fuente UNICA de verdad.
 *
 * En un BSP cada cara controla su textura de forma explicita: ejes U/V alineados
 * a mundo, escala, offset y rotacion. Esto NO son UVs estilo MDL (atadas al
 * vertice): se DERIVAN del plano de la cara con la misma formula que usa el
 * motor al cargar el .bsp. Por eso el preview del editor y el .map compilado
 * coinciden pixel a pixel — sin proyecciones inventadas ni distorsiones.
 *
 * Convencion Quake:
 *   uv_tile = ( dot(p, uAxis) / (texSize * uScale) ) + uOffset / texSize
 * con texSize = 64 (nuestras texturas). Con uScale = 1 y celda de 64u, una cara
 * de cubo recibe exactamente UNA textura (1:1), sin rotacion por defecto.
 */

export const TEX_SIZE = 64

function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }

/**
 * Ejes base U/V world-aligned segun el eje dominante de la normal. MISMO criterio
 * que server/compile/brushes.js (texAxes), para que preview y .map coincidan.
 */
export function baseAxes(normal) {
  const ax = Math.abs(normal[0]), ay = Math.abs(normal[1]), az = Math.abs(normal[2])
  if (az >= ax && az >= ay) return { u: [1, 0, 0], v: [0, -1, 0] } // cara horizontal
  if (ax >= ay) return { u: [0, 1, 0], v: [0, 0, -1] }             // este/oeste
  return { u: [1, 0, 0], v: [0, 0, -1] }                           // norte/sur
}

/** Rota los ejes U/V dentro del plano de la cara `deg` grados. */
function rotateAxes(u, v, deg) {
  if (!deg) return { u, v }
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r), s = Math.sin(r)
  return {
    u: [u[0] * c + v[0] * s, u[1] * c + v[1] * s, u[2] * c + v[2] * s],
    v: [-u[0] * s + v[0] * c, -u[1] * s + v[1] * c, -u[2] * s + v[2] * c],
  }
}

/**
 * Ejes U/V finales (ya rotados) de una cara, dados su normal y los params de
 * texturizado { rot }. Devuelve { u, v }.
 */
export function faceAxes(normal, params = {}) {
  const { u, v } = baseAxes(normal)
  return rotateAxes(u, v, params.rot || 0)
}

/**
 * UV (en baldosas, 0..1 por repeticion) de un punto de mundo sobre una cara.
 * @param p       punto [x,y,z] en mundo
 * @param axes    { u, v } de faceAxes
 * @param params  { scale:[su,sv], offset:[ou,ov] }
 */
export function pointUV(p, axes, params = {}) {
  const su = params.scale ? params.scale[0] : 1
  const sv = params.scale ? params.scale[1] : 1
  const ou = params.offset ? params.offset[0] : 0
  const ov = params.offset ? params.offset[1] : 0
  return [
    dot(p, axes.u) / (TEX_SIZE * su) + ou / TEX_SIZE,
    dot(p, axes.v) / (TEX_SIZE * sv) + ov / TEX_SIZE,
  ]
}
