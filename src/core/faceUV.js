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
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }

// Una normal se considera ALINEADA A EJE si una de sus componentes domina
// claramente (cara recta: +Z, -X, ...). Si dos componentes son comparables, la
// cara es DIAGONAL (p.ej. un ala a 45° o un chaflan) y la proyeccion world-
// aligned la estira y la hace "saltar". Umbral: la 2ª componente < 0.85 * la 1ª.
function isAxisAligned(normal) {
  const a = [Math.abs(normal[0]), Math.abs(normal[1]), Math.abs(normal[2])].sort((p, q) => q - p)
  return a[1] < 0.85 * a[0]
}

/**
 * Ejes base U/V de una cara segun su normal.
 *
 * - Cara ALINEADA A EJE: ejes WORLD-ALIGNED por eje dominante (Valve 220 clasico).
 *   MISMO criterio que server/compile/brushes.js, para que preview y .map
 *   coincidan. Es lo que queremos para cubos/rampas rectas.
 * - Cara DIAGONAL (normal a 45°, etc.): ejes ALINEADOS A LA SUPERFICIE de la
 *   cara, no a mundo. Asi la textura sigue la inclinacion sin estirarse ni
 *   romper entre caras (p.ej. alas en X, chaflanes). U se toma horizontal dentro
 *   del plano cuando se puede; V = normal x U.
 */
export function baseAxes(normal) {
  if (isAxisAligned(normal)) {
    const ax = Math.abs(normal[0]), ay = Math.abs(normal[1]), az = Math.abs(normal[2])
    if (az >= ax && az >= ay) return { u: [1, 0, 0], v: [0, -1, 0] } // cara horizontal
    if (ax >= ay) return { u: [0, 1, 0], v: [0, 0, -1] }             // este/oeste
    return { u: [1, 0, 0], v: [0, 0, -1] }                           // norte/sur
  }
  // Cara diagonal: ejes en el plano de la cara. U = direccion "horizontal" sobre
  // la cara (perpendicular a la normal y al eje Z mundial); si la cara es casi
  // horizontal, usa el eje X mundial como semilla. V = U x normal (apunta hacia
  // "abajo" en el plano, coherente con la V world-aligned que va en -Z/-Y).
  const n = norm(normal)
  const seed = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  const u = norm(cross(seed, n))   // horizontal dentro del plano de la cara
  const v = norm(cross(u, n))      // completa la base; V hacia abajo en el plano
  return { u, v }
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
