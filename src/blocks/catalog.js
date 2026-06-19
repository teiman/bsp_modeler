/**
 * Catalogo de modulos — las formas que sabemos hacer en un BSP.
 *
 * Cada modulo se define en ESPACIO DE CELDA UNITARIA: el cubo [-0.5, +0.5] en
 * los tres ejes (Z = arriba, como Quake). Al instanciarlo se escala por
 * cellSize y se traslada al centro de la celda.
 *
 * Un modulo = una o varias BRUSHES convexas. Cada brush es una lista de CARAS;
 * cada cara = { name, poly } donde:
 *   - name : nombre estable de la cara ('+Z','-Z','+X','-X','+Y','-Y','slope',
 *            'bevel', ...). Se usa para el faceId y para asignar textura.
 *   - poly : poligono (array de vertices [x,y,z]) en orden CCW visto DESDE FUERA
 *            del solido. De ahi salen tanto los triangulos del render como el
 *            plano de la cara para el .map (qbsp).
 *
 * De `poly` derivamos todo: la normal (para el plano del .map y el sombreado) y
 * los triangulos (fan) para el render. No duplicamos datos.
 */

// Medio lado de la celda unitaria.
const H = 0.5

// Los 8 vertices del cubo unitario, indexados:
//   0: ---  1: +--  2: ++-  3: -+-   (z = -H, base)
//   4: --+  5: +-+  6: +++  7: -++   (z = +H, techo)
const V = [
  [-H, -H, -H], [+H, -H, -H], [+H, +H, -H], [-H, +H, -H],
  [-H, -H, +H], [+H, -H, +H], [+H, +H, +H], [-H, +H, +H],
]

// Helper: cara como lista de indices de V (CCW desde fuera).
const f = (name, ...idx) => ({ name, poly: idx.map((i) => V[i]) })

/**
 * CUBO: 6 caras, una brush. CCW visto desde fuera en cada cara.
 *  +Z techo, -Z base, +X este, -X oeste, +Y norte, -Y sur.
 */
function cube() {
  return [[
    f('+Z', 4, 5, 6, 7),
    f('-Z', 3, 2, 1, 0),
    f('+X', 1, 2, 6, 5),
    f('-X', 3, 0, 4, 7),
    f('+Y', 2, 3, 7, 6),
    f('-Y', 0, 1, 5, 4),
  ]]
}

/**
 * RAMPA: cuña que sube de -Y (bajo) a +Y (alto). La cara superior inclinada es
 * 'slope'. Vertices del prisma triangular:
 *   base: 0,1,2,3 (z=-H)   alto trasero: 6,7 (z=+H, en y=+H)
 * Caras: base (-Z), trasera (+Y), dos triangulos laterales (+X / -X) y la rampa.
 */
function ramp() {
  return [[
    f('-Z', 3, 2, 1, 0),                  // base
    f('+Y', 2, 3, 7, 6),                  // pared trasera vertical (alta)
    { name: 'slope', poly: [V[0], V[1], V[6], V[7]] }, // cara inclinada (de -Y bajo a +Y alto)
    { name: '+X', poly: [V[1], V[2], V[6]] },          // triangulo lateral este
    { name: '-X', poly: [V[3], V[0], V[7]] },          // triangulo lateral oeste
  ]]
}

/**
 * BEVEL (chaflan de esquina vertical): corta la arista +X/+Y del cubo con un
 * plano a 45°. Reemplaza esa esquina por la cara 'bevel'. Es un prisma de base
 * pentagonal extruido en Z.
 *
 * Base (z=-H), CCW: 0(-- ) 1(+-) m1(+ ,0) m2(0,+) 3(-+)  con
 *   m1 = (+H, 0, -H), m2 = (0, +H, -H) -> el corte une (+H,0) con (0,+H).
 */
function bevel() {
  const b0 = [-H, -H, -H], b1 = [+H, -H, -H], bm1 = [+H, 0, -H], bm2 = [0, +H, -H], b3 = [-H, +H, -H]
  const t0 = [-H, -H, +H], t1 = [+H, -H, +H], tm1 = [+H, 0, +H], tm2 = [0, +H, +H], t3 = [-H, +H, +H]
  return [[
    { name: '-Z', poly: [b3, bm2, bm1, b1, b0] },      // base (CCW desde abajo)
    { name: '+Z', poly: [t0, t1, tm1, tm2, t3] },      // techo (CCW desde arriba)
    { name: '-Y', poly: [b0, b1, t1, t0] },            // sur
    { name: '+X', poly: [b1, bm1, tm1, t1] },          // este (recortado)
    { name: 'bevel', poly: [bm1, bm2, tm2, tm1] },     // cara del chaflan a 45°
    { name: '+Y', poly: [bm2, b3, t3, tm2] },          // norte (recortado)
    { name: '-X', poly: [b3, b0, t0, t3] },            // oeste
  ]]
}

/**
 * CUÑA DE ESQUINA (corner wedge): tetra-ish que llena solo la mitad triangular
 * de la celda en planta (triangulo -X-Y .. +X-Y .. -X+Y), con techo inclinado.
 * Util para chaflanes de techo. Una brush.
 */
