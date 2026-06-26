/**
 * Servidor UNICO del BSP Modeler: sirve el frontend Y la API en un solo puerto.
 *
 *   pnpm start   ->  UI + API + compilacion en http://localhost:7777
 *
 * En desarrollo (por defecto) monta Vite en modo middleware: hot-reload del
 * frontend dentro de este mismo proceso, sin segundo servidor ni proxy.
 * Con --prod sirve el `dist/` ya construido (pnpm build).
 *
 * El navegador NUNCA toca binarios ni disco: todo pasa por /api/*.
 *   GET  /api/textures     -> texturas pregeneradas [{ id, url }]
 *   POST /api/compile      -> { project, quality } -> { ok, log, bspUrl?, error? }
 *   GET  /api/tex/:id.png   -> preview PNG de una textura
 *   GET  /api/bsp/:base.bsp -> descarga del .bsp compilado
 */

import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { TMP_DIR, TEXTURES_DIR, ROOT_DIR } from './compile/paths.js'
import { writeMap } from './compile/mapWriter.js'
import { writeWad } from './compile/wadWriter.js'
import { compileMap, toolchainAvailable, AO_PROFILES, PHONG_PROFILES, SUN_PROFILES, LIGHTS8_PROFILES } from './compile/compileTools.js'
import { HULL_PROFILES } from './compile/mapWriter.js'
import { listTextureIds, resolveTexture } from './compile/textures.js'

const PORT = process.env.PORT || 7777
const PROD = process.argv.includes('--prod')
const MAP_BASE = 'model' // base fijo: tmp/model.map -> tmp/model.bsp
const DIST_DIR = path.join(ROOT_DIR, 'dist')

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(obj))
}

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8')
}

// Las texturas que se OFRECEN en la paleta. Fuente de verdad dinamica (se lee
// en cada peticion). De una animacion +N solo se muestra el frame 0 (+0base):
// es el unico que se pinta; +1..+9 existen solo para que el WAD los cicle, asi
// que se ocultan de la paleta. El resto de texturas pasan tal cual.
async function listTextures() {
  const ids = await listTextureIds()
  const shown = ids.filter((id) => {
    const m = /^\+([0-9a-j])/i.exec(id) // frame de animacion?
    return !m || m[1] === '0'           // muestra no-animadas y solo el frame +0
  })
  return shown.map((id) => ({ id, url: `/api/tex/${id}.png` }))
}

async function handleCompile(req, res) {
  const log = []
  const onLog = (line) => log.push(line)
  try {
    const { project, quality } = JSON.parse(await readBody(req))
    // El perfil decide la iluminacion: dirt (oclusion ambiental), phong (suaviza
    // caras adyacentes -> redondea bola/chamferBox) y/o sun (sol cenital via
    // caja-mundo sky, perfil starfallsun).
    const light = {
      dirt: AO_PROFILES.has(quality) ? 1 : 0,
      phong: PHONG_PROFILES.has(quality) ? 1 : 0,
      sun: SUN_PROFILES.has(quality) ? 1 : 0,
      // Modo clasico: 8 luces de punto alrededor del modelo (sin caja sellada).
      lights8: LIGHTS8_PROFILES.has(quality) ? 1 : 0,
    }
    // El perfil "starfall" usa el layout de colision de casco: nave en func_wall
    // (*1) + caja-mundo sellada (*0). Lo activa opts.hull en el mapWriter.
    const hull = HULL_PROFILES.has(quality)

    if (!(await toolchainAvailable())) {
      onLog('Toolchain no encontrado (qbsp.exe).')
      onLog('Copia qbsp/light/vis a ./bin o define BSP_BIN_DIR.')
      onLog('Ej (PowerShell): $env:BSP_BIN_DIR="D:\\code\\ultimata\\editor-map\\bin"; pnpm start')
      const { map } = writeMap(project, { light, hull })
      await fs.mkdir(TMP_DIR, { recursive: true })
      await fs.writeFile(path.join(TMP_DIR, `${MAP_BASE}.map`), map)
      onLog(`Escrito tmp/${MAP_BASE}.map (${map.length} bytes) — sin compilar.`)
      return json(res, 200, { ok: false, log: log.join('\n'), error: 'toolchain ausente' })
    }

    await fs.mkdir(TMP_DIR, { recursive: true })
    const { map, textures } = writeMap(project, { light, hull })
    await fs.writeFile(path.join(TMP_DIR, `${MAP_BASE}.map`), map)
    onLog(`Escrito tmp/${MAP_BASE}.map (${textures.length} texturas${hull ? ', layout colision-casco' : ''})`)

    await writeWad(textures, path.join(TMP_DIR, 'textures.wad'))
    onLog('Escrito tmp/textures.wad')

    const result = await compileMap(MAP_BASE, onLog, { quality })
    if (result.ok) {
      return json(res, 200, { ok: true, log: log.join('\n'), bspUrl: `/api/bsp/${MAP_BASE}.bsp` })
    }
    const error = `fallo en ${result.lastTool}`
    return json(res, 200, { ok: false, log: log.join('\n'), error })
  } catch (e) {
    onLog('Error: ' + (e?.stack || e?.message || e))
    return json(res, 200, { ok: false, log: log.join('\n'), error: String(e?.message || e) })
  }
}

