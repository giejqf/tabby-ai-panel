import { RunExitState } from '../types/session'
import { BufferCapture, BufferPosition, ResolvedPosition, TerminalEntry } from './terminal-registry.service'
import { learnPromptTerminator, looksLikeInputPrompt, looksLikePrompt, stripEchoAndPrompt } from './util/prompt-detect'
import { lastNonEmptyLine, tidyOutput } from './util/text'
import { abortError } from './util/sse'

/** What the runner needs from the registry (kept narrow so tests can fake it). */
export interface RunnerHost {
    mark (entry: TerminalEntry): BufferPosition
    resolve (entry: TerminalEntry, pos: BufferPosition): ResolvedPosition
    captureSince (entry: TerminalEntry, from: BufferPosition, maxLines?: number): BufferCapture
    captureLast (entry: TerminalEntry, n: number): BufferCapture
    captureScreen (entry: TerminalEntry): BufferCapture
    cursorRow (entry: TerminalEntry): number
    cursorLine (entry: TerminalEntry): string
    sendInput (entry: TerminalEntry, data: string): void
}

export interface ObserveOptions {
    timeoutMs: number
    signal?: AbortSignal
    /** Called whenever captured output changes. */
    onProgress?: (output: string) => void
    /** Stop as soon as the output matches. */
    untilRegex?: RegExp | null
    /** Quiet time before a prompt-looking last line counts as "done". */
    quietMs?: number
    /** Quiet time (no output) before giving up with `idle`. */
    idleMs?: number
    pollMs?: number
}

export interface RunResult {
    state: RunExitState | 'matched'
    output: string
    durationMs: number
    lastLine: string
    /** Where the capture ended – pass to waitForOutput to get only newer output. */
    end: BufferPosition
}

interface ObserveContext extends ObserveOptions {
    start: BufferPosition
    seqAtStart: number
    command: string | null
    terminator: string | null
}

export class TerminalRunner {
    constructor (private host: RunnerHost) {}

    /** Type a command, press Enter and wait for it to finish (or need attention). */
    async run (entry: TerminalEntry, command: string, options: ObserveOptions): Promise<RunResult> {
        const start = this.host.mark(entry)
        const promptLine = this.host.cursorLine(entry)
        const terminator = learnPromptTerminator(promptLine)
        const seqAtStart = entry.outputSeq
        this.host.sendInput(entry, command.replace(/\r?\n/g, '\r') + '\r')
        return this.observe(entry, { ...options, start, seqAtStart, command, terminator })
    }

    /** Send raw keystrokes (already translated) and report what happened next. */
    async sendKeys (entry: TerminalEntry, data: string, options: ObserveOptions): Promise<RunResult> {
        const start = this.host.mark(entry)
        const terminator = learnPromptTerminator(this.host.cursorLine(entry))
        const seqAtStart = entry.outputSeq
        this.host.sendInput(entry, data)
        // keystrokes are usually answers to prompts: settle quickly
        return this.observe(entry, { quietMs: 600, idleMs: 2500, ...options, start, seqAtStart, command: null, terminator })
    }

    /** Wait for new output after `from` without sending anything. */
    async waitForOutput (entry: TerminalEntry, from: BufferPosition, options: ObserveOptions): Promise<RunResult> {
        const terminator = learnPromptTerminator(this.host.cursorLine(entry))
        return this.observe(entry, { ...options, start: from, seqAtStart: entry.outputSeq, command: null, terminator })
    }