function cornerWedge() {
  // Base triangular en z=-H, vertice alto en (-H,-H,+H).
  const a = [-H, -H, -H], b = [+H, -H, -H], c = [-H, +H, -H]
  const top = [-H, -H, +H]
  return [[
    { name: '-Z', poly: [c, b, a] },           // base (CCW desde abajo)
    { name: '-Y', poly: [a, b, top] },         // pared sur con el alto
    { name: '-X', poly: [c, a, top] },         // pared oeste con el alto
    { name: 'slope', poly: [b, c, top] },      // cara inclinada (hipotenusa)
  ]]
}

// --- Helpers para props multi-brush -------------------------------------------

/**
 * Brush de caja AABB en espacio de celda unitaria, [min..max] por eje (en
 * unidades de celda, normalmente dentro de [-0.5, +0.5]). prefix da nombres de
 * cara unicos cuando un modulo tiene varias cajas (p.ej. 'body+Z').
 */
function boxBrush({ x0, y0, z0, x1, y1, z1 }, prefix = '') {
  const c = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ]
  const ff = (name, ...idx) => ({ name: prefix + name, poly: idx.map((i) => c[i]) })
  return [
    ff('+Z', 4, 5, 6, 7), ff('-Z', 3, 2, 1, 0),
    ff('+X', 1, 2, 6, 5), ff('-X', 3, 0, 4, 7),
    ff('+Y', 2, 3, 7, 6), ff('-Y', 0, 1, 5, 4),
  ]
}

/**
 * Prisma regular de `sides` lados extruido en Z (cilindro facetado): UNA brush
 * convexa. radius en unidades de celda; z0/z1 los extremos en Z. Las caras
 * laterales se llaman `${prefix}s0..sN`, las tapas `${prefix}+Z`/`-Z`.
 * `sides` <= 8 para no pasarse de planos en qbsp.
 */
function prismZ({ sides = 8, radius = 0.4, z0 = -H, z1 = +H, prefix = '' }) {
  const ring = (z) => Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2
    return [Math.cos(a) * radius, Math.sin(a) * radius, z]
  })
  const bot = ring(z0), top = ring(z1)
  const faces = [
    { name: prefix + '+Z', poly: [...top] },                 // tapa superior (CCW desde +Z)
    { name: prefix + '-Z', poly: [...bot].reverse() },       // tapa inferior (CCW desde -Z)
  ]
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides
    // Cara lateral CCW desde fuera: bot[i], bot[j], top[j], top[i].
    faces.push({ name: `${prefix}s${i}`, poly: [bot[i], bot[j], top[j], top[i]] })
  }
  return faces
}

/**
 * TUBO / TUBERIA: un segmento de tuberia recto a lo largo de Z, con dos
 * bridas (flanges) en los extremos. 3 brushes convexas: cuerpo + 2 bridas.
 * Compila a BSP como cualquier otro solido.
 */
function pipe() {
  const body = prismZ({ sides: 8, radius: 0.26, z0: -H, z1: +H, prefix: 'tube' })
  const flangeBot = prismZ({ sides: 8, radius: 0.38, z0: -H, z1: -H + 0.12, prefix: 'fa' })
  const flangeTop = prismZ({ sides: 8, radius: 0.38, z0: +H - 0.12, z1: +H, prefix: 'fb' })
  return [body, flangeBot, flangeTop]
}

/**
 * MOTOR: prop industrial. 5 brushes convexas:
 *   - bloque (caja),
 *   - cabeza cilindrica encima,
 *   - dos chimeneas de escape,
 *   - base/peana.
 * Todo alineado a ejes y convexo -> compila a BSP.
 */
function engine() {
  const base = boxBrush({ x0: -H, y0: -H, z0: -H, x1: +H, y1: +H, z1: -H + 0.12 }, 'base')
  const block = boxBrush({ x0: -0.4, y0: -0.32, z0: -H + 0.12, x1: 0.4, y1: 0.32, z1: 0.15 }, 'body')
  const head = prismZ({ sides: 8, radius: 0.26, z0: 0.15, z1: 0.4, prefix: 'head' })
  const exhaustA = boxBrush({ x0: -0.28, y0: -0.1, z0: 0.4, x1: -0.12, y1: 0.1, z1: +H }, 'exA')
  const exhaustB = boxBrush({ x0: 0.12, y0: -0.1, z0: 0.4, x1: 0.28, y1: 0.1, z1: +H }, 'exB')
  return [base, block, head, exhaustA, exhaustB]
}

export const MODULES = {
  cube:        { key: 'cube',        label: 'Cubo',          category: 'Solidos', build: cube },
  ramp:        { key: 'ramp',        label: 'Rampa',         category: 'Rampas',  build: ramp },
  bevel:       { key: 'bevel',       label: 'Bisel',         category: 'Biseles', build: bevel },
  cornerWedge: { key: 'cornerWedge', label: 'Cuña esquina',  category: 'Biseles', build: cornerWedge },
  pipe:        { key: 'pipe',        label: 'Tubería',       category: 'Props',   build: pipe },
  engine:      { key: 'engine',      label: 'Motor',         category: 'Props',   build: engine },
}

export const MODULE_LIST = Object.values(MODULES)

/** Devuelve las brushes (en espacio de celda unitaria) de un modulo por key. */
export function buildModule(key) {
  const def = MODULES[key]
  if (!def) throw new Error(`Modulo desconocido: ${key}`)
  return def.build()
}
