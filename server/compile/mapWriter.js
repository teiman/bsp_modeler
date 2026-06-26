/**
 * Escritor de .map (Valve 220) para el BSP Modeler.
 *
 * Genera un MODELO BSP "desnudo" (un brush-model / bmodel, como b_explob.bsp o
 * los botes de vida de Quake clasico), NO un nivel. Los brushes del modelo van
 * directos en el worldspawn -> quedan en el bmodel 0, que es lo que carga el
 * motor con setmodel(".../modelo.bsp") y usa como entidad solida (SOLID_BSP).
 *
 * Por eso NO hay caja de sellado (skybox), ni info_player_start, ni -leaktest:
 * todo eso es de los niveles brush-based. Un modelo-objeto se compila desnudo;
 * sale "fullbright" porque no hereda luz de un mundo (correcto para un objeto).
 *
 * Flags de compilacion: en compileTools.js.
 */

import { deserialize } from '../../src/core/model.js'
import { instanceModel } from '../../src/core/instance.js'
import { isMarker } from '../../src/blocks/catalog.js'
import { cellCenter } from '../../src/core/geometry.js'
import { applyOrient } from '../../src/core/orientations.js'
import { brushFromFaces } from './brushes.js'

const DEFAULT_TEX = 'default'

// Perfiles que producen un .bsp con COLISION DE CASCO (hull 1 poblado): la nave
// va en un func_wall (-> submodelo *1) y el worldspawn lleva una caja-mundo
// SELLADA alrededor para que qbsp (con -leaktest) construya los clip-hulls.
// Sin sellado, ericw-tools detecta un "leak" y deja el hull 1 VACIO -> la
// entidad colisiona contra el bounding box entero como un ladrillo.
// El QC carga la nave con setmodel(self, "*1:progs/starship.bsp") + SOLID_BSP.
export const HULL_PROFILES = new Set(['starfall', 'starfallsun'])

// Holgura (u) entre el casco y la caja-mundo. Solo tiene que sellar el vacio
// para qbsp; no se carga ni colisiona en runtime (es el submodelo *0, que el QC
// nunca instancia). Generosa para que ningun brush de la nave la toque.
const SEAL_MARGIN = 64
// Textura de la caja-mundo. No se ve nunca (cara interior de un submodelo no
// cargado), pero qbsp necesita un nombre valido por cara.
const SEAL_TEX = DEFAULT_TEX
// Cuando el perfil lleva sol, la caja-mundo se sella con `sky`: el motor la trata
// como cielo (el sol entra por ahi) y sigue sellando para qbsp/-leaktest.
const SKY_TEX = 'sky'

// "Modo clasico": 8 luces de punto en las esquinas, alrededor del modelo.
// LIGHT8_PAD = holgura (u) entre el AABB y cada luz. LIGHT8_GAIN escala el valor
// `light` con el tamaño del modelo para que el alcance cubra el objeto entero.
const LIGHT8_PAD = 96
const LIGHT8_GAIN = 1.0

/** Params de texturizado de una cara: { tex, scale, offset, rot } o default. */
function texOfFactory(model) {
  return (faceId) => model.faceTextures[faceId] || { tex: DEFAULT_TEX }
}

/**
 * Claves de ILUMINACION del worldspawn (las lee light.exe de ericw-tools).
 *
 * Dos escenarios MUY distintos:
 *
 * 1) MODELO DESNUDO (hull: false). Objeto suelto, sin mundo sellado. Probado:
 *    NO sirven el sol ni las luces colocadas (qbsp las marca "outside", el sol
 *    necesita caras `sky` y no hay). Lo unico fiable es AMBIENTE (_minlight) +
 *    dirt (AO): claro y con relieve, sin "arriba/abajo" real.
 *
 * 2) LAYOUT SELLADO + SOL (hull: true, light.sun). La nave va en func_wall (*1)
 *    dentro de una caja-mundo CON TEXTURA SKY. Ahi `_sunlight` SI entra (por las
 *    caras sky) y hornea el lightmap de la nave con sombreado DIRECCIONAL — deja
 *    de verse plana. Lo activa el perfil starfallsun (SUN_PROFILES).
 *
 * opts.light:
 *   minlight : ambiente global (_minlight). Default 200. Se CLAMPEA a un minimo
 *              de MINLIGHT_FLOOR (190) — un objeto desnudo con minlight bajo sale
 *              NEGRO, asi que no se permite compilar por debajo de ese suelo.
 *   dirt     : 1 activa la oclusion ambiental (perfil hqao).
 *   sun      : 1 activa el sol cenital (_sunlight). Requiere caja-mundo sky
 *              (lo monta writeMap cuando hull && sun).
 */
