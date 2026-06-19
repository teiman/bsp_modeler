<script setup>
import { onMounted } from 'vue'
import { store } from './store.js'
import { fetchTextures } from './api.js'
import Toolbar from './components/Toolbar.vue'
import Viewport3D from './components/Viewport3D.vue'
import ModulePalette from './components/ModulePalette.vue'
import TexturePalette from './components/TexturePalette.vue'
import DesignCatalog from './components/DesignCatalog.vue'

/** Carga una imagen (para el atlas) desde una URL; resuelve null si falla. */
function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

onMounted(async () => {
  try {
    const list = await fetchTextures() // [{ id, url }]
    const withImages = await Promise.all(
      list.map(async (t) => ({ ...t, image: await loadImage(t.url) })),
    )
    store.setTextures(withImages)
  } catch {
    // Sin servidor de texturas: el editor funciona igual, con el tile a cuadros.
  }
})
</script>

<template>
  <div class="app">
    <Toolbar />
    <div class="body">
      <aside class="left"><ModulePalette /></aside>
      <Viewport3D />
      <aside class="right"><TexturePalette /></aside>
    </div>
    <DesignCatalog v-if="store.catalogOpen" />
  </div>
</template>

<style scoped>
.app { display: flex; flex-direction: column; height: 100vh; }
.body { display: flex; flex: 1; min-height: 0; }
.left, .right { width: 210px; background: #201d29; overflow-y: auto; flex-shrink: 0; }
.left { border-right: 1px solid #2e2a3a; }
.right { border-left: 1px solid #2e2a3a; }
</style>
