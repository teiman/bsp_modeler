/**
 * Texturas DINAMICAS desde disco. La carpeta `textures/` es la fuente de
 * verdad: cada `<id>.png` es una textura. Sueltas un PNG y aparece; lo quitas y
 * desaparece. No hace falta `gen-textures`.
 *
 * El WAD necesita indices de la paleta de Quake (no RGBA), asi que por cada PNG
 * se cachea un `<id>.tex` (JSON { width, height, indices(base64) }). Se
 * autogenera cuando falta o cuando el PNG es mas nuevo que el `.tex`. Si borras
 * el PNG, el `.tex` huerfano se ignora (y se puede limpiar).
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { PNG } from 'pngjs'
import { TEXTURES_DIR } from './paths.js'
import { nearestIndex } from './quakePalette.js'

export const TILE = 64 // toda textura se normaliza a 64x64 (ver wadWriter)

// Quake guarda el nombre de textura en 16 bytes -> max 15 caracteres utiles.
const MAX_TEX_NAME = 15

/**
 * Nombre CANONICO de una textura en el WAD/.map (<=15 chars), determinista.
 * Para ids cortos es identidad (no cambia las texturas existentes). Para ids
 * largos, recorta y añade un sufijo hash corto para que dos ids distintos no
 * colisionen al truncar (p.ej. green_metal_decor1 vs ...decor2). DEBE usarse
 * identicamente en el .map y en el WAD para que el motor resuelva la textura.
 */
export function wadName(id) {
  if (id.length <= MAX_TEX_NAME) return id
  // hash djb2 del id COMPLETO -> sufijo base36. Tomamos los digitos BAJOS del
  // hash (los mas sensibles a cambios pequeños como decor1 vs decor2) con
  // padding fijo, para que dos ids casi iguales no colisionen al truncar.
  let h = 5381
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) >>> 0
  const suffix = '~' + (h % 1296).toString(36).padStart(2, '0') // 1296 = 36^2 -> 2 chars
  return id.slice(0, MAX_TEX_NAME - suffix.length) + suffix
}

// Subcarpeta de texturas FULLBRIGHT: un PNG en textures/fb/ se cuantiza contra
// la paleta fullbright (224..255), asi brilla siempre (luces, pantallas,
// parpadeos). El id es PLANO (el nombre del fichero, sin 'fb/'): textures/fb/
// alarm.png -> id 'alarm'. Si existe el mismo nombre en raiz y en fb/, gana fb/.
const FB_DIR = path.join(TEXTURES_DIR, 'fb')

// Subcarpeta textures/all/: PNG que YA usan colores exactos de la paleta de
// Quake, incluidos pixeles fullbright. Se cuantizan contra TODA la paleta
// (0..255) -> cada pixel cae en su indice exacto, normal o fullbright, decidido
// por pixel. Id plano igual que fb/. Pensadas para texturas "ya listas" que
// mezclan zonas normales y zonas que brillan.
const ALL_DIR = path.join(TEXTURES_DIR, 'all')

/** PNG (sin ext) de una carpeta, o [] si no existe. */
async function pngsIn(dir) {
  try {
    const files = await fs.readdir(dir)
    return files.filter((f) => f.toLowerCase().endsWith('.png')).map((f) => f.slice(0, -4))
  } catch { return [] }
}

/**
 * Resuelve un id de textura a su ubicacion: { pngPath, texPath, mode }.
 *   mode: 'fb' (textures/fb/), 'all' (textures/all/) o 'normal' (raiz).
 * Prioridad: fb/ > all/ > raiz. Devuelve null si no hay PNG en ninguna.
 */
export async function resolveTexture(id) {
  const fbPng = path.join(FB_DIR, `${id}.png`)
  if (await mtime(fbPng)) {
    return { pngPath: fbPng, texPath: path.join(FB_DIR, `${id}.tex`), mode: 'fb' }
  }
  const allPng = path.join(ALL_DIR, `${id}.png`)
  if (await mtime(allPng)) {
    return { pngPath: allPng, texPath: path.join(ALL_DIR, `${id}.tex`), mode: 'all' }
  }
  const png = path.join(TEXTURES_DIR, `${id}.png`)
  if (await mtime(png)) {
    return { pngPath: png, texPath: path.join(TEXTURES_DIR, `${id}.tex`), mode: 'normal' }
  }
  return null
}

