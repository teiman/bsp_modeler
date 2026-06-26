<script setup>
import { ref, computed } from 'vue'
import { store } from '../store.js'
import { compileModel } from '../api.js'

const compiling = ref(false)
const log = ref('')
const bspUrl = ref(null)

/** Nombre de fichero seguro para la descarga: <nombre del modelo>.bsp */
const bspFileName = computed(() => {
  const safe = (store.fileName || 'modelo').trim().replace(/[^\w.-]+/g, '_') || 'modelo'
  return `${safe}.bsp`
})

/** URL de descarga con el nombre del modelo (el servidor pone Content-Disposition). */
const bspDownloadUrl = computed(() =>
  bspUrl.value ? `${bspUrl.value}?name=${encodeURIComponent(bspFileName.value)}` : null
)
const quality = ref('hq')
const logOpen = ref(false)      // panel flotante visible
const logCollapsed = ref(false) // solo la barra de titulo

async function compile() {
  compiling.value = true
  log.value = 'Compilando...'
  bspUrl.value = null
  logOpen.value = true          // se abre flotando al compilar
  logCollapsed.value = false
  try {
    const res = await compileModel(store.exportProject(), quality.value)
    log.value = res.log || res.error || '(sin salida)'
    if (res.ok && res.bspUrl) bspUrl.value = res.bspUrl
  } catch (e) {
    log.value = 'Error: no se pudo contactar el servidor de compilación.\n' +
      'Arráncalo con `pnpm start`.\n\n' + (e?.message || e)
  } finally {
    compiling.value = false
  }
}

