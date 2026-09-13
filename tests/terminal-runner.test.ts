import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TerminalRunner, RunnerHost, translateKeys } from '../src/core/terminal-runner'
import type { BufferCapture, BufferPosition, ResolvedPosition, TerminalEntry } from '../src/core/terminal-registry.service'

const PROMPT = 'ubuntu@linux1:~$ '

/** A tiny fake of an xterm buffer driven by a scripted "shell". Lines carry ids so
 *  positions can be anchored to a line (like xterm markers) and survive trimming. */
class FakeShell implements RunnerHost {
    lines: string[] = [PROMPT]
    ids: number[] = [1]
    private nextId = 2
    entry: TerminalEntry = { id: 't', tab: null as any, descriptor: { kind: 'local' }, label: 'fake', lastOutputAt: 0, outputSeq: 0, busyWith: null, readMarker: { row: 0 }, closed: false }
    inputs: string[] = []
    alternate = false
    onInput: ((data: string) => void) | null = null

    mark (): BufferPosition {
        const row = this.lines.length - 1
        return { row, marker: { anchorId: this.ids[row], line: row, isDisposed: false, dispose () {} } as any }
    }
    resolve (_e: TerminalEntry, pos: BufferPosition): ResolvedPosition {
        const idx = this.ids.indexOf((pos.marker as any).anchorId)
        if (idx >= 0) return { row: idx, trimmed: false, reset: false }
        return { row: 0, trimmed: true, reset: this.lines.length < pos.row }
    }
    captureSince (e: TerminalEntry, from: BufferPosition): BufferCapture {
        const end = this.lines.length - 1
        return { lines: this.lines.slice(Math.max(0, this.resolve(e, from).row), end + 1), endRow: end + 1, isAlternate: this.alternate }
    }
    captureLast (_e: TerminalEntry, n: number): BufferCapture {
        return { lines: this.lines.slice(-n), endRow: this.lines.length, isAlternate: this.alternate }
    }
    captureScreen (): BufferCapture {
        return { lines: this.lines.slice(-24), endRow: this.lines.length, isAlternate: this.alternate }
    }
    cursorRow (): number { return this.lines.length - 1 }
    cursorLine (): string { return this.lines[this.lines.length - 1] }
    sendInput (_e: TerminalEntry, data: string): void {
        this.inputs.push(data)
        this.onInput?.(data)
    }
    /** shell output arrives */
    write (...newLines: string[]): void {
        for (const l of newLines) { this.lines.push(l); this.ids.push(this.nextId++) }
        this.entry.outputSeq++
        this.entry.lastOutputAt = Date.now()
    }
    echo (command: string): void {
        this.lines[this.lines.length - 1] = PROMPT + command
        this.entry.outputSeq++
    }
    prompt (): void { this.write(PROMPT) }
    /** scrollback is full: the oldest rows fall off */
    trim (n: number): void { this.lines.splice(0, n); this.ids.splice(0, n) }
    /** the session restarted with a fresh buffer */
    replaceBuffer (...newLines: string[]): void {
        this.lines = []; this.ids = []
        this.write(...newLines)
    }
}

const fast = { pollMs: 15, quietMs: 60 }
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

test('run: prompt returns → output without echo and prompt', async () => {
    const shell = new FakeShell()
    shell.onInput = data => {
        const cmd = data.replace(/\r$/, '')
        setTimeout(() => shell.echo(cmd), 5)
        setTimeout(() => shell.write('total 8', 'drwxr-xr-x 2 ubuntu ubuntu 4096 wg'), 40)
        setTimeout(() => shell.prompt(), 80)
    }
    const runner = new TerminalRunner(shell)
    const r = await runner.run(shell.entry, 'ls -la', { timeoutMs: 3000, ...fast })
    assert.equal(shell.inputs[0], 'ls -la\r')
    assert.equal(r.state, 'prompt')
    assert.equal(r.output, 'total 8\ndrwxr-xr-x 2 ubuntu ubuntu 4096 wg')
    assert.equal(r.end.row, shell.lines.length - 1)
})

test('run: capture is correct even when the scrollback trims rows meanwhile', async () => {
    const shell = new FakeShell()
    shell.write('old 1', 'old 2', 'old 3', 'old 4', PROMPT)
    shell.onInput = data => {
        const cmd = data.replace(/\r$/, '')
        setTimeout(() => shell.echo(cmd), 5)
        setTimeout(() => { shell.write('out A', 'out B'); shell.trim(3) }, 30)
        setTimeout(() => { shell.write('out C'); shell.trim(2); shell.prompt() }, 60)
    }
    const r = await new TerminalRunner(shell).run(shell.entry, 'make', { timeoutMs: 3000, ...fast })
    assert.equal(r.state, 'prompt')
    assert.equal(r.output, 'out A\nout B\nout C')
})

test('run: a command with no output still completes', async () => {
    const shell = new FakeShell()
    shell.onInput = data => {
        setTimeout(() => shell.echo(data.replace(/\r$/, '')), 5)
        setTimeout(() => shell.prompt(), 30)
    }
    const r = await new TerminalRunner(shell).run(shell.entry, 'cd /tmp', { timeoutMs: 3000, ...fast })
    assert.equal(r.state, 'prompt')
    assert.equal(r.output, '')
})