// Suelo de luz para el MODELO DESNUDO (sin sol): por debajo de esto sale negro,
// porque no hay ninguna fuente que lo rescate. NO aplica cuando hay sol.
const MINLIGHT_FLOOR = 190
// Con SOL, el ambiente baja a este suelo: solo evita el negro ABSOLUTO en las
// caras en sombra; el claroscuro lo dan el sol + el domo. Si fuera alto (190+)
// rellenaria las sombras y el modelo se veria PLANO aunque el lightmap tenga rango.
const MINLIGHT_SUN = 78

// Iluminacion del perfil con sol. Buscamos sombras SUAVES y poco contrastadas:
//   SUN_LIGHT   : sol DIRECTO (cenital). Da el claroscuro principal. Moderado
//                 para no quemar; el domo rellena el resto.
//   SUN2        : _sunlight2 = DOMO de cielo (luz difusa desde todo el hemisferio
//                 superior). Rellena las caras en sombra del sol directo -> baja
//                 el contraste y suaviza. Es lo que evita la sombra "dura".
//   PENUMBRA    : ablanda el BORDE de la sombra del sol directo (grados). Mas =
//                 transicion luz/sombra mas difusa.
// La OCLUSION AMBIENTAL (dirt) la activan los flags del perfil starfallsun en
// compileTools.js: oscurece rincones y zonas tapadas por voladizos -> la nave
// proyecta sombra suave sobre si misma.
const SUN_LIGHT = 180     // sol directo: moderado, el domo aporta el resto
const SUN_MANGLE = '0 -90 0'
const SUN2 = 225          // domo de cielo (luz difusa de relleno; alto = sombras suaves)
const SUN_PENUMBRA = 24   // grados de borde blando del sol directo

function worldLightKeys(light = {}) {
  const { dirt = 0, phong = 0, sun = 0 } = light
  // Suelo ambiente: bajo con sol (deja ver sombras), alto sin sol (evita negro).
  const ml = sun
    ? MINLIGHT_SUN
    : Math.max(MINLIGHT_FLOOR, light.minlight ?? 200)
  const keys = [`"_minlight" "${ml}"`]
  if (sun) {
    // Sol directo cenital + domo de cielo difuso + borde blando: claroscuro con
    // sombras SUAVES, no duras. Entra por las caras sky de la caja-mundo y
    // hornea el lightmap de la nave (*1).
    keys.push(`"_sunlight" "${SUN_LIGHT}"`)
    keys.push(`"_sun_mangle" "${SUN_MANGLE}"`)
    keys.push(`"_sunlight2" "${SUN2}"`)
    keys.push(`"_sunlight_penumbra" "${SUN_PENUMBRA}"`)
  }
  if (dirt) {
    keys.push('"_dirt" "1"')          // oclusion ambiental (AO) por mapa
    keys.push('"_minlight_dirt" "1"') // el ambiente respeta la oclusion
  }
  if (phong) {
    // Phong: suaviza el sombreado entre caras adyacentes -> piezas facetadas
    // (bola, chamferBox) se ven REDONDEADAS sin añadir geometria. El angulo es
    // el umbral: caras con normales a <= N grados se mezclan.
    keys.push('"_phong" "1"')
    keys.push(`"_phong_angle" "${typeof phong === 'number' && phong > 1 ? phong : 89}"`)
  }
  return keys
}

/**
 * AABB en mundo de TODAS las caras instanciadas. Devuelve { min:[x,y,z],
 * max:[x,y,z] } o null si no hay geometria.
 */
