/**
 * Catalogo de modelos guardados (como el catalogo de modules_editor2).
 *
 * Es del USUARIO: vive en localStorage. Se puede guardar (sobrescribir si el
 * nombre ya existe), cargar, borrar, y exportar/importar todo el catalogo como
 * un .json para copia de seguridad o llevarlo a otra maquina.
 *
 * Cada entrada: { name, savedAt, data } donde `data` es lo que produce
 * model.serialize() (listo para model.deserialize()).
 */

const LS_KEY = 'bsp_modeler:catalog'
const CATALOG_FORMAT = 'bsp-modeler:catalog'

function readAll() {
  try {
    const raw = typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch { return [] }
}

function writeAll(list) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LS_KEY, JSON.stringify(list))
  } catch { /* sin localStorage o cuota llena: ignorar */ }
}

/** Catalogo completo, mas reciente primero. */
export function listDesigns() {
  return readAll().sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''))
}

/** True si ya hay un modelo con ese nombre (para avisar de sobrescritura). */
export function designExists(name) {
  const n = (name || '').trim()
  return readAll().some((d) => d.name === n)
}

/**
 * Guarda (o sobrescribe si el nombre coincide) un modelo. `data` = serialize().
 * `savedAt` se pasa desde fuera para no depender de Date.now() en tests.
 */
export function saveDesign(name, data, savedAt = null) {
  const clean = (name || '').trim().slice(0, 64)
  if (!clean) throw new Error('El modelo necesita un nombre')
  const list = readAll()
  const entry = { name: clean, savedAt: savedAt || new Date().toISOString(), data }
  const i = list.findIndex((d) => d.name === clean)
  if (i >= 0) list[i] = entry
  else list.push(entry)
  writeAll(list)
  return entry
}

/** Borra un modelo del catalogo por nombre. */
export function deleteDesign(name) {
  writeAll(readAll().filter((d) => d.name !== name))
}

/** Serializa TODO el catalogo a un objeto JSON-able (copia de seguridad). */
export function exportCatalog() {
  return { format: CATALOG_FORMAT, version: 1, designs: readAll() }
}

/**
 * Importa un catalogo. Por defecto FUSIONA (nombres repetidos se sobrescriben);
 * con `replace`, sustituye todo. Acepta el objeto { designs } o un array suelto.
 * Devuelve cuantos modelos quedaron en el catalogo.
 */
export function importCatalog(data, { replace = false } = {}) {
  const incoming = Array.isArray(data) ? data : (data && Array.isArray(data.designs) ? data.designs : null)
  if (!incoming) throw new Error('Catalogo no valido')
  const valid = incoming.filter((d) => d && typeof d.name === 'string' && d.data)
  if (replace) { writeAll(valid); return valid.length }
  const list = readAll()
  for (const d of valid) {
    const entry = { name: d.name, savedAt: d.savedAt || new Date().toISOString(), data: d.data }
    const i = list.findIndex((s) => s.name === entry.name)
    if (i >= 0) list[i] = entry
    else list.push(entry)
  }
  writeAll(list)
  return list.length
}
