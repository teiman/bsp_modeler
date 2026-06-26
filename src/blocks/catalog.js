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
 * Prisma facetado a lo largo del eje X (el "hacia delante" de las naves).
 * radius en celda; x0/x1 los extremos. r1 permite afilar (cono/tronco): radio
 * en x1 distinto del de x0. Caras: tapas `${prefix}+X`/`-X`, laterales `s0..sN`.
 */
function prismX({ sides = 8, radius = 0.4, r1 = null, x0 = -H, x1 = +H, prefix = '' }) {
  const rEnd = r1 == null ? radius : r1
  const ring = (x, r) => Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2
    return [x, Math.cos(a) * r, Math.sin(a) * r]
  })
  const back = ring(x0, radius), front = ring(x1, rEnd)
  const faces = [
    { name: prefix + '+X', poly: [...front] },          // tapa delantera (CCW desde +X)
    { name: prefix + '-X', poly: [...back].reverse() }, // tapa trasera
  ]
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides
    faces.push({ name: `${prefix}s${i}`, poly: [back[i], front[i], front[j], back[j]] })
  }
  return faces
}

/**
 * FUSELAJE: segmento de casco octogonal a lo largo de X. La pieza base para
 * encadenar el cuerpo de una nave. Una brush.
 */
function fuselage() {
  return [prismX({ sides: 8, radius: 0.46, x0: -H, x1: +H, prefix: 'hull' })]
}

/**
 * CUBO CHAFLANADO (eje X): un cubo con las 4 ARISTAS LONGITUDINALES (las
 * paralelas a X) "matadas" a 45° -> seccion octogonal regular extruida en X.
 * Es el cuerpo de las fragatas (ver ref/naves): 4 caras rectas grandes
 * (+Y/-Y/+Z/-Z), 4 chaflanes diagonales y 2 tapas (+X/-X). Una brush convexa.
 *
 * Octagono REGULAR inscrito en el cuadrado [-H..+H]: cada esquina se corta a
 * c = H/(1+raiz2) del vertice, asi el lado recto y el diagonal quedan iguales.
 * Gira con R/F/G para orientarlo en Y o Z si quieres el cuerpo en otro eje.
 */
function chamferBox() {
  const c = H / (1 + Math.SQRT2) // ~0.2071: cuanto se come cada esquina
  const m = H - c                // ~0.2929: donde empieza el chaflan en cada lado
  // Octagono en el plano Y-Z, recorrido CCW visto desde +X (igual convencion
  // que prismX: el angulo crece de +Y hacia +Z). 8 vertices [y, z]:
  const ring2d = [
    [+H, -m], [+H, +m],          // cara +Y (recta)
    [+m, +H], [-m, +H],          // cara +Z (recta)
    [-H, +m], [-H, -m],          // cara -Y (recta)
    [-m, -H], [+m, -H],          // cara -Z (recta)
  ]
  // Nombres de cara entre vertice i y el siguiente (i -> i+1):
  //   los lados rectos heredan el nombre de la cara del cubo; los diagonales
  //   son chaflanes con nombre propio para poder texturizarlos aparte.
  const sideName = ['+Y', 'cYZ+', '+Z', 'cZY-', '-Y', 'cYZ-', '-Z', 'cZY+']
  const at = (x) => ring2d.map(([y, z]) => [x, y, z])
  const back = at(-H), front = at(+H)
  const faces = [
    { name: '+X', poly: [...front] },          // tapa delantera (CCW desde +X)
    { name: '-X', poly: [...back].reverse() }, // tapa trasera
  ]
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8
    // Cara lateral CCW desde fuera: back[i], back[j], front[j], front[i].
    faces.push({ name: sideName[i], poly: [back[i], back[j], front[j], front[i]] })
  }
  return [faces]
}

/**
 * SPIKE / PINCHO: cono afilado orientado libremente, de `base` (centro del
 * anillo gordo) a `apex` (la punta). Termina en una punta MINUSCULA (no exacta)
 * para que qbsp no degenere por planos coincidentes — igual criterio que el
 * morro. Una brush convexa: tapa trasera `${prefix}-` + caras `${prefix}s0..N`.
 *
 * base/apex en espacio de celda unitaria. radius = grosor del pincho en la base.
 */
