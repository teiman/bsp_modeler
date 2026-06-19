/**
 * Escritor de .map (Valve 220) para el BSP Modeler.
 *
 * Toma el proyecto (modelo serializado), lo instancia reusando el core del
 * frontend (src/core/instance.js — misma geometria que se ve en el editor) y
 * emite un brush por cada brush convexa de cada bloque.
 *
 * Para que qbsp no reporte LEAK, el mundo se SELLA con una caja-cielo (skybox)
 * de 6 caras alrededor de todo el modelo. Se anade un info_player_start sobre
 * el primer bloque para poder cargar el .bsp en el motor.
 *
 * Flags de compilacion: en compileTools.js (qbsp -bsp2 -worldextent ...).
 */

import { deserialize } from '../../src/core/model.js'
import { instanceModel } from '../../src/core/instance.js'
import { brushFromFaces, faceLine } from './brushes.js'

const SKY_TEX = 'sky'
const DEFAULT_TEX = 'default'

/** Params de texturizado de una cara: { tex, scale, offset, rot } o default. */
function texOfFactory(model) {
  return (faceId) => model.faceTextures[faceId] || { tex: DEFAULT_TEX }
}

/** AABB de todos los vertices instanciados (para dimensionar el skybox). */
function modelBounds(instances) {
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]
  for (const inst of instances)
    for (const brush of inst.brushes)
      for (const face of brush)
        for (const v of face.verts)
          for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], v[i]); mx[i] = Math.max(mx[i], v[i]) }
  if (!isFinite(mn[0])) { mn = [-64, -64, -64]; mx = [64, 64, 64] }
  return { mn, mx }
}

/** Caja hueca de 6 caras (paredes de grosor `t`) que rodea [mn,mx] con margen. */
function skyBox(mn, mx, margin = 128, t = 32) {
  const a = [mn[0] - margin, mn[1] - margin, mn[2] - margin]
  const b = [mx[0] + margin, mx[1] + margin, mx[2] + margin]
  // 6 losas: piso, techo, y 4 paredes. Cada losa es una caja AABB -> brush.
  const slabs = [
    [a[0] - t, a[1] - t, a[2] - t, b[0] + t, b[1] + t, a[2]],   // piso
    [a[0] - t, a[1] - t, b[2], b[0] + t, b[1] + t, b[2] + t],   // techo
    [a[0] - t, a[1] - t, a[2], a[0], b[1] + t, b[2]],           // -X
    [b[0], a[1] - t, a[2], b[0] + t, b[1] + t, b[2]],           // +X
    [a[0], a[1] - t, a[2], b[0], a[1], b[2]],                   // -Y
    [a[0], b[1], a[2], b[0], b[1] + t, b[2]],                   // +Y
  ]
  return slabs.map((s) => boxBrushAABB(s, SKY_TEX)).join('\n')
}

/** Brush de caja AABB [minX,minY,minZ,maxX,maxY,maxZ] (CCW por cara). */
function boxBrushAABB([x0, y0, z0, x1, y1, z1], tex) {
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ]
  const faces = [
    { verts: [v[4], v[5], v[6], v[7]], normal: [0, 0, 1] },
    { verts: [v[3], v[2], v[1], v[0]], normal: [0, 0, -1] },
    { verts: [v[1], v[2], v[6], v[5]], normal: [1, 0, 0] },
    { verts: [v[3], v[0], v[4], v[7]], normal: [-1, 0, 0] },
    { verts: [v[2], v[3], v[7], v[6]], normal: [0, 1, 0] },
    { verts: [v[0], v[1], v[5], v[4]], normal: [0, -1, 0] },
  ]
  const lines = faces.map((f) => faceLine(f.verts, f.normal, { tex }))
  return '{\n' + lines.join('\n') + '\n}'
}

/** Punto de spawn sobre el modelo (centro del AABB, encima del techo). */
function playerStart(mn, mx) {
  const x = Math.round((mn[0] + mx[0]) / 2)
  const y = Math.round((mn[1] + mx[1]) / 2)
  const z = Math.round(mx[2] + 32)
  return `{\n"classname" "info_player_start"\n"origin" "${x} ${y} ${z}"\n}`
}

/**
 * Escribe el .map completo. Devuelve { map, textures } donde textures es el set
 * de nombres de textura usados (para construir el WAD).
 */
export function writeMap(project, { wad = 'textures.wad' } = {}) {
  const model = deserialize(project)
  const instances = instanceModel(model)
  const texOf = texOfFactory(model)

  const worldBrushes = []
  const usedTextures = new Set([SKY_TEX, DEFAULT_TEX])
  for (const inst of instances) {
    for (const brush of inst.brushes) {
      for (const f of brush) usedTextures.add(texOf(f.faceId).tex)
      worldBrushes.push(brushFromFaces(brush, texOf))
    }
  }

  const { mn, mx } = modelBounds(instances)
  const world = [
    '{',
    '"classname" "worldspawn"',
    `"wad" "${wad}"`,
    skyBox(mn, mx),
    ...worldBrushes,
    '}',
  ].join('\n')

  const map = [world, playerStart(mn, mx), ''].join('\n')
  return { map, textures: [...usedTextures] }
}
