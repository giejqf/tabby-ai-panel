import { AgentTool, ApprovalRequirement, ResolvedTerminal, ToolContext } from './types'
import { assessCommand, maxRisk, normalizeRisk } from '../util/risk'
import { translateKeys } from '../terminal-runner'
import { RunResult } from '../terminal-runner'
import { countLines, formatDuration } from '../util/text'

const TERMINAL_PARAM = {
    type: 'string',
    description: 'Target terminal: its key from list_terminals (e.g. "t1") or its exact label (e.g. "Linux-2").',
}

function str (v: unknown): string {
    return typeof v === 'string' ? v : v == null ? '' : String(v)
}

function num (v: unknown, fallback: number): number {
    const n = typeof v === 'number' ? v : parseFloat(String(v))
    return Number.isFinite(n) && n > 0 ? n : fallback
}

async function wake (ctx: ToolContext, t: ResolvedTerminal): Promise<void> {
    if (!(await ctx.ensureReady(t.entry))) {
        throw new Error(`Terminal ${t.key} "${t.label}" could not be started (its shell did not come up). Ask the user to open that tab, or use another terminal.`)
    }
}

/** Header line + guidance that tells the model what the terminal is doing now. */
export function describeRunResult (label: string, key: string, r: RunResult, cmdTimeoutS?: number): string {
    const dur = formatDuration(r.durationMs)
    const lines = countLines(r.output)
    let header: string
    let hint = ''
    switch (r.state) {
        case 'prompt':
            header = `finished – prompt returned after ${dur}`
            break
        case 'matched':
            header = `output matched the pattern after ${dur}`
            break
        case 'awaiting_input':
            header = `WAITING FOR INPUT after ${dur} – last line: ${JSON.stringify(r.lastLine.trim())}`
            hint = 'The program is waiting. Answer with send_keys (e.g. keys ["y","enter"]), or use ask_user if the user must decide (passwords must be typed by the user: ask them to type it into the terminal, then wait_for_output).'
            break
        case 'alt_screen':
            header = 'a full-screen program is active (vim/less/htop/…) – showing the screen'
            hint = 'Interact with send_keys (e.g. "q", ":q", "ctrl-c"), or wait_for_output.'
            break
        case 'idle':
            header = `no new output for a while and no prompt after ${dur} – the command may still be running or waiting silently`
            hint = 'Use wait_for_output to keep waiting, read_terminal to look again, or send_keys "ctrl-c" to abort.'
            break
        case 'timeout':
            header = `still running after ${cmdTimeoutS ?? Math.round(r.durationMs / 1000)}s – no prompt yet`
            hint = 'Use wait_for_output with a longer timeout to keep waiting, or send_keys "ctrl-c" to abort.'
            break
        case 'reset':
            header = 'the terminal was reset or reconnected while waiting – the command may not have run'
            hint = 'Check the current state with read_terminal, then run the command again if needed.'
            break
        case 'cancelled':
            header = 'cancelled by the user'
            break
        default:
            header = r.state
    }
    const parts = [`[${key} "${label}" · ${header}${lines ? ` · ${lines} lines` : ''}]`]
    if (hint) parts.push(hint)
    parts.push(r.output || '(no output)')
    return parts.join('\n')
}