function spike(base, apex, radius = 0.06, sides = 4, prefix = 'sp') {
  // Eje del pincho y dos vectores perpendiculares para el anillo de la base.
  const ax = [apex[0] - base[0], apex[1] - base[1], apex[2] - base[2]]
  const al = Math.hypot(ax[0], ax[1], ax[2]) || 1
  const dir = [ax[0] / al, ax[1] / al, ax[2] / al]
  // u = perpendicular a dir (elige el eje del mundo menos alineado para estabilidad).
  const up = Math.abs(dir[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
  const u = nrm(cross(up, dir)), v = cross(dir, u)
  // Anillo de la base, CCW mirado desde el apex hacia la base.
  const ring = Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2
    const cs = Math.cos(a) * radius, sn = Math.sin(a) * radius
    return [base[0] + u[0] * cs + v[0] * sn, base[1] + u[1] * cs + v[1] * sn, base[2] + u[2] * cs + v[2] * sn]
  })
  // Punta minuscula: pequeno anillo casi-puntual en el apex (mantiene convexidad
  // sin generar una punta degenerada). Lo retraemos un pelo sobre el eje.
  const tipR = radius * 0.12
  const tipBase = [apex[0] - dir[0] * 0.001, apex[1] - dir[1] * 0.001, apex[2] - dir[2] * 0.001]
  const tip = Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2
    const cs = Math.cos(a) * tipR, sn = Math.sin(a) * tipR
    return [tipBase[0] + u[0] * cs + v[0] * sn, tipBase[1] + u[1] * cs + v[1] * sn, tipBase[2] + u[2] * cs + v[2] * sn]
  })
  const faces = [
    { name: `${prefix}-`, poly: [...ring].reverse() }, // tapa de la base (mirando hacia -dir)
    { name: `${prefix}+`, poly: [...tip] },             // micro-tapa de la punta (mirando hacia +dir)
  ]
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides
    faces.push({ name: `${prefix}s${i}`, poly: [ring[i], ring[j], tip[j], tip[i]] })
  }
  return faces
}

/**
 * SPIKES: decoracion de 3 pinchos afilados inclinados hacia arriba y hacia
 * atras (-X), abiertos en abanico (ver ref/naves: aletas/antenas traseras de
 * la fragata). 3 brushes convexas, compila a BSP.
 */
function spikes() {
  // Apuntan hacia arriba (+Z) y atras (-X); el del medio mas alto, los de los
  // lados abiertos en Y. ANCLADOS AL SUELO: el centro de la base se eleva el
  // radio (r) para que el anillo no atraviese el plano z = -H (queda asentado).
  const r = 0.05
  const mk = (dy, len, lift) => spike(
    [-0.12, dy, -H + r],                       // base apoyada en el suelo
    [-0.40, dy * 1.6, -H + r + len * lift],    // punta (atras-arriba, abierta en Y)
    r, 4, `sk${dy < 0 ? 'L' : dy > 0 ? 'R' : 'C'}`,
  )
  return [
    mk(0, 1.0, 0.95),     // central, el mas alto
    mk(-0.16, 0.9, 0.9),  // izquierdo
    mk(0.16, 0.9, 0.9),   // derecho
  ]
}

/**
 * MORRO / CONO DE PROA: tronco-cono que afila hacia +X y termina casi en punta.
 * Una brush (afilado, no punta exacta, para que qbsp no degenere).
 */
function noseCone() {
  return [prismX({ sides: 8, radius: 0.46, r1: 0.06, x0: -H, x1: +H, prefix: 'nose' })]
}

/**
 * TOBERA / NOZZLE: cono de escape que se ABRE hacia -X (la parte trasera de un
 * motor). Una brush.
 */
function nozzle() {
  return [prismX({ sides: 8, radius: 0.12, r1: 0.46, x0: -H, x1: +H, prefix: 'noz' })]
}

