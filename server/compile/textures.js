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

/** Lista de ids de textura = los PNG presentes en textures/ (sin extension). */
export async function listTextureIds() {
  let files = []
  try { files = await fs.readdir(TEXTURES_DIR) } catch { return [] }
  return files.filter((f) => f.toLowerCase().endsWith('.png')).map((f) => f.slice(0, -4)).sort()
}

/** mtime de un fichero o 0 si no existe. */
async function mtime(p) {
  try { return (await fs.stat(p)).mtimeMs } catch { return 0 }
}

/**
 * Decodifica el PNG, lo reescala/recorta a 64x64 (nearest) y lo cuantiza a la
 * paleta de Quake. Devuelve { width:64, height:64, indices:Buffer }.
 */
async function pngToIndices(pngPath) {
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
      indices[y * TILE + x] = nearestIndex(data[o], data[o + 1], data[o + 2])
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
  const pngPath = path.join(TEXTURES_DIR, `${id}.png`)
  const texPath = path.join(TEXTURES_DIR, `${id}.tex`)
  const pngTime = await mtime(pngPath)
  if (!pngTime) return null // sin PNG -> la textura no existe

  if ((await mtime(texPath)) >= pngTime) {
    // .tex al dia: usalo.
    try {
      const t = JSON.parse(await fs.readFile(texPath, 'utf8'))
      return { width: t.width, height: t.height, indices: Buffer.from(t.indices, 'base64') }
    } catch { /* corrupto -> regenerar */ }
  }

  // Regenera el .tex desde el PNG.
  const tex = await pngToIndices(pngPath)
  await fs.writeFile(texPath, JSON.stringify({
    width: tex.width, height: tex.height, indices: tex.indices.toString('base64'),
  }))
  return tex
}
