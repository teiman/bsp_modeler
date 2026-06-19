/**
 * Modelo de datos del BSP Modeler.
 *
 * Un MODELO es una coleccion de BLOQUES colocados en una grid 3D de celdas
 * enteras, mas un mapa `faceId -> texturaId` que vive aparte (forma y textura
 * estan DESLIGADAS — ver plan.md §5).
 *
 * Un BLOQUE = { id, key, cell:[x,y,z], rot } donde:
 *   - key  : tipo de modulo del catalogo (cube, ramp, bevel, ...)
 *   - cell : posicion en celdas (enteros). El centro de la celda en mundo es
 *            cell * CELL_SIZE.
 *   - rot  : indice de ORIENTACION del cubo (0..23) — ver core/orientations.js.
 *            Permite cualquier orientacion alineada a ejes (p.ej. una rampa
 *            boca abajo o tumbada), no solo el yaw. Los 0..3 son el yaw puro
 *            (compatibilidad con el modelo antiguo).
 *
 * faceId ESTABLE: identifica una cara concreta de un bloque concreto como
 *   `${blockId}:${faceName}` (p.ej. "b3:+Z"). No depende de la posicion ni de
 *   la rotacion, asi que la textura asignada sobrevive a mover/rotar el bloque.
 */

import { rotateOrientation } from './orientations.js'

// Tamano de celda en unidades de mundo (Quake). 64 = una textura de 64x64 a
// escala 1:1 llena exactamente una cara de cubo (alineado a mundo de Quake con
// uScale=vScale=1). Sin factores de escala: lo que ves es lo que compila.
export const CELL_SIZE = 64

let _seq = 0
/** Genera un id de bloque unico dentro de la sesion (b0, b1, ...). */
export function nextBlockId() {
  return 'b' + _seq++
}

/** Resetea el contador de ids (para tests y carga de proyectos). */
export function resetBlockIds(n = 0) {
  _seq = n
}

/** Crea un modelo vacio. */
export function createModel() {
  return {
    cellSize: CELL_SIZE,
    blocks: [],            // [{ id, key, cell:[x,y,z], rot }]
    // { [faceId]: { tex, scale:[u,v], offset:[u,v], rot } }
    // Control total por cara como en un .map BSP (no UVs estilo MDL):
    //   tex    : nombre de la textura
    //   scale  : escala U/V (uScale/vScale del .map). 1 = textura 64px sobre 64u
    //   offset : desplazamiento U/V en texels
    //   rot    : rotacion de la textura en grados
    faceTextures: {},
  }
}

/** Parametros de texturizado por defecto de una cara (1:1, sin offset ni giro). */
export function defaultFaceTex(tex) {
  return { tex, scale: [1, 1], offset: [0, 0], rot: 0 }
}

/** Construye el faceId estable de una cara de un bloque. */
export function faceId(blockId, faceName) {
  return `${blockId}:${faceName}`
}

/** Devuelve el bloque en una celda concreta, o null. */
export function blockAtCell(model, [x, y, z]) {
  return model.blocks.find(
    (b) => b.cell[0] === x && b.cell[1] === y && b.cell[2] === z,
  ) || null
}

/**
 * Coloca (o reemplaza) un bloque en una celda. Devuelve el bloque creado.
 * Si ya habia un bloque en esa celda lo sustituye (y descarta sus texturas).
 */
export function placeBlock(model, key, cell, rot = 0) {
  removeBlock(model, cell)
  const block = { id: nextBlockId(), key, cell: [...cell], rot: rot | 0 }
  model.blocks.push(block)
  return block
}

/** Borra el bloque de una celda (si existe) y sus texturas asociadas. */
export function removeBlock(model, cell) {
  const b = blockAtCell(model, cell)
  if (!b) return false
  model.blocks = model.blocks.filter((x) => x !== b)
  for (const fid of Object.keys(model.faceTextures)) {
    if (fid.startsWith(b.id + ':')) delete model.faceTextures[fid]
  }
  return true
}

