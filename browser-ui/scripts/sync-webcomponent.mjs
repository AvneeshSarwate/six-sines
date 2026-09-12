import { cp, access, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'dist-webcomponent')
const destination = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(root, '../../../avTools/packages/six-sines/ui')
await access(resolve(source, 'six-sines-editor.js'))
await mkdir(destination, { recursive: true })
await cp(source, destination, { recursive: true })
console.log(`Copied Six Sines UI to ${destination}`)