function modelAABB(instances) {
  let min = [Infinity, Infinity, Infinity]
  let max = [-Infinity, -Infinity, -Infinity]
  let any = false
  for (const inst of instances) {
    for (const brush of inst.brushes) {
      for (const f of brush) {
        for (const v of f.verts) {
          any = true
          for (let i = 0; i < 3; i++) {
            if (v[i] < min[i]) min[i] = v[i]
            if (v[i] > max[i]) max[i] = v[i]
          }
        }
      }
    }
  }
  return any ? { min, max } : null
}

/**
 * Un brush de caja AXIAL solido [min..max] en Valve 220. Convencion
 * TrenchBroom: 3 planos por la esquina MIN y 3 por la esquina MAX, normales
 * hacia afuera. Copiado verbatim de ultimata/tools/lib/map.mjs (boxBrush), que
 * es el que ya sella bien sector1.bsp; mi version a mano dejaba caras sin
 * "visible sides" y qbsp descartaba el brush -> el sellado no sellaba.
 */
function axialBoxBrush([x0, y0, z0], [x1, y1, z1], tex) {
  const l = []
  l.push(`( ${x0} ${y0} ${z0} ) ( ${x0} ${y0 + 1} ${z0} ) ( ${x0} ${y0} ${z0 + 1} ) ${tex} [ 0 -1 0 0 ] [ 0 0 -1 0 ] 0 1 1`)
  l.push(`( ${x0} ${y0} ${z0} ) ( ${x0} ${y0} ${z0 + 1} ) ( ${x0 + 1} ${y0} ${z0} ) ${tex} [ 1 0 0 0 ] [ 0 0 -1 0 ] 0 1 1`)
  l.push(`( ${x0} ${y0} ${z0} ) ( ${x0 + 1} ${y0} ${z0} ) ( ${x0} ${y0 + 1} ${z0} ) ${tex} [ -1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1`)
  l.push(`( ${x1} ${y1} ${z1} ) ( ${x1} ${y1 + 1} ${z1} ) ( ${x1 + 1} ${y1} ${z1} ) ${tex} [ 1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1`)
  l.push(`( ${x1} ${y1} ${z1} ) ( ${x1 + 1} ${y1} ${z1} ) ( ${x1} ${y1} ${z1 + 1} ) ${tex} [ -1 0 0 0 ] [ 0 0 -1 0 ] 0 1 1`)
  l.push(`( ${x1} ${y1} ${z1} ) ( ${x1} ${y1} ${z1 + 1} ) ( ${x1} ${y1 + 1} ${z1} ) ${tex} [ 0 1 0 0 ] [ 0 0 -1 0 ] 0 1 1`)
  return '{\n' + l.join('\n') + '\n}'
}

/**
 * Caja-mundo HUECA y SELLADA que contiene la nave: 6 losas axiales (una por
 * pared) formando un cascaron. Cada losa es un brush solido de SHELL de grosor
 * fijo; el interior queda vacio para que info_player_start y la nave "respiren"
 * y qbsp no vea leak. Devuelve un array de brushes (texto).
 */
function sealBoxBrushes(aabb, margin, tex) {
  const lo = [aabb.min[0] - margin, aabb.min[1] - margin, aabb.min[2] - margin]
  const hi = [aabb.max[0] + margin, aabb.max[1] + margin, aabb.max[2] + margin]
  const t = 16 // grosor de pared
  const [ox, oy, oz] = [lo[0] - t, lo[1] - t, lo[2] - t]
  const [px, py, pz] = [hi[0] + t, hi[1] + t, hi[2] + t]
  return [
    axialBoxBrush([ox, oy, oz], [px, py, lo[2]], tex),   // suelo  (-Z)
    axialBoxBrush([ox, oy, hi[2]], [px, py, pz], tex),   // techo  (+Z)
    axialBoxBrush([ox, oy, oz], [lo[0], py, pz], tex),   // pared -X
    axialBoxBrush([hi[0], oy, oz], [px, py, pz], tex),   // pared +X
    axialBoxBrush([ox, oy, oz], [px, lo[1], pz], tex),   // pared -Y
    axialBoxBrush([ox, hi[1], oz], [px, py, pz], tex),   // pared +Y
  ]
}