export const listTerminalsTool: AgentTool = {
    spec: {
        name: 'list_terminals',
        description: 'List every open terminal tab with its key, label, connection (ssh user@host / local), status and last line. Call this when unsure which terminal to use. Status not_started means a restored tab that has not been opened yet – the action tools start it automatically.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    approval: () => null,
    async execute (_args, ctx) {
        const list = ctx.listTerminals()
        if (!list.length) {
            return 'No terminal tabs are open. Use open_terminal to open one from a saved profile, or ask the user to open one.'
        }
        return list.map(t => {
            const bits = [`${t.key}  "${t.label}"  ${t.connection}  status: ${t.status}`]
            if (t.isActive) bits.push('[active tab]')
            if (t.cwd) bits.push(`cwd: ${t.cwd}`)
            if (t.lastLine) bits.push(`last line: ${JSON.stringify(t.lastLine.trim().slice(0, 120))}`)
            return bits.join('  ')
        }).join('\n')
    },
}

export const readTerminalTool: AgentTool = {
    spec: {
        name: 'read_terminal',
        description: 'Read the most recent lines of a terminal\'s screen/scrollback without typing anything. Use it to see the current state before acting, or to look at output that scrolled by.',
        parameters: {
            type: 'object',
            properties: {
                terminal: TERMINAL_PARAM,
                lines: { type: 'integer', description: 'How many lines from the bottom (default 60, max 400).' },
            },
            required: ['terminal'],
            additionalProperties: false,
        },
    },
    terminalArg: 'terminal',
    approval: () => null,
    async execute (args, ctx) {
        const t = ctx.resolveTerminal(args.terminal)
        await wake(ctx, t)
        const n = Math.max(1, Math.min(400, Math.floor(num(args.lines, 60))))
        const capture = ctx.captureLast(t.entry, n)
        t.entry.readMarker = ctx.mark(t.entry)
        ctx.markUsed(t.key)
        const body = capture.lines.join('\n').trimEnd()
        const screenNote = capture.isAlternate ? ' · full-screen program active' : ''
        return `[${t.key} "${t.label}" · last ${capture.lines.length} lines${screenNote}]\n${body || '(empty)'}`
    },
}

export const runCommandTool: AgentTool = {
    spec: {
        name: 'run_command',
        description: 'Type a shell command into a terminal, press Enter, and wait for it to finish. Returns the output and whether the prompt came back, the program is waiting for input, or it is still running. One command per call; chain with && when steps belong together.',
        parameters: {
            type: 'object',
            properties: {
                terminal: TERMINAL_PARAM,
                command: { type: 'string', description: 'Exact command line to run.' },
                risk_level: { type: 'string', enum: ['low', 'medium', 'high'], description: 'low: read-only/inspection. medium: changes files, packages, services or network config. high: destructive or hard to undo.' },
                explanation: { type: 'string', description: 'One sentence for the user: what this does and why.' },
                timeout_seconds: { type: 'integer', description: 'How long to wait before reporting back if the command has not finished (default 60).' },
            },
            required: ['terminal', 'command', 'risk_level', 'explanation'],
            additionalProperties: false,
        },
    },
    terminalArg: 'terminal',
    approval (args): ApprovalRequirement {
        const a = assessCommand(str(args.command), args.risk_level)
        return { level: a.level, hardBlock: a.hardBlock, reason: a.reason }
    },
    async execute (args, ctx) {
        const command = str(args.command)
        if (!command.trim()) {
            throw new Error('command must not be empty')
        }
        const t = ctx.resolveTerminal(args.terminal)
        if (t.entry.busyWith && t.entry.busyWith !== ctx.toolCallId) {
            throw new Error(`Terminal ${t.key} "${t.label}" is busy with another command. Wait for it or pick another terminal.`)
        }
        await wake(ctx, t)
        if (ctx.isAlternateScreen(t.entry)) {
            throw new Error(`Terminal ${t.key} "${t.label}" has a full-screen program open. Exit it first (send_keys) or use read_terminal to see it.`)
        }
        const timeoutS = Math.max(2, Math.min(3600, num(args.timeout_seconds, ctx.defaultTimeoutSeconds)))
        ctx.reveal(t.entry)
        ctx.markUsed(t.key)
        t.entry.busyWith = ctx.toolCallId
        try {
            const result = await ctx.runner.run(t.entry, command, {
                timeoutMs: timeoutS * 1000,
                signal: ctx.signal,
                onProgress: text => ctx.progress(text),
            })
            t.entry.readMarker = result.end
            ctx.setExitState(result.state)
            return describeRunResult(t.label, t.key, result, timeoutS)
        } finally {
            t.entry.busyWith = null
        }
    },
}

export const sendKeysTool: AgentTool = {
    spec: {
        name: 'send_keys',
        description: 'Send keystrokes to a terminal without a trailing Enter (unless you include "enter"). Use it to answer prompts (y/n), drive full-screen programs, or interrupt with ctrl-c. Never use it to type passwords – ask the user to type those.',
        parameters: {
            type: 'object',
            properties: {
                terminal: TERMINAL_PARAM,
                keys: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Sequence of keys. Plain text is typed literally; special names: enter, tab, esc, space, backspace, up, down, left, right, ctrl-c, ctrl-d, ctrl-z, ctrl-l. Example: ["y", "enter"].',
                },
                explanation: { type: 'string', description: 'Why these keys are being sent.' },
                risk_level: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Risk of what these keys will cause (confirming a destructive prompt is high).' },
                timeout_seconds: { type: 'integer', description: 'How long to wait for the terminal to settle afterwards (default 15).' },
            },
            required: ['terminal', 'keys', 'explanation'],
            additionalProperties: false,
        },
    },
    terminalArg: 'terminal',
    approval (args): ApprovalRequirement {
        const keys: string[] = Array.isArray(args.keys) ? args.keys.map(str) : []
        const benign = keys.every(k => /^(ctrl-c|ctrl-l|esc|escape|enter|q|space|up|down|left|right|pageup|pagedown|home|end)$/i.test(k.trim()))
        const claimed = normalizeRisk(args.risk_level ?? (benign ? 'low' : 'medium'))
        return { level: benign ? claimed : maxRisk(claimed, 'medium'), hardBlock: false }
    },
    async execute (args, ctx) {
        const keys: string[] = Array.isArray(args.keys) ? args.keys.map(str) : [str(args.keys)]
        if (!keys.length) {
            throw new Error('keys must not be empty')
        }
        const data = keys.map(k => {
            try {
                return translateKeys(k)
            } catch {
                return k   // literal text
            }
        }).join('')
        const t = ctx.resolveTerminal(args.terminal)
        await wake(ctx, t)
        const timeoutS = Math.max(1, Math.min(600, num(args.timeout_seconds, 15)))
        ctx.reveal(t.entry)
        ctx.markUsed(t.key)
        const prevBusy = t.entry.busyWith
        t.entry.busyWith = ctx.toolCallId
        try {
            const result = await ctx.runner.sendKeys(t.entry, data, {
                timeoutMs: timeoutS * 1000,
                signal: ctx.signal,
                onProgress: text => ctx.progress(text),
            })
            t.entry.readMarker = result.end
            ctx.setExitState(result.state)
            return describeRunResult(t.label, t.key, result, timeoutS)
        } finally {
            t.entry.busyWith = prevBusy && prevBusy !== ctx.toolCallId ? prevBusy : null
        }
    },
}

