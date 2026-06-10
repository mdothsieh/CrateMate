/**
 * electron-vite builds the three parts of an Electron app separately:
 *   main     → Node.js process (window management, SQLite, audio analysis)
 *   preload  → the tiny security bridge between main and the UI
 *   renderer → the React UI (runs in a sandboxed Chromium page)
 *
 * externalizeDepsPlugin keeps native modules (better-sqlite3, onnxruntime-node,
 * ffmpeg-static) as plain require()s instead of trying to bundle their binaries.
 */
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: 'src/main/index.ts',
          // built separately: forked as a utilityProcess per analysis worker
          'analysis-worker': 'src/main/analysis/worker.ts',
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react(), tailwindcss()],
  },
})
