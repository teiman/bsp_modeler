/**
 * Corre qbsp (+ light) sobre tmp/<base>.map.
 *
 * Adaptado de editor-map/src/main/compileTools.js. Streamea stdout/stderr
 * linea a linea via onLog y para al primer exit code != 0. qbsp escribe un
 * .pts cuando -leaktest detecta un leak: lo reportamos como fallo aunque qbsp
 * salga con 0.
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { BIN_DIR, TMP_DIR } from './paths.js'
import { HULL_PROFILES } from './mapWriter.js'

// Modelo-objeto desnudo (bmodel), no un nivel: SIN -leaktest (no hay mundo
// sellado que comprobar). -bsp2 = formato BSP2. NO usamos -noclip: los hulls
// de colision del modelo deben generarse.
const QBSP_FLAGS = ['-bsp2', '-worldextent', '32768']

// NINGUN perfil corre vis. vis precalcula la visibilidad entre portales de un
// NIVEL y necesita un .prt valido, que qbsp solo escribe con un mapa SELLADO.
// Aqui todo son objetos-modelo desnudos (sin caja) -> el .prt sale vacio y vis
// aborta con "unknown header/empty portal file". Para un objeto-modelo vis no
// aporta nada de todos modos: qbsp + light bastan.

// Como QBSP_FLAGS pero con -leaktest: la nave va en un func_wall dentro de una
// caja-mundo sellada (mapWriter, opts.hull) y EXIGIMOS que no haya fuga, porque
// es justo lo que garantiza que qbsp construya el hull 1 del submodelo *1. Si
// el .map filtrara, preferimos fallar a producir un .bsp con colision rota.
const QBSP_FLAGS_SEALED = ['-bsp2', '-worldextent', '32768', '-leaktest']

const PROFILES = {
  // Solo geometria, sin luz. El .bsp se vera oscuro (r_fullbright 1 en consola).
  flat: [{ name: 'qbsp', exe: 'qbsp.exe', args: QBSP_FLAGS }],
  // COLISION DE CASCO para Starfall: nave en func_wall (*1) + caja-mundo
  // sellada (*0). qbsp con -leaktest construye el hull 1 -> SOLID_BSP usable.
  // light suaviza el casco; la caja-mundo no se ve (submodelo *0 no cargado).
  starfall: [
    { name: 'qbsp', exe: 'qbsp.exe', args: QBSP_FLAGS_SEALED },
    { name: 'light', exe: 'light.exe', args: ['-extra4', '-soft'] },
  ],
  // Como starfall pero con SOL CENITAL y sombras SUAVES: la caja-mundo sellada
  // lleva textura `sky`, asi el sol directo + el domo de cielo (_sunlight/
  // _sunlight2, worldspawn, los pone el mapWriter) entran desde arriba y hornean
  // el lightmap de la nave (*1). -dirt añade OCLUSION AMBIENTAL: rincones y
  // zonas tapadas por voladizos se oscurecen -> la nave proyecta sombra suave
  // sobre si misma. -soft difumina el lightmap (bordes menos duros).
  starfallsun: [
    { name: 'qbsp', exe: 'qbsp.exe', args: QBSP_FLAGS_SEALED },
    { name: 'light', exe: 'light.exe', args: ['-extra4', '-soft', '-dirt', '-dirtdepth', '128', '-dirtgain', '0.4'] },
  ],
  fast: [
    { name: 'qbsp', exe: 'qbsp.exe', args: QBSP_FLAGS },
    { name: 'light', exe: 'light.exe', args: ['-sunsamples', '1'] },
  ],
  // MODO CLASICO: sin caja de sellado. El mapWriter rodea el modelo con 8 luces
  // de punto (classname "light") en las 8 esquinas -> el objeto se ilumina desde
  // todos los lados, como un objeto en un mapa de Quake clasico. Sin dirt ni sol:
  // solo light.exe trazando la luz directa de esas 8 fuentes. -extra4/-soft para
  // un lightmap limpio y bordes suaves.
  classic: [
    { name: 'qbsp', exe: 'qbsp.exe', args: QBSP_FLAGS },
    { name: 'light', exe: 'light.exe', args: ['-extra4', '-soft'] },
  ],
  hq: [
    { name: 'qbsp', exe: 'qbsp.exe', args: QBSP_FLAGS },
    { name: 'light', exe: 'light.exe', args: ['-extra4', '-soft'] },
  ],
  // hq + OCLUSION AMBIENTAL (dirt): rincones y esquinas mas oscuros, mucho mas
  // volumen. light.exe (ericw-tools) lee _dirt del worldspawn (lo pone el
  // mapWriter) y estos flags afinan profundidad/intensidad del efecto.
  //   -dirt      activa el dirt mapping
  //   -dirtdepth alcance del trazado de oclusion (u). mas = sombras mas amplias
  //   -dirtgain  curva de intensidad (mas = mas contraste en los rincones)
  hqao: [
    { name: 'qbsp', exe: 'qbsp.exe', args: QBSP_FLAGS },
    { name: 'light', exe: 'light.exe', args: ['-extra4', '-soft', '-dirt', '-dirtdepth', '128', '-dirtgain', '1'] },
  ],
  // hq + AO + PHONG: ademas suaviza el sombreado entre caras adyacentes
  // (_phong en el worldspawn, lo pone el mapWriter) -> piezas facetadas como la
  // bola o el chamferBox se ven REDONDEADAS, sin añadir geometria. Mismas
  // herramientas que hqao; el phong es una clave del worldspawn, no un flag.
  hqaop: [
    { name: 'qbsp', exe: 'qbsp.exe', args: QBSP_FLAGS },
    { name: 'light', exe: 'light.exe', args: ['-extra4', '-soft', '-dirt', '-dirtdepth', '128', '-dirtgain', '1'] },
  ],
}

// Perfiles que quieren oclusion ambiental (dirt) -> el mapWriter añade _dirt 1.
export const AO_PROFILES = new Set(['hqao', 'hqaop'])
// Perfiles que quieren phong (suavizado de caras) -> el mapWriter añade _phong 1.
export const PHONG_PROFILES = new Set(['hqaop'])
// Perfiles con SOL CENITAL: el mapWriter sella la caja-mundo con textura `sky` y
// añade _sunlight al worldspawn -> la nave (*1) recibe sombreado direccional.
export const SUN_PROFILES = new Set(['starfallsun'])
// Perfiles "Modo clasico": el mapWriter rodea el modelo con 8 luces de punto en
// las esquinas (sin caja de sellado). Activa light.lights8 en writeMap.
export const LIGHTS8_PROFILES = new Set(['classic'])

function runTool(tool, mapBase, onLog) {
  return new Promise((resolve, reject) => {
    const exePath = path.join(BIN_DIR, tool.exe)
    const args = [...tool.args, mapBase]
    onLog(`$ ${tool.exe} ${args.join(' ')}`)
    const child = spawn(exePath, args, { cwd: TMP_DIR, windowsHide: true })
    let out = '', err = ''
    const flush = (buf) => {
      const lines = buf.split(/\r?\n/)
      const carry = lines.pop()
      for (const l of lines) if (l.length) onLog(l)
      return carry
    }
    child.stdout.on('data', (c) => { out = flush(out + c.toString('utf8')) })
    child.stderr.on('data', (c) => { err = flush(err + c.toString('utf8')) })
    child.on('error', reject)
    child.on('close', (code) => {
      if (out) onLog(out)
      if (err) onLog(err)
      onLog(`(${tool.name} terminó con código ${code})`)
      resolve(code ?? -1)
    })
  })
}

async function fileExists(p) { try { await fs.access(p); return true } catch { return false } }

/**
 * @returns { ok, bspPath, lastTool, exitCode }
 */
