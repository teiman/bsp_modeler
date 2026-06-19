<script setup>
import { computed } from 'vue'
import { store } from '../store.js'

const groups = computed(() => {
  const by = {}
  for (const m of store.modules) (by[m.category] ||= []).push(m)
  return by
})
</script>

<template>
  <div class="palette">
    <h3>Bloques</h3>
    <div v-for="(mods, cat) in groups" :key="cat" class="group">
      <div class="cat">{{ cat }}</div>
      <button
        v-for="m in mods"
        :key="m.key"
        class="module"
        :class="{ active: m.key === store.activeModule }"
        @click="store.setModule(m.key)"
      >{{ m.label }}</button>
    </div>
    <p class="rot">Orientación: #{{ store.placeRot }} <small>(R yaw · F volcar · G lado)</small></p>
  </div>
</template>

<style scoped>
.palette { padding: 10px; }
h3 { margin: 0 0 8px; font-size: 13px; color: #d9ccf2; }
.cat { margin: 8px 0 4px; font: 600 11px/1 system-ui; color: #8e83a6; text-transform: uppercase; letter-spacing: 0.5px; }
.module {
  display: block; width: 100%; text-align: left; margin: 2px 0; padding: 6px 9px;
  background: #2a2733; color: #cfc4e4; border: 1px solid #3a3647; border-radius: 5px; cursor: pointer; font: 13px system-ui;
}
.module.active { background: #6f4bd8; color: #fff; border-color: #9b7bff; }
.module:hover { border-color: #6f4bd8; }
.rot { margin-top: 12px; font: 12px system-ui; color: #b8acce; }
.rot small { color: #7d7290; }
</style>
