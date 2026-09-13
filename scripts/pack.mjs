// Build a zip that unpacks as tabby-ai-panel/ inside Tabby's plugins/node_modules/.
//   npm run pack   →  release/tabby-ai-panel-<version>.zip
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
if (!fs.existsSync(path.join(root, 'dist', 'index.js'))) {
    console.error('dist/index.js missing – run `npm run build` first')
    process.exit(1)
}
const stage = path.join(root, 'release', 'stage')
const target = path.join(stage, pkg.name)
fs.rmSync(stage, { recursive: true, force: true })
fs.mkdirSync(path.join(target, 'dist'), { recursive: true })

// Tabby only needs package.json + dist; strip dev-only fields from the manifest.
const manifest = { ...pkg }
delete manifest.devDependencies
delete manifest.scripts
delete manifest.files
fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
for (const f of fs.readdirSync(path.join(root, 'dist'))) {
    fs.copyFileSync(path.join(root, 'dist', f), path.join(target, 'dist', f))
}
for (const f of ['README.md', 'LICENSE']) {
    if (fs.existsSync(path.join(root, f))) fs.copyFileSync(path.join(root, f), path.join(target, f))
}
fs.mkdirSync(path.join(target, 'docs'), { recursive: true })
if (fs.existsSync(path.join(root, 'docs', 'screenshot.png'))) {
    fs.copyFileSync(path.join(root, 'docs', 'screenshot.png'), path.join(target, 'docs', 'screenshot.png'))
}

const zip = path.join(root, 'release', `${pkg.name}-${pkg.version}.zip`)
fs.rmSync(zip, { force: true })
execFileSync('zip', ['-qr', zip, pkg.name], { cwd: stage })
fs.rmSync(stage, { recursive: true, force: true })
console.log(`Packed ${path.relative(root, zip)} (${(fs.statSync(zip).size / 1024).toFixed(0)} KB)`)
console.log('Unzip inside <Tabby config dir>/plugins/node_modules/ and restart Tabby.')
