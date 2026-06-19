<script setup>
/**
 * Catalogo de modelos guardados (estilo modules_editor2). Guarda el modelo
 * actual con un nombre, lista los guardados como tarjetas, y permite cargar,
 * borrar y exportar/importar todo el catalogo. Del usuario (localStorage).
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { store } from '../store.js'
import {
  listDesigns, saveDesign, deleteDesign, designExists, exportCatalog, importCatalog,
} from '../core/designLibrary.js'

const designs = ref([])
const name = ref(store.fileName)

function refresh() {
  designs.value = listDesigns().map((e) => ({
    ...e,
    count: (e.data && e.data.blocks && e.data.blocks.length) || 0,
  }))
}

function fmtDate(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString() } catch { return '' }
}

function saveCurrent() {
  if (store.isEmpty()) { alert('El modelo está vacío: no hay nada que guardar.'); return }
  const n = name.value.trim()
  if (!n) { alert('Ponle un nombre al modelo.'); return }
  if (designExists(n) && !confirm(`Ya existe un modelo "${n}". ¿Sobrescribirlo?`)) return
  saveDesign(n, store.exportProject())
  store.setFileName(n)
  refresh()
}

function load(entry) {
  if (!store.isEmpty() && !confirm(`¿Cargar "${entry.name}"? Sustituirá el modelo actual (puedes deshacer).`)) return
  store.loadProject(entry.data, entry.name)
  name.value = entry.name
  store.closeCatalog()
}

function remove(entry) {
  if (!confirm(`¿Borrar "${entry.name}" del catálogo?`)) return
  deleteDesign(entry.name)
  refresh()
}

function exportAll() {
  const blob = new Blob([JSON.stringify(exportCatalog(), null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'catalogo.json'
  a.click()
}

const fileInput = ref(null)
async function importAll(e) {
  const file = e.target.files[0]
  if (!file) return
  try {
    const data = JSON.parse(await file.text())
    let replace = false
    if (designs.value.length) {
      replace = confirm('¿Reemplazar el catálogo actual?\n\nAceptar = reemplazar todo.\nCancelar = fusionar (los nombres repetidos se sobrescriben).')
    }
    const n = importCatalog(data, { replace })
    refresh()
    alert(`Catálogo importado. ${n} modelos en total.`)
  } catch (err) { alert('No se pudo importar: ' + err.message) }
  e.target.value = ''
}

function onKey(e) { if (e.key === 'Escape') store.closeCatalog() }

onMounted(() => { refresh(); window.addEventListener('keydown', onKey) })
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="catalog">
    <header>
      <span class="title">📁 Catálogo de modelos</span>
      <div class="save">
        <input type="text" v-model="name" placeholder="nombre del modelo" @keyup.enter="saveCurrent" />
        <button class="primary" @click="saveCurrent">Guardar modelo actual</button>
      </div>
      <div class="io">
        <button @click="exportAll" :disabled="!designs.length">Exportar catálogo</button>
        <button @click="fileInput.click()">Importar catálogo</button>
        <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="importAll" />
      </div>
      <button class="close" @click="store.closeCatalog()" title="Cerrar (Esc)">✕</button>
    </header>

    <div class="body">
      <p v-if="!designs.length" class="empty">
        No hay modelos guardados todavía. Construye algo, ponle nombre y pulsa
        «Guardar modelo actual».
      </p>
      <div class="grid">
        <div v-for="e in designs" :key="e.name" class="card" @click="load(e)">
          <button class="del" title="Borrar" @click.stop="remove(e)">🗑</button>
          <div class="thumb">📦</div>
          <span class="cname">{{ e.name }}</span>
          <span class="meta">{{ e.count }} bloques</span>
          <span class="date">{{ fmtDate(e.savedAt) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.catalog { position: fixed; inset: 0; z-index: 60; display: flex; flex-direction: column; background: #0e0c14; }
header {
  display: flex; align-items: center; gap: 12px; padding: 10px 16px;
  border-bottom: 1px solid #2e2a3a; background: #1b1922; flex-wrap: wrap;
}
.title { font: 600 15px system-ui; color: #b69bff; }
.save { display: flex; gap: 6px; align-items: center; }
.save input {
  width: 200px; background: #232029; color: #e6e0f2; border: 1px solid #3a3647;
  border-radius: 5px; padding: 6px 9px; font: 13px system-ui;
}
.save input:focus { outline: none; border-color: #6f4bd8; }
.io { display: flex; gap: 6px; }
.spacer { flex: 1; }
button {
  background: #2a2733; color: #cfc4e4; border: 1px solid #3a3647;
  padding: 6px 12px; border-radius: 5px; font: 13px system-ui; cursor: pointer;
}
button:hover { border-color: #6f4bd8; }
button:disabled { opacity: 0.45; cursor: default; }
button.primary { background: #2f7d4f; color: #fff; border-color: #3ba066; }
.close { margin-left: auto; width: 34px; padding: 6px 0; }
.close:hover { background: #3a1f22; border-color: #c4524a; color: #fff; }
.body { flex: 1; overflow: auto; padding: 16px; }
.empty { color: #8e83a6; text-align: center; margin-top: 60px; font: 14px system-ui; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.card {
  position: relative; background: #201d29; border: 1px solid #2e2a3a; border-radius: 8px;
  padding: 14px 10px 10px; display: flex; flex-direction: column; align-items: center; gap: 3px; cursor: pointer;
}
.card:hover { border-color: #6f4bd8; background: #261f33; }
.thumb { font-size: 38px; line-height: 1; margin-bottom: 4px; }
.cname { font: 600 13px system-ui; color: #e6e0f2; text-align: center; word-break: break-word; }
.meta { font: 11px system-ui; color: #9d93b0; text-transform: uppercase; letter-spacing: 0.5px; }
.date { font: 10px system-ui; color: #6f6685; }
.del {
  position: absolute; top: 6px; right: 6px; width: 26px; height: 26px; padding: 0;
  font-size: 12px; opacity: 0; transition: opacity 0.15s;
}
.card:hover .del { opacity: 1; }
.del:hover { background: #3a1f22; border-color: #c4524a; }
</style>