/**
 * COCKPIT / CABINA: cuña con el frontal inclinado (parabrisas) que sube de
 * delante (-X bajo) a atras (+X alto). Prisma triangular en X. Una brush.
 */
function cockpit() {
  // Base 0,1,2,3 (z=-H). Alto trasero en x=+H (vertices 6,7 a z=+H).
  return [[
    f('-Z', 3, 2, 1, 0),                              // base
    f('+X', 1, 2, 6, 5),                              // pared trasera vertical (alta)
    { name: 'glass', poly: [V[0], V[3], V[6], V[5]] }, // parabrisas inclinado (-X bajo -> +X alto)...
    { name: '+Y', poly: [V[2], V[3], V[6]] },          // triangulo lateral norte
    { name: '-Y', poly: [V[1], V[0], V[5]] },          // triangulo lateral sur
  ]]
}

/**
 * ALETA / FIN: aleta delgada vertical barrida (plano X-Z), fina en Y. Sirve de
 * aleron de cola o ala. Prisma triangular extruido en Y. Una brush.
 */
function fin() {
  const t = 0.08 // medio grosor en Y
  // Triangulo en el plano X-Z: (-H,-H) atras-abajo, (+H,-H) delante-abajo, (-H,+H) atras-arriba.
  const tri = [[-H, -H], [+H, -H], [-H, +H]] // [x, z]
  const at = (sgn) => tri.map(([x, z]) => [x, sgn * t, z])
  const a = at(-1), b = at(+1) // caras -Y y +Y
  return [[
    { name: '-Y', poly: [a[0], a[2], a[1]] },         // cara izquierda (CCW desde -Y)
    { name: '+Y', poly: [b[0], b[1], b[2]] },          // cara derecha (CCW desde +Y)
    { name: '-Z', poly: [a[0], a[1], b[1], b[0]] },    // borde inferior
    { name: 'swept', poly: [a[1], a[2], b[2], b[1]] }, // borde barrido (hipotenusa)
    { name: '-X', poly: [a[2], a[0], b[0], b[2]] },    // borde trasero
  ]]
}

/**
 * ALA DIAGONAL: placa grande y fina (fina en Y) en el plano X-Z, con el borde
 * superior BARRIDO en diagonal — sube de delante (-X) a atras (+X). Pensada para
 * el patron de "alas en X": coloca una y rota su gemela 180° (R/F/G) para que
 * crucen vistas de frente. Una brush convexa (cuadrilatero extruido en Y).
 *
 *   perfil en X-Z (vista lateral):      +Z _______
 *                                          |      /|
 *                                          |     / |   borde 'swept' (diagonal)
 *                                          |    /  |
 *                                       -Z |___/___|  -X .......... +X
 *
 * El ala llena toda la celda en X y Z salvo la esquina superior-delantera, que
 * el barrido recorta. Asi al apilar/rotar las piezas las diagonales encajan.
 */
function wingDiagonal() {
  const t = 0.06       // medio grosor en Y (placa fina)
  const lo = -H + 0.10 // arranque del barrido en la cara delantera (-X), cerca del suelo
  // Cuadrilatero en el plano X-Z, CCW: trasero-abajo, delante-abajo, delante-bajo
  // del barrido, trasero-arriba. La diagonal va de (-X, lo) a (+X, +H).
  const quad = [
    [-H, -H],   // trasero-abajo
    [+H, -H],   // delante-abajo
    [+H, +H],   // delante-arriba (la diagonal sube hasta aqui)
    [-H, lo],   // trasero, a media altura -> de aqui sale el barrido
  ] // [x, z]
  const at = (sgn) => quad.map(([x, z]) => [x, sgn * t, z])
  const a = at(-1), b = at(+1) // caras -Y (izquierda) y +Y (derecha)
  return [[
    { name: '-Y', poly: [a[0], a[1], a[2], a[3]] },          // cara izquierda (CCW desde -Y)
    { name: '+Y', poly: [b[0], b[3], b[2], b[1]] },          // cara derecha (CCW desde +Y)
    { name: '-Z', poly: [a[0], b[0], b[1], a[1]] },          // borde inferior
    { name: '+X', poly: [a[1], b[1], b[2], a[2]] },          // borde delantero (alto)
    { name: 'swept', poly: [a[2], b[2], b[3], a[3]] },       // borde superior BARRIDO (diagonal)
    { name: '-X', poly: [a[3], b[3], b[0], a[0]] },          // borde trasero (corto)
  ]]
}

