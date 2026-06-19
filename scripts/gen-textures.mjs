/**
 * Pregenera el set de texturas predefinidas en `textures/`.
 *
 * Por cada textura escribe:
 *   - <id>.tex : JSON { width, height, indices(base64) } con indices de la
 *                paleta de Quake — lo lee el wadWriter (sin decodificar PNG).
 *   - <id>.png : preview RGBA para el navegador.
 *
 * Las texturas viven en disco para poder editarlas (plan.md §5). Reejecuta este
 * script para regenerarlas: `pnpm gen-textures`.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { QUAKE_PALETTE, nearestIndex } from '../server/compile/quakePalette.js'
import { encodePNG } from '../server/compile/png.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(__dirname, '..', 'textures')
// Tamaño FIJO de toda textura: 64x64 px, ni mas ni menos. Casa 1:1 con la celda
// de 64u del editor y es el tamaño que el WAD espera (server/compile/wadWriter).
const SIZE = 64

// Generadores: cada uno pinta un patron y devuelve [r,g,b] por pixel (x,y).
function solid([r, g, b]) { return () => [r, g, b] }
function bricks(base, mortar) {
  return (x, y) => {
    const row = Math.floor(y / 16)
    const off = (row % 2) * 16
    const bx = (x + off) % 32, by = y % 16
    return (bx < 2 || by < 2) ? mortar : base
  }
}
function checker(a, b, s = 8) {
  return (x, y) => ((Math.floor(x / s) + Math.floor(y / s)) % 2 ? b : a)
}
function noise(base, amp) {
  return (x, y) => {
    // ruido deterministico (sin Math.random para reproducibilidad).
    const n = ((x * 92821 + y * 68473) % 97) / 97 - 0.5
    return base.map((c) => Math.max(0, Math.min(255, Math.round(c + n * amp))))
  }
}

// --- Helpers de naveespacial --------------------------------------------------

const clamp = (c) => Math.max(0, Math.min(255, Math.round(c)))
const add = (col, d) => col.map((c) => clamp(c + d))
const det = (x, y) => ((x * 92821 + y * 68473) % 97) / 97 - 0.5 // ruido det. [-0.5,0.5]

/**
 * Muro fortificado de placas blindadas: placas grandes con junta hundida,
 * chaflán biselado (claro arriba/izq, oscuro abajo/der para dar volumen) y un
 * remache redondo en cada esquina de placa.
 */
function panels(base, { cell = 32, seam = 3, bevel = 3, grain = 10 } = {}) {
  return (x, y) => {
    const gx = x % cell, gy = y % cell
    let col = add(base, det(x, y) * grain)
    // Junta hundida entre placas.
    if (gx < seam || gy < seam) return add(base, -55)
    // Bisel: borde claro tras la junta, sombra en el borde opuesto.
    if (gx < seam + bevel || gy < seam + bevel) col = add(col, 34)
    if (gx >= cell - bevel || gy >= cell - bevel) col = add(col, -26)
    // Remache redondo cerca de cada esquina interior de la placa.
    const rx = Math.min(gx - seam - 3, cell - 4 - gx)
    const ry = Math.min(gy - seam - 3, cell - 4 - gy)
    if (rx >= 0 && ry >= 0) {
      const d = Math.hypot(rx - 2, ry - 2)
      if (d < 2.2) col = add(col, 60 - d * 18)                   // remache abombado
    }
    return col
  }
}

/** Ventanas pequeñas iluminadas en una rejilla, sobre casco metálico. */
function windows(hull, glow, { cell = 16, win = 6 } = {}) {
  return (x, y) => {
    const gx = x % cell, gy = y % cell
    const inWin = gx >= 3 && gx < 3 + win && gy >= 3 && gy < 3 + win
    if (inWin) {
      // brillo con un degradado interno para que parezca una luz encendida.
      const cx = gx - (3 + win / 2), cy = gy - (3 + win / 2)
      const d = Math.hypot(cx, cy) / (win / 2)
      return add(glow, -d * 70)
    }
    let col = add(hull, det(x, y) * 12)
    if (gx < 1 || gy < 1) col = add(col, -30) // marco del panel
    return col
  }
}