/**
 * 8 entidades `light` (point lights de Quake) repartidas en las 8 direcciones
 * diagonales (las 8 esquinas) ALREDEDOR del modelo. Iluminan el objeto desde
 * todos los lados — el "Modo clasico": nada de sol ni domo, solo luces puntuales
 * como en los mapas de Quake de toda la vida. NO necesita caja de sellado: son
 * entidades-punto, light.exe traza la luz directa hacia la geometria del bmodel.
 *
 * Cada luz se coloca a una distancia LIGHT8_PAD del AABB en su esquina y con un
 * valor `light` proporcional al tamaño del modelo (asi un modelo grande no se
 * queda corto de alcance). Devuelve un array de textos de entidad.
 */
function classicLights(aabb) {
  const c = [
    (aabb.min[0] + aabb.max[0]) / 2,
    (aabb.min[1] + aabb.max[1]) / 2,
    (aabb.min[2] + aabb.max[2]) / 2,
  ]
  // Semi-diagonal del AABB + holgura -> radio donde plantamos las luces.
  const half = [
    (aabb.max[0] - aabb.min[0]) / 2,
    (aabb.max[1] - aabb.min[1]) / 2,
    (aabb.max[2] - aabb.min[2]) / 2,
  ]
  const diag = Math.sqrt(half[0] ** 2 + half[1] ** 2 + half[2] ** 2)
  const r = diag + LIGHT8_PAD
  // Intensidad: alcanza con margen desde la esquina hasta el centro del modelo.
  const value = Math.round((r + diag) * LIGHT8_GAIN)
  const ents = []
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const ox = Math.round(c[0] + sx * r)
        const oy = Math.round(c[1] + sy * r)
        const oz = Math.round(c[2] + sz * r)
        ents.push([
          '{',
          '"classname" "light"',
          `"origin" "${ox} ${oy} ${oz}"`,
          `"light" "${value}"`,
          '}',
        ].join('\n'))
      }
    }
  }
  return ents
}

/**
 * Sanea el texto de un anclaje para usarlo como `classname` en el .map. Un
 * classname no puede llevar comillas ni saltos de linea (rompen el parser de
 * qbsp). Conservamos espacios y el resto tal cual ("frontal barrage" es valido).
 */