export const waitForOutputTool: AgentTool = {
    spec: {
        name: 'wait_for_output',
        description: 'Keep waiting on a terminal where a command is still running (after a timeout/idle result), or wait for the user to finish typing something. Returns the output produced since the last read.',
        parameters: {
            type: 'object',
            properties: {
                terminal: TERMINAL_PARAM,
                timeout_seconds: { type: 'integer', description: 'Maximum time to wait (default 60).' },
                until_regex: { type: 'string', description: 'Optional regular expression; return as soon as the new output matches it.' },
            },
            required: ['terminal'],
            additionalProperties: false,
        },
    },
    terminalArg: 'terminal',
    approval: () => null,
    async execute (args, ctx) {
        const t = ctx.resolveTerminal(args.terminal)
        await wake(ctx, t)
        const timeoutS = Math.max(1, Math.min(3600, num(args.timeout_seconds, 60)))
        let regex: RegExp | null = null
        if (args.until_regex) {
            try {
                regex = new RegExp(str(args.until_regex), 'm')
            } catch (e) {
                throw new Error(`until_regex is not a valid regular expression: ${(e as Error).message}`)
            }
        }
        ctx.markUsed(t.key)
        const wasBusy = t.entry.busyWith
        t.entry.busyWith = ctx.toolCallId
        try {
            const result = await ctx.runner.waitForOutput(t.entry, t.entry.readMarker, {
                timeoutMs: timeoutS * 1000,
                signal: ctx.signal,
                untilRegex: regex,
                onProgress: text => ctx.progress(text),
                idleMs: Math.min(timeoutS * 1000, 20_000),
            })
            t.entry.readMarker = result.end
            ctx.setExitState(result.state)
            return describeRunResult(t.label, t.key, result, timeoutS)
        } finally {
            t.entry.busyWith = wasBusy && wasBusy !== ctx.toolCallId ? wasBusy : null
        }
    },
}