function saveProject() {
  const data = JSON.stringify(store.exportProject(), null, 2)
  const blob = new Blob([data], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${store.fileName}.json`
  a.click()
}

const fileInput = ref(null)
function openFile() { fileInput.value.click() }
async function onFile(e) {
  const file = e.target.files[0]
  if (!file) return
  try { store.loadProject(JSON.parse(await file.text())) }
  catch (err) { alert('No se pudo cargar el proyecto: ' + err.message) }
  e.target.value = ''
}
</script>

<template>
  <div class="toolbar">
    <div class="brand">BSP</div>
    <input
      class="modelname"
      type="text"
      :value="store.fileName"
      title="Nombre del modelo"
      @change="store.setFileName($event.target.value)"
    />

    <div class="seg">
      <button :class="{ active: store.mode === 'build' }" @click="store.setMode('build')">Construir (B)</button>
      <button :class="{ active: store.mode === 'paint' }" @click="store.setMode('paint')">Pintar (P)</button>
    </div>

    <button
      class="toggle"
      :class="{ active: store.showAnchors }"
      :title="store.showAnchors ? 'Ocultar anclas (marcadores)' : 'Mostrar anclas (marcadores)'"
      @click="store.toggleAnchors()"
    >⚓ Anclas: {{ store.showAnchors ? 'on' : 'off' }}</button>

    <div class="spacer"></div>

    <button @click="store.undo()" title="Deshacer (Ctrl+Z)">↶</button>
    <button @click="store.redo()" title="Rehacer (Ctrl+Shift+Z)">↷</button>
    <button @click="store.newModel()">Nuevo</button>
    <button @click="store.openCatalog()" title="Catálogo de modelos guardados">📁 Catálogo</button>
    <button @click="openFile">Abrir</button>
    <button @click="saveProject">Guardar</button>
    <input ref="fileInput" type="file" accept=".json" hidden @change="onFile" />

    <select v-model="quality" title="Perfil de compilación">
      <option value="starfall">c1 · Starfall (colisión de casco · SOLID_BSP)</option>
      <option value="starfallsun">c2 · Starfall + sol (casco + luz cenital)</option>
      <option value="hqaop">c3 · alta + AO + Phong (suaviza curvas)</option>
      <option value="hqao">c4 · alta + AO (oclusión ambiental)</option>
      <option value="hq">c5 · alta (luz)</option>
      <option value="classic">c6 · Modo clásico (8 luces alrededor)</option>
      <option value="fast">c7 · rápida</option>
      <option value="flat">c8 · plana (sin luz)</option>
    </select>
    <button class="compile" :disabled="compiling" @click="compile">
      {{ compiling ? 'Compilando…' : 'Compilar BSP' }}
    </button>
    <a v-if="bspUrl" class="dl" :href="bspDownloadUrl" :download="bspFileName">⬇ {{ bspFileName }}</a>
  </div>

  <!-- Log de compilacion: panel FLOTANTE colapsable, por encima del viewport. -->
  <div v-if="logOpen && log" class="logpanel" :class="{ collapsed: logCollapsed }">
    <div class="loghead" @click="logCollapsed = !logCollapsed">
      <span class="caret">{{ logCollapsed ? '▸' : '▾' }}</span>
      <span class="logtitle">Log de compilación</span>
      <span v-if="compiling" class="spin">compilando…</span>
      <span class="grow"></span>
      <a v-if="bspUrl" class="dl small" :href="bspDownloadUrl" :download="bspFileName" @click.stop>⬇ {{ bspFileName }}</a>
      <button class="iconbtn" title="Cerrar" @click.stop="logOpen = false">✕</button>
    </div>
    <pre v-show="!logCollapsed" class="logbody">{{ log }}</pre>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  background: #1b1922; border-bottom: 1px solid #2e2a3a;
}
.brand { font: 700 15px system-ui; color: #b69bff; }
.modelname {
  width: 150px; background: #232029; color: #e6e0f2; border: 1px solid #3a3647;
  border-radius: 5px; padding: 5px 9px; font: 600 13px system-ui; margin-right: 4px;
}
.modelname:focus { outline: none; border-color: #6f4bd8; }
.spacer { flex: 1; }
button, select, .dl {
  font: 13px system-ui; padding: 5px 10px; border-radius: 5px; cursor: pointer;
  background: #2a2733; color: #cfc4e4; border: 1px solid #3a3647; text-decoration: none;
}
button:hover, select:hover { border-color: #6f4bd8; }
.seg button.active { background: #6f4bd8; color: #fff; border-color: #9b7bff; }
.toggle.active { background: #6f4bd8; color: #fff; border-color: #9b7bff; }
.compile { background: #2f7d4f; color: #fff; border-color: #3ba066; }
.compile:disabled { opacity: 0.6; cursor: default; }
.dl { background: #3a3647; }
/* Panel flotante del log: fijo abajo-derecha, por encima del viewport. */
.logpanel {
  position: fixed; right: 16px; bottom: 16px; z-index: 50;
  width: min(560px, calc(100vw - 32px));
  display: flex; flex-direction: column;
  background: #14121aee; border: 1px solid #3a3647; border-radius: 8px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.55); backdrop-filter: blur(3px);
  overflow: hidden;
}
.loghead {
  display: flex; align-items: center; gap: 8px; padding: 6px 10px; cursor: pointer;
  background: #211d2b; border-bottom: 1px solid #2e2a3a; user-select: none;
}
.logpanel.collapsed .loghead { border-bottom: none; }
.caret { color: #b69bff; width: 12px; }
.logtitle { font: 600 12px system-ui; color: #d9ccf2; }
.spin { font: 11px system-ui; color: #9bdcb0; }
.grow { flex: 1; }
.iconbtn {
  padding: 2px 7px; font: 12px system-ui; line-height: 1;
  background: #2a2733; color: #cfc4e4; border: 1px solid #3a3647; border-radius: 5px; cursor: pointer;
}
.iconbtn:hover { border-color: #6f4bd8; }
.dl.small { padding: 2px 8px; font-size: 12px; }
.logbody {
  max-height: 40vh; overflow: auto; margin: 0; padding: 8px 12px;
  color: #c7e0c7; font: 11px/1.4 ui-monospace, monospace; white-space: pre-wrap;
}
</style>
