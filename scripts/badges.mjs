// Render the README badges with badge-maker into docs/assets/badges/.
//   npm run badges            (also runs on `npm version`)
// Values come from package.json and a real test run, so the badges cannot
// drift from the code as long as this is re-run on release.
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { makeBadge } from 'badge-maker'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'docs', 'assets', 'badges')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

function testCounts () {
    let tap = ''
    try {
        tap = execFileSync(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap', 'tests/**/*.test.ts'], { cwd: root, encoding: 'utf8' })
    } catch (e) {
        tap = e.stdout ?? ''   // non-zero exit when a test fails; the summary is still printed
    }
    const count = name => Number(new RegExp(`^# ${name} (\\d+)$`, 'm').exec(tap)?.[1] ?? NaN)
    return { pass: count('pass'), fail: count('fail') }
}

const tests = testCounts()
if (!Number.isFinite(tests.pass)) {
    console.error('Could not read the test summary – is the test runner working (`npm test`)?')
    process.exit(1)
}

const badges = {
    npm: { label: 'npm', message: `v${pkg.version}`, color: '#cb3837' },
    license: { label: 'license', message: pkg.license, color: '#3b82f6' },
    tabby: { label: 'tabby', message: 'plugin', color: '#34d399' },
    api: { label: 'LLM API', message: 'OpenAI-compatible', color: '#818cf8' },
    tests: tests.fail
        ? { label: 'tests', message: `${tests.fail} failing`, color: '#e05d44' }
        : { label: 'tests', message: `${tests.pass} passing`, color: '#4c1' },
}

fs.mkdirSync(outDir, { recursive: true })
for (const [name, format] of Object.entries(badges)) {
    fs.writeFileSync(path.join(outDir, `${name}.svg`), makeBadge({ style: 'flat', labelColor: '#555', ...format }) + '\n')
    console.log(`${name}.svg  ${format.label}: ${format.message}`)
}
if (tests.fail) {
    process.exitCode = 1
}
