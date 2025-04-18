import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['electron-store'] })]
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: 'src/preload/index.ts', // Default preload
          widget: 'src/preload/widget.ts' // Widget preload
        }
      }
    },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    // Specify multiple HTML entry points
    build: {
      rollupOptions: {
        input: {
          index: 'src/renderer/index.html', // Default entry
          widget: 'src/renderer/widget.html' // Widget entry
        }
      }
    },
    plugins: [svelte(), tailwindcss()]
  }
})