/** Tubos/cables horizontales con tornillos: "ingeniería expuesta". */
function machinery(base, pipe, accent) {
  return (x, y) => {
    const band = Math.floor(y / 10) % 3
    const yy = y % 10
    if (band === 0) {
      // tubería gruesa con reflejo (clara arriba, oscura abajo).
      const shade = (yy - 5) * 9
      return add(pipe, -shade + det(x, y) * 8)
    }
    if (band === 1 && (x % 12 < 2)) return accent              // cableado vertical
    let col = add(base, det(x, y) * 16)
    if (yy === 0) col = add(col, -36)                          // separación de bandas
    if ((x % 8 < 2) && (yy % 8 < 2)) col = add(col, 40)        // tornillos
    return col
  }
}

/** Bloques de lanzamiento de misiles: tubos circulares en rejilla. */
function missilePods(hull, tube, ring, { cell = 20, r = 7 } = {}) {
  return (x, y) => {
    const cx = (x % cell) - cell / 2, cy = (y % cell) - cell / 2
    const d = Math.hypot(cx, cy)
    if (d < r - 2) return add(tube, -(r - 2 - d) * 14)         // boca oscura del tubo
    if (d < r) return ring                                    // anillo claro del borde
    let col = add(hull, det(x, y) * 14)
    if (x % cell < 2 || y % cell < 2) col = add(col, -28)      // rejilla entre tubos
    return col
  }
}

const TEXTURES = {
  default:  solid([150, 150, 150]),
  sky:      solid([60, 60, 110]),
  stone:    noise([120, 120, 128], 40),
  brick:    bricks([150, 80, 60], [60, 50, 48]),
  wood:     noise([120, 85, 50], 30),
  metal:    checker([110, 115, 125], [90, 95, 105], 16),
  grass:    noise([70, 110, 55], 35),
  sand:     noise([190, 170, 120], 25),
  lava:     noise([200, 70, 20], 60),
  water:    noise([40, 80, 130], 30),

  // --- Nave espacial ---
  ship_wall:    panels([95, 100, 112], { cell: 32, grain: 16 }), // muro fortificado
  ship_windows: windows([70, 78, 92], [150, 220, 255]),          // area con pequeñas ventanas
  ship_missile: missilePods([90, 92, 98], [40, 42, 48], [160, 150, 120]), // lanzadores de misiles
  ship_engine:  machinery([80, 84, 92], [120, 125, 135], [200, 150, 60]), // ingenieria expuesta
}

async function genOne(id, fn) {
  const indices = Buffer.alloc(SIZE * SIZE)
  const rgba = new Uint8Array(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b] = fn(x, y)
      const i = nearestIndex(r, g, b)
      indices[y * SIZE + x] = i
      // El preview usa el color REAL de la paleta (lo que se vera en el juego).
      const [pr, pg, pb] = QUAKE_PALETTE[i]
      const o = (y * SIZE + x) * 4
      rgba[o] = pr; rgba[o + 1] = pg; rgba[o + 2] = pb; rgba[o + 3] = 255
    }
  }
  await fs.writeFile(path.join(OUT, `${id}.tex`), JSON.stringify({
    width: SIZE, height: SIZE, indices: indices.toString('base64'),
  }))
  await fs.writeFile(path.join(OUT, `${id}.png`), encodePNG(rgba, SIZE, SIZE))
}

async function main() {
  await fs.mkdir(OUT, { recursive: true })
  const ids = Object.keys(TEXTURES)
  for (const id of ids) await genOne(id, TEXTURES[id])
  console.log(`Generadas ${ids.length} texturas en ${OUT}: ${ids.join(', ')}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