function sanitizeClassname(label) {
  return String(label).replace(/["\r\n]/g, ' ').trim()
}

/**
 * Entidad-PUNTO invisible de un marcador (anchor). NO lleva brushes, asi que es
 * un point entity: queda escrita en el lump ENTITIES del .bsp pero no produce
 * geometria ni colision. classname = el texto del anclaje; origin = centro de la
 * celda en mundo; direction = vector de la flecha (+X local rotado por rot);
 * angle = yaw de esa direccion (convencion Quake), por si algo lo quiere leer.
 *
 * Devuelve el texto de la entidad o null si el anclaje no tiene texto (sin
 * classname no tiene sentido emitirla).
 */
function markerEntity(block, cellSize) {
  const cls = sanitizeClassname(block.label || '')
  if (!cls) return null
  const [ox, oy, oz] = cellCenter(block.cell, cellSize).map(Math.round)
  // Direccion de la flecha: +X local del bloque rotado por su orientacion.
  const d = applyOrient(block.rot | 0, [1, 0, 0])
  const yaw = Math.round((Math.atan2(d[1], d[0]) * 180 / Math.PI + 360) % 360)
  const pitch = Math.round(Math.asin(Math.max(-1, Math.min(1, d[2]))) * 180 / Math.PI)
  return [
    '{',
    `"classname" "${cls}"`,
    `"origin" "${ox} ${oy} ${oz}"`,
    `"direction" "${d[0].toFixed(4)} ${d[1].toFixed(4)} ${d[2].toFixed(4)}"`,
    `"angle" "${yaw}"`,
    `"mangle" "${yaw} ${pitch} 0"`,
    '}',
  ].join('\n')
}

/**
 * Escribe el .map completo. Devuelve { map, textures } donde textures es el set
 * de nombres de textura usados (para construir el WAD).
 *
 * opts.light: { minlight, dirt, phong } — ver worldLightKeys.
 * opts.hull:  true -> layout de COLISION DE CASCO. La nave va en un func_wall
 *             (submodelo *1) dentro de una caja-mundo sellada en el worldspawn,
 *             para que qbsp construya el hull 1. Default false (modelo desnudo,
 *             el bmodel 0 sale con hull 1 vacio -> solo sirve con SOLID_BBOX).
 */
export function writeMap(project, { wad = 'textures.wad', light = {}, hull = false } = {}) {
  const model = deserialize(project)
  const instances = instanceModel(model)
  const texOf = texOfFactory(model)

  const shipBrushes = []
  const markerEntities = []
  const usedTextures = new Set([DEFAULT_TEX])
  for (const inst of instances) {
    // Los MARCADORES (anchor) no aportan geometria: emiten una entidad-punto
    // invisible (su texto -> classname) y NO brushes. Saltamos sus brushes.
    if (isMarker(inst.block.key)) {
      const ent = markerEntity(inst.block, model.cellSize)
      if (ent) markerEntities.push(ent)
      continue
    }
    for (const brush of inst.brushes) {
      for (const f of brush) usedTextures.add(texOf(f.faceId).tex)
      shipBrushes.push(brushFromFaces(brush, texOf))
    }
  }

  if (!hull) {
    // Modelo desnudo: la nave entera en el worldspawn (bmodel 0). Sin sellado.
    // Los marcadores van como entidades-punto APARTE del worldspawn.
    // El "Modo clasico" (light.lights8) rodea el modelo con 8 luces de punto:
    // entidades aparte, sin caja de sellado.
    let lightEnts = []
    if (light.lights8) {
      const solid = instances.filter((inst) => !isMarker(inst.block.key))
      const aabb = modelAABB(solid)
      if (aabb) lightEnts = classicLights(aabb)
    }
    const world = [
      '{',
      '"classname" "worldspawn"',
      `"wad" "${wad}"`,
      ...worldLightKeys(light),
      ...shipBrushes,
      '}',
      ...markerEntities,
      ...lightEnts,
    ].join('\n')
    return { map: world + '\n', textures: [...usedTextures] }
  }

  // Layout de COLISION DE CASCO:
  //   worldspawn (bmodel *0) = caja-mundo sellada (NO se carga en runtime)
  //   func_wall  (bmodel *1) = la nave solida (esto carga el QC, SOLID_BSP)
  //   info_player_start      = punto interior, para que -leaktest no aborte
  // La caja-mundo solo debe envolver la geometria SOLIDA: los marcadores no
  // cuentan (no tienen brushes en el .bsp, su "geometria" es solo de editor).
  const solidInstances = instances.filter((inst) => !isMarker(inst.block.key))
  const aabb = modelAABB(solidInstances)
  if (!aabb) throw new Error('Modelo vacio: no se puede sellar la caja-mundo')

  // Con sol, la caja-mundo se sella con `sky` para que _sunlight entre por ahi.
  const sealTex = light.sun ? SKY_TEX : SEAL_TEX
  if (light.sun) usedTextures.add(SKY_TEX) // el WAD debe llevar la textura sky
  const sealBrushes = sealBoxBrushes(aabb, SEAL_MARGIN, sealTex)
  // Punto de jugador dentro del hueco, separado de toda geometria.
  const start = [
    Math.round((aabb.min[0] + aabb.max[0]) / 2),
    aabb.min[1] - SEAL_MARGIN + 8,
    Math.round((aabb.min[2] + aabb.max[2]) / 2),
  ]

  const world = [
    '{',
    '"classname" "worldspawn"',
    `"wad" "${wad}"`,
    ...worldLightKeys(light),
    ...sealBrushes,
    '}',
    '{',
    '"classname" "func_wall"',
    ...shipBrushes,
    '}',
    '{',
    '"classname" "info_player_start"',
    `"origin" "${start[0]} ${start[1]} ${start[2]}"`,
    '}',
    ...markerEntities,
  ].join('\n')

  return { map: world + '\n', textures: [...usedTextures] }
}
