/**
 * Corre qbsp (+ vis + light) sobre tmp/<base>.map.
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

const QBSP_FLAGS = ['-bsp2', '-worldextent', '32768', '-leaktest']

const PROFILES = {
  // Solo geometria, sin luz. El .bsp se vera oscuro (r_fullbright 1 en consola).
  flat: [{ name: 'qbsp', exe: 'qbsp.exe', args: QBSP_FLAGS }],
  fast: [
    { name: 'qbsp', exe: 'qbsp.exe', args: QBSP_FLAGS },
    { name: 'light', exe: 'light.exe', args: ['-sunsamples', '1'] },
  ],
  hq: [
    { name: 'qbsp', exe: 'qbsp.exe', args: QBSP_FLAGS },
    { name: 'vis', exe: 'vis.exe', args: ['-fast'] },
    { name: 'light', exe: 'light.exe', args: ['-extra4', '-soft'] },
  ],
}

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
 * @returns { ok, leaked, bspPath, lastTool, exitCode }
 */
export async function compileMap(mapBase, onLog, opts = {}) {
  const tools = PROFILES[opts.quality] || PROFILES.fast
  const mapFile = path.join(TMP_DIR, `${mapBase}.map`)
  if (!(await fileExists(mapFile))) throw new Error(`Map no encontrado: ${mapFile}`)

  for (const ext of ['.bsp', '.pts', '.lit', '.prt']) {
    try { await fs.unlink(path.join(TMP_DIR, mapBase + ext)) } catch {}
  }

  for (const tool of tools) {
    const code = await runTool(tool, mapBase, onLog)
    if (code !== 0) return { ok: false, leaked: false, bspPath: null, lastTool: tool.name, exitCode: code }
    if (tool.name === 'qbsp') {
      if (await fileExists(path.join(TMP_DIR, `${mapBase}.pts`))) {
        onLog(`LEAK detectado (${mapBase}.pts)`)
        return { ok: false, leaked: true, bspPath: null, lastTool: 'qbsp', exitCode: 0 }
      }
    }
  }
  const lastTool = tools[tools.length - 1]?.name ?? 'qbsp'
  return { ok: true, leaked: false, bspPath: path.join(TMP_DIR, `${mapBase}.bsp`), lastTool, exitCode: 0 }
}

/** ¿Está disponible el toolchain (qbsp.exe presente)? */
export async function toolchainAvailable() {
  return fileExists(path.join(BIN_DIR, 'qbsp.exe'))
}