/**
 * Lista de ids de textura = los PNG en textures/, textures/fb/ y textures/all/
 * (sin ext). Si un nombre esta en varias, aparece una sola vez (la prioridad de
 * cuantizado la decide resolveTexture: fb/ > all/ > raiz).
 */
export async function listTextureIds() {
  const root = await pngsIn(TEXTURES_DIR)
  const fb = await pngsIn(FB_DIR)
  const all = await pngsIn(ALL_DIR)
  return [...new Set([...root, ...fb, ...all])].sort()
}

/**
 * TEXTURAS ANIMADAS (convencion de Quake). Una textura cuyo nombre empieza por
 * `+0` (p.ej. `+0panel`) es el primer frame de una animacion: el motor cicla
 * automaticamente `+1panel`, `+2panel`, ... `+9panel` a ~5 fps. (El par `+0`/
 * `+a` es el estado normal/activado de un switch.)
 *
 * El .map solo referencia `+0panel`, pero el WAD debe llevar TODOS los frames
 * presentes para que el motor pueda ciclarlos. Esta funcion, dado un nombre de
 * textura, devuelve la lista de frames hermanos que existen como PNG en
 * textures/ (incluido el propio). Para texturas no animadas devuelve [id].
 */
export async function animFrames(id, ids = null) {
  const m = /^\+([0-9a-j])(.+)$/i.exec(id) // +<frame><base>, frame 0-9 o a-j
  if (!m) return [id]
  const base = m[2]
  const present = ids || await listTextureIds()
  const frames = present.filter((t) => {
    const mm = /^\+([0-9a-j])(.+)$/i.exec(t)
    return mm && mm[2] === base
  })
  return frames.length ? frames.sort() : [id]
}

/** mtime de un fichero o 0 si no existe. */
async function mtime(p) {
  try { return (await fs.stat(p)).mtimeMs } catch { return 0 }
}

/**
 * Decodifica el PNG, lo reescala/recorta a 64x64 (nearest) y lo cuantiza a la
 * paleta de Quake. Devuelve { width:64, height:64, indices:Buffer }.
 */
async function pngToIndices(pngPath, mode = 'normal') {
  const buf = await fs.readFile(pngPath)
  const png = PNG.sync.read(buf) // RGBA, maneja filtros/paleta/gris internamente
  const { width: w, height: h, data } = png
  const indices = Buffer.alloc(TILE * TILE)
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      // Muestreo nearest desde el tamaño original al tile 64x64.
      const sx = Math.min(w - 1, Math.floor((x * w) / TILE))
      const sy = Math.min(h - 1, Math.floor((y * h) / TILE))
      const o = (sy * w + sx) * 4
      // Cuantiza segun el modo de la carpeta: 'normal' (0..223), 'fb' (224..255)
      // o 'all' (0..255, indice exacto por pixel).
      indices[y * TILE + x] = nearestIndex(data[o], data[o + 1], data[o + 2], mode)
    }
  }
  return { width: TILE, height: TILE, indices }
}

/**
 * Asegura que existe un `.tex` actualizado para `id` y devuelve sus indices.
 * Regenera si el `.tex` falta o es mas viejo que el PNG. Devuelve null si no hay
 * PNG para ese id.
 */
export async function ensureTex(id) {
  const loc = await resolveTexture(id)
  if (!loc) return null // sin PNG (ni en raiz, ni en fb/, ni en all/) -> no existe
  const { pngPath, texPath, mode } = loc
  const pngTime = await mtime(pngPath)

  if ((await mtime(texPath)) >= pngTime) {
    // .tex al dia: usalo.
    try {
      const t = JSON.parse(await fs.readFile(texPath, 'utf8'))
      return { width: t.width, height: t.height, indices: Buffer.from(t.indices, 'base64') }
    } catch { /* corrupto -> regenerar */ }
  }

  // Regenera el .tex desde el PNG (cuantizando segun el modo de la carpeta).
  const tex = await pngToIndices(pngPath, mode)
  await fs.writeFile(texPath, JSON.stringify({
    width: tex.width, height: tex.height, indices: tex.indices.toString('base64'),
  }))
  return tex
}
