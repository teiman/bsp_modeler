import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// UN solo servidor (server/index.js) sirve el frontend Y la API en el mismo
// puerto. En desarrollo monta Vite como middleware usando esta misma config,
// asi que /api/* lo resuelve el servidor directamente — sin proxy ni 2º puerto.
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{js,mjs}'],
  },
})
