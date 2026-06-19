/**
 * Cliente de la API del servidor de compilacion. El navegador NUNCA toca
 * binarios ni disco: todo pasa por estos endpoints (proxyeados a :7777 por
 * Vite, ver vite.config.js).
 */

/** Lista de texturas predefinidas: [{ id, url }]. */
export async function fetchTextures() {
  const r = await fetch('/api/textures')
  if (!r.ok) throw new Error('No se pudieron cargar las texturas')
  return r.json()
}

/**
 * Compila el modelo a BSP. Devuelve { ok, log, bspUrl?, error? }.
 * El log llega completo (no streaming) para mantener el cliente simple.
 */
export async function compileModel(project, quality = 'fast') {
  const r = await fetch('/api/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, quality }),
  })
  return r.json()
}
