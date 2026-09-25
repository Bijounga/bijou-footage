import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(__dirname, 'electron/main/index.js') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(__dirname, 'electron/preload/index.js') } }
  },
  renderer: {
    root: 'src',
    build: { rollupOptions: { input: resolve(__dirname, 'src/index.html') } },
    plugins: [react()]
  }
})