test('run: does not finish while the typed command is still on the prompt line', async () => {
    const shell = new FakeShell()
    // shell echoes but produces the prompt only after a long time
    shell.onInput = data => {
        setTimeout(() => shell.echo(data.replace(/\r$/, '')), 5)
        setTimeout(() => shell.write('working...'), 100)
        setTimeout(() => shell.prompt(), 600)
    }
    const t0 = Date.now()
    const r = await new TerminalRunner(shell).run(shell.entry, 'sleep 1', { timeoutMs: 3000, ...fast })
    assert.equal(r.state, 'prompt')
    assert.ok(Date.now() - t0 >= 600, 'must wait for the real prompt')
    assert.equal(r.output, 'working...')
})

test('run: interactive prompt is reported as awaiting_input', async () => {
    const shell = new FakeShell()
    shell.onInput = data => {
        setTimeout(() => shell.echo(data.replace(/\r$/, '')), 5)
        setTimeout(() => shell.write('Reading package lists... Done', 'Do you want to continue? [Y/n]'), 30)
    }
    const r = await new TerminalRunner(shell).run(shell.entry, 'sudo apt install wireguard', { timeoutMs: 5000, ...fast, quietMs: 60 })
    assert.equal(r.state, 'awaiting_input')
    assert.equal(r.lastLine, 'Do you want to continue? [Y/n]')
    assert.ok(r.output.includes('Reading package lists'))
})

test('run: still running → timeout with partial output; wait_for_output then finishes', async () => {
    const shell = new FakeShell()
    shell.onInput = data => {
        setTimeout(() => shell.echo(data.replace(/\r$/, '')), 5)
        let i = 0
        const iv = setInterval(() => {
            shell.write(`line ${++i}`)
            if (i === 12) {
                clearInterval(iv)
                shell.prompt()
            }
        }, 40)
    }
    const runner = new TerminalRunner(shell)
    const r1 = await runner.run(shell.entry, 'tail -f log', { timeoutMs: 200, ...fast })
    assert.equal(r1.state, 'timeout')
    assert.ok(r1.output.includes('line 1'))
    assert.ok(!r1.output.includes('line 12'))
    const r2 = await runner.waitForOutput(shell.entry, r1.end, { timeoutMs: 3000, ...fast })
    assert.equal(r2.state, 'prompt')
    assert.ok(!r2.output.includes('line 1\n'), 'only new output is returned')
    assert.ok(r2.output.includes('line 12'))
})

test('sendKeys: answering a prompt', async () => {
    const shell = new FakeShell()
    shell.write('Do you want to continue? [Y/n]')
    shell.onInput = data => {
        if (data === 'y\r') {
            setTimeout(() => shell.write('Unpacking wireguard...', 'Done.'), 20)
            setTimeout(() => shell.prompt(), 60)
        }
    }
    const r = await new TerminalRunner(shell).sendKeys(shell.entry, 'y' + translateKeys('enter'), { timeoutMs: 3000, ...fast })
    assert.equal(r.state, 'prompt')
    assert.ok(r.output.includes('Done.'))
})

test('run: idle when silent for too long', async () => {
    const shell = new FakeShell()
    shell.onInput = data => setTimeout(() => shell.echo(data.replace(/\r$/, '')), 5)
    const r = await new TerminalRunner(shell).run(shell.entry, 'sleep 100', { timeoutMs: 5000, ...fast, idleMs: 150 })
    assert.equal(r.state, 'idle')
})

test('run: alternate screen is reported with the screen contents', async () => {
    const shell = new FakeShell()
    shell.onInput = data => {
        setTimeout(() => { shell.echo(data.replace(/\r$/, '')); shell.alternate = true; shell.write('~', '~', '"file.txt" 0L, 0B') }, 5)
    }
    const r = await new TerminalRunner(shell).run(shell.entry, 'vim file.txt', { timeoutMs: 5000, ...fast })
    assert.equal(r.state, 'alt_screen')
    assert.ok(r.output.includes('file.txt'))
})

test('run: abort signal cancels', async () => {
    const shell = new FakeShell()
    shell.onInput = data => setTimeout(() => shell.echo(data.replace(/\r$/, '')), 5)
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 60)
    const r = await new TerminalRunner(shell).run(shell.entry, 'sleep 100', { timeoutMs: 5000, signal: ac.signal, ...fast })
    assert.equal(r.state, 'cancelled')
})

test('run: a reset/reconnected terminal is reported instead of waiting forever', async () => {
    const shell = new FakeShell()
    shell.write('old line 1', 'old line 2', 'old line 3', PROMPT)
    shell.onInput = data => {
        setTimeout(() => shell.echo(data.replace(/\r$/, '')), 5)
        // session restarts: buffer replaced by a fresh banner
        setTimeout(() => shell.replaceBuffer('Welcome to the new shell', PROMPT), 40)
    }
    const r = await new TerminalRunner(shell).run(shell.entry, 'apt update', { timeoutMs: 5000, ...fast })
    assert.equal(r.state, 'reset')
    assert.ok(r.output.includes('Welcome to the new shell'))
})

test('translateKeys', () => {
    assert.equal(translateKeys('ctrl-c'), '\x03')
    assert.equal(translateKeys('Ctrl+D'), '\x04')
    assert.equal(translateKeys('enter'), '\r')
    assert.equal(translateKeys('esc'), '\x1b')
    assert.equal(translateKeys('up'), '\x1b[A')
    assert.throws(() => translateKeys('hello'))
})
