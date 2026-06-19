<script setup>
import { store } from '../store.js'
</script>

<template>
  <div class="palette">
    <h3>Texturas</h3>
    <label class="whole">
      <input type="checkbox" :checked="store.paintWhole" @change="store.setPaintWhole($event.target.checked)" />
      Pieza entera
    </label>
    <p v-if="!store.textures.length" class="empty">
      Sin texturas. Suelta un <code>.png</code> en <code>textures/</code> y
      arranca el servidor (<code>pnpm start</code>).
    </p>
    <div class="grid">
      <button
        v-for="t in store.textures"
        :key="t.id"
        class="swatch"
        :class="{ active: t.id === store.activeTexture }"
        :title="t.id"
        @click="store.setActiveTexture(t.id)"
      >
        <img v-if="t.url" :src="t.url" :alt="t.id" />
        <span class="label">{{ t.id }}</span>
      </button>
    </div>
    <p class="hint">
      Modo pintar (P): clic en una cara para aplicar · Alt+clic para quitar.
      Con <b>Pieza entera</b>, el clic pinta todas las caras del bloque.
    </p>
  </div>
</template>

<style scoped>
.palette { padding: 10px; }
h3 { margin: 0 0 8px; font-size: 13px; color: #d9ccf2; }
.whole {
  display: flex; align-items: center; gap: 6px; margin-bottom: 10px;
  font: 13px system-ui; color: #cfc4e4; cursor: pointer; user-select: none;
}
.whole input { accent-color: #6f4bd8; cursor: pointer; }
.empty { font: 12px system-ui; color: #b8acce; }
.empty code { background: #2a2733; padding: 1px 4px; border-radius: 3px; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.swatch {
  position: relative; padding: 0; border: 2px solid #3a3647; border-radius: 6px; overflow: hidden;
  cursor: pointer; background: #2a2733; aspect-ratio: 1;
}
.swatch.active { border-color: #9b7bff; }
.swatch img { display: block; width: 100%; height: 100%; image-rendering: pixelated; object-fit: cover; }
.swatch .label {
  position: absolute; left: 0; right: 0; bottom: 0; font: 9px/1.2 system-ui; color: #e7d9ff;
  background: rgba(20, 18, 26, 0.75); padding: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.hint { margin-top: 10px; font: 12px system-ui; color: #b8acce; }
</style>