/**
 * ALA EN PUNTA: placa grande y fina (fina en Y) en el plano X-Z que se AFILA a
 * una punta hacia delante (+X). Complementa a `wingDiagonal` en el patron en X:
 * la diagonal de una y la punta de otra cierran la silueta. Una brush convexa
 * (triangulo extruido en Y). Punta no exacta para no degenerar en qbsp.
 *
 *   perfil en X-Z (vista lateral):     +Z |\
 *                                          | \____
 *                                          |      \___  punta hacia +X
 *                                       -Z |__________\
 *                                          -X ....... +X
 */
function wingTip() {
  const t = 0.06       // medio grosor en Y (placa fina)
  const tip = +H - 0.02 // la punta no llega exacta al borde (evita plano degenerado)
  // Triangulo en el plano X-Z: base vertical en -X (de -H a +H en Z), vertice
  // (punta) hacia +X a media altura. CCW visto desde +Y.
  const tri = [
    [-H, -H],   // trasero-abajo
    [tip, 0],   // punta, a media altura entre los dos bordes traseros
    [-H, +H],   // trasero-arriba
  ] // [x, z]
  const at = (sgn) => tri.map(([x, z]) => [x, sgn * t, z])
  const a = at(-1), b = at(+1) // caras -Y y +Y
  return [[
    { name: '-Y', poly: [a[0], a[1], a[2]] },               // cara izquierda (CCW desde -Y)
    { name: '+Y', poly: [b[0], b[2], b[1]] },               // cara derecha (CCW desde +Y)
    { name: '-X', poly: [a[2], b[2], b[0], a[0]] },         // borde trasero (base)
    { name: 'edgeLo', poly: [a[0], b[0], b[1], a[1]] },     // borde inferior hacia la punta
    { name: 'edgeHi', poly: [a[1], b[1], b[2], a[2]] },     // borde superior hacia la punta
  ]]
}

/**
 * Extruye un POLIGONO 2D del plano Y-Z a lo largo del eje X (de x0 a x1),
 * generando una brush convexa (prisma). El poligono `ring2d` es una lista de
 * puntos [y, z] en orden CCW visto desde +X. Genera la tapa +X, la tapa -X y
 * una cara lateral por arista. `names` (opcional) da nombre a cada cara lateral
 * i->i+1; si falta, usa `${prefix}s{i}`.
 *
 * El poligono DEBE ser convexo (qbsp solo admite brushes convexas).
 */
function extrudeX(ring2d, x0, x1, prefix = '', names = null) {
  const back = ring2d.map(([y, z]) => [x0, y, z])   // tapa trasera (-X)
  const front = ring2d.map(([y, z]) => [x1, y, z])  // tapa delantera (+X)
  const raw = [
    { name: prefix + '+X', poly: [...front] },
    { name: prefix + '-X', poly: [...back] },
  ]
  for (let i = 0; i < ring2d.length; i++) {
    const j = (i + 1) % ring2d.length
    const nm = names ? names[i] : `${prefix}s${i}`
    raw.push({ name: nm, poly: [back[i], front[i], front[j], back[j]] })
  }
  // Centroide del prisma. Reordenamos cada cara para que su normal (CCW) apunte
  // HACIA FUERA del centro -> brush convexa valida sea cual sea el winding de
  // entrada del anillo (evita errores manuales de orientacion).
  const all = raw.flatMap((f) => f.poly)
  const c = all.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]).map((s) => s / all.length)
  const subv = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
  const crossv = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  return raw.map((f) => {
    const n = crossv(subv(f.poly[1], f.poly[0]), subv(f.poly[2], f.poly[0]))
    const cen = f.poly.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]).map((s) => s / f.poly.length)
    const out = subv(cen, c)
    const inward = n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0
    return { name: f.name, poly: inward ? [...f.poly].reverse() : f.poly }
  })
}

