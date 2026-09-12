import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { cpSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'six-sines-distribution',
      closeBundle() {
        const out = resolve('dist-webcomponent')
        mkdirSync(out, { recursive: true })
        cpSync('types/six-sines-editor.d.ts', resolve(out, 'six-sines-editor.d.ts'))
        cpSync('public/presets', resolve(out, 'presets'), { recursive: true })
        for (const name of ['schema.json', 'init.sxsnp', 'presets.json']) {
          cpSync(resolve('src/data', name), resolve(out, name))
        }
        cpSync('LICENSE.md', resolve(out, 'LICENSE.md'))
        cpSync('src/assets/fonts/Manrope-OFL.txt', resolve(out, 'Manrope-OFL.txt'))
        cpSync('src/assets/fonts/AnonymousPro-OFL.txt', resolve(out, 'AnonymousPro-OFL.txt'))
      },
    },
  ],
  publicDir: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist-webcomponent',
    lib: {
      entry: resolve('src/webcomponent.ts'),
      formats: ['es'],
      fileName: () => 'six-sines-editor.js',
    },
  },
})
