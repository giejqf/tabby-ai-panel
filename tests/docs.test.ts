// Keeps the documentation in sync with the code: tools, settings, hotkeys,
// the version badge, and every relative link in the Markdown files.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import { ALL_TOOLS } from '../src/core/tools'
import { DEFAULT_CONFIG, HOTKEY_IDS } from '../src/types/config'

const root = path.resolve(__dirname, '..')
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')
const markdownFiles = ['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'scripts/e2e/README.md',
    ...fs.readdirSync(path.join(root, 'docs')).filter(f => f.endsWith('.md')).map(f => `docs/${f}`)]

/** Lines of the table under `heading` whose header row starts with `| <firstColumn> |`. */
function tableRows (markdown: string, heading: string, firstColumn: string): string[][] {
    const start = markdown.indexOf(`\n${heading}\n`)
    assert.ok(start >= 0, `missing heading ${heading}`)
    const lines = markdown.slice(start + heading.length + 2).split('\n')
    const header = lines.findIndex(l => l.startsWith(`| ${firstColumn} |`))
    assert.ok(header >= 0, `no "${firstColumn}" table under ${heading}`)
    const rows: string[][] = []
    for (const line of lines.slice(header + 2)) {
        if (!line.startsWith('|')) break
        rows.push(line.split(/(?<!\\)\|/).slice(1, -1).map(c => c.trim()))
    }
    return rows
}

test('every agent tool and parameter is documented in docs/agent-tools.md', () => {
    const doc = read('docs/agent-tools.md')
    const documented = [...doc.matchAll(/^### `(\w+)`$/gm)].map(m => m[1])
    assert.deepEqual(documented.sort(), ALL_TOOLS.map(t => t.spec.name).sort())
    for (const tool of ALL_TOOLS) {
        const props = tool.spec.parameters.properties ?? {}
        const required: string[] = tool.spec.parameters.required ?? []
        if (!Object.keys(props).length) continue
        const rows = tableRows(doc, `### \`${tool.spec.name}\``, 'Parameter')
        const params = Object.fromEntries(rows.map(r => [r[0].replace(/`/g, ''), r[1]]))
        assert.deepEqual(Object.keys(params).sort(), Object.keys(props).sort(), `${tool.spec.name} parameters`)
        for (const [name, type] of Object.entries(params)) {
            assert.equal(type.includes('required'), required.includes(name), `${tool.spec.name}.${name} required flag`)
        }
    }
})

test('every setting and its default is documented in docs/configuration.md', () => {
    const doc = read('docs/configuration.md')
    for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
        const row = doc.split('\n').find(l => l.startsWith('|') && l.includes(`| \`${key}\` |`))
        assert.ok(row, `setting ${key} is not documented`)
        const shown = value === '' ? "''" : String(value)
        assert.ok(row.includes(`| \`${shown}\` |`), `default of ${key} should be \`${shown}\`: ${row}`)
    }
})

test('hotkey ids and default bindings are documented', () => {
    const config = read('docs/configuration.md')
    for (const id of Object.values(HOTKEY_IDS)) {
        assert.ok(config.includes(`| \`${id}\` |`), `hotkey ${id} missing from docs/configuration.md`)
    }
    // defaults live in src/config.ts, which needs tabby-core at runtime, so read it as text
    const source = read('src/config.ts')
    const [general, mac] = source.split('platformDefaults')
    const bindings = (block: string) => Object.fromEntries([...block.matchAll(/\[HOTKEY_IDS\.(\w+)\]: \['([^']+)'\]/g)].map(m => [m[1], m[2]]))
    const pc = bindings(general)
    const macOS = bindings(mac)
    const usage = read('docs/usage.md').split('\n')
    for (const name of Object.keys(HOTKEY_IDS)) {
        const pcKeys = `\`${pc[name].replace(/-/g, '+')}\``
        const macKeys = `\`${macOS[name].replace('-Shift-', '⇧').replace(/-/g, '')}\``
        assert.ok(usage.some(l => l.includes(pcKeys) && l.includes(macKeys)), `docs/usage.md should list ${pcKeys} / ${macKeys} for ${name}`)
    }
})

test('the npm badge matches package.json', () => {
    const { version } = JSON.parse(read('package.json'))
    assert.ok(read('docs/assets/badges/npm.svg').includes(`v${version}`), 'run `npm run badges`')
})

test('relative links and anchors in the Markdown files resolve', () => {
    const slug = (heading: string) => heading.trim().toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/ /g, '-')
    const anchors = (file: string) => {
        const text = read(file).replace(/```[\s\S]*?```/g, '')
        return new Set([...text.matchAll(/^#{1,6} (.+)$/gm)].map(m => slug(m[1])))
    }
    // absolute links into this repository (used where npm renders the README) must point at real files too
    const repoRaw = 'https://raw.githubusercontent.com/giejqf/tabby-ai-panel/main/'
    for (const file of markdownFiles) {
        const text = read(file).replace(/```[\s\S]*?```/g, '')
        const targets = [...text.matchAll(/\]\(([^)\s]+)\)|(?:href|src)="([^"]+)"/g)].map(m => m[1] ?? m[2])
        for (const target of targets) {
            if (target.startsWith(repoRaw)) {
                assert.ok(fs.existsSync(path.join(root, target.slice(repoRaw.length))), `${file}: broken link ${target}`)
                continue
            }
            if (/^(https?:|mailto:)/.test(target)) continue
            const [rel, hash] = target.split('#')
            const resolved = rel ? path.normalize(path.join(path.dirname(file), rel)) : file
            assert.ok(fs.existsSync(path.join(root, resolved)), `${file}: broken link ${target}`)
            if (hash && resolved.endsWith('.md')) {
                assert.ok(anchors(resolved).has(hash), `${file}: no heading for #${hash} in ${resolved}`)
            }
        }
    }
})