// Cuanto se extiende un ala en X a lo largo de la diagonal, medido desde el
// centro de la celda. La media diagonal del cubo es H*raiz2 (~0.707): con un
// REACH mayor las PUNTAS se salen del cubo hacia las celdas vecinas, de modo que
// dos alas contiguas se SOLAPAN y conectan (en lugar de quedarse cortas dentro
// de su hueco). Las caras laterales largas siguen dentro del cubo en su espesor.
const WINGX_REACH = 1.15

/**
 * ALA EN X (DIAGONAL 45°): placa GRANDE y fina sobre la diagonal del plano Y-Z
 * (el que ves desde detras de la nave), a 45°. Las PUNTAS SOBRESALEN del cubo
 * para solapar con la celda vecina y formar una X continua; el resto del aspa
 * cabe en el cubo. Sin rotar es el brazo "/"; las 4 orientaciones de 90° sobre
 * el eje X (R/F/G) dan los 4 brazos del aspa.
 *
 *   vista trasera (Y-Z):   +Z      /
 *                           |     /  <- la punta se sale del cubo (solapa vecino)
 *                           |   /
 *                      -----+--/----- +Y
 *                         / |
 *                        /  (otra punta sale por la esquina opuesta)
 *
 * Placa de espesor constante (medio espesor t perpendicular a la diagonal), con
 * profundidad en X. Una brush convexa (paralelogramo extruido en X).
 */
function wingX() {
  const t = 0.10       // medio espesor de la placa (perpendicular a la diagonal)
  const depth = 0.34   // media profundidad en X (cara delantera/trasera)
  const s2 = Math.SQRT1_2          // 1/raiz2
  const dir = [s2, s2]             // a lo largo del ala: diagonal +Y,+Z
  const per = [-s2, s2]            // espesor: perpendicular, -Y,+Z
  const L = WINGX_REACH            // medio largo a lo largo de la diagonal (sale del cubo)
  const corner = (along, across) => [dir[0] * along + per[0] * across, dir[1] * along + per[1] * across]
  const ring = [
    corner(-L, +t),  // punta interior, lado +
    corner(+L, +t),  // punta exterior, lado +
    corner(+L, -t),  // punta exterior, lado -
    corner(-L, -t),  // punta interior, lado -
  ]
  const names = ['edgeHi', 'tipOut', 'edgeLo', 'tipIn']
  return [extrudeX(ring, -depth, depth, 'wx', names)]
}

/**
 * ALA EN X AFILADA (DIAGONAL 45°): como `wingX`, sobre la diagonal a 45° en Y-Z,
 * pero AFILA hacia la punta EXTERIOR terminando casi en pico — como las aspas
 * que rematan en punta. La raiz cruza el centro de la celda y sobresale por la
 * esquina interior (igual que wingX), asi SOLAPA con la pieza contigua y conecta
 * la X. Una brush convexa. La punta no es exacta (deja un filo minusculo) para
 * que qbsp no degenere.
 */
function wingXTip() {
  const t = 0.13       // medio espesor en la raiz (interior)
  const tipT = 0.012   // medio espesor en la punta (casi cero, no exacto)
  const depth = 0.30
  const s2 = Math.SQRT1_2
  const dir = [s2, s2]
  const per = [-s2, s2]
  // La raiz cruza el centro y llega hasta la esquina INTERIOR (-Lin), igual que
  // wingX, para SOLAPAR con la pieza contigua y conectar la X. Solo afila hacia
  // la punta EXTERIOR (+Lout).
  const Lin = WINGX_REACH          // la raiz sobresale por la esquina interior (solapa vecino)
  const Lout = WINGX_REACH + 0.15  // la punta llega algo mas lejos (aspa larga)
  const corner = (along, across) => [dir[0] * along + per[0] * across, dir[1] * along + per[1] * across]
  // Trapecio: ancho t en la raiz (interior), afila a tipT en la punta (exterior).
  const ring = [
    corner(-Lin, +t),     // raiz (esquina interior), lado +
    corner(Lout, +tipT),  // punta (esquina exterior), lado +
    corner(Lout, -tipT),  // punta, lado - (casi en el eje)
    corner(-Lin, -t),     // raiz, lado -
  ]
  const names = ['edgeHi', 'tipOut', 'edgeLo', 'rootIn']
  return [extrudeX(ring, -depth, depth, 'wxt', names)]
}