/** Rota el bloque de una celda 90° sobre un eje ('z'|'x'|'y', dir ±1). */
export function rotateBlock(model, cell, axis = 'z', dir = 1) {
  const b = blockAtCell(model, cell)
  if (!b) return false
  b.rot = rotateOrientation(b.rot, axis, dir)
  return true
}

/**
 * Asigna una textura a una cara (faceId estable). `tex` null la quita.
 * Conserva los parametros (scale/offset/rot) si la cara ya tenia textura, para
 * que cambiar de textura no reinicie el ajuste fino.
 */
export function setFaceTexture(model, fid, tex) {
  if (tex == null) { delete model.faceTextures[fid]; return }
  const prev = model.faceTextures[fid]
  model.faceTextures[fid] = prev ? { ...prev, tex } : defaultFaceTex(tex)
}

/** Actualiza parametros de texturizado de una cara (merge parcial). */
export function setFaceParams(model, fid, params) {
  const cur = model.faceTextures[fid]
  if (!cur) return
  model.faceTextures[fid] = { ...cur, ...params }
}

/** Devuelve los parametros de una cara o null. */
export function getFaceTex(model, fid) {
  return model.faceTextures[fid] || null
}

// --- Serializacion -------------------------------------------------------------

const FORMAT = 'bsp-modeler/1'

// Texturas renombradas (su nombre superaba el limite de 15 chars de Quake).
// Se parchean al cargar para que los proyectos/autosave viejos no pierdan la
// textura de esas caras. Mapeo: nombre viejo -> nombre nuevo.
const RENAMED_TEXTURES = {
  green_metal_decor1: 'gm_decor1',
  green_metal_decor2: 'gm_decor2',
}

/** Serializa el modelo a un objeto JSON-able. */
export function serialize(model) {
  return {
    format: FORMAT,
    cellSize: model.cellSize,
    blocks: model.blocks.map((b) => ({ id: b.id, key: b.key, cell: b.cell, rot: b.rot })),
    faceTextures: { ...model.faceTextures },
  }
}

/** Reconstruye un modelo desde su forma JSON. Lanza si el formato no encaja. */
export function deserialize(data) {
  if (!data || data.format !== FORMAT) {
    throw new Error(`Formato de proyecto desconocido: ${data && data.format}`)
  }
  const model = createModel()
  // Migracion: proyectos viejos se guardaron con cellSize 16 (cuando la textura
  // de 64px cubria 64u -> una cara mostraba solo 16/64 = 1/4 de la textura).
  // Ahora la celda es de 64u para que una textura de 64px llene la cara 1:1.
  // Forzamos el cellSize actual; las celdas son indices enteros, asi que la
  // disposicion del modelo no cambia, solo su escala en mundo.
  model.cellSize = CELL_SIZE
  model.blocks = (data.blocks || []).map((b) => ({
    id: b.id, key: b.key, cell: [...b.cell], rot: (b.rot || 0) | 0,
  }))
  // Normaliza faceTextures: el formato viejo guardaba un string (solo el nombre
  // de textura); ahora es { tex, scale, offset, rot }.
  model.faceTextures = {}
  for (const [fid, val] of Object.entries(data.faceTextures || {})) {
    const ft = typeof val === 'string'
      ? defaultFaceTex(val)
      : { tex: val.tex, scale: val.scale || [1, 1], offset: val.offset || [0, 0], rot: val.rot || 0 }
    // Parche: texturas renombradas (ver RENAMED_TEXTURES).
    if (RENAMED_TEXTURES[ft.tex]) ft.tex = RENAMED_TEXTURES[ft.tex]
    model.faceTextures[fid] = ft
  }
  // Continua la secuencia de ids por encima del mayor id existente para no colisionar.
  let maxId = -1
  for (const b of model.blocks) {
    const m = /^b(\d+)$/.exec(b.id)
    if (m) maxId = Math.max(maxId, Number(m[1]))
  }
  resetBlockIds(maxId + 1)
  return model
}
