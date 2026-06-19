/**
 * Atlas de texturas para el preview del editor.
 *
 * Empaqueta las texturas (cada una un canvas/imagen del mismo tamano) en una
 * rejilla cuadrada. Devuelve un canvas listo para subir a WebGL y, por cada
 * texturaId, el rect normalizado [u0,v0,u1,v1] de su tile. El default (sin
 * textura) ocupa el tile 0.
 */

export const DEFAULT_TEXTURE = '__none__'

/**
 * @param textures Array<{ id, image }> donde image es un HTMLImageElement o
 *                 HTMLCanvasElement de TILE x TILE px.
 * @param tile     lado del tile en px (todas las texturas se reescalan a esto).
 */
export function buildAtlas(textures, tile = 64) {
  const entries = [{ id: DEFAULT_TEXTURE, image: makeCheckerTile(tile) }, ...textures]
  const cols = Math.ceil(Math.sqrt(entries.length))
  const rows = Math.ceil(entries.length / cols)
  const canvas = document.createElement('canvas')
  canvas.width = cols * tile
  canvas.height = rows * tile
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = false

  const rects = {}
  entries.forEach((e, i) => {
    const cx = (i % cols) * tile
    const cy = Math.floor(i / cols) * tile
    ctx.drawImage(e.image, cx, cy, tile, tile)
    rects[e.id] = [cx / canvas.width, cy / canvas.height, (cx + tile) / canvas.width, (cy + tile) / canvas.height]
  })

  return { canvas, rects, cols, rows, tile }
}

/** Tile a cuadros para "sin textura asignada". */
function makeCheckerTile(tile) {
  const c = document.createElement('canvas')
  c.width = c.height = tile
  const ctx = c.getContext('2d')
  const n = 8, s = tile / n
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#3a3a44' : '#2a2a31'
      ctx.fillRect(x * s, y * s, s, s)
    }
  }
  return c
}
