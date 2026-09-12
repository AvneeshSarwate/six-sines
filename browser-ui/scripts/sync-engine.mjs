import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const source = resolve(
  process.env.SIX_SINES_ENGINE_DIR || resolve(root, '../ignore/browser-engine'),
)
const destination = resolve(root, 'public/engine')
const files = [
  'six-sines.js',
  'six-sines.wasm',
  'six-sines-worklet.js',
  'six-sines-node.js',
  'six-sines-build.json',
]
for (const file of files)
  if (!existsSync(resolve(source, file)))
    throw new Error(
      `Engine artifact missing: ${file}. Run npm run engine:build first (requires Emscripten, CMake, Ninja).`,
    )
mkdirSync(destination, { recursive: true })
for (const file of files)
  copyFileSync(
    resolve(
      file.endsWith('-node.js') || file.endsWith('-worklet.js') ? resolve(root, '../web') : source,
      file,
    ),
    resolve(destination, file),
  )
console.log('Synced Six Sines WASM engine into public/engine')
