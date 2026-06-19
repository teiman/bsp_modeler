/**
 * Las 24 orientaciones del cubo (grupo de rotaciones propias del cubo).
 *
 * Permiten colocar un bloque en cualquier orientacion alineada a ejes: una
 * rampa de pie, tumbada, o BOCA ABAJO; biseles y cuñas en cualquier esquina.
 *
 * Cada orientacion es una matriz 3x3 de enteros (filas) que transforma un punto
 * [x,y,z] y, por extension, los nombres de cara (±X/±Y/±Z) a su nueva cara.
 *
 * Las 4 primeras orientaciones (indices 0..3) son las rotaciones puras en Z
 * (yaw), identicas al modelo antiguo `rot 0..3` — asi los proyectos viejos se
 * cargan sin cambios.
 */

// Generadores: 90° alrededor de Z y de X (matrices que mapean ejes a ejes).
//  rotZ: x->y, y->-x   |   rotX: y->z, z->-y
function matMul(a, b) {
  const o = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      o[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]
  return o
}
const ID = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
const RZ = [[0, -1, 0], [1, 0, 0], [0, 0, 1]] // 90° en Z (CCW visto desde +Z)
const RX = [[1, 0, 0], [0, 0, -1], [0, 1, 0]] // 90° en X
const RY = [[0, 0, 1], [0, 1, 0], [-1, 0, 0]] // 90° en Y

function matEq(a, b) {
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (a[i][j] !== b[i][j]) return false
  return true
}

/**
 * Construye las 24 matrices unicas. Empezamos por las 4 de yaw puro (Z^0..Z^3)
 * para conservar la compatibilidad de indices, y luego completamos el resto
 * componiendo RZ/RX hasta tener las 24 del grupo.
 */
function buildOrientations() {
  const yaw = [ID, RZ, matMul(RZ, RZ), matMul(RZ, matMul(RZ, RZ))]
  const list = [...yaw]
  const has = (m) => list.some((x) => matEq(x, m))
  // BFS sobre los generadores partiendo de las de yaw.
  const queue = [...yaw]
  while (queue.length && list.length < 24) {
    const m = queue.shift()
    for (const g of [RZ, RX]) {
      const n = matMul(g, m)
      if (!has(n)) { list.push(n); queue.push(n) }
    }
  }
  return list
}

const MATS = buildOrientations()
export const ORIENTATION_COUNT = MATS.length // 24

/** Aplica la orientacion `o` (0..23) a un punto [x,y,z]. */
export function applyOrient(o, p) {
  const m = MATS[o & 31] || ID
  return [
    m[0][0] * p[0] + m[0][1] * p[1] + m[0][2] * p[2],
    m[1][0] * p[0] + m[1][1] * p[1] + m[1][2] * p[2],
    m[2][0] * p[0] + m[2][1] * p[1] + m[2][2] * p[2],
  ]
}

/** Indice de la orientacion identidad. */
export const ORIENT_IDENTITY = 0

/** Indice de la matriz `m` dentro de la tabla (o 0 si no esta). */
function indexOf(m) {
  for (let i = 0; i < MATS.length; i++) if (matEq(MATS[i], m)) return i
  return 0
}

/**
 * Compone una rotacion de 90° sobre la orientacion actual y devuelve el nuevo
 * indice. axis: 'z' (yaw, gira en horizontal), 'x' (tumbar adelante/atras),
 * 'y' (tumbar a los lados). dir = +1 / -1.
 */
export function rotateOrientation(o, axis, dir = 1) {
  const g = axis === 'x' ? RX : axis === 'y' ? RY : RZ
  let m = MATS[o] || ID
  const steps = dir < 0 ? 3 : 1 // -90° = tres veces +90°
  for (let s = 0; s < steps; s++) m = matMul(g, m)
  return indexOf(m)
}

// Vector unitario de cada cara canonica.
const FACE_VEC = {
  '+X': [1, 0, 0], '-X': [-1, 0, 0],
  '+Y': [0, 1, 0], '-Y': [0, -1, 0],
  '+Z': [0, 0, 1], '-Z': [0, 0, -1],
}
const VEC_FACE = (v) => {
  for (const [name, fv] of Object.entries(FACE_VEC))
    if (fv[0] === v[0] && fv[1] === v[1] && fv[2] === v[2]) return name
  return null
}

/**
 * Nombre de cara tras aplicar la orientacion. Una cara canonica (±X/±Y/±Z) se
 * mueve al eje donde apunta su normal rotada; las caras no canonicas ('slope',
 * 'bevel', ...) conservan su nombre (siguen siendo unicas dentro del bloque).
 */
export function orientFaceName(name, o) {
  const v = FACE_VEC[name]
  if (!v) return name
  const r = applyOrient(o, v).map(Math.round)
  return VEC_FACE(r) || name
}
