/**
 * Escritor de WAD2 (formato de Quake) con miptex.
 *
 * Empaqueta las texturas de `textures/` en un .wad que qbsp puede resolver.
 * Cada textura se guarda en disco como `<id>.tex` (JSON: width,height,indices
 * en base64 = indices de la paleta de Quake) — asi el servidor no necesita
 * decodificar PNG. El WAD lleva ademas un lump de paleta opcional.
 *
 * Formato WAD2:
 *   header: 'WAD2', numlumps(int32), infotableofs(int32)
 *   lumps:  miptex consecutivos
 *   dirent (32 bytes): ofs,dsize,size,type,compression,pad(2),name(16)
 *
 * miptex:  name(16), width(int32), height(int32), 4 offsets(int32) a los 4
 *          niveles de mip; luego los pixeles (indices de paleta) de cada nivel.
 */

import fs from 'node:fs/promises'
import { nearestIndex } from './quakePalette.js'
import { ensureTex, wadName, animFrames, listTextureIds } from './textures.js'

const TYP_MIPTEX = 0x44

/** Reduce a la mitad un buffer de indices (nearest, sin remuestrear color). */
function halfMip(src, w, h) {
  const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1)
  const out = new Uint8Array(nw * nh)
  for (let y = 0; y < nh; y++)
    for (let x = 0; x < nw; x++)
      out[y * nw + x] = src[(y * 2) * w + (x * 2)]
  return { data: out, w: nw, h: nh }
}

/** Construye un lump miptex (Buffer) para una textura indexada. */
function miptexLump(name, w, h, indices) {
  const mips = [{ data: indices, w, h }]
  for (let i = 0; i < 3; i++) { const prev = mips[i]; mips.push(halfMip(prev.data, prev.w, prev.h)) }

  const header = 40 // name(16)+w(4)+h(4)+offsets(16)
  const sizes = mips.map((m) => m.w * m.h)
  const total = header + sizes.reduce((a, b) => a + b, 0)
  const buf = Buffer.alloc(total)
  buf.write(name.slice(0, 15), 0, 'ascii')
  buf.writeUInt32LE(w, 16); buf.writeUInt32LE(h, 20)
  let ofs = header
  for (let i = 0; i < 4; i++) { buf.writeUInt32LE(ofs, 24 + i * 4); ofs += sizes[i] }
  let p = header
  for (const m of mips) { Buffer.from(m.data).copy(buf, p); p += m.data.length }
  return buf
}

// Carga indexada de una textura: ensureTex decodifica el PNG y autogenera el
// .tex cache cuando falta. Devuelve null si no hay PNG para ese id.
const loadTexture = (id) => ensureTex(id)

/** Textura de relleno solida (color del nombre o gris) si falta el .tex. */
function fallbackTexture(name, w = 64, h = 64) {
  const idx = name === 'sky' ? nearestIndex(60, 60, 110)
    : name === 'default' ? nearestIndex(150, 150, 150)
    : nearestIndex(128, 128, 128)
  return { width: w, height: h, indices: Buffer.alloc(w * h, idx) }
}

// Toda textura del WAD se normaliza a este tamaño fijo (cuadrado, multiplo de
// 16 que exige Quake). Casa 1:1 con la celda de 64u del editor.
const TILE = 64

/**
 * Escribe un WAD2 con las texturas `names` en `outPath`. TODA textura se ajusta
 * a TILE x TILE (64x64) exacto: recorta lo que sobra, rellena lo que falta.
 */
export async function writeWad(names, outPath) {
  const lumps = []
  const seen = new Set()
  // Texturas ANIMADAS: una cara solo referencia el frame `+0name`, pero el WAD
  // debe llevar todos los frames (`+1name`, ...) para que el motor los cicle.
  // Expandimos cada nombre a sus frames hermanos presentes en textures/.
  const ids = await listTextureIds()
  const expanded = []
  const pushed = new Set()
  for (const name of names)
    for (const fr of await animFrames(name, ids))
      if (!pushed.has(fr)) { pushed.add(fr); expanded.push(fr) }
  names = expanded
  for (const name of names) {
    // Nombre canonico (<=15 chars) — el MISMO que referencia el .map (brushes.js).
    const canon = wadName(name)
    if (seen.has(canon)) continue // ya añadido (p.ej. dos ids que canonizan igual)
    seen.add(canon)
    let tex = await loadTexture(name)
    if (!tex) tex = fallbackTexture(name)
    const data = (tex.width === TILE && tex.height === TILE)
      ? tex.indices : fitIndices(tex.indices, tex.width, tex.height, TILE, TILE)
    lumps.push({ name: canon, buf: miptexLump(canon, TILE, TILE, data) })
  }

  const numlumps = lumps.length
  let dataSize = 0
  for (const l of lumps) dataSize += l.buf.length
  const headerSize = 12
  const direntSize = 32

  const out = Buffer.alloc(headerSize + dataSize + numlumps * direntSize)
  out.write('WAD2', 0, 'ascii')
  out.writeInt32LE(numlumps, 4)
  out.writeInt32LE(headerSize + dataSize, 8) // infotableofs

  let ofs = headerSize
  let dirOfs = headerSize + dataSize
  for (const l of lumps) {
    l.buf.copy(out, ofs)
    out.writeInt32LE(ofs, dirOfs)            // filepos
    out.writeInt32LE(l.buf.length, dirOfs + 4) // disksize
    out.writeInt32LE(l.buf.length, dirOfs + 8) // size
    out.writeUInt8(TYP_MIPTEX, dirOfs + 12)  // type
    out.writeUInt8(0, dirOfs + 13)           // compression
    out.write(l.name.slice(0, 15), dirOfs + 16, 'ascii') // name
    ofs += l.buf.length
    dirOfs += direntSize
  }

  await fs.writeFile(outPath, out)
  return { names, count: numlumps, bytes: out.length }
}

/**
 * Ajusta un buffer de indices de w x h a nw x nh: recorta lo que sobra y
 * rellena (clamp al borde) lo que falta. Garantiza el tamaño destino exacto.
 */
function fitIndices(src, w, h, nw, nh) {
  const out = Buffer.alloc(nw * nh)
  for (let y = 0; y < nh; y++)
    for (let x = 0; x < nw; x++)
      out[y * nw + x] = src[Math.min(y, h - 1) * w + Math.min(x, w - 1)]
  return out
}