async function serveFile(res, filePath, contentType, downloadName) {
  try {
    const data = await fs.readFile(filePath)
    const headers = { 'Content-Type': contentType }
    if (downloadName) headers['Content-Disposition'] = `attachment; filename="${downloadName}"`
    res.writeHead(200, headers)
    res.end(data)
  } catch {
    res.writeHead(404); res.end('not found')
  }
}

/** Maneja las rutas /api/*. Devuelve true si la peticion era de la API. */
async function handleApi(req, res, p) {
  if (p === '/api/textures' && req.method === 'GET') { await json(res, 200, await listTextures()); return true }
  if (p === '/api/compile' && req.method === 'POST') { await handleCompile(req, res); return true }
  if (p.startsWith('/api/tex/') && p.endsWith('.png')) {
    const id = path.basename(p, '.png')
    // Resuelve raiz, fb/ o all/ para servir el PNG de preview correcto.
    const loc = await resolveTexture(id)
    await serveFile(res, loc ? loc.pngPath : path.join(TEXTURES_DIR, `${id}.png`), 'image/png'); return true
  }
  if (p.startsWith('/api/bsp/') && p.endsWith('.bsp')) {
    // ?name= define el nombre de descarga (el .bsp en disco siempre es model.bsp).
    const u = new URL(req.url, `http://localhost:${PORT}`)
    const raw = u.searchParams.get('name') || path.basename(p)
    const dl = raw.replace(/[^\w.-]+/g, '_').replace(/^_+/, '') || 'modelo.bsp'
    await serveFile(res, path.join(TMP_DIR, path.basename(p)), 'application/octet-stream', dl); return true
  }
  return false
}

// --- Frontend: Vite middleware (dev) o dist/ estatico (--prod) -----------------

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' }

async function makeFrontend() {
  if (PROD) {
    // Sirve el build estatico; cualquier ruta desconocida cae en index.html (SPA).
    return async (req, res) => {
      const url = new URL(req.url, `http://localhost:${PORT}`)
      let file = path.join(DIST_DIR, url.pathname === '/' ? 'index.html' : url.pathname)
      try { await fs.access(file) } catch { file = path.join(DIST_DIR, 'index.html') }
      serveFile(res, file, MIME[path.extname(file)] || 'application/octet-stream')
    }
  }
  // Desarrollo: Vite en modo middleware (hot-reload en este mismo proceso).
  const { createServer } = await import('vite')
  const vite = await createServer({
    root: ROOT_DIR,
    server: { middlewareMode: true },
    appType: 'spa',
  })
  return (req, res) => vite.middlewares(req, res, () => { res.writeHead(404); res.end('not found') })
}

const frontend = await makeFrontend()

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  if (url.pathname.startsWith('/api/')) {
    if (await handleApi(req, res, url.pathname)) return
    res.writeHead(404); return res.end('not found')
  }
  // Todo lo demas (UI, assets, HMR) lo sirve el frontend.
  frontend(req, res)
})

server.listen(PORT, async () => {
  console.log(`\n  BSP Modeler  ->  http://localhost:${PORT}   ${PROD ? '(dist)' : '(dev, hot-reload)'}\n`)
  if (!(await toolchainAvailable())) {
    console.log('  AVISO: qbsp.exe no esta en ./bin. Define BSP_BIN_DIR para compilar.\n')
  }
})
