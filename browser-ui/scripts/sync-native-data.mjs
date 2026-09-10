import { cpSync, existsSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve, relative, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const reference = resolve(process.argv[2] || resolve(root, '../target/push2-native/ui-schema'))
cpSync(resolve(reference, 'schema.json'), resolve(root, 'src/data/schema.json'))
cpSync(resolve(reference, 'init.sxsnp'), resolve(root, 'src/data/init.sxsnp'))
if (existsSync(resolve(reference, 'waveforms.json'))) cpSync(resolve(reference, 'waveforms.json'), resolve(root, 'src/data/waveforms.json'))
const source = resolve(root, '../resources/factory_patches')
const entries = []
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) walk(path)
    else if (entry.name.endsWith('.sxsnp')) {
      const parts = relative(source, path).split('/')
      entries.push({ name: basename(path, '.sxsnp'), category: parts.slice(0, -1).join('/'), path: '/presets/' + parts.map(encodeURIComponent).join('/') })
    }
  }
}
walk(source)
cpSync(source, resolve(root, 'public/presets'), { recursive: true })
writeFileSync(resolve(root, 'src/data/presets.json'), JSON.stringify(entries.sort((a,b) => a.path.localeCompare(b.path)), null, 2) + '\n')
console.log(`Synced native schema, Init, and ${entries.length} factory presets`)
