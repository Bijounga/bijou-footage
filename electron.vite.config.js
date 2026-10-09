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
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/index.html') },
      // The voiceover AudioWorklet must be a real file: the page's CSP
      // doesn't allow scripts from data: URLs (Vite inlines small assets).
      assetsInlineLimit: (file) => (/voWorklet/.test(file) ? false : undefined)
    },
    plugins: [react()]
  }
})