export const askUserTool: AgentTool = {
    spec: {
        name: 'ask_user',
        description: 'Ask the user a question in the panel and wait for the answer. Use it for missing information, decisions with real consequences, or before touching anything the user did not clearly ask for.',
        parameters: {
            type: 'object',
            properties: {
                question: { type: 'string', description: 'The question, phrased so it can be answered briefly.' },
                choices: { type: 'array', items: { type: 'string' }, description: 'Optional fixed options shown as buttons.' },
            },
            required: ['question'],
            additionalProperties: false,
        },
    },
    approval: () => null,
    async execute (args, ctx) {
        const question = str(args.question).trim()
        if (!question) {
            throw new Error('question must not be empty')
        }
        const choices = Array.isArray(args.choices) ? args.choices.map(str).filter(Boolean) : undefined
        const answer = await ctx.askUser(question, choices?.length ? choices : undefined)
        return `User answered: ${answer}`
    },
}

export const openTerminalTool: AgentTool = {
    spec: {
        name: 'open_terminal',
        description: 'Open a new terminal tab from one of the user\'s saved Tabby profiles (SSH hosts, local shells). Returns the new terminal\'s key. Use list_terminals first – only open a new tab when no suitable one exists.',
        parameters: {
            type: 'object',
            properties: {
                profile: { type: 'string', description: 'Profile name as it appears in Tabby (case-insensitive), or an ssh host name that appears in a profile.' },
            },
            required: ['profile'],
            additionalProperties: false,
        },
    },
    approval: () => ({ level: 'medium', hardBlock: false }),
    async execute (args, ctx) {
        const ref = str(args.profile).trim()
        if (!ref) {
            const profiles = ctx.listProfiles()
            return `profile is required. Available profiles:\n${profiles.map(p => `- ${p.name} (${p.kind}${p.detail ? `, ${p.detail}` : ''})`).join('\n')}`
        }
        const t = await ctx.openTerminal(ref)
        ctx.markUsed(t.key)
        return `Opened ${t.key} "${t.label}". Give it a moment, then read_terminal to confirm it is ready (SSH hosts may ask for a password – the user must type it).`
    },
}

export const focusTerminalTool: AgentTool = {
    spec: {
        name: 'focus_terminal',
        description: 'Switch the user\'s view to a terminal tab (for example to let them type a password or watch something).',
        parameters: {
            type: 'object',
            properties: { terminal: TERMINAL_PARAM },
            required: ['terminal'],
            additionalProperties: false,
        },
    },
    terminalArg: 'terminal',
    approval: () => null,
    async execute (args, ctx) {
        const t = ctx.resolveTerminal(args.terminal)
        ctx.focus(t.entry)
        return `Focused ${t.key} "${t.label}".`
    },
}

export const ALL_TOOLS: AgentTool[] = [
    listTerminalsTool,
    readTerminalTool,
    runCommandTool,
    sendKeysTool,
    waitForOutputTool,
    askUserTool,
    openTerminalTool,
    focusTerminalTool,
]

export function findTool (name: string): AgentTool | undefined {
    return ALL_TOOLS.find(t => t.spec.name === name)
}