    private async observe (entry: TerminalEntry, ctx: ObserveContext): Promise<RunResult> {
        const t0 = Date.now()
        const pollMs = ctx.pollMs ?? 150
        const quietMs = ctx.quietMs ?? 350
        const idleMs = ctx.idleMs ?? Math.min(ctx.timeoutMs, 15_000)
        let lastText = ''
        let lastSeq = entry.outputSeq
        let lastChangeAt = t0

        const finish = (state: RunResult['state'], cap: BufferCapture, lines: string[]): RunResult => {
            const output = tidyOutput(lines.join('\n'))
            return {
                state,
                output,
                durationMs: Date.now() - t0,
                lastLine: lastNonEmptyLine(cap.lines.join('\n')),
                end: this.host.mark(entry),
            }
        }

        while (true) {
            try {
                await sleep(pollMs, ctx.signal)
            } catch (e) {
                const cap = this.host.captureSince(entry, ctx.start)
                return finish('cancelled', cap, this.visibleLines(cap, ctx, false))
            }
            const now = Date.now()
            const position = this.host.resolve(entry, ctx.start)
            if (position.reset) {
                // the session was reset or reconnected under us: show what is there now
                const screen = this.host.captureLast(entry, 40)
                return finish('reset', screen, screen.lines)
            }
            const cap = this.host.captureSince(entry, ctx.start)
            const cursorRow = this.host.cursorRow(entry)
            const moved = cursorRow > position.row || position.trimmed || entry.outputSeq > ctx.seqAtStart
            const rawLast = lastNonEmptyLine(cap.lines.join('\n'))

            const provisional = this.visibleLines(cap, ctx, false)
            const text = provisional.join('\n')
            if (text !== lastText || entry.outputSeq !== lastSeq) {
                lastText = text
                lastSeq = entry.outputSeq
                lastChangeAt = now
                ctx.onProgress?.(tidyOutput(text))
            }
            const quiet = now - lastChangeAt

            if (cap.isAlternate) {
                if (quiet >= 1000) {
                    const screen = this.host.captureScreen(entry)
                    return finish('alt_screen', screen, screen.lines)
                }
                continue
            }

            if (ctx.untilRegex && ctx.untilRegex.test(text)) {
                return finish('matched', cap, provisional)
            }

            if (moved && quiet >= quietMs && looksLikePrompt(rawLast, ctx.terminator) && !looksLikeInputPrompt(rawLast)) {
                return finish('prompt', cap, this.visibleLines(cap, ctx, true))
            }

            if (moved && quiet >= Math.max(quietMs, 1200) && looksLikeInputPrompt(rawLast)) {
                return finish('awaiting_input', cap, provisional)
            }

            if (now - t0 >= ctx.timeoutMs) {
                return finish('timeout', cap, provisional)
            }

            if (moved && quiet >= idleMs) {
                return finish('idle', cap, provisional)
            }
        }
    }

    private visibleLines (cap: BufferCapture, ctx: ObserveContext, stripTrailingPrompt: boolean): string[] {
        if (ctx.command) {
            const stripped = stripEchoAndPrompt(cap.lines, ctx.command, ctx.terminator)
            if (stripTrailingPrompt) {
                return stripped
            }
            // keep a trailing prompt-looking line while still running (it may be data)
            const withoutEcho = dropEcho(cap.lines, ctx.command)
            return withoutEcho
        }
        if (stripTrailingPrompt) {
            const lines = [...cap.lines]
            while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
            if (lines.length && looksLikePrompt(lines[lines.length - 1], ctx.terminator)) lines.pop()
            return lines
        }
        return cap.lines
    }
}

function dropEcho (lines: string[], command: string): string[] {
    const cmdHead = command.trim().split('\n')[0].slice(0, 24)
    const out = [...lines]
    let dropped = 0
    while (out.length && dropped < 3) {
        const l = out[0]
        if (cmdHead && l.includes(cmdHead)) {
            out.shift()
            break
        }
        if (l.trim() === '') {
            out.shift()
            dropped++
            continue
        }
        break
    }
    return out
}

export function sleep (ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(abortError())
            return
        }
        const t = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort)
            resolve()
        }, ms)
        const onAbort = () => {
            clearTimeout(t)
            reject(abortError())
        }
        signal?.addEventListener('abort', onAbort, { once: true })
    })
}

/** Translate friendly key names into terminal bytes. */
export function translateKeys (spec: string): string {
    const map: Record<string, string> = {
        'enter': '\r', 'return': '\r', 'cr': '\r',
        'tab': '\t',
        'esc': '\x1b', 'escape': '\x1b',
        'space': ' ',
        'backspace': '\x7f',
        'up': '\x1b[A', 'down': '\x1b[B', 'right': '\x1b[C', 'left': '\x1b[D',
        'home': '\x1b[H', 'end': '\x1b[F',
        'pageup': '\x1b[5~', 'pagedown': '\x1b[6~',
        'delete': '\x1b[3~',
        'f1': '\x1bOP', 'f2': '\x1bOQ', 'f3': '\x1bOR', 'f4': '\x1bOS',
    }
    const key = spec.trim().toLowerCase()
    if (map[key] !== undefined) {
        return map[key]
    }
    const ctrl = /^(ctrl|c|control|\^)[-+]?([a-z\[\]\\^_@])$/.exec(key)
    if (ctrl) {
        const ch = ctrl[2].toUpperCase()
        return String.fromCharCode(ch.charCodeAt(0) & 0x1f)
    }
    const alt = /^(alt|meta|m)[-+]([a-z0-9])$/.exec(key)
    if (alt) {
        return `\x1b${alt[2]}`
    }
    throw new Error(`Unknown key "${spec}". Use names like enter, tab, esc, ctrl-c, ctrl-d, up, down.`)
}