/**
 * PILOTO / VENTANA: una cajita pequeña para pegar a una superficie desde fuera.
 * Ocupa SOLO su propia celda: la cara trasera -X queda a ras del borde de la
 * celda (x = -H), asi al colocarla en la celda contigua al casco encaja contra
 * el sin meterse dentro del vecino (sin z-fighting). Una brush.
 *
 * Gira con R/F/G para pegarla contra cualquier cara (24 orientaciones). Pintala
 * con +0blink/+0amber/+0cyan para que parpadee.
 */
function pilots() {
  const s = 0.16  // medio lado de la cajita (en Y y Z)
  const d = 0.08  // fondo de la cajita en X: BAJITO, apenas sobresale del casco
  // De x=-H (a ras del borde, toca el vecino) a x=-H+d. Centrada en Y/Z.
  return [boxBrush({ x0: -H, y0: -s, z0: -s, x1: -H + d, y1: s, z1: s }, '')]
}

/**
 * MASTIL / ANTENA: torre fina vertical con base ancha. 2 brushes (base + asta).
 */
function mast() {
  const base = boxBrush({ x0: -0.22, y0: -0.22, z0: -H, x1: 0.22, y1: 0.22, z1: -H + 0.14 }, 'mb')
  const pole = prismZ({ sides: 6, radius: 0.07, z0: -H + 0.14, z1: +H, prefix: 'pole' })
  return [base, pole]
}

/**
 * PANEL SOLAR / ALA: placa fina horizontal (plano X-Y), delgada en Z. Una brush.
 */
function panel() {
  const t = 0.05
  return [boxBrush({ x0: -H, y0: -H, z0: -t, x1: +H, y1: +H, z1: t }, 'panel')]
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

// --- Helpers biologicos -------------------------------------------------------

/**
 * Tronco-cono facetado orientado libremente, de `base` (centro del anillo de
 * radio r0) a `tip` (centro del anillo de radio r1). A diferencia de `spike`
 * NO termina en punta: deja dos tapas con radio propio, util para ramas/segmentos
 * orgánicos que luego se encadenan. Una brush convexa.
 *
 * base/tip en espacio de celda unitaria. r0 = radio en la base, r1 = radio en
 * la punta (afila si r1 < r0). prefix da nombres de cara unicos por segmento.
 */
function frustum(base, tip, r0, r1, sides = 6, prefix = 'fr') {
  const ax = [tip[0] - base[0], tip[1] - base[1], tip[2] - base[2]]
  const al = Math.hypot(ax[0], ax[1], ax[2]) || 1
  const dir = [ax[0] / al, ax[1] / al, ax[2] / al]
  const up = Math.abs(dir[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
  const u = nrm(cross(up, dir)), v = cross(dir, u)
  const ring = (c, r) => Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2
    const cs = Math.cos(a) * r, sn = Math.sin(a) * r
    return [c[0] + u[0] * cs + v[0] * sn, c[1] + u[1] * cs + v[1] * sn, c[2] + u[2] * cs + v[2] * sn]
  })
  const bot = ring(base, r0), top = ring(tip, r1)
  const faces = [
    { name: `${prefix}-`, poly: [...bot].reverse() }, // tapa de la base (mira hacia -dir)
    { name: `${prefix}+`, poly: [...top] },           // tapa de la punta (mira hacia +dir)
  ]
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides
    faces.push({ name: `${prefix}s${i}`, poly: [bot[i], bot[j], top[j], top[i]] })
  }
  return faces
}

