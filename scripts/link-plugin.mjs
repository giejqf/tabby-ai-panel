// Symlink this plugin into Tabby's plugin directory for development.
// Usage: npm run link:tabby   (then restart Tabby, or use TABBY_PLUGINS)
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

function tabbyPluginsDir () {
    if (process.env.TABBY_PLUGINS) return process.env.TABBY_PLUGINS
    switch (process.platform) {
        case 'win32': return path.join(process.env.APPDATA ?? os.homedir(), 'tabby', 'plugins')
        case 'darwin': return path.join(os.homedir(), 'Library', 'Application Support', 'tabby', 'plugins')
        default: return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'tabby', 'plugins')
    }
}

const pluginsDir = tabbyPluginsDir()
const target = path.join(pluginsDir, 'node_modules', 'tabby-ai-panel')
fs.mkdirSync(path.dirname(target), { recursive: true })
try {
    fs.rmSync(target, { recursive: true, force: true })
} catch { /* ignore */ }
fs.symlinkSync(root, target, 'junction')
console.log(`Linked ${root} -> ${target}`)
console.log('Restart Tabby (or reload plugins) to pick it up. Run `npm run watch` while developing.')