export async function compileMap(mapBase, onLog, opts = {}) {
  const tools = PROFILES[opts.quality] || PROFILES.hq
  const mapFile = path.join(TMP_DIR, `${mapBase}.map`)
  if (!(await fileExists(mapFile))) throw new Error(`Map no encontrado: ${mapFile}`)

  for (const ext of ['.bsp', '.pts', '.lit', '.prt']) {
    try { await fs.unlink(path.join(TMP_DIR, mapBase + ext)) } catch {}
  }

  // El leak SOLO es un fallo en los perfiles de casco: ahi un .pts significa que
  // qbsp no construyo el hull 1 del func_wall (*1) -> colision rota. En un modelo
  // DESNUDO (flat/hq/fast/classic...) no hay caja: el .pts es esperado e inocuo
  // (p. ej. las 8 luces del Modo clasico viven "fuera" de la geometria), no debe
  // abortar la compilacion.
  const failOnLeak = HULL_PROFILES.has(opts.quality)

  for (const tool of tools) {
    const code = await runTool(tool, mapBase, onLog)
    if (code !== 0) return { ok: false, bspPath: null, lastTool: tool.name, exitCode: code }
    // qbsp puede salir 0 y aun asi escribir un .pts si el mapa filtra (leak).
    // Un leak deja los hulls sin construir -> lo tratamos como fallo del qbsp.
    if (failOnLeak && tool.name === 'qbsp' && (await fileExists(path.join(TMP_DIR, `${mapBase}.pts`)))) {
      onLog('LEAK: qbsp escribio un .pts (mapa no sellado). Hulls no construidos.')
      return { ok: false, bspPath: null, lastTool: 'qbsp', exitCode: -2 }
    }
  }
  const lastTool = tools[tools.length - 1]?.name ?? 'qbsp'
  return { ok: true, bspPath: path.join(TMP_DIR, `${mapBase}.bsp`), lastTool, exitCode: 0 }
}

/** ¿Está disponible el toolchain (qbsp.exe presente)? */
export async function toolchainAvailable() {
  return fileExists(path.join(BIN_DIR, 'qbsp.exe'))
}