// --- Modulos biologicos -------------------------------------------------------

/**
 * CORAL: racimo organico. Un tronco central que se afila hacia arriba y varias
 * ramas que salen en abanico, cada una un tronco-cono afilado e inclinado. Cada
 * rama es UNA brush convexa (afilada, no punta exacta) -> compila a BSP igual
 * que los pinchos. Las ramas arrancan dentro del tronco para que se fundan.
 */
function coral() {
  const G = -H // suelo de la celda
  const brushes = []
  // Tronco central, gordo abajo y afilado hacia arriba.
  brushes.push(frustum([0, 0, G], [0.02, 0, G + 0.85], 0.20, 0.05, 6, 'trunk'))
  // Ramas en abanico: arrancan a media altura del tronco y se curvan hacia
  // fuera y arriba, afilando a casi-punta. Distribuidas en angulo.
  const rama = (ang, lift, len, r, tag) => {
    const ca = Math.cos(ang), sa = Math.sin(ang)
    const start = [ca * 0.06, sa * 0.06, G + 0.30]            // dentro del tronco
    const end = [ca * len, sa * len, G + 0.30 + lift]          // fuera y arriba
    return frustum(start, end, r, 0.025, 5, tag)
  }
  brushes.push(rama(0.4, 0.55, 0.42, 0.11, 'r0'))
  brushes.push(rama(2.3, 0.62, 0.38, 0.10, 'r1'))
  brushes.push(rama(4.1, 0.50, 0.40, 0.10, 'r2'))
  brushes.push(rama(5.4, 0.66, 0.34, 0.09, 'r3'))
  return brushes
}

/**
 * CORAZA / CAPARAZON curvado: domo abovedado. Se aproxima la cupula apilando
 * anillos (tronco-conos) de radio decreciente con la altura, siguiendo un perfil
 * de cuarto de circunferencia. Cada anillo es UNA brush convexa; el remate es un
 * casquete afilado. La superficie queda facetada pero "curvada" a la vista.
 *
 * Apoyado en el suelo (z=-H). rings controla cuantos segmentos de altura (mas =
 * mas suave, mas planos en qbsp). sides = facetas alrededor.
 */
function shell(rings = 4, sides = 8) {
  const G = -H
  const R = 0.46          // radio en la base
  const Htot = 0.92       // altura total del domo
  const brushes = []
  // Perfil de cuarto de circunferencia: en la altura t en [0,1], el radio sigue
  // r = R*cos(t*PI/2) y la altura z = G + Htot*sin(t*PI/2). Apila frustums entre
  // niveles consecutivos.
  const lvl = (t) => ({
    r: R * Math.cos(t * Math.PI / 2),
    z: G + Htot * Math.sin(t * Math.PI / 2),
  })
  for (let i = 0; i < rings; i++) {
    const a = lvl(i / rings), b = lvl((i + 1) / rings)
    // El ultimo anillo afila a casi-punta para rematar la cupula sin degenerar.
    const r1 = i === rings - 1 ? 0.04 : b.r
    brushes.push(frustum([0, 0, a.z], [0, 0, b.z], a.r, r1, sides, `sh${i}`))
  }
  return brushes
}

/**
 * ANCLA / MARKER: un cubo pequeño con una FLECHA que apunta a +X local. NO es
 * geometria solida: es un MARCADOR. En el editor se ve (cubo + flecha) para
 * situarlo y orientarlo con R/F/G, pero al compilar NO emite brushes —
 * el mapWriter lo salta (MODULES[key].marker) y en su lugar escribe una ENTIDAD
 * invisible en el .bsp: classname = el texto del bloque (block.label), origin =
 * centro de la celda, angle/mangle = la direccion de la flecha (+X rotado).
 *
 * La flecha apunta a +X (igual convencion que las naves: +X = "hacia delante").
 * Cuerpo pequeño centrado + asta + cabeza piramidal. Varias brushes convexas,
 * solo para el render.
 */
function anchor() {
  const body = boxBrush({ x0: -0.16, y0: -0.16, z0: -0.16, x1: 0.16, y1: 0.16, z1: 0.16 }, 'body')
  // Asta de la flecha: barra fina de +0.16 a +0.30 en X.
  const shaft = boxBrush({ x0: 0.16, y0: -0.05, z0: -0.05, x1: 0.30, y1: 0.05, z1: 0.05 }, 'shaft')
  // Cabeza: piramide que afila a casi-punta en +X (de x=0.30 a ~0.5).
  const head = spike([0.30, 0, 0], [0.49, 0, 0], 0.14, 4, 'head')
  return [body, shaft, head]
}

export const MODULES = {
  cube:        { key: 'cube',        label: 'Cubo',          category: 'Solidos', build: cube },
  anchor:      { key: 'anchor',      label: 'Ancla (marcador)', category: 'Marcadores', build: anchor, marker: true },
  ramp:        { key: 'ramp',        label: 'Rampa',         category: 'Rampas',  build: ramp },
  bevel:       { key: 'bevel',       label: 'Bisel',         category: 'Biseles', build: bevel },
  cornerWedge: { key: 'cornerWedge', label: 'Cuña esquina',  category: 'Biseles', build: cornerWedge },
  // Nave espacial.
  fuselage:    { key: 'fuselage',    label: 'Fuselaje',      category: 'Nave',    build: fuselage },
  chamferBox:  { key: 'chamferBox',  label: 'Cubo chaflanado', category: 'Nave',  build: chamferBox },
  noseCone:    { key: 'noseCone',    label: 'Morro',         category: 'Nave',    build: noseCone },
  nozzle:      { key: 'nozzle',      label: 'Tobera',        category: 'Nave',    build: nozzle },
  cockpit:     { key: 'cockpit',     label: 'Cabina',        category: 'Nave',    build: cockpit },
  fin:         { key: 'fin',         label: 'Aleta',         category: 'Nave',    build: fin },
  wingDiagonal:{ key: 'wingDiagonal',label: 'Ala diagonal',  category: 'Nave',    build: wingDiagonal },
  wingTip:     { key: 'wingTip',     label: 'Ala en punta',  category: 'Nave',    build: wingTip },
  wingX:       { key: 'wingX',       label: 'Ala X (45°)',   category: 'Nave',    build: wingX },
  wingXTip:    { key: 'wingXTip',    label: 'Ala X punta (45°)', category: 'Nave', build: wingXTip },
  spikes:      { key: 'spikes',      label: 'Pinchos (3)',   category: 'Nave',    build: spikes },
  pilots:      { key: 'pilots',      label: 'Piloto/Ventana', category: 'Nave',  build: pilots },
  panel:       { key: 'panel',       label: 'Panel/Ala',     category: 'Nave',    build: panel },
  mast:        { key: 'mast',        label: 'Mástil',        category: 'Nave',    build: mast },
  // Props.
  pipe:        { key: 'pipe',        label: 'Tubería',       category: 'Props',   build: pipe },
  engine:      { key: 'engine',      label: 'Motor',         category: 'Props',   build: engine },
  // Biologicos.
  coral:       { key: 'coral',       label: 'Coral',         category: 'Bio',     build: coral },
  shell:       { key: 'shell',       label: 'Coraza',        category: 'Bio',     build: () => shell() },
}

export const MODULE_LIST = Object.values(MODULES)

/** Devuelve las brushes (en espacio de celda unitaria) de un modulo por key. */
export function buildModule(key) {
  const def = MODULES[key]
  if (!def) throw new Error(`Modulo desconocido: ${key}`)
  return def.build()
}

/**
 * ¿Es un MARCADOR (no aporta geometria solida al .bsp)? Los marcadores se ven en
 * el editor pero al compilar el mapWriter NO emite sus brushes; en su lugar
 * escribe una entidad invisible. Default false (modulo solido normal).
 */
export function isMarker(key) {
  return !!(MODULES[key] && MODULES[key].marker)
}
